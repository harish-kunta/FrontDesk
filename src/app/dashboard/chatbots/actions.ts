"use server";

import { createHash } from "node:crypto";
import { and, asc, cosineDistance, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { chatbots, chunks, sources } from "@/db/schema";
import { EmbeddingError, embedTexts } from "@/lib/ai/embed";
import { requireOwnedChatbot } from "@/lib/chatbots";
import { MAX_SOURCE_CHARS, RETRIEVAL_LIMIT, RETRIEVAL_THRESHOLD } from "@/lib/rag-config";
import { chunkText } from "@/lib/text-chunking";
import { requireWorkspace } from "@/lib/workspace";

const MAX_BOTS_PER_WORKSPACE = 1;

export type SourceActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type RetrievalChunk = {
  sourceName: string;
  index: number;
  content: string;
  tokenCount: number;
  similarity: number;
};

export type RetrievalActionState = {
  status: "idle" | "success" | "error";
  message: string;
  question: string;
  chunks: RetrievalChunk[];
  promptPreview: string;
};

export async function createChatbot(formData: FormData) {
  const rawName = formData.get("name");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (name.length < 2 || name.length > 80) {
    redirect("/dashboard/chatbots/new?error=name");
  }

  const { workspace } = await requireWorkspace();
  const [existing] = await db
    .select({ id: chatbots.id })
    .from(chatbots)
    .where(eq(chatbots.workspaceId, workspace.id))
    .limit(MAX_BOTS_PER_WORKSPACE);

  if (existing) redirect(`/dashboard/chatbots/${existing.id}/playground`);

  const [chatbot] = await db
    .insert(chatbots)
    .values({ workspaceId: workspace.id, name, status: "draft" })
    .onConflictDoNothing({ target: chatbots.workspaceId })
    .returning({ id: chatbots.id });

  if (!chatbot) {
    const [createdByAnotherRequest] = await db
      .select({ id: chatbots.id })
      .from(chatbots)
      .where(eq(chatbots.workspaceId, workspace.id))
      .limit(1);
    if (createdByAnotherRequest) {
      redirect(`/dashboard/chatbots/${createdByAnotherRequest.id}/playground`);
    }
    redirect("/dashboard/chatbots");
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/chatbots");
  redirect(`/dashboard/chatbots/${chatbot.id}/playground`);
}

export async function ingestTextSource(
  chatbotId: string,
  _previousState: SourceActionState,
  formData: FormData,
): Promise<SourceActionState> {
  const { chatbot } = await requireOwnedChatbot(chatbotId);
  const rawName = formData.get("name");
  const rawContent = formData.get("content");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  const content = typeof rawContent === "string" ? rawContent.trim() : "";

  if (name.length < 2 || name.length > 100) {
    return { status: "error", message: "Give this text source a name (2–100 characters)." };
  }
  if (!content) return { status: "error", message: "Paste some text before indexing it." };
  if (content.length > MAX_SOURCE_CHARS) {
    return {
      status: "error",
      message: `This MVP accepts up to ${MAX_SOURCE_CHARS.toLocaleString()} characters per text source.`,
    };
  }

  const textChunks = chunkText(content);
  try {
    const { embeddings } = await embedTexts(textChunks.map((chunk) => chunk.content));
    if (embeddings.length !== textChunks.length) {
      return { status: "error", message: "Not all text could be embedded. Please retry." };
    }

    await db.transaction(async (tx) => {
      const [source] = await tx
        .insert(sources)
        .values({
          chatbotId: chatbot.id,
          name,
          content,
          charCount: content.length,
          status: "ready",
        })
        .returning({ id: sources.id });

      await tx.insert(chunks).values(
        textChunks.map((chunk, index) => ({
          chatbotId: chatbot.id,
          sourceId: source.id,
          content: chunk.content,
          chunkIndex: chunk.index,
          tokenCount: chunk.estimatedTokens,
          contentHash: createHash("sha256").update(chunk.content).digest("hex"),
          metadata: { sourceName: name },
          embedding: embeddings[index],
        })),
      );
    });

    revalidatePath(`/dashboard/chatbots/${chatbot.id}/playground`);
    return {
      status: "success",
      message: `Indexed ${textChunks.length} chunk${textChunks.length === 1 ? "" : "s"}. You can now try a question below.`,
    };
  } catch (error) {
    if (error instanceof EmbeddingError) {
      return { status: "error", message: error.message };
    }
    return { status: "error", message: "The source could not be saved. Please retry." };
  }
}

export async function previewRetrieval(
  chatbotId: string,
  _previousState: RetrievalActionState,
  formData: FormData,
): Promise<RetrievalActionState> {
  const { chatbot } = await requireOwnedChatbot(chatbotId);
  const rawQuestion = formData.get("question");
  const question = typeof rawQuestion === "string" ? rawQuestion.trim() : "";
  if (!question || question.length > 1_000) {
    return {
      status: "error",
      message: "Enter a question up to 1,000 characters long.",
      question,
      chunks: [],
      promptPreview: "",
    };
  }

  try {
    const { embeddings } = await embedTexts([question]);
    const queryEmbedding = embeddings[0];
    const distance = cosineDistance(chunks.embedding, queryEmbedding);
    const similarity = sql<number>`1 - (${distance})`;

    const rows = await db
      .select({
        sourceName: sources.name,
        index: chunks.chunkIndex,
        content: chunks.content,
        tokenCount: chunks.tokenCount,
        similarity,
      })
      .from(chunks)
      .innerJoin(sources, eq(chunks.sourceId, sources.id))
      // The bot was first resolved inside the signed-in workspace above. Keep
      // this explicit bot filter on every vector retrieval query as well.
      .where(and(eq(chunks.chatbotId, chatbot.id), eq(sources.chatbotId, chatbot.id)))
      .orderBy(asc(distance))
      .limit(RETRIEVAL_LIMIT);

    const matches = rows.map((row) => ({ ...row, similarity: Number(row.similarity) }));
    const contextChunks = matches.filter((chunk) => chunk.similarity >= RETRIEVAL_THRESHOLD);
    const promptPreview = [
      "SYSTEM",
      "You are a helpful support assistant. Answer only from the supplied context. If the answer is missing, say you do not know. Be concise and cite the source name.",
      "",
      "CONTEXT",
      ...(contextChunks.length === 0
        ? ["No retrieved chunks meet the similarity threshold; the assistant should fall back."]
        : contextChunks.map(
            (chunk, index) => `[${index + 1}] Source: ${chunk.sourceName}\n${chunk.content}`,
          )),
      "",
      `USER QUESTION\n${question}`,
    ].join("\n");

    return {
      status: "success",
      message:
        matches.length === 0
          ? "No chunks are indexed yet. Add a text source above first."
          : contextChunks.length === 0
            ? `No result met the ${RETRIEVAL_THRESHOLD.toFixed(2)} similarity threshold. M2 will use the fallback path.`
            : `${contextChunks.length} of ${matches.length} retrieved chunks meet the ${RETRIEVAL_THRESHOLD.toFixed(2)} threshold.`,
      question,
      chunks: matches,
      promptPreview,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof EmbeddingError
          ? error.message
          : "The question could not be searched. Please retry.",
      question,
      chunks: [],
      promptPreview: "",
    };
  }
}

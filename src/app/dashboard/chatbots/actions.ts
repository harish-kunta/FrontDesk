"use server";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { chatbots, chunks, sources } from "@/db/schema";
import { EmbeddingError, embedTexts } from "@/lib/ai/embed";
import { requireOwnedChatbot } from "@/lib/chatbots";
import { MAX_SOURCE_CHARS } from "@/lib/rag-config";
import { chunkText } from "@/lib/text-chunking";
import { normalizeDomain, type WidgetConfig } from "@/lib/widget";
import { requireWorkspace } from "@/lib/workspace";

const MAX_BOTS_PER_WORKSPACE = 1;

export type SourceActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type WidgetActionState = SourceActionState;

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
      await tx.update(chatbots).set({ status: "ready" }).where(eq(chatbots.id, chatbot.id));
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

export async function saveWidgetSettings(
  chatbotId: string,
  _previousState: WidgetActionState,
  formData: FormData,
): Promise<WidgetActionState> {
  const { chatbot } = await requireOwnedChatbot(chatbotId);
  const rawColor = formData.get("color");
  const rawAvatarUrl = formData.get("avatarUrl");
  const rawPosition = formData.get("position");
  const rawWelcome = formData.get("welcomeMessage");
  const rawQuestions = formData.get("starterQuestions");
  const rawDomains = formData.get("allowedDomains");
  const leadCapture = formData.get("leadCapture") === "on";
  const color = typeof rawColor === "string" ? rawColor.trim() : "";
  const avatarUrl = typeof rawAvatarUrl === "string" ? rawAvatarUrl.trim() : "";
  const position = typeof rawPosition === "string" ? rawPosition : "right";
  const welcomeMessage = typeof rawWelcome === "string" ? rawWelcome.trim() : "";
  const starterQuestions =
    typeof rawQuestions === "string"
      ? rawQuestions
          .split("\n")
          .map((question) => question.trim())
          .filter(Boolean)
      : [];
  const submittedDomains =
    typeof rawDomains === "string"
      ? rawDomains
          .split(/[\n,]/)
          .map((domain) => domain.trim())
          .filter(Boolean)
      : [];

  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    return { status: "error", message: "Choose a valid six-digit hex brand color." };
  }
  if (avatarUrl) {
    try {
      const parsedAvatarUrl = new URL(avatarUrl);
      if (parsedAvatarUrl.protocol !== "https:" || avatarUrl.length > 2_000) throw new Error();
    } catch {
      return { status: "error", message: "Avatar images must use a valid HTTPS URL." };
    }
  }
  if (position !== "left" && position !== "right") {
    return { status: "error", message: "Choose left or right widget placement." };
  }
  if (!welcomeMessage || welcomeMessage.length > 240) {
    return { status: "error", message: "The welcome message must be 1–240 characters." };
  }
  if (starterQuestions.length > 3 || starterQuestions.some((question) => question.length > 80)) {
    return {
      status: "error",
      message: "Add up to 3 starter questions, each 80 characters or less.",
    };
  }
  if (submittedDomains.length > 20) {
    return { status: "error", message: "Add up to 20 website domains." };
  }
  const allowedDomains = submittedDomains.map(normalizeDomain);
  if (allowedDomains.some((domain) => domain === null)) {
    return {
      status: "error",
      message: "Enter domains only, like example.com. Do not include a URL path or protocol.",
    };
  }

  const widgetConfig: WidgetConfig = {
    color,
    avatarUrl,
    position,
    welcomeMessage,
    starterQuestions,
    allowedDomains: [...new Set(allowedDomains as string[])],
    leadCapture,
  };
  await db.update(chatbots).set({ widgetConfig }).where(eq(chatbots.id, chatbot.id));
  revalidatePath(`/dashboard/chatbots/${chatbot.id}/widget`);
  revalidatePath(`/b/${chatbot.id}`);
  return { status: "success", message: "Widget settings saved." };
}

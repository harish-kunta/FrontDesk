import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { chatbots, chunks, conversations, messages, sources } from "@/db/schema";
import {
  buildChatInput,
  buildGroundedInstructions,
  CHAT_ERROR_MESSAGE,
  CHAT_FALLBACK,
  CHAT_MODEL,
  ChatGenerationError,
  type ChatHistoryMessage,
  type GroundingChunk,
  isFallbackAnswer,
  startChatResponse,
} from "@/lib/ai/chat";
import { EmbeddingError, embedTexts } from "@/lib/ai/embed";
import { retrieveChunks } from "@/lib/ai/retrieval";
import { RETRIEVAL_THRESHOLD } from "@/lib/rag-config";
import { requireWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_QUESTION_CHARS = 2_000;
const MAX_HISTORY_MESSAGES = 10;

type RouteContext = { params: Promise<{ chatbotId: string }> };

type RetrievedChunk = GroundingChunk & {
  tokenCount: number;
  similarity: number;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function findOwnedChatbot(chatbotId: string) {
  const session = await auth();
  if (!session?.user?.id) return { response: jsonError("Sign in to use the playground.", 401) };
  if (!UUID_PATTERN.test(chatbotId)) return { response: jsonError("Chatbot not found.", 404) };

  const { workspace } = await requireWorkspace();
  const [chatbot] = await db
    .select({ id: chatbots.id })
    .from(chatbots)
    .where(and(eq(chatbots.id, chatbotId), eq(chatbots.workspaceId, workspace.id)))
    .limit(1);

  if (!chatbot) return { response: jsonError("Chatbot not found.", 404) };
  return { chatbot };
}

async function findConversation(conversationId: string, chatbotId: string) {
  if (!UUID_PATTERN.test(conversationId)) return null;
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.chatbotId, chatbotId)))
    .limit(1);
  return conversation ?? null;
}

async function loadRecentHistory(conversationId: string): Promise<ChatHistoryMessage[]> {
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.sequence))
    .limit(MAX_HISTORY_MESSAGES);

  return rows.reverse().map((message) => ({ role: message.role, content: message.content }));
}

async function loadCitations(chunkIds: string[], chatbotId: string) {
  const uniqueIds = [...new Set(chunkIds)].filter((id) => UUID_PATTERN.test(id));
  if (uniqueIds.length === 0) return [];

  const rows = await db
    .select({
      id: chunks.id,
      sourceName: sources.name,
      chunkIndex: chunks.chunkIndex,
    })
    .from(chunks)
    .innerJoin(sources, eq(chunks.sourceId, sources.id))
    .where(and(eq(chunks.chatbotId, chatbotId), inArray(chunks.id, uniqueIds)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return uniqueIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id: row.id, sourceName: row.sourceName, chunkIndex: row.chunkIndex }] : [];
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { chatbotId } = await context.params;
  const owned = await findOwnedChatbot(chatbotId);
  if ("response" in owned) return owned.response;

  const conversationId = new URL(request.url).searchParams.get("conversationId") ?? "";
  const conversation = await findConversation(conversationId, owned.chatbot.id);
  if (!conversation) return jsonError("Conversation not found.", 404);

  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      citedChunkIds: messages.citedChunkIds,
      isFallback: messages.isFallback,
      inputTokens: messages.inputTokens,
      outputTokens: messages.outputTokens,
      latencyMs: messages.latencyMs,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(asc(messages.sequence))
    .limit(200);

  const citationsByMessage = await Promise.all(
    rows.map((row) => loadCitations(row.citedChunkIds ?? [], owned.chatbot.id)),
  );

  return Response.json(
    {
      conversationId: conversation.id,
      messages: rows.map((row, index) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        citations: citationsByMessage[index].map((citation, citationIndex) => ({
          ...citation,
          reference:
            [...new Set([...row.content.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])))][
              citationIndex
            ] ?? citationIndex + 1,
        })),
        isFallback: row.isFallback,
        usage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens },
        latencyMs: row.latencyMs,
        createdAt: row.createdAt,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const { chatbotId } = await context.params;
  const owned = await findOwnedChatbot(chatbotId);
  if ("response" in owned) return owned.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Send a valid JSON request.", 400);
  }

  if (typeof body !== "object" || body === null)
    return jsonError("Send a question to the assistant.", 400);
  const rawQuestion = "question" in body ? body.question : undefined;
  const rawConversationId = "conversationId" in body ? body.conversationId : undefined;
  const question = typeof rawQuestion === "string" ? rawQuestion.trim() : "";
  const requestedConversationId =
    typeof rawConversationId === "string" ? rawConversationId.trim() : "";

  if (!question || question.length > MAX_QUESTION_CHARS) {
    return jsonError(
      `Enter a question up to ${MAX_QUESTION_CHARS.toLocaleString()} characters long.`,
      400,
    );
  }
  if (requestedConversationId && !UUID_PATTERN.test(requestedConversationId)) {
    return jsonError("Conversation not found.", 404);
  }

  const existingConversation = requestedConversationId
    ? await findConversation(requestedConversationId, owned.chatbot.id)
    : null;
  if (requestedConversationId && !existingConversation)
    return jsonError("Conversation not found.", 404);

  const requestStartedAt = Date.now();
  let queryEmbedding: number[];
  try {
    const result = await embedTexts([question]);
    queryEmbedding = result.embeddings[0];
  } catch (error) {
    return jsonError(
      error instanceof EmbeddingError
        ? error.message
        : "The question could not be searched. Please retry.",
      503,
    );
  }

  const retrievedRows = await retrieveChunks(owned.chatbot.id, queryEmbedding);

  const retrieved: RetrievedChunk[] = retrievedRows.map((row) => ({
    ...row,
    similarity: Number(row.similarity),
  }));
  const groundingChunks = retrieved.filter((chunk) => chunk.similarity >= RETRIEVAL_THRESHOLD);
  const history = existingConversation ? await loadRecentHistory(existingConversation.id) : [];
  const instructions = buildGroundedInstructions(groundingChunks);
  const modelInput = buildChatInput(history, question);
  const debugContext = {
    threshold: RETRIEVAL_THRESHOLD,
    model: CHAT_MODEL,
    retrieved,
    usedChunks: groundingChunks.map(({ id, sourceName, chunkIndex, content }) => ({
      id,
      sourceName,
      chunkIndex,
      content,
    })),
    prompt:
      groundingChunks.length > 0
        ? JSON.stringify({ instructions, input: modelInput }, null, 2)
        : "No prompt was sent to the model because no retrieved passage met the similarity threshold.",
  };

  let upstream: Response | null = null;
  if (groundingChunks.length > 0) {
    try {
      upstream = await startChatResponse({ instructions, history, question });
    } catch (error) {
      const message =
        error instanceof ChatGenerationError
          ? error.message
          : "The assistant could not start a response. Please retry.";
      return jsonError(message, 503);
    }
  }

  const conversation = existingConversation
    ? existingConversation
    : (
        await db
          .insert(conversations)
          .values({ chatbotId: owned.chatbot.id })
          .returning({ id: conversations.id })
      )[0];

  async function saveAssistantMessage(input: {
    content: string;
    citedChunkIds: string[];
    isFallback: boolean;
    inputTokens?: number | null;
    outputTokens?: number | null;
    latencyMs: number;
  }) {
    await db.transaction(async (tx) => {
      await tx.insert(messages).values({
        conversationId: conversation.id,
        role: "user",
        content: question,
      });
      await tx.insert(messages).values({
        conversationId: conversation.id,
        role: "assistant",
        content: input.content,
        citedChunkIds: input.citedChunkIds,
        model: groundingChunks.length > 0 ? CHAT_MODEL : null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        latencyMs: input.latencyMs,
        isFallback: input.isFallback,
      });
      await tx
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversation.id));
    });
  }

  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("conversation", { conversationId: conversation.id });
      send("context", debugContext);

      if (!upstream?.body) {
        await saveAssistantMessage({
          content: CHAT_FALLBACK,
          citedChunkIds: [],
          isFallback: true,
          latencyMs: Date.now() - requestStartedAt,
        });
        send("replace", { answer: CHAT_FALLBACK });
        send("done", {
          answer: CHAT_FALLBACK,
          citations: [],
          fallback: true,
          usage: null,
          latencyMs: Date.now() - requestStartedAt,
        });
        controller.close();
        return;
      }

      const reader = upstream.body.getReader();
      activeReader = reader;
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedAnswer = "";
      let usage: { inputTokens: number | null; outputTokens: number | null } = {
        inputTokens: null,
        outputTokens: null,
      };

      const processEvent = (frame: string) => {
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") return;

        let event: {
          type?: string;
          delta?: string;
          message?: string;
          response?: { usage?: { input_tokens?: number; output_tokens?: number } };
        };
        try {
          event = JSON.parse(data) as typeof event;
        } catch {
          return;
        }

        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          streamedAnswer += event.delta;
          send("delta", { delta: event.delta });
        } else if (event.type === "response.completed") {
          usage = {
            inputTokens: event.response?.usage?.input_tokens ?? null,
            outputTokens: event.response?.usage?.output_tokens ?? null,
          };
        } else if (event.type === "error" || event.type === "response.failed") {
          throw new Error(event.message || "The model stream failed.");
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (cancelled) return;
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let separator = buffer.match(/\r?\n\r?\n/);
          while (separator?.index !== undefined) {
            processEvent(buffer.slice(0, separator.index));
            buffer = buffer.slice(separator.index + separator[0].length);
            separator = buffer.match(/\r?\n\r?\n/);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) processEvent(buffer);

        const citationNumbers = [...streamedAnswer.matchAll(/\[(\d+)\]/g)].map((match) =>
          Number(match[1]),
        );
        const citedIndexes = [...new Set(citationNumbers)]
          .filter((number) => number >= 1 && number <= groundingChunks.length)
          .map((number) => number - 1);
        const citedChunks = citedIndexes.map((index) => groundingChunks[index]);
        const referenceNumbers = new Map(
          citedIndexes.map((originalIndex, citationIndex) => [
            originalIndex + 1,
            citationIndex + 1,
          ]),
        );
        const modelDeclined = isFallbackAnswer(streamedAnswer);
        const citationlessAnswer = citedChunks.length === 0 && !modelDeclined;
        const fallback = citationlessAnswer || modelDeclined;
        const answer = fallback
          ? CHAT_FALLBACK
          : streamedAnswer
              .replace(/\[(\d+)\]/g, (_marker, rawNumber: string) => {
                const remapped = referenceNumbers.get(Number(rawNumber));
                return remapped ? `[${remapped}]` : "";
              })
              .trim() || CHAT_FALLBACK;
        const finalCitations = fallback
          ? []
          : await loadCitations(
              citedChunks.map((chunk) => chunk.id),
              owned.chatbot.id,
            );
        const latencyMs = Date.now() - requestStartedAt;

        await saveAssistantMessage({
          content: answer,
          citedChunkIds: finalCitations.map((citation) => citation.id),
          isFallback: fallback,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs,
        });

        if (fallback) send("replace", { answer });
        send("done", {
          answer,
          citations: finalCitations.map((citation, index) => ({
            ...citation,
            reference: index + 1,
          })),
          fallback,
          usage,
          latencyMs,
        });
        controller.close();
      } catch {
        if (cancelled) return;
        const latencyMs = Date.now() - requestStartedAt;
        await saveAssistantMessage({
          content: CHAT_ERROR_MESSAGE,
          citedChunkIds: [],
          isFallback: true,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs,
        });
        send("replace", { answer: CHAT_ERROR_MESSAGE });
        send("done", {
          answer: CHAT_ERROR_MESSAGE,
          citations: [],
          fallback: true,
          usage,
          latencyMs,
          error: "The model stream did not finish. You can retry your question.",
        });
        controller.close();
      } finally {
        reader.releaseLock();
        activeReader = null;
      }
    },
    async cancel() {
      cancelled = true;
      await activeReader?.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

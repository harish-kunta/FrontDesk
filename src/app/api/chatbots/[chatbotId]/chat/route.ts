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
import { rewriteSearchQuestion } from "@/lib/ai/chat-provider";
import { EmbeddingError, embedTexts } from "@/lib/ai/embed";
import { retrieveChunks } from "@/lib/ai/retrieval";
import { getCourtesyReply } from "@/lib/ai/visitor-intents";
import { consumePublicChatRequest } from "@/lib/public-rate-limit";
import { QUERY_REWRITE_MIN_SIMILARITY, RETRIEVAL_THRESHOLD } from "@/lib/rag-config";
import { corsHeaders, DEFAULT_WIDGET_CONFIG, originIsAllowed } from "@/lib/widget";
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

function editDistanceAtMostTwo(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 2) return false;

  // Damerau-Levenshtein with a small cutoff: single-character typos and
  // adjacent transpositions are common, while larger rewrites are unsafe.
  const rows = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );
  for (let i = 0; i <= left.length; i++) rows[i][0] = i;
  for (let j = 0; j <= right.length; j++) rows[0][j] = j;

  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + substitutionCost,
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }

  return rows[left.length][right.length] <= 2;
}

function selectSafeSearchRewrite(original: string, candidate: string) {
  const cleaned = candidate
    .replace(/^['"“”]|['"“”]$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > MAX_QUESTION_CHARS || cleaned === original) return null;

  const originalWords = original.match(/[\p{L}\p{N}]+/gu) ?? [];
  const candidateWords = cleaned.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (originalWords.length !== candidateWords.length) return null;

  let changedWords = 0;
  for (let index = 0; index < originalWords.length; index++) {
    const before = originalWords[index].toLocaleLowerCase();
    const after = candidateWords[index].toLocaleLowerCase();
    if (before === after) continue;
    if (before.length < 4 || after.length < 4 || !editDistanceAtMostTwo(before, after)) return null;
    changedWords++;
  }

  return changedWords > 0 ? cleaned : null;
}

function eventStreamResponse(events: Array<[string, unknown]>, allowedOrigin?: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [event, data] of events) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
      ...(allowedOrigin ? corsHeaders(allowedOrigin) : {}),
    },
  });
}

function addUsage(
  modelUsage: { inputTokens: number | null; outputTokens: number | null },
  additionalUsage: { inputTokens: number | null; outputTokens: number | null } | null,
) {
  if (!additionalUsage) return modelUsage;
  return {
    inputTokens:
      modelUsage.inputTokens === null && additionalUsage.inputTokens === null
        ? null
        : (modelUsage.inputTokens ?? 0) + (additionalUsage.inputTokens ?? 0),
    outputTokens:
      modelUsage.outputTokens === null && additionalUsage.outputTokens === null
        ? null
        : (modelUsage.outputTokens ?? 0) + (additionalUsage.outputTokens ?? 0),
  };
}

function jsonError(message: string, status: number, allowedOrigin?: string) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(allowedOrigin ? corsHeaders(allowedOrigin) : {}),
      },
    },
  );
}

async function findPostChatbot(chatbotId: string, request: Request) {
  const session = await auth();
  if (session?.user?.id) {
    const owned = await findOwnedChatbot(chatbotId);
    if (!("response" in owned)) return owned;
  }
  if (!UUID_PATTERN.test(chatbotId)) return { response: jsonError("Chatbot not found.", 404) };

  const [chatbot] = await db
    .select({ id: chatbots.id, widgetConfig: chatbots.widgetConfig })
    .from(chatbots)
    .where(eq(chatbots.id, chatbotId))
    .limit(1);
  if (!chatbot) return { response: jsonError("Chatbot not found.", 404) };

  const origin = request.headers.get("origin");
  if (
    !originIsAllowed(
      origin,
      chatbot.widgetConfig ?? DEFAULT_WIDGET_CONFIG,
      new URL(request.url).origin,
    )
  ) {
    return { response: jsonError("This website is not enabled for this chatbot.", 403) };
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const clientAddress = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  const limit = consumePublicChatRequest(`${chatbot.id}:${clientAddress}`);
  if (!limit.allowed) {
    return {
      response: jsonError(
        "This assistant is receiving too many messages. Please try again shortly.",
        429,
        origin ?? undefined,
      ),
    };
  }

  return { chatbot: { id: chatbot.id }, allowedOrigin: origin ?? undefined };
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
      sourceUrl: sources.url,
      chunkIndex: chunks.chunkIndex,
    })
    .from(chunks)
    .innerJoin(sources, eq(chunks.sourceId, sources.id))
    .where(and(eq(chunks.chatbotId, chatbotId), inArray(chunks.id, uniqueIds)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return uniqueIds.flatMap((id) => {
    const row = byId.get(id);
    return row
      ? [
          {
            id: row.id,
            sourceName: row.sourceName,
            sourceUrl: row.sourceUrl,
            chunkIndex: row.chunkIndex,
          },
        ]
      : [];
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
      rating: messages.rating,
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
        rating: row.rating,
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
  const owned = await findPostChatbot(chatbotId, request);
  if ("response" in owned) return owned.response;
  const allowedOrigin = "allowedOrigin" in owned ? owned.allowedOrigin : undefined;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Send a valid JSON request.", 400, allowedOrigin);
  }

  if (typeof body !== "object" || body === null)
    return jsonError("Send a question to the assistant.", 400, allowedOrigin);
  const rawQuestion = "question" in body ? body.question : undefined;
  const rawConversationId = "conversationId" in body ? body.conversationId : undefined;
  const question = typeof rawQuestion === "string" ? rawQuestion.trim() : "";
  const requestedConversationId =
    typeof rawConversationId === "string" ? rawConversationId.trim() : "";

  if (!question || question.length > MAX_QUESTION_CHARS) {
    return jsonError(
      `Enter a question up to ${MAX_QUESTION_CHARS.toLocaleString()} characters long.`,
      400,
      allowedOrigin,
    );
  }
  if (requestedConversationId && !UUID_PATTERN.test(requestedConversationId)) {
    return jsonError("Conversation not found.", 404, allowedOrigin);
  }

  const existingConversation = requestedConversationId
    ? await findConversation(requestedConversationId, owned.chatbot.id)
    : null;
  if (requestedConversationId && !existingConversation)
    return jsonError("Conversation not found.", 404);

  const requestStartedAt = Date.now();
  const courtesyReply = getCourtesyReply(question);
  if (courtesyReply) {
    const conversation = existingConversation
      ? existingConversation
      : (
          await db
            .insert(conversations)
            .values({ chatbotId: owned.chatbot.id })
            .returning({ id: conversations.id })
        )[0];
    const [assistantMessage] = await db.transaction(async (tx) => {
      await tx.insert(messages).values({
        conversationId: conversation.id,
        role: "user",
        content: question,
      });
      const [assistantMessage] = await tx
        .insert(messages)
        .values({
          conversationId: conversation.id,
          role: "assistant",
          content: courtesyReply,
          model: null,
          latencyMs: Date.now() - requestStartedAt,
          isFallback: false,
        })
        .returning({ id: messages.id });
      await tx
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversation.id));
      return [assistantMessage];
    });

    const latencyMs = Date.now() - requestStartedAt;
    const events: Array<[string, unknown]> = [
      ["conversation", { conversationId: conversation.id }],
    ];
    if (!allowedOrigin) {
      events.push([
        "context",
        {
          threshold: RETRIEVAL_THRESHOLD,
          model: CHAT_MODEL,
          retrieved: [],
          usedChunks: [],
          prompt:
            "A simple courtesy reply was returned without document retrieval or a model call.",
        },
      ]);
    }
    events.push(
      ["delta", { delta: courtesyReply }],
      [
        "done",
        {
          answer: courtesyReply,
          citations: [],
          fallback: false,
          usage: null,
          latencyMs,
          messageId: assistantMessage.id,
        },
      ],
    );
    return eventStreamResponse(events, allowedOrigin);
  }

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
      allowedOrigin,
    );
  }

  const initialRows = await retrieveChunks(owned.chatbot.id, queryEmbedding);

  let retrieved: RetrievedChunk[] = initialRows.map((row) => ({
    ...row,
    similarity: Number(row.similarity),
  }));
  const initialTopSimilarity = retrieved[0]?.similarity ?? 0;
  let rewriteUsage: { inputTokens: number | null; outputTokens: number | null } | null = null;
  let queryRewrite: {
    original: string;
    rewritten: string | null;
    similarityBefore: number;
    similarityAfter: number;
  } | null = null;
  let searchQuestion = question;
  let groundingChunks = retrieved.filter((chunk) => chunk.similarity >= RETRIEVAL_THRESHOLD);

  if (groundingChunks.length === 0 && initialTopSimilarity >= QUERY_REWRITE_MIN_SIMILARITY) {
    try {
      const rewrite = await rewriteSearchQuestion(question);
      rewriteUsage = { inputTokens: rewrite.inputTokens, outputTokens: rewrite.outputTokens };
      const safeRewrite = selectSafeSearchRewrite(question, rewrite.answer);
      if (safeRewrite) {
        const rewrittenEmbedding = (await embedTexts([safeRewrite])).embeddings[0];
        const rewrittenRows = await retrieveChunks(owned.chatbot.id, rewrittenEmbedding);
        const rewrittenRetrieved: RetrievedChunk[] = rewrittenRows.map((row) => ({
          ...row,
          similarity: Number(row.similarity),
        }));
        const rewrittenTopSimilarity = rewrittenRetrieved[0]?.similarity ?? 0;
        queryRewrite = {
          original: question,
          rewritten: safeRewrite,
          similarityBefore: initialTopSimilarity,
          similarityAfter: rewrittenTopSimilarity,
        };

        // Keep the existing confidence bar. A spelling correction is useful only
        // when the corrected search gives us a stronger grounded match.
        if (
          rewrittenTopSimilarity > initialTopSimilarity &&
          rewrittenTopSimilarity >= RETRIEVAL_THRESHOLD
        ) {
          searchQuestion = safeRewrite;
          retrieved = rewrittenRetrieved;
          groundingChunks = retrieved.filter((chunk) => chunk.similarity >= RETRIEVAL_THRESHOLD);
        }
      }
    } catch {
      // Search recovery is best-effort; the original retrieval still controls fallback.
    }
  }

  const history = existingConversation ? await loadRecentHistory(existingConversation.id) : [];
  const instructions = buildGroundedInstructions(groundingChunks);
  const modelInput = buildChatInput(history, searchQuestion);
  const debugContext = {
    threshold: RETRIEVAL_THRESHOLD,
    model: CHAT_MODEL,
    retrieved,
    queryRewrite,
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
      upstream = await startChatResponse({ instructions, history, question: searchQuestion });
    } catch (error) {
      const message =
        error instanceof ChatGenerationError
          ? error.message
          : "The assistant could not start a response. Please retry.";
      return jsonError(message, 503, allowedOrigin);
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
    return db.transaction(async (tx) => {
      await tx.insert(messages).values({
        conversationId: conversation.id,
        role: "user",
        content: question,
      });
      const [assistantMessage] = await tx
        .insert(messages)
        .values({
          conversationId: conversation.id,
          role: "assistant",
          content: input.content,
          citedChunkIds: input.citedChunkIds,
          model: groundingChunks.length > 0 ? CHAT_MODEL : null,
          inputTokens: input.inputTokens ?? null,
          outputTokens: input.outputTokens ?? null,
          latencyMs: input.latencyMs,
          isFallback: input.isFallback,
        })
        .returning({ id: messages.id });
      await tx
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversation.id));
      return assistantMessage;
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
      if (!allowedOrigin) send("context", debugContext);

      if (!upstream?.body) {
        const usage = addUsage({ inputTokens: null, outputTokens: null }, rewriteUsage);
        const savedMessage = await saveAssistantMessage({
          content: CHAT_FALLBACK,
          citedChunkIds: [],
          isFallback: true,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs: Date.now() - requestStartedAt,
        });
        send("replace", { answer: CHAT_FALLBACK });
        send("done", {
          answer: CHAT_FALLBACK,
          citations: [],
          fallback: true,
          usage,
          latencyMs: Date.now() - requestStartedAt,
          messageId: savedMessage.id,
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
        const totalUsage = addUsage(usage, rewriteUsage);

        const savedMessage = await saveAssistantMessage({
          content: answer,
          citedChunkIds: finalCitations.map((citation) => citation.id),
          isFallback: fallback,
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
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
          usage: totalUsage,
          latencyMs,
          messageId: savedMessage.id,
        });
        controller.close();
      } catch {
        if (cancelled) return;
        const latencyMs = Date.now() - requestStartedAt;
        const totalUsage = addUsage(usage, rewriteUsage);
        const savedMessage = await saveAssistantMessage({
          content: CHAT_ERROR_MESSAGE,
          citedChunkIds: [],
          isFallback: true,
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
          latencyMs,
        });
        send("replace", { answer: CHAT_ERROR_MESSAGE });
        send("done", {
          answer: CHAT_ERROR_MESSAGE,
          citations: [],
          fallback: true,
          usage: totalUsage,
          latencyMs,
          messageId: savedMessage.id,
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
      ...(allowedOrigin ? corsHeaders(allowedOrigin) : {}),
    },
  });
}

export async function OPTIONS(request: Request, context: RouteContext) {
  const { chatbotId } = await context.params;
  if (!UUID_PATTERN.test(chatbotId)) return new Response(null, { status: 404 });
  const origin = request.headers.get("origin");
  if (!origin) return new Response(null, { status: 403 });
  const [chatbot] = await db
    .select({ widgetConfig: chatbots.widgetConfig })
    .from(chatbots)
    .where(eq(chatbots.id, chatbotId))
    .limit(1);
  if (!chatbot) return new Response(null, { status: 404 });
  if (
    !originIsAllowed(
      origin,
      chatbot.widgetConfig ?? DEFAULT_WIDGET_CONFIG,
      new URL(request.url).origin,
    )
  ) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

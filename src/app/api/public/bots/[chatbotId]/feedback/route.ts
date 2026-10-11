import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { consumePublicChatRequest } from "@/lib/public-rate-limit";
import {
  publicWidgetCorsHeaders,
  publicWidgetError,
  resolvePublicWidgetRequest,
} from "@/lib/public-widget-request";

type RouteContext = { params: Promise<{ chatbotId: string }> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: RouteContext) {
  const { chatbotId } = await context.params;
  const resolved = await resolvePublicWidgetRequest(request, chatbotId);
  if ("response" in resolved) return resolved.response;

  const limit = consumePublicChatRequest(
    `feedback:${resolved.chatbot.id}:${resolved.clientAddress}`,
  );
  if (!limit.allowed) {
    return publicWidgetError(
      "Feedback is temporarily rate limited. Please try again shortly.",
      429,
      resolved.origin,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return publicWidgetError("Send a valid JSON request.", 400, resolved.origin);
  }
  if (typeof body !== "object" || body === null) {
    return publicWidgetError("Send a rating for an assistant message.", 400, resolved.origin);
  }

  const messageId = "messageId" in body && typeof body.messageId === "string" ? body.messageId : "";
  const rating = "rating" in body ? body.rating : undefined;
  if (!UUID_PATTERN.test(messageId) || (rating !== 1 && rating !== -1)) {
    return publicWidgetError(
      "Choose thumbs up or thumbs down for an assistant message.",
      400,
      resolved.origin,
    );
  }

  const [ownedMessage] = await db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.role, "assistant"),
        eq(conversations.chatbotId, resolved.chatbot.id),
      ),
    )
    .limit(1);
  if (!ownedMessage) return publicWidgetError("Assistant message not found.", 404, resolved.origin);

  await db.update(messages).set({ rating }).where(eq(messages.id, ownedMessage.id));
  return Response.json(
    { success: true },
    { headers: { ...publicWidgetCorsHeaders(resolved.origin), "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS(request: Request, context: RouteContext) {
  const { chatbotId } = await context.params;
  const resolved = await resolvePublicWidgetRequest(request, chatbotId);
  if ("response" in resolved) return resolved.response;
  return new Response(null, { status: 204, headers: publicWidgetCorsHeaders(resolved.origin) });
}

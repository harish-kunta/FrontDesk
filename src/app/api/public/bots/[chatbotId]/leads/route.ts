import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, leads } from "@/db/schema";
import { consumePublicChatRequest } from "@/lib/public-rate-limit";
import {
  publicWidgetCorsHeaders,
  publicWidgetError,
  resolvePublicWidgetRequest,
} from "@/lib/public-widget-request";

type RouteContext = { params: Promise<{ chatbotId: string }> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request, context: RouteContext) {
  const { chatbotId } = await context.params;
  const resolved = await resolvePublicWidgetRequest(request, chatbotId);
  if ("response" in resolved) return resolved.response;

  const limit = consumePublicChatRequest(`leads:${resolved.chatbot.id}:${resolved.clientAddress}`);
  if (!limit.allowed) {
    return publicWidgetError(
      "Lead capture is temporarily rate limited. Please try again shortly.",
      429,
      resolved.origin,
    );
  }
  if (!resolved.chatbot.widgetConfig?.leadCapture) {
    return publicWidgetError(
      "Lead capture is not enabled for this assistant.",
      403,
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
    return publicWidgetError("Enter your name and email address.", 400, resolved.origin);
  }

  const conversationId =
    "conversationId" in body && typeof body.conversationId === "string" ? body.conversationId : "";
  const name = "name" in body && typeof body.name === "string" ? body.name.trim() : "";
  const email =
    "email" in body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = "phone" in body && typeof body.phone === "string" ? body.phone.trim() : "";
  if (
    !UUID_PATTERN.test(conversationId) ||
    name.length < 1 ||
    name.length > 120 ||
    email.length > 254 ||
    !EMAIL_PATTERN.test(email) ||
    phone.length > 40
  ) {
    return publicWidgetError(
      "Enter a valid name and email address. Phone is optional.",
      400,
      resolved.origin,
    );
  }

  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.chatbotId, resolved.chatbot.id)),
    )
    .limit(1);
  if (!conversation) return publicWidgetError("Conversation not found.", 404, resolved.origin);

  const [lead] = await db
    .insert(leads)
    .values({
      workspaceId: resolved.chatbot.workspaceId,
      chatbotId: resolved.chatbot.id,
      conversationId: conversation.id,
      name,
      email,
      phone: phone || null,
    })
    .onConflictDoNothing({ target: leads.conversationId })
    .returning({ id: leads.id });

  return Response.json(
    { success: true, alreadySubmitted: !lead },
    { headers: { ...publicWidgetCorsHeaders(resolved.origin), "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS(request: Request, context: RouteContext) {
  const { chatbotId } = await context.params;
  const resolved = await resolvePublicWidgetRequest(request, chatbotId);
  if ("response" in resolved) return resolved.response;
  return new Response(null, { status: 204, headers: publicWidgetCorsHeaders(resolved.origin) });
}

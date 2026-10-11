import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chatbots } from "@/db/schema";
import { DEFAULT_WIDGET_CONFIG, originIsAllowed } from "@/lib/widget";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function publicWidgetError(message: string, status: number, origin?: string) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(origin
          ? {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Accept",
              "Access-Control-Max-Age": "600",
              Vary: "Origin",
            }
          : {}),
      },
    },
  );
}

export async function resolvePublicWidgetRequest(request: Request, chatbotId: string) {
  if (!UUID_PATTERN.test(chatbotId)) {
    return { response: publicWidgetError("Chatbot not found.", 404) };
  }

  const [chatbot] = await db
    .select({
      id: chatbots.id,
      workspaceId: chatbots.workspaceId,
      widgetConfig: chatbots.widgetConfig,
    })
    .from(chatbots)
    .where(eq(chatbots.id, chatbotId))
    .limit(1);
  if (!chatbot) return { response: publicWidgetError("Chatbot not found.", 404) };

  const origin = request.headers.get("origin");
  if (
    !origin ||
    !originIsAllowed(
      origin,
      chatbot.widgetConfig ?? DEFAULT_WIDGET_CONFIG,
      new URL(request.url).origin,
    )
  ) {
    return {
      response: publicWidgetError("This website is not enabled for this chatbot.", 403),
    };
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const clientAddress = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  return { chatbot, origin, clientAddress };
}

export function publicWidgetCorsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

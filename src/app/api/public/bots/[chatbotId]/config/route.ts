import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chatbots } from "@/db/schema";
import { corsHeaders, DEFAULT_WIDGET_CONFIG, originIsAllowed } from "@/lib/widget";

type RouteContext = { params: Promise<{ chatbotId: string }> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function resolvePublicConfig(request: Request, context: RouteContext) {
  const { chatbotId } = await context.params;
  if (!UUID_PATTERN.test(chatbotId)) return { response: jsonError("Chatbot not found.", 404) };

  const [chatbot] = await db
    .select({ id: chatbots.id, name: chatbots.name, widgetConfig: chatbots.widgetConfig })
    .from(chatbots)
    .where(eq(chatbots.id, chatbotId))
    .limit(1);
  if (!chatbot) return { response: jsonError("Chatbot not found.", 404) };

  // Same-origin GET requests may omit Origin. External browser fetches use
  // Origin, which is the value checked for embedded pages.
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  if (
    !originIsAllowed(
      origin,
      chatbot.widgetConfig ?? DEFAULT_WIDGET_CONFIG,
      new URL(request.url).origin,
    )
  ) {
    return { response: jsonError("This website is not enabled for this chatbot.", 403) };
  }

  return {
    chatbot,
    origin: origin as string,
  };
}

export async function GET(request: Request, context: RouteContext) {
  const result = await resolvePublicConfig(request, context);
  if ("response" in result) return result.response;
  return Response.json(
    { id: result.chatbot.id, name: result.chatbot.name, config: result.chatbot.widgetConfig },
    { headers: { ...corsHeaders(result.origin), "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS(request: Request, context: RouteContext) {
  const result = await resolvePublicConfig(request, context);
  if ("response" in result) return result.response;
  return new Response(null, { status: 204, headers: corsHeaders(result.origin) });
}

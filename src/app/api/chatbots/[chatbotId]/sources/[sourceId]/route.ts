import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatbots, sources } from "@/db/schema";
import { findApiChatbot } from "@/lib/api-chatbot";

type RouteContext = { params: Promise<{ chatbotId: string; sourceId: string }> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(_request: Request, context: RouteContext) {
  const { chatbotId, sourceId } = await context.params;
  const access = await findApiChatbot(chatbotId);
  if ("response" in access) return access.response;
  const { chatbot } = access;
  if (!UUID_PATTERN.test(sourceId)) {
    return Response.json({ error: "Source not found." }, { status: 404 });
  }
  const deleted = await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.chatbotId, chatbot.id)))
      .returning({ id: sources.id });
    if (!removed) return null;

    const [remainingSource] = await tx
      .select({ id: sources.id })
      .from(sources)
      .where(eq(sources.chatbotId, chatbot.id))
      .limit(1);
    if (!remainingSource) {
      await tx.update(chatbots).set({ status: "draft" }).where(eq(chatbots.id, chatbot.id));
    }
    return removed;
  });

  if (!deleted) return Response.json({ error: "Source not found." }, { status: 404 });
  return Response.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
}

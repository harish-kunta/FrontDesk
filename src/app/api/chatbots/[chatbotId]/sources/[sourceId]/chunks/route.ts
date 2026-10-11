import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chunks, sources } from "@/db/schema";
import { findApiChatbot } from "@/lib/api-chatbot";

type RouteContext = { params: Promise<{ chatbotId: string; sourceId: string }> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: RouteContext) {
  const { chatbotId, sourceId } = await context.params;
  const access = await findApiChatbot(chatbotId);
  if ("response" in access) return access.response;
  const { chatbot } = access;
  if (!UUID_PATTERN.test(sourceId)) {
    return Response.json({ error: "Source not found." }, { status: 404 });
  }
  const [source] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.chatbotId, chatbot.id)))
    .limit(1);
  if (!source) return Response.json({ error: "Source not found." }, { status: 404 });
  const rows = await db
    .select({
      id: chunks.id,
      content: chunks.content,
      chunkIndex: chunks.chunkIndex,
      tokenCount: chunks.tokenCount,
    })
    .from(chunks)
    .innerJoin(sources, eq(chunks.sourceId, sources.id))
    .where(
      and(
        eq(chunks.chatbotId, chatbot.id),
        eq(chunks.sourceId, sourceId),
        eq(sources.chatbotId, chatbot.id),
      ),
    )
    .orderBy(asc(chunks.chunkIndex));

  return Response.json({ chunks: rows }, { headers: { "Cache-Control": "no-store" } });
}

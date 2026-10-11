import { and, asc, cosineDistance, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { chunks, sources } from "@/db/schema";
import { RETRIEVAL_LIMIT } from "@/lib/rag-config";

/** Every vector lookup is constrained to one already-authorized chatbot. */
export async function retrieveChunks(chatbotId: string, queryEmbedding: number[]) {
  const distance = cosineDistance(chunks.embedding, queryEmbedding);
  const similarity = sql<number>`1 - (${distance})`;

  return db
    .select({
      id: chunks.id,
      sourceName: sources.name,
      chunkIndex: chunks.chunkIndex,
      content: chunks.content,
      tokenCount: chunks.tokenCount,
      similarity,
    })
    .from(chunks)
    .innerJoin(sources, eq(chunks.sourceId, sources.id))
    .where(
      and(
        eq(chunks.chatbotId, chatbotId),
        eq(sources.chatbotId, chatbotId),
        eq(sources.status, "ready"),
      ),
    )
    .orderBy(asc(distance))
    .limit(RETRIEVAL_LIMIT);
}

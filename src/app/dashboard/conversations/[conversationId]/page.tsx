import { and, asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { chatbots, chunks, conversations, leads, messages, sources } from "@/db/schema";
import { requireWorkspace } from "@/lib/workspace";
import { WorkspaceFrame } from "../../workspace-frame";

type ConversationPageProps = { params: Promise<{ conversationId: string }> };

export default async function ConversationPage({ params }: ConversationPageProps) {
  const { conversationId } = await params;
  const { user, workspace } = await requireWorkspace();
  const [conversation] = await db
    .select({
      id: conversations.id,
      chatbotId: chatbots.id,
      chatbotName: chatbots.name,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .innerJoin(chatbots, eq(conversations.chatbotId, chatbots.id))
    .where(and(eq(conversations.id, conversationId), eq(chatbots.workspaceId, workspace.id)))
    .limit(1);
  if (!conversation) notFound();

  const [bots, messageRows, [lead]] = await Promise.all([
    db.select({ id: chatbots.id }).from(chatbots).where(eq(chatbots.workspaceId, workspace.id)),
    db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        citedChunkIds: messages.citedChunkIds,
        isFallback: messages.isFallback,
        rating: messages.rating,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(asc(messages.sequence)),
    db.select().from(leads).where(eq(leads.conversationId, conversation.id)).limit(1),
  ]);
  const citedIds = [...new Set(messageRows.flatMap((row) => row.citedChunkIds ?? []))];
  const citationRows = citedIds.length
    ? await db
        .select({
          id: chunks.id,
          sourceName: sources.name,
          sourceUrl: sources.url,
          chunkIndex: chunks.chunkIndex,
        })
        .from(chunks)
        .innerJoin(sources, eq(chunks.sourceId, sources.id))
        .where(and(eq(chunks.chatbotId, conversation.chatbotId), inArray(chunks.id, citedIds)))
    : [];
  const citationById = new Map(citationRows.map((row) => [row.id, row]));

  return (
    <WorkspaceFrame
      active="conversations"
      chatbotCount={bots.length}
      user={user}
      workspace={workspace}
    >
      <div className="m1-page-heading">
        <div>
          <Link className="m1-back-link" href="/dashboard/conversations">
            ← All conversations
          </Link>
          <div className="eyebrow">{conversation.chatbotName}</div>
          <h1>Visitor conversation</h1>
          <p>Started {conversation.createdAt.toLocaleString()}</p>
        </div>
        <Link className="button button-secondary" href="/dashboard/conversations">
          Back to inbox
        </Link>
      </div>
      {lead && (
        <section className="m1-panel m5-lead-summary">
          <div>
            <div className="eyebrow">VISITOR CONTACT</div>
            <b>{lead.name}</b>
            <a href={`mailto:${lead.email}`}>{lead.email}</a>
            {lead.phone && <a href={`tel:${lead.phone}`}>{lead.phone}</a>}
          </div>
          <time>{lead.createdAt.toLocaleDateString()}</time>
        </section>
      )}
      <section className="m1-panel m5-transcript">
        {messageRows.map((message) => {
          const citations = message.citedChunkIds.flatMap((id) => {
            const citation = citationById.get(id);
            return citation ? [citation] : [];
          });
          return (
            <article className={`m5-transcript-message ${message.role}`} key={message.id}>
              <div className="m5-transcript-meta">
                <b>{message.role === "user" ? "Visitor" : conversation.chatbotName}</b>
                <time>{message.createdAt.toLocaleString()}</time>
                {message.isFallback && <span className="m5-status-tag unanswered">Fallback</span>}
                {message.rating === 1 && <span title="Visitor liked this answer">👍</span>}
                {message.rating === -1 && <span title="Visitor disliked this answer">👎</span>}
              </div>
              <p>{message.content}</p>
              {citations.length > 0 && (
                <div className="m5-transcript-citations">
                  {citations.map((citation, index) => (
                    <a
                      href={citation.sourceUrl ?? "#"}
                      key={citation.id}
                      target="_blank"
                      rel="noreferrer"
                    >
                      [{index + 1}] {citation.sourceName} · passage {citation.chunkIndex + 1}
                    </a>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </WorkspaceFrame>
  );
}

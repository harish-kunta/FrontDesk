import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { chatbots, conversations, messages } from "@/db/schema";
import { requireWorkspace } from "@/lib/workspace";
import { WorkspaceFrame } from "../workspace-frame";
import type { InboxRow } from "./inbox";
import { ConversationInbox } from "./inbox";

export default async function ConversationsPage() {
  const { user, workspace } = await requireWorkspace();
  const bots = await db
    .select({ id: chatbots.id, name: chatbots.name })
    .from(chatbots)
    .where(eq(chatbots.workspaceId, workspace.id));

  const conversationRows = bots.length
    ? await db
        .select({
          id: conversations.id,
          chatbotName: chatbots.name,
          updatedAt: conversations.updatedAt,
        })
        .from(conversations)
        .innerJoin(chatbots, eq(conversations.chatbotId, chatbots.id))
        .where(eq(chatbots.workspaceId, workspace.id))
        .orderBy(desc(conversations.updatedAt))
        .limit(100)
    : [];

  const conversationIds = conversationRows.map((row) => row.id);
  const [latestMessages, latestVisitorMessages, messageCounts, fallbackMessages] =
    conversationIds.length
      ? await Promise.all([
          db
            .selectDistinctOn([messages.conversationId], {
              conversationId: messages.conversationId,
              content: messages.content,
            })
            .from(messages)
            .where(inArray(messages.conversationId, conversationIds))
            .orderBy(messages.conversationId, desc(messages.sequence)),
          db
            .selectDistinctOn([messages.conversationId], {
              conversationId: messages.conversationId,
              content: messages.content,
            })
            .from(messages)
            .where(
              and(inArray(messages.conversationId, conversationIds), eq(messages.role, "user")),
            )
            .orderBy(messages.conversationId, desc(messages.sequence)),
          db
            .select({ conversationId: messages.conversationId, value: count() })
            .from(messages)
            .where(inArray(messages.conversationId, conversationIds))
            .groupBy(messages.conversationId),
          db
            .select({ conversationId: messages.conversationId })
            .from(messages)
            .where(
              and(
                inArray(messages.conversationId, conversationIds),
                eq(messages.role, "assistant"),
                eq(messages.isFallback, true),
              ),
            ),
        ])
      : [[], [], [], []];

  const latestByConversation = new Map(
    latestMessages.map((row) => [row.conversationId, row.content]),
  );
  const latestVisitorQuestionByConversation = new Map(
    latestVisitorMessages.map((row) => [row.conversationId, row.content]),
  );
  const countByConversation = new Map(messageCounts.map((row) => [row.conversationId, row.value]));
  const fallbackConversationIds = new Set(fallbackMessages.map((row) => row.conversationId));
  const rows: InboxRow[] = conversationRows.map((row) => ({
    id: row.id,
    chatbotName: row.chatbotName,
    updatedAt: row.updatedAt.toISOString(),
    messageCount: countByConversation.get(row.id) ?? 0,
    lastMessage: latestByConversation.get(row.id) ?? "",
    lastVisitorQuestion: latestVisitorQuestionByConversation.get(row.id) ?? "",
    hadFallback: fallbackConversationIds.has(row.id),
  }));

  return (
    <WorkspaceFrame
      active="conversations"
      chatbotCount={bots.length}
      user={user}
      workspace={workspace}
    >
      <div className="m1-page-heading">
        <div>
          <div className="eyebrow">VISITOR ACTIVITY</div>
          <h1>Conversations</h1>
          <p>Review what visitors asked, where the assistant needed help, and how chats went.</p>
        </div>
        <span className="m1-model-pill">Latest 100</span>
      </div>
      <section className="m1-panel m5-panel">
        <ConversationInbox rows={rows} />
      </section>
    </WorkspaceFrame>
  );
}

import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { chatbots, conversations, leads, messages } from "@/db/schema";
import { requireWorkspace } from "@/lib/workspace";
import { WorkspaceFrame } from "./workspace-frame";

export default async function DashboardPage() {
  const { user, workspace } = await requireWorkspace();
  const bots = await db
    .select({ id: chatbots.id })
    .from(chatbots)
    .where(eq(chatbots.workspaceId, workspace.id))
    .orderBy(desc(chatbots.createdAt))
    .limit(1);
  const [chatbotCount] = await db
    .select({ value: count() })
    .from(chatbots)
    .where(eq(chatbots.workspaceId, workspace.id));
  const firstChatbot = bots[0];
  const chatbotHref = firstChatbot
    ? `/dashboard/chatbots/${firstChatbot.id}/playground`
    : "/dashboard/chatbots/new";
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [conversationTotal, leadTotal, answerTotal, recentConversations] = firstChatbot
    ? await Promise.all([
        db
          .select({ value: count() })
          .from(conversations)
          .where(
            and(
              eq(conversations.chatbotId, firstChatbot.id),
              gte(conversations.createdAt, monthStart),
            ),
          ),
        db
          .select({ value: count() })
          .from(leads)
          .where(and(eq(leads.workspaceId, workspace.id), gte(leads.createdAt, monthStart))),
        db
          .select({ value: count() })
          .from(messages)
          .innerJoin(conversations, eq(messages.conversationId, conversations.id))
          .where(
            and(
              eq(conversations.chatbotId, firstChatbot.id),
              eq(messages.role, "assistant"),
              eq(messages.isFallback, false),
              gte(messages.createdAt, monthStart),
            ),
          ),
        db
          .select({ id: conversations.id, updatedAt: conversations.updatedAt })
          .from(conversations)
          .where(eq(conversations.chatbotId, firstChatbot.id))
          .orderBy(desc(conversations.updatedAt))
          .limit(5),
      ])
    : [[{ value: 0 }], [{ value: 0 }], [{ value: 0 }], []];
  const recentIds = recentConversations.map((conversation) => conversation.id);
  const recentMessages = recentIds.length
    ? await db
        .selectDistinctOn([messages.conversationId], {
          conversationId: messages.conversationId,
          content: messages.content,
        })
        .from(messages)
        .where(inArray(messages.conversationId, recentIds))
        .orderBy(messages.conversationId, desc(messages.sequence))
    : [];
  const recentMessageByConversation = new Map(
    recentMessages.map((message) => [message.conversationId, message.content]),
  );

  return (
    <WorkspaceFrame
      active="overview"
      chatbotCount={chatbotCount.value}
      user={user}
      workspace={workspace}
    >
      <div className="welcome-row">
        <div>
          <div className="eyebrow">YOUR WORKSPACE</div>
          <h1>
            Good morning, {user.name?.split(" ")[0] || "there"}
            <span className="wave">✳</span>
          </h1>
          <p>Here’s the start of your customer support story.</p>
        </div>
        <Link className="button button-primary" href={chatbotHref}>
          {firstChatbot ? "Open your chatbot" : "Create a chatbot"} <span>＋</span>
        </Link>
      </div>
      <div className="metric-grid">
        <article className="metric-card">
          <div className="metric-label">
            CHATBOTS <span className="metric-symbol symbol-violet">◈</span>
          </div>
          <div className="metric-value">
            {chatbotCount.value}
            <small> / 1</small>
          </div>
          <div className="metric-caption">Your AI support assistants</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">
            CONVERSATIONS <span className="metric-symbol symbol-peach">▤</span>
          </div>
          <div className="metric-value">{conversationTotal[0]?.value ?? 0}</div>
          <div className="metric-caption">This month</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">
            ANSWERS FOUND <span className="metric-symbol symbol-mint">✦</span>
          </div>
          <div className="metric-value">{answerTotal[0]?.value ?? 0}</div>
          <div className="metric-caption">Grounded replies this month</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">
            LEADS CAPTURED <span className="metric-symbol symbol-yellow">♧</span>
          </div>
          <div className="metric-value">{leadTotal[0]?.value ?? 0}</div>
          <div className="metric-caption">People who want to hear from you</div>
        </article>
      </div>
      <div className="setup-card">
        <div className="setup-copy">
          <div className="setup-kicker">
            <span>YOUR FIRST STEP</span>
            <span className="step-progress">
              01 <i /> 03
            </span>
          </div>
          <h2>Let’s get your front desk ready.</h2>
          <p>
            Give your assistant a little knowledge about your business. We’ll turn your text into
            searchable pieces and show you which ones match a question.
          </p>
          <Link className="button setup-button" href={chatbotHref}>
            {firstChatbot ? "Continue to your playground" : "Paste your first FAQ"} <span>→</span>
          </Link>
          <div className="setup-checks">
            <span>
              <i>✓</i> Workspace created
            </span>
            <span>
              <i>✓</i> Your account secured
            </span>
          </div>
        </div>
        <div className="setup-illustration" aria-hidden="true">
          <div className="illo-sun">✳</div>
          <div className="illo-window">
            <div className="illo-window-head">
              <span>F</span>
              <i />
              <i />
              <i />
            </div>
            <div className="illo-chat-row">
              <span className="illo-bot">F</span>
              <i />
            </div>
            <div className="illo-chat-bubble">
              <span />
              <span />
            </div>
            <div className="illo-question">
              <span />
            </div>
            <div className="illo-chat-bubble short">
              <span />
            </div>
            <div className="illo-send">↑</div>
          </div>
          <div className="illo-star">✦</div>
          <div className="illo-leaf">⌁</div>
        </div>
      </div>
      <div className="lower-grid">
        <article className="activity-card">
          <div className="card-heading">
            <div>
              <h2>Recent activity</h2>
              <p>A quiet start is a good start.</p>
            </div>
            <span className="muted-tag">LAST 7 DAYS</span>
          </div>
          {recentConversations.length ? (
            <div className="m5-recent-activity">
              {recentConversations.map((conversation) => (
                <Link href={`/dashboard/conversations/${conversation.id}`} key={conversation.id}>
                  <span>
                    {recentMessageByConversation.get(conversation.id) || "Conversation started"}
                  </span>
                  <time>{conversation.updatedAt.toLocaleDateString()}</time>
                </Link>
              ))}
            </div>
          ) : (
            <div className="activity-empty">
              <div className="activity-icon">◷</div>
              <b>No activity just yet</b>
              <span>Once your chatbot is live, you’ll see conversations here.</span>
            </div>
          )}
        </article>
        <article className="learn-card">
          <span className="learn-icon">✳</span>
          <div className="eyebrow">A NOTE FROM US</div>
          <h2>Trust is the feature.</h2>
          <p>
            FrontDesk will answer from your information and point visitors to its sources. If it
            doesn’t know, it’ll say so.
          </p>
          <a href="/">
            How FrontDesk works <span>→</span>
          </a>
        </article>
      </div>
      <footer className="dashboard-footer">
        <span>
          FRONTDESK <i>·</i> YOUR KNOWLEDGE, ALWAYS ON
        </span>
        <span>Made for the questions that come up every day.</span>
      </footer>
    </WorkspaceFrame>
  );
}

import { and, asc, count, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { chatbots, conversations, messages } from "@/db/schema";
import { requireWorkspace } from "@/lib/workspace";
import { WorkspaceFrame } from "../workspace-frame";

type PairSummary = { question: string; count: number };

export default async function AnalyticsPage() {
  const { user, workspace } = await requireWorkspace();
  const bots = await db
    .select({ id: chatbots.id })
    .from(chatbots)
    .where(eq(chatbots.workspaceId, workspace.id));
  const since = new Date();
  since.setDate(since.getDate() - 13);
  since.setHours(0, 0, 0, 0);

  const [conversationTotal, rows] = bots.length
    ? await Promise.all([
        db
          .select({ value: count() })
          .from(conversations)
          .innerJoin(chatbots, eq(conversations.chatbotId, chatbots.id))
          .where(and(eq(chatbots.workspaceId, workspace.id), gte(conversations.createdAt, since))),
        db
          .select({
            conversationId: messages.conversationId,
            sequence: messages.sequence,
            role: messages.role,
            content: messages.content,
            isFallback: messages.isFallback,
            rating: messages.rating,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .innerJoin(conversations, eq(messages.conversationId, conversations.id))
          .innerJoin(chatbots, eq(conversations.chatbotId, chatbots.id))
          .where(and(eq(chatbots.workspaceId, workspace.id), gte(messages.createdAt, since)))
          .orderBy(asc(messages.conversationId), asc(messages.sequence)),
      ])
    : [[{ value: 0 }], []];

  const assistantRows = rows.filter((row) => row.role === "assistant");
  const answeredRows = assistantRows.filter((row) => !row.isFallback);
  const ratedRows = assistantRows.filter((row) => row.rating !== null);
  const positiveRatings = ratedRows.filter((row) => row.rating === 1).length;
  const resolutionRate = assistantRows.length
    ? Math.round((answeredRows.length / assistantRows.length) * 100)
    : 0;
  const satisfactionRate = ratedRows.length
    ? Math.round((positiveRatings / ratedRows.length) * 100)
    : null;

  const questionCounts = new Map<string, number>();
  const unansweredCounts = new Map<string, number>();
  const lastQuestionByConversation = new Map<string, string>();
  for (const row of rows) {
    if (row.role === "user") {
      lastQuestionByConversation.set(row.conversationId, row.content.trim());
      continue;
    }
    const question = lastQuestionByConversation.get(row.conversationId);
    if (!question) continue;
    const normalized = question.replace(/\s+/g, " ").slice(0, 280);
    questionCounts.set(normalized, (questionCounts.get(normalized) ?? 0) + 1);
    if (row.isFallback)
      unansweredCounts.set(normalized, (unansweredCounts.get(normalized) ?? 0) + 1);
    lastQuestionByConversation.delete(row.conversationId);
  }

  const toTopList = (source: Map<string, number>): PairSummary[] =>
    [...source.entries()]
      .map(([question, value]) => ({ question, count: value }))
      .sort(
        (left, right) => right.count - left.count || left.question.localeCompare(right.question),
      )
      .slice(0, 5);
  const topQuestions = toTopList(questionCounts);
  const unansweredQuestions = toTopList(unansweredCounts);

  const dateKeys = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(since);
    date.setDate(since.getDate() + index);
    return date.toISOString().slice(0, 10);
  });
  const dailyCounts = new Map(dateKeys.map((day) => [day, 0]));
  for (const row of assistantRows) {
    const day = row.createdAt.toISOString().slice(0, 10);
    if (dailyCounts.has(day)) dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1);
  }
  const maxDailyCount = Math.max(1, ...dailyCounts.values());

  return (
    <WorkspaceFrame active="analytics" chatbotCount={bots.length} user={user} workspace={workspace}>
      <div className="m1-page-heading">
        <div>
          <div className="eyebrow">YOUR CUSTOMER SUPPORT STORY</div>
          <h1>Analytics</h1>
          <p>
            Conversation activity over the last 14 days, with the questions that need attention.
          </p>
        </div>
        <span className="m1-model-pill">Last 14 days</span>
      </div>
      <div className="metric-grid m5-metric-grid">
        <article className="metric-card">
          <div className="metric-label">CONVERSATIONS</div>
          <div className="metric-value">{conversationTotal[0]?.value ?? 0}</div>
          <div className="metric-caption">Started in this period</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">ASSISTANT REPLIES</div>
          <div className="metric-value">{assistantRows.length}</div>
          <div className="metric-caption">Visitor questions answered or handed off</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">RESOLUTION RATE</div>
          <div className="metric-value">
            {resolutionRate}
            <small>%</small>
          </div>
          <div className="metric-caption">Replies with a grounded answer</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">POSITIVE RATINGS</div>
          <div className="metric-value">
            {satisfactionRate === null ? "—" : `${satisfactionRate}%`}
          </div>
          <div className="metric-caption">
            {ratedRows.length} visitor rating{ratedRows.length === 1 ? "" : "s"}
          </div>
        </article>
      </div>

      <div className="m5-analytics-grid">
        <section className="m1-panel m5-panel">
          <div className="m5-section-heading">
            <div>
              <h2>Replies by day</h2>
              <p>Assistant responses, including fallbacks.</p>
            </div>
          </div>
          {assistantRows.length === 0 ? (
            <div className="m5-empty-state">
              <span>No replies yet in this period.</span>
            </div>
          ) : (
            <div
              className="m5-chart"
              role="img"
              aria-label="Assistant replies per day for the last 14 days"
            >
              {dateKeys.map((day) => {
                const value = dailyCounts.get(day) ?? 0;
                const height = value ? Math.max(8, Math.round((value / maxDailyCount) * 100)) : 2;
                return (
                  <div className="m5-chart-column" key={day} title={`${day}: ${value} replies`}>
                    <span>{value || ""}</span>
                    <i style={{ height: `${height}%` }} />
                    <small>
                      {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </small>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <section className="m1-panel m5-panel">
          <div className="m5-section-heading">
            <div>
              <h2>Most asked</h2>
              <p>Repeated visitor questions.</p>
            </div>
          </div>
          <QuestionList
            rows={topQuestions}
            empty="Questions will appear after your first visitor chat."
          />
        </section>
        <section className="m1-panel m5-panel m5-unanswered-panel">
          <div className="m5-section-heading">
            <div>
              <h2>Needs an answer</h2>
              <p>Questions where the assistant used its fallback.</p>
            </div>
          </div>
          <QuestionList
            rows={unansweredQuestions}
            empty="No unanswered questions in this period."
            unanswered
          />
        </section>
      </div>
    </WorkspaceFrame>
  );
}

function QuestionList({
  rows,
  empty,
  unanswered = false,
}: {
  rows: PairSummary[];
  empty: string;
  unanswered?: boolean;
}) {
  return rows.length ? (
    <ol className="m5-question-list">
      {rows.map((row) => (
        <li key={row.question}>
          <span>{row.question}</span>
          <b className={unanswered ? "unanswered" : ""}>{row.count}</b>
        </li>
      ))}
    </ol>
  ) : (
    <div className="m5-empty-state">
      <span>{empty}</span>
    </div>
  );
}

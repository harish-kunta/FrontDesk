import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { WorkspaceFrame } from "@/app/dashboard/workspace-frame";
import { db } from "@/db";
import { chunks, sources } from "@/db/schema";
import { listWorkspaceChatbots, requireOwnedChatbot } from "@/lib/chatbots";
import { SearchPlayground } from "../../search-playground";
import { SourceForm } from "../../source-form";

type PlaygroundPageProps = {
  params: Promise<{ chatbotId: string }>;
};

export default async function PlaygroundPage({ params }: PlaygroundPageProps) {
  const { chatbotId } = await params;
  const { user, workspace, chatbot } = await requireOwnedChatbot(chatbotId);
  const [bots, sourceRows] = await Promise.all([
    listWorkspaceChatbots(workspace.id),
    db
      .select({
        id: sources.id,
        name: sources.name,
        status: sources.status,
        charCount: sources.charCount,
        createdAt: sources.createdAt,
        chunkCount: count(chunks.id),
      })
      .from(sources)
      .leftJoin(chunks, eq(chunks.sourceId, sources.id))
      // requireOwnedChatbot checked the session's workspace above. Keep the
      // chatbot scope on the source list so another tenant's content can't leak.
      .where(eq(sources.chatbotId, chatbot.id))
      .groupBy(sources.id)
      .orderBy(desc(sources.createdAt)),
  ]);

  return (
    <WorkspaceFrame active="chatbots" chatbotCount={bots.length} user={user} workspace={workspace}>
      <div className="m1-page-heading">
        <div>
          <Link className="m1-back-link" href="/dashboard/chatbots">
            ← All chatbots
          </Link>
          <div className="eyebrow">M1 · PASTE TEXT, THEN SEARCH</div>
          <h1>{chatbot.name} playground</h1>
          <p>Teach the assistant from your own content and inspect retrieval before it answers.</p>
        </div>
        <span className="m1-status-pill">{chatbot.status}</span>
      </div>

      <div className="m1-learning-strip">
        <div>
          <b>1. Chunk</b>
          <span>Split text into overlapping pieces</span>
        </div>
        <div>
          <b>2. Embed</b>
          <span>Turn each piece into 1,536 numbers</span>
        </div>
        <div>
          <b>3. Retrieve</b>
          <span>Rank by cosine similarity to a question</span>
        </div>
      </div>

      <div className="m1-workbench">
        <section className="m1-panel">
          <div className="m1-panel-heading">
            <div>
              <div className="eyebrow">KNOWLEDGE SOURCE</div>
              <h2>Paste text</h2>
            </div>
            <span className="m1-model-pill">Text only · 100K characters max</span>
          </div>
          <p className="m1-intro-copy">
            Start with an FAQ, shipping policy, or product notes. We keep your source and save its
            chunks with this chatbot’s ID.
          </p>
          <SourceForm chatbotId={chatbot.id} />
        </section>

        <SearchPlayground chatbotId={chatbot.id} />
      </div>

      <section className="m1-panel m1-sources-panel">
        <div className="m1-panel-heading">
          <div>
            <div className="eyebrow">INDEXED KNOWLEDGE</div>
            <h2>Your sources</h2>
          </div>
          <span className="m1-model-pill">{sourceRows.length} source(s)</span>
        </div>
        {sourceRows.length === 0 ? (
          <div className="m1-source-empty">
            <span>Nothing indexed yet.</span> Paste a short FAQ above to create the first source.
          </div>
        ) : (
          <div className="m1-source-list">
            {sourceRows.map((source) => (
              <article className="m1-source-row" key={source.id}>
                <div className="m1-source-icon">TXT</div>
                <div className="m1-source-copy">
                  <b>{source.name}</b>
                  <span>
                    {source.charCount.toLocaleString()} characters · {source.chunkCount} chunks ·{" "}
                    {source.createdAt.toLocaleDateString()}
                  </span>
                </div>
                <span className={`m1-source-status ${source.status}`}>{source.status}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="m1-learning-note">
        M1 stops at retrieval. The context preview is what we would give a chat model; M2 will add
        generated answers, citations, and the “I don’t know” fallback.
      </p>
    </WorkspaceFrame>
  );
}

import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { WorkspaceFrame } from "@/app/dashboard/workspace-frame";
import { db } from "@/db";
import { chunks, sources } from "@/db/schema";
import { CHAT_MODEL } from "@/lib/ai/chat";
import { listWorkspaceChatbots, requireOwnedChatbot } from "@/lib/chatbots";
import { ChatPlayground } from "../../chat-playground";
import { CrawlForm } from "../../crawl-form";
import { SourceForm } from "../../source-form";
import { SourceManager } from "../../source-manager";

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
        type: sources.type,
        url: sources.url,
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
          <div className="eyebrow">M3 · CRAWL, EXTRACT, INDEX</div>
          <h1>{chatbot.name} playground</h1>
          <p>Add website pages or pasted text, then see how the assistant uses each source.</p>
        </div>
        <div className="m4-playground-actions">
          <Link
            className="button button-secondary"
            href={`/dashboard/chatbots/${chatbot.id}/widget`}
          >
            Set up visitor chat →
          </Link>
          <span className="m1-status-pill">{chatbot.status}</span>
        </div>
      </div>

      <div className="m1-learning-strip">
        <div>
          <b>1. Retrieve</b>
          <span>Find passages related to the question</span>
        </div>
        <div>
          <b>2. Generate</b>
          <span>Give the LLM only the matching passages</span>
        </div>
        <div>
          <b>3. Cite and save</b>
          <span>Show sources and keep this conversation</span>
        </div>
      </div>

      <div className="m1-workbench">
        <section className="m1-panel">
          <div className="m1-panel-heading">
            <div>
              <div className="eyebrow">WEBSITE SOURCE</div>
              <h2>Crawl a website</h2>
            </div>
            <span className="m1-model-pill">Up to 20 same-host pages</span>
          </div>
          <p className="m1-intro-copy">
            Discover pages from the sitemap or site links, choose what belongs in your assistant,
            and watch extraction and indexing progress.
          </p>
          <CrawlForm chatbotId={chatbot.id} />
          <div className="m3-text-source-divider">
            <span>OR ADD TEXT DIRECTLY</span>
          </div>
          <SourceForm chatbotId={chatbot.id} />
        </section>

        <ChatPlayground chatbotId={chatbot.id} model={CHAT_MODEL} />
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
            <span>Nothing indexed yet.</span> Crawl a website or paste a short FAQ to create the
            first source.
          </div>
        ) : (
          <SourceManager
            chatbotId={chatbot.id}
            sources={sourceRows.map((source) => ({
              ...source,
              createdAt: source.createdAt.toISOString(),
            }))}
          />
        )}
      </section>

      <p className="m1-learning-note">
        RAG means retrieval-augmented generation: search narrows the source material first, then an
        LLM writes an answer from those passages. The model never receives another workspace’s
        chunks, and low-relevance questions get a fixed “I don’t know” response before generation.
      </p>
    </WorkspaceFrame>
  );
}

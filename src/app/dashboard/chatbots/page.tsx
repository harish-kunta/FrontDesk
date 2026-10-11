import Link from "next/link";
import { listWorkspaceChatbots } from "@/lib/chatbots";
import { requireWorkspace } from "@/lib/workspace";
import { WorkspaceFrame } from "../workspace-frame";

export default async function ChatbotsPage() {
  const { user, workspace } = await requireWorkspace();
  const bots = await listWorkspaceChatbots(workspace.id);

  return (
    <WorkspaceFrame active="chatbots" chatbotCount={bots.length} user={user} workspace={workspace}>
      <div className="m1-page-heading">
        <div>
          <div className="eyebrow">YOUR ASSISTANT</div>
          <h1>Chatbots</h1>
          <p>Build one support assistant for this workspace, then teach it from your own text.</p>
        </div>
        {bots.length === 0 && (
          <Link className="button button-primary" href="/dashboard/chatbots/new">
            Create a chatbot <span>＋</span>
          </Link>
        )}
      </div>

      {bots.length === 0 ? (
        <section className="m1-panel m1-empty-state">
          <span className="m1-empty-icon">◈</span>
          <h2>Your first chatbot starts here</h2>
          <p>
            Name your assistant, paste in an FAQ, and explore how semantic search finds answers.
          </p>
          <Link className="button button-primary" href="/dashboard/chatbots/new">
            Create your first chatbot
          </Link>
        </section>
      ) : (
        <div className="m1-bot-list">
          {bots.map((bot) => (
            <article className="m1-bot-card" key={bot.id}>
              <div className="m1-bot-icon">F</div>
              <div className="m1-bot-copy">
                <h2>{bot.name}</h2>
                <p>
                  <span className={`m1-source-status ${bot.status}`}>{bot.status}</span> · Created{" "}
                  {bot.createdAt.toLocaleDateString()}
                </p>
              </div>
              <Link
                className="button m1-button-quiet"
                href={`/dashboard/chatbots/${bot.id}/playground`}
              >
                Open playground <span>→</span>
              </Link>
            </article>
          ))}
        </div>
      )}
    </WorkspaceFrame>
  );
}

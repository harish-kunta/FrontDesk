import Link from "next/link";
import { WorkspaceFrame } from "@/app/dashboard/workspace-frame";
import { listWorkspaceChatbots, requireOwnedChatbot } from "@/lib/chatbots";
import { DEFAULT_WIDGET_CONFIG } from "@/lib/widget";
import { WidgetPreview } from "../../widget-preview";
import { WidgetSettingsForm } from "../../widget-settings-form";

type WidgetPageProps = { params: Promise<{ chatbotId: string }> };

export default async function WidgetSettingsPage({ params }: WidgetPageProps) {
  const { chatbotId } = await params;
  const { user, workspace, chatbot } = await requireOwnedChatbot(chatbotId);
  const bots = await listWorkspaceChatbots(workspace.id);
  const config = chatbot.widgetConfig ?? DEFAULT_WIDGET_CONFIG;

  return (
    <WorkspaceFrame active="chatbots" chatbotCount={bots.length} user={user} workspace={workspace}>
      <div className="m1-page-heading">
        <div>
          <Link className="m1-back-link" href={`/dashboard/chatbots/${chatbot.id}/playground`}>
            ← Back to playground
          </Link>
          <div className="eyebrow">M4 · PUBLIC CHAT</div>
          <h1>Launch your visitor chat</h1>
          <p>Choose a brand style, allow your website, and add FrontDesk with one script tag.</p>
        </div>
        <Link className="button button-secondary" href={`/b/${chatbot.id}`} target="_blank">
          Preview hosted page ↗
        </Link>
      </div>

      <div className="m4-widget-layout">
        <section className="m1-panel">
          <div className="m1-panel-heading">
            <div>
              <div className="eyebrow">WIDGET SETTINGS</div>
              <h2>Make it yours</h2>
            </div>
          </div>
          <WidgetSettingsForm chatbotId={chatbot.id} config={config} />
        </section>

        <aside className="m4-learning-card">
          <span className="eyebrow">WHAT HAPPENS IN THE BROWSER</span>
          <h2>One small loader, isolated UI</h2>
          <ol>
            <li>The script reads this chatbot’s public ID from its data attribute.</li>
            <li>It fetches only the name and appearance settings allowed for that website.</li>
            <li>Messages go to the same grounded RAG pipeline used in your playground.</li>
            <li>
              Each retrieval query still filters by this chatbot ID before any chunks reach the LLM.
            </li>
          </ol>
          <p>
            Shadow DOM gives the widget its own styling boundary. Your customer’s page can still
            influence placement, but its CSS cannot accidentally change the chat panel’s buttons,
            fonts, or spacing.
          </p>
          <a className="m4-hosted-link" href={`/b/${chatbot.id}`} target="_blank" rel="noreferrer">
            {`/b/${chatbot.id}`}
          </a>
          <WidgetPreview chatbotId={chatbot.id} chatbotName={chatbot.name} />
        </aside>
      </div>
    </WorkspaceFrame>
  );
}

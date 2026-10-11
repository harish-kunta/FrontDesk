import Link from "next/link";
import { redirect } from "next/navigation";
import { createChatbot } from "@/app/dashboard/chatbots/actions";
import { listWorkspaceChatbots } from "@/lib/chatbots";
import { requireWorkspace } from "@/lib/workspace";
import { WorkspaceFrame } from "../../workspace-frame";

type NewChatbotPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function NewChatbotPage({ searchParams }: NewChatbotPageProps) {
  const { user, workspace } = await requireWorkspace();
  const bots = await listWorkspaceChatbots(workspace.id);
  const { error } = await searchParams;
  const existingBot = bots[0];

  if (existingBot && bots.length > 0 && !error) {
    redirect(`/dashboard/chatbots/${existingBot.id}/playground`);
  }

  return (
    <WorkspaceFrame active="chatbots" chatbotCount={bots.length} user={user} workspace={workspace}>
      <div className="m1-page-heading">
        <div>
          <Link className="m1-back-link" href="/dashboard/chatbots">
            ← All chatbots
          </Link>
          <div className="eyebrow">CREATE</div>
          <h1>Name your assistant</h1>
          <p>We’ll start with one chatbot in this workspace for the M1 learning slice.</p>
        </div>
      </div>
      <section className="m1-panel m1-create-panel">
        {existingBot ? (
          <>
            <h2>This workspace already has its chatbot</h2>
            <p>The MVP gives each account one workspace and one chatbot.</p>
            <Link
              className="button button-primary"
              href={`/dashboard/chatbots/${existingBot.id}/playground`}
            >
              Open {existingBot.name} <span>→</span>
            </Link>
          </>
        ) : (
          <form action={createChatbot} className="m1-form">
            <label className="m1-field">
              <span>Chatbot name</span>
              <input name="name" placeholder="Acme Support" minLength={2} maxLength={80} required />
              <small>Visitors will see this name when they chat with your assistant.</small>
            </label>
            {error === "name" && (
              <p className="m1-action-message error" role="alert">
                Choose a name between 2 and 80 characters.
              </p>
            )}
            <button className="button button-primary" type="submit">
              Create chatbot <span>→</span>
            </button>
          </form>
        )}
      </section>
    </WorkspaceFrame>
  );
}

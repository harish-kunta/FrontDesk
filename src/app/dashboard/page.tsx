import { count, eq } from "drizzle-orm";
import Link from "next/link";
import { signOut } from "@/auth";
import { db } from "@/db";
import { chatbots } from "@/db/schema";
import { requireWorkspace } from "@/lib/workspace";

const navigation = [
  { icon: "▦", label: "Overview", active: true },
  { icon: "◈", label: "Chatbots", active: false },
  { icon: "▤", label: "Conversations", active: false },
  { icon: "⌁", label: "Leads", active: false },
  { icon: "◷", label: "Analytics", active: false },
];

export default async function DashboardPage() {
  const { user, workspace } = await requireWorkspace();
  const [chatbotCount] = await db
    .select({ value: count() })
    .from(chatbots)
    // Tenant boundary: this query only counts bots owned by this workspace.
    .where(eq(chatbots.workspaceId, workspace.id));

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand-lockup sidebar-brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            F
          </span>
          <span>frontdesk</span>
        </Link>
        <div className="workspace-switcher">
          <span className="workspace-avatar">{workspace.name.slice(0, 1).toUpperCase()}</span>
          <span className="workspace-copy">
            <b>{workspace.name}</b>
            <small>Free workspace</small>
          </span>
          <span className="switcher-chevron">⌄</span>
        </div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Workspace navigation">
          {navigation.map((item) => (
            <div
              className={`side-nav-item${item.active ? " selected" : " disabled"}`}
              key={item.label}
              aria-current={item.active ? "page" : undefined}
              aria-disabled={!item.active}
            >
              <span className="side-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
              {item.label === "Chatbots" && <span className="nav-count">{chatbotCount.value}</span>}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="usage-card">
            <div className="usage-heading">
              <span>Monthly messages</span>
              <span>0 / 50</span>
            </div>
            <div className="usage-track">
              <span />
            </div>
            <small>50 replies included each month</small>
          </div>
          <div className="profile-row">
            <span className="profile-avatar">{user.name?.slice(0, 1).toUpperCase() || "Y"}</span>
            <span className="profile-copy">
              <b>{user.name || "Your account"}</b>
              <small>{user.email}</small>
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button className="icon-button logout-button" aria-label="Sign out" title="Sign out">
                ↗
              </button>
            </form>
          </div>
        </div>
      </aside>
      <section className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <b>Overview</b>
          </div>
          <div className="topbar-right">
            <span className="help-link">
              Workspace setup preview
            </span>
            <span className="topbar-avatar">{user.name?.slice(0, 1).toUpperCase() || "Y"}</span>
          </div>
        </header>
        <div className="dashboard-content">
          <div className="welcome-row">
            <div>
              <div className="eyebrow">YOUR WORKSPACE</div>
              <h1>
                Good morning, {user.name?.split(" ")[0] || "there"}
                <span className="wave">✳</span>
              </h1>
              <p>Here’s the start of your customer support story.</p>
            </div>
            <button
              className="button button-primary button-disabled"
              disabled
              title="Chatbot setup is the next build milestone"
            >
              Create a chatbot <span>＋</span>
            </button>
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
              <div className="metric-value">0</div>
              <div className="metric-caption">This month</div>
            </article>
            <article className="metric-card">
              <div className="metric-label">
                ANSWERS FOUND <span className="metric-symbol symbol-mint">✦</span>
              </div>
              <div className="metric-value">—</div>
              <div className="metric-caption">Available once your bot is live</div>
            </article>
            <article className="metric-card">
              <div className="metric-label">
                LEADS CAPTURED <span className="metric-symbol symbol-yellow">♧</span>
              </div>
              <div className="metric-value">0</div>
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
                Your workspace is set up. Next, we’ll teach your assistant about your business so it
                can answer with confidence.
              </p>
              <button className="button setup-button" disabled>
                Chatbot setup arrives in the next milestone <span>→</span>
              </button>
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
              <div className="activity-empty">
                <div className="activity-icon">◷</div>
                <b>No activity just yet</b>
                <span>Once your chatbot is live, you’ll see conversations here.</span>
              </div>
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
        </div>
      </section>
    </main>
  );
}

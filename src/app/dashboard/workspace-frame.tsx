import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/auth";

type WorkspaceFrameProps = {
  active: "overview" | "chatbots";
  chatbotCount: number;
  user: { name?: string | null; email?: string | null };
  workspace: { name: string };
  children: ReactNode;
};

const inactiveNavigation = [
  { icon: "▤", label: "Conversations" },
  { icon: "⌁", label: "Leads" },
  { icon: "◷", label: "Analytics" },
];

export function WorkspaceFrame({
  active,
  chatbotCount,
  user,
  workspace,
  children,
}: WorkspaceFrameProps) {
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
          <Link
            className={`side-nav-item${active === "overview" ? " selected" : ""}`}
            href="/dashboard"
            aria-current={active === "overview" ? "page" : undefined}
          >
            <span className="side-icon" aria-hidden="true">
              ▦
            </span>
            <span>Overview</span>
          </Link>
          <Link
            className={`side-nav-item${active === "chatbots" ? " selected" : ""}`}
            href="/dashboard/chatbots"
            aria-current={active === "chatbots" ? "page" : undefined}
          >
            <span className="side-icon" aria-hidden="true">
              ◈
            </span>
            <span>Chatbots</span>
            <span className="nav-count">{chatbotCount}</span>
          </Link>
          {inactiveNavigation.map((item) => (
            <div className="side-nav-item disabled" key={item.label} aria-disabled="true">
              <span className="side-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
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
              <button
                className="icon-button logout-button"
                type="submit"
                aria-label="Sign out"
                title="Sign out"
              >
                ↗
              </button>
            </form>
          </div>
        </div>
      </aside>
      <section className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <b>{active === "overview" ? "Overview" : "Chatbots"}</b>
          </div>
          <div className="topbar-right">
            <span className="help-link">M1 · Knowledge setup</span>
            <span className="topbar-avatar">{user.name?.slice(0, 1).toUpperCase() || "Y"}</span>
          </div>
        </header>
        <div className="dashboard-content">{children}</div>
      </section>
    </main>
  );
}

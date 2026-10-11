import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { chatbots, conversations, leads } from "@/db/schema";
import { requireWorkspace } from "@/lib/workspace";
import { WorkspaceFrame } from "../workspace-frame";

export default async function LeadsPage() {
  const { user, workspace } = await requireWorkspace();
  const [bots, rows] = await Promise.all([
    db.select({ id: chatbots.id }).from(chatbots).where(eq(chatbots.workspaceId, workspace.id)),
    db
      .select({
        id: leads.id,
        conversationId: leads.conversationId,
        name: leads.name,
        email: leads.email,
        phone: leads.phone,
        chatbotName: chatbots.name,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .innerJoin(chatbots, eq(leads.chatbotId, chatbots.id))
      .innerJoin(conversations, eq(leads.conversationId, conversations.id))
      .where(eq(leads.workspaceId, workspace.id))
      .orderBy(desc(leads.createdAt))
      .limit(500),
  ]);

  return (
    <WorkspaceFrame active="leads" chatbotCount={bots.length} user={user} workspace={workspace}>
      <div className="m1-page-heading">
        <div>
          <div className="eyebrow">PEOPLE TO FOLLOW UP WITH</div>
          <h1>Leads</h1>
          <p>Contact details visitors chose to share with your assistant.</p>
        </div>
        <a className="button button-secondary" href="/api/dashboard/leads/export">
          Export CSV ↓
        </a>
      </div>
      <section className="m1-panel m5-panel">
        {rows.length === 0 ? (
          <div className="m5-empty-state">
            <b>No leads yet</b>
            <span>
              Turn on lead capture in widget settings to invite visitors to leave their details.
            </span>
          </div>
        ) : (
          <div className="m5-table-wrap">
            <table className="m5-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Assistant</th>
                  <th>Date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((lead) => (
                  <tr key={lead.id}>
                    <td>{lead.name}</td>
                    <td>
                      <a href={`mailto:${lead.email}`}>{lead.email}</a>
                    </td>
                    <td>{lead.phone ? <a href={`tel:${lead.phone}`}>{lead.phone}</a> : "—"}</td>
                    <td>{lead.chatbotName}</td>
                    <td>{lead.createdAt.toLocaleDateString()}</td>
                    <td>
                      <Link href={`/dashboard/conversations/${lead.conversationId}`}>
                        View chat →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m5-table-note">Showing the latest {rows.length} leads.</p>
          </div>
        )}
      </section>
    </WorkspaceFrame>
  );
}

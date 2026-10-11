import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatbots, leads } from "@/db/schema";
import { requireWorkspace } from "@/lib/workspace";

function escapeCsv(value: string | null) {
  const cleanValue = value ?? "";
  const safeValue = /^[=+\-@\t\r]/.test(cleanValue) ? `'${cleanValue}` : cleanValue;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export async function GET() {
  const { workspace } = await requireWorkspace();
  const rows = await db
    .select({
      name: leads.name,
      email: leads.email,
      phone: leads.phone,
      chatbotName: chatbots.name,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(chatbots, eq(leads.chatbotId, chatbots.id))
    .where(eq(leads.workspaceId, workspace.id))
    .orderBy(desc(leads.createdAt));
  const csv = [
    ["Name", "Email", "Phone", "Assistant", "Captured at"].map(escapeCsv).join(","),
    ...rows.map((row) =>
      [row.name, row.email, row.phone, row.chatbotName, row.createdAt.toISOString()]
        .map(escapeCsv)
        .join(","),
    ),
  ].join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="frontdesk-leads.csv"',
      "Cache-Control": "no-store",
    },
  });
}

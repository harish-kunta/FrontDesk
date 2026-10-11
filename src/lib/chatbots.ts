import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { chatbots } from "@/db/schema";
import { requireWorkspace } from "@/lib/workspace";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Resolve a bot only after deriving the workspace from the signed-in session. */
export async function requireOwnedChatbot(chatbotId: string) {
  if (!UUID_PATTERN.test(chatbotId)) notFound();

  const { user, workspace } = await requireWorkspace();
  const [chatbot] = await db
    .select()
    .from(chatbots)
    .where(and(eq(chatbots.id, chatbotId), eq(chatbots.workspaceId, workspace.id)))
    .limit(1);

  if (!chatbot) notFound();
  return { user, workspace, chatbot };
}

export async function listWorkspaceChatbots(workspaceId: string) {
  return db
    .select({
      id: chatbots.id,
      name: chatbots.name,
      status: chatbots.status,
      createdAt: chatbots.createdAt,
    })
    .from(chatbots)
    .where(eq(chatbots.workspaceId, workspaceId))
    .orderBy(desc(chatbots.createdAt));
}

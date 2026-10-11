import "server-only";

import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { chatbots } from "@/db/schema";
import { requireWorkspace } from "@/lib/workspace";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Authenticate API callers and resolve chatbot ownership from the session, never the request body. */
export async function findApiChatbot(chatbotId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      response: Response.json({ error: "Sign in to manage chatbot sources." }, { status: 401 }),
    };
  }
  if (!UUID_PATTERN.test(chatbotId)) {
    return { response: Response.json({ error: "Chatbot not found." }, { status: 404 }) };
  }

  const { workspace } = await requireWorkspace();
  const [chatbot] = await db
    .select({ id: chatbots.id })
    .from(chatbots)
    .where(and(eq(chatbots.id, chatbotId), eq(chatbots.workspaceId, workspace.id)))
    .limit(1);
  if (!chatbot) {
    return { response: Response.json({ error: "Chatbot not found." }, { status: 404 }) };
  }
  return { chatbot };
}

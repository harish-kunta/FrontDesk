import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { chatbots, conversations } from "@/db/schema";
import { requireWorkspace } from "@/lib/workspace";

type RouteContext = { params: Promise<{ conversationId: string }> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(_request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  if (!UUID_PATTERN.test(conversationId)) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  const { workspace } = await requireWorkspace();
  const [ownedConversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(chatbots, eq(conversations.chatbotId, chatbots.id))
    .where(and(eq(conversations.id, conversationId), eq(chatbots.workspaceId, workspace.id)))
    .limit(1);
  if (!ownedConversation) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  await db.delete(conversations).where(eq(conversations.id, ownedConversation.id));
  revalidatePath("/dashboard/conversations");
  revalidatePath(`/dashboard/conversations/${conversationId}`);
  return Response.json({ success: true });
}

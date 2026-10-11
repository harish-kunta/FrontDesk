import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { workspaceMembers, workspaces } from "@/db/schema";

/**
 * Resolve the signed-in user's workspace on the server. Callers should use the
 * returned ID in every customer-data query; never take it from a form or URL.
 */
export async function requireWorkspace() {
  const session = await auth();
  const user = session?.user;

  if (!user?.id) redirect("/signin");

  const [existingWorkspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.ownerId, user.id))
    .limit(1);

  if (existingWorkspace) {
    const [membership] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, existingWorkspace.id),
          eq(workspaceMembers.userId, user.id),
        ),
      )
      .limit(1);

    if (membership) return { user, workspace: existingWorkspace };
  }

  // The unique owner_id constraint makes this safe if two first-page requests
  // arrive at nearly the same time.
  const workspace = await db.transaction(async (tx) => {
    await tx
      .insert(workspaces)
      .values({
        name: `${user.name?.trim() || "My"}'s workspace`,
        ownerId: user.id,
      })
      .onConflictDoNothing({ target: workspaces.ownerId });

    const [resolvedWorkspace] = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.ownerId, user.id))
      .limit(1);

    if (!resolvedWorkspace) throw new Error("Could not create the user's workspace.");

    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: resolvedWorkspace.id, userId: user.id, role: "owner" })
      .onConflictDoNothing();

    return resolvedWorkspace;
  });

  return { user, workspace };
}

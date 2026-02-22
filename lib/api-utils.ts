import { db } from "@/lib/db";
import { workspaces, users } from "@/lib/db/schema";

/**
 * Resolve the default workspace and user IDs for API routes.
 * In a full multi-tenant setup this would read from the authenticated session.
 * For now, returns the first workspace and user in the database.
 */
export async function resolveWorkspaceAndUser(
  bodyWorkspaceId?: string,
  bodyCreatedBy?: string
): Promise<{ workspaceId: string; createdBy: string }> {
  let workspaceId = bodyWorkspaceId;
  let createdBy = bodyCreatedBy;

  // If valid UUIDs were provided and they aren't the null placeholder, use them
  const nullUUID = "00000000-0000-0000-0000-000000000000";

  if (!workspaceId || workspaceId === nullUUID) {
    try {
      const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
      workspaceId = ws?.id || nullUUID;
    } catch {
      workspaceId = nullUUID;
    }
  }

  if (!createdBy || createdBy === nullUUID) {
    try {
      const [user] = await db.select({ id: users.id }).from(users).limit(1);
      createdBy = user?.id || nullUUID;
    } catch {
      createdBy = nullUUID;
    }
  }

  return { workspaceId, createdBy };
}

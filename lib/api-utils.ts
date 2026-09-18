import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";

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

  const nullUUID = "00000000-0000-0000-0000-000000000000";

  if (!workspaceId || workspaceId === nullUUID) {
    try {
      const { data } = await intelligenceDb
        .from("workspaces")
        .select("id")
        .limit(1)
        .single();
      workspaceId = data?.id || nullUUID;
    } catch {
      workspaceId = nullUUID;
    }
  }

  if (!createdBy || createdBy === nullUUID) {
    try {
      const { data } = await supabase
        .from("users")
        .select("id_user")
        .is("date_deleted", null)
        .limit(1)
        .single();
      createdBy = data ? String(data.id_user) : nullUUID;
    } catch {
      createdBy = nullUUID;
    }
  }

  return { workspaceId: workspaceId!, createdBy: createdBy! };
}

import { intelligenceDb } from "@/lib/supabase-intelligence";

export type AccessResult =
  | { allowed: true; permission: "owner" | "view" | "collaborate" }
  | { allowed: false };

/**
 * Centralised access check for AI conversations.
 * Returns the user's permission level or denies access.
 */
export async function checkConversationAccess(
  conversationId: string,
  userId: number,
  conversation: { visibility: string; userCreated: number; workspaceId?: string }
): Promise<AccessResult> {
  // Owner always has full access
  if (conversation.userCreated === userId) {
    return { allowed: true, permission: "owner" };
  }

  // Team conversations are accessible to workspace members only
  if (conversation.visibility === "team") {
    if (conversation.workspaceId) {
      const { data: membership } = await intelligenceDb
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", conversation.workspaceId)
        .eq("user_id", userId)
        .limit(1);
      if (!membership || membership.length === 0) {
        return { allowed: false };
      }
    }
    return { allowed: true, permission: "collaborate" };
  }

  // Private conversations — check shares table
  const { data: share } = await intelligenceDb
    .from("ai_shares")
    .select("type_permission")
    .eq("id_conversation", conversationId)
    .eq("user_recipient", userId)
    .maybeSingle();

  if (share) {
    return {
      allowed: true,
      permission: share.type_permission as "view" | "collaborate",
    };
  }

  return { allowed: false };
}

/**
 * Mirror of checkConversationAccess for design_sessions (the Design Mode v2
 * data root). Same shape, different table — keeps the two services parallel.
 */
export async function checkSessionAccess(
  sessionId: string,
  userId: number,
  session: { visibility: string; userCreated: number; workspaceId?: string }
): Promise<AccessResult> {
  // Owner has full access
  if (session.userCreated === userId) {
    return { allowed: true, permission: "owner" };
  }

  // Team sessions are accessible to workspace members
  if (session.visibility === "team") {
    if (session.workspaceId) {
      const { data: membership } = await intelligenceDb
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", session.workspaceId)
        .eq("user_id", userId)
        .limit(1);
      if (!membership || membership.length === 0) {
        return { allowed: false };
      }
    }
    return { allowed: true, permission: "collaborate" };
  }

  // Private — check design_shares (parallel table to ai_shares)
  const { data: share } = await intelligenceDb
    .from("design_shares")
    .select("type_permission")
    .eq("id_session", sessionId)
    .eq("user_recipient", userId)
    .maybeSingle();

  if (share) {
    return {
      allowed: true,
      permission: share.type_permission as "view" | "collaborate",
    };
  }

  return { allowed: false };
}

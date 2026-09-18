/**
 * Creating a memory — extracted from POST /api/ai/memories so the notebook's
 * promote action reaches the SAME contract rather than a second copy of it.
 *
 * Everything security-relevant lives here: source-conversation authorisation,
 * scope validation, the admin entitlement for team memories, and the 50-row
 * cap. A duplicate of this logic elsewhere is how the two halves drift apart,
 * which has already bitten this codebase once (hasClientAttendee hardened in
 * SQL and left vulnerable in TypeScript).
 */

import { intelligenceDb } from "@/lib/supabase-intelligence";
import { mapMemory } from "@/lib/ai/response-mappers";

export const MEMORY_CAP = 50;

export interface CreateMemoryInput {
  workspaceId: string;
  userId: number;
  /** Workspace role from verifyWorkspaceMembership — owner/admin bypass the flag. */
  memberRole: string | null;
  content: string;
  category?: string;
  scope?: "private" | "team";
  sourceConversationId?: string | null;
  /** Notebook entries carry a stamped audience floor that survives deletion of
   *  the source thread. When it says private, no team memory may result even
   *  if the conversation can no longer be resolved. */
  forcePrivate?: boolean;
  /** Distinguishes a notebook promotion from a hand-written memory. */
  source?: string;
}

export type CreateMemoryResult =
  | { ok: true; memory: ReturnType<typeof mapMemory>; notice?: string }
  | { ok: false; error: string; status: number };

export async function createMemory(input: CreateMemoryInput): Promise<CreateMemoryResult> {
  const { workspaceId, userId, memberRole, content, category, scope, sourceConversationId } = input;

  if (!workspaceId || !content) {
    return { ok: false, error: "workspaceId and content are required", status: 400 };
  }
  if (scope !== undefined && scope !== "private" && scope !== "team") {
    return { ok: false, error: "scope must be 'private' or 'team'", status: 400 };
  }

  let finalScope: "private" | "team" = scope || "private";
  let finalUserId: number | null = userId;
  let downgradedToPrivate = false;

  // A caller-supplied floor wins outright — no lookup can lift it.
  if (input.forcePrivate) {
    finalScope = "private";
    finalUserId = userId;
  }

  // ── Resolve the source conversation FIRST, and authorise it. ──
  // A team memory is injected into every workspace member's system prompt on
  // every turn, so promoting one is a workspace-wide act. The justification
  // must be verified, not merely present: selecting by id alone would let a
  // caller name a conversation in another workspace — or create their own team
  // conversation, which any member may do — and have it count as authority.
  let sourceIsTeam = false;
  if (sourceConversationId && !input.forcePrivate) {
    const { data: conv } = await intelligenceDb
      .from("ai_conversations")
      .select("type_visibility, id_workspace, user_created")
      .eq("id_conversation", sourceConversationId)
      .maybeSingle();

    const sameWorkspace = !!conv && conv.id_workspace === workspaceId;
    const readable = sameWorkspace &&
      (conv!.user_created === userId || conv!.type_visibility === "team");
    if (!conv || !sameWorkspace || !readable) {
      console.warn(`[Memories] user ${userId} referenced an unreadable/foreign source conversation — ignoring it`);
    } else {
      sourceIsTeam = conv.type_visibility === "team";
    }
    // A private (or unverifiable) source can ONLY produce a private memory.
    if (!sourceIsTeam) {
      finalScope = "private";
      finalUserId = userId;
    }
  }

  // ── Entitlement check on the FINAL scope, however it was reached. ──
  if (finalScope === "team") {
    const { data: adminRow } = await intelligenceDb
      .from("users_access")
      .select("flag_access_admin")
      .eq("user_target", userId)
      .eq("id_workspace", workspaceId)
      .eq("flag_access_admin", 1)
      .limit(1)
      .maybeSingle();
    const isRoleAdmin = ["owner", "admin"].includes(String(memberRole || "").toLowerCase());
    if (!adminRow && !isRoleAdmin) {
      console.warn(`[Memories] user ${userId} not entitled to create a team memory — stored as private`);
      finalScope = "private";
      finalUserId = userId;
      downgradedToPrivate = true;
    } else {
      finalUserId = null;
    }
  } else {
    finalUserId = userId;
  }

  // Enforce the cap per user per workspace. NOTE the and(): without it this
  // reads as "(any private memory in the workspace) OR (any memory I own)", so
  // every colleague's private memories counted towards YOUR cap and blocked
  // saves you couldn't even see, let alone archive. Matches the GET filter.
  const countFilter = finalUserId !== null
    ? `and(type_scope.eq.private,user_memory.eq.${userId})`
    : `type_scope.eq.team`;

  const { count: memoryCount } = await intelligenceDb
    .from("ai_memories")
    .select("*", { count: "exact", head: true })
    .eq("id_workspace", workspaceId)
    .eq("flag_active", 1)
    .or(countFilter);

  if ((memoryCount || 0) >= MEMORY_CAP) {
    return {
      ok: false,
      status: 400,
      error: `Memory limit reached (${MEMORY_CAP}). Archive old memories to save new ones.`,
    };
  }

  const { data: memory, error } = await intelligenceDb
    .from("ai_memories")
    .insert({
      id_workspace: workspaceId,
      user_memory: finalUserId,
      type_scope: finalScope,
      type_category: category || "fact",
      information_content: content.slice(0, 500),
      id_conversation_source: sourceConversationId || null,
      type_source: input.source || "explicit", // user-created memories get highest trust
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message, status: 500 };

  return {
    ok: true,
    memory: mapMemory(memory),
    ...(downgradedToPrivate
      ? { notice: "Saved as a private memory. Team memories apply to everyone in the workspace, so only an admin can create one." }
      : {}),
  };
}

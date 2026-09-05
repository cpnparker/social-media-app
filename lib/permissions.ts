import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { NextResponse } from "next/server";

// ── Role Categories ──
const TCE_STAFF_ROLES = ["super", "tceadmin", "tcemanager", "tceuser"];
const CLIENT_ROLES = ["clientadmin", "clientuser", "freelancer"];

export function isTCEStaff(role: string): boolean {
  return TCE_STAFF_ROLES.includes(role);
}

export function isClientRole(role: string): boolean {
  return CLIENT_ROLES.includes(role);
}

// ── Core auth check ──
// Returns the authenticated user's id and role, or a 401 response.
// Always verifies role from the database to handle stale JWT tokens.
export async function requireAuth(): Promise<
  { userId: number; role: string } | NextResponse
> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id, 10);
  let role = (session.user as any).role || "none";

  // Always refresh role from DB to handle stale JWT tokens
  try {
    const { data: dbUser } = await supabase
      .from("users")
      .select("role_user")
      .eq("id_user", userId)
      .is("date_deleted", null)
      .single();
    if (dbUser?.role_user) {
      role = dbUser.role_user;
    }
  } catch {
    // Keep session role on DB error
  }

  return { userId, role };
}

// ── Client access check ──
// For TCE staff: returns null (meaning "all clients allowed").
// For client roles: returns the array of client IDs they can access.
// For "none": returns empty array (no access).
export async function getAllowedClientIds(
  userId: number,
  role: string
): Promise<number[] | null> {
  if (isTCEStaff(role)) return null; // null = unrestricted

  if (isClientRole(role)) {
    const { data } = await supabase
      .from("lookup_users_clients")
      .select("id_client")
      .eq("id_user", userId);
    return (data || []).map((r) => r.id_client);
  }

  // role === "none" or unknown
  return [];
}

// ── Validate a specific customerId against permissions ──
export async function canAccessClient(
  userId: number,
  role: string,
  clientId: number
): Promise<boolean> {
  if (isTCEStaff(role)) return true;

  const allowedIds = await getAllowedClientIds(userId, role);
  if (!allowedIds) return true;
  return allowedIds.includes(clientId);
}

// ── Workspace membership check ──
// Verifies the user belongs to the given workspace via Supabase workspace_members.
// Returns the member role ('owner' | 'admin' | 'editor' | 'viewer') or null if not a member.
export async function verifyWorkspaceMembership(
  userId: number,
  workspaceId: string
): Promise<string | null> {
  try {
    const { data: member } = await intelligenceDb
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .limit(1)
      .single();
    return member?.role || null;
  } catch {
    return null;
  }
}

// ── EngineAI front door ──
/**
 * May this user run an EngineAI turn in this workspace?
 *
 * flag_access_enginegpt was previously enforced only in the browser: the rail
 * hid EngineAI, but a session cookie could still POST straight to
 * /api/ai/conversations and .../messages and get a full turn with Engine,
 * client-context, MeetingBrain and Slack access. Revoking access — including
 * the bulk /api/admin/restrict-access route — therefore did not actually
 * revoke anything until the cookie expired.
 *
 * Semantics deliberately match the browser's source of truth exactly
 * (/api/me/workspaces:64, `access ? !!access.flag_access_enginegpt : false`),
 * so switching this on locks out nobody who can use the product today:
 * an absent users_access row is DENIED, and so is a row with the flag at 0.
 * A query error is also denied — this is the front door, so it fails closed.
 */
export async function hasEngineAiAccess(
  userId: number,
  workspaceId: string
): Promise<boolean> {
  try {
    const { data, error } = await intelligenceDb
      .from("users_access")
      .select("flag_access_enginegpt")
      .eq("id_workspace", workspaceId)
      .eq("user_target", userId)
      .maybeSingle();
    if (error) {
      console.error("[access] enginegpt check failed:", error.message);
      return false;
    }
    return !!data?.flag_access_enginegpt;
  } catch {
    return false;
  }
}

/**
 * May this user use the Content Optimizer in this workspace?
 *
 * ONE GATE: the optimiser is part of EngineAI, so this IS hasEngineAiAccess.
 *
 * It used to read its own optimizer flag, which was right while the feature
 * shipped dark to a handful of accounts and wrong the moment it became
 * standard. A second flag that must be granted alongside the first is a
 * synchronisation job nobody is assigned: whoever onboards the next hire grants
 * EngineAI, and three months later one person mysteriously lacks the optimiser.
 * Chris made the call on 2026-08-24 — default on for every EngineAI user.
 *
 * DELEGATING rather than copying the query is the point. A duplicated select on
 * the enginegpt flag would be two code paths obliged to agree forever; a call
 * cannot drift. It also inherits the front-door semantics documented above —
 * absent row denied, zero denied, query error denied — instead of restating
 * them and risking a copy that says something subtly different.
 *
 * The old strict `=== 1` versus this truthy read makes no difference on a
 * `smallint NOT NULL DEFAULT 0` column, and matching the browser's source of
 * truth exactly (/api/me/workspaces) matters more than the strictness did.
 *
 * The old per-feature column is now UNREAD. It stays in the table and
 * /api/admin/restrict-access keeps zeroing it, so the data stays truthful if
 * the gate is ever split again — but nothing gates on it, and revocation now
 * runs through the enginegpt flag, which that route already clears in its main
 * update. Verified before shipping: the lockdown still locks the optimiser out.
 */
export async function hasOptimizerAccess(
  userId: number,
  workspaceId: string
): Promise<boolean> {
  return hasEngineAiAccess(userId, workspaceId);
}

// ── Apply client scoping to a Supabase query builder ──
// Returns { query } with filters applied, or { query, error } with a 403 response.
export async function scopeQueryToClients(
  query: any,
  userId: number,
  role: string,
  customerId: string | null,
  clientColumn: string = "id_client"
): Promise<{ query: any; error?: NextResponse }> {
  const allowedIds = await getAllowedClientIds(userId, role);

  if (customerId) {
    const cid = parseInt(customerId, 10);
    // Validate access
    if (allowedIds !== null && !allowedIds.includes(cid)) {
      return {
        query,
        error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
    return { query: query.eq(clientColumn, cid) };
  }

  // No customerId filter specified
  if (allowedIds !== null) {
    if (allowedIds.length === 0) {
      // No access to any client — return empty results
      return { query: query.in(clientColumn, [-1]) };
    }
    return { query: query.in(clientColumn, allowedIds) };
  }

  // TCE staff with no filter = return everything
  return { query };
}

import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
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
  } catch (err) {
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

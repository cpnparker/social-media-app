import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isTCEStaff } from "@/lib/permissions";

/**
 * Staff gate for the client summary section, which fails CLOSED.
 *
 * requireAuth() in lib/permissions.ts refreshes the role from the database but
 * KEEPS THE SESSION ROLE if that lookup returns nothing (:43, "Keep session
 * role on DB error"). Two ways that reads wrong: supabase-js resolves a failed
 * query as {data: null, error} rather than throwing, so the catch rarely runs
 * and `dbUser?.role_user` is simply undefined; and a soft-deleted user is
 * excluded by the `date_deleted` filter, so they also fall through to whatever
 * their JWT last said. Either way a stale token keeps its privileges.
 *
 * That is a reasonable default for the app at large — a transient database
 * blip should not sign everyone out — but wrong for this section, which puts
 * the whole book of business, every account manager and (for finance viewers)
 * every contract value on one screen. Here, not being able to confirm who
 * someone is means no.
 *
 * Deliberately NOT a change to requireAuth: every route in the app depends on
 * its current behaviour, and tightening it globally is a separate decision with
 * a much larger blast radius.
 */
export async function requireTceStaff(): Promise<
  { userId: number; role: string; email: string } | NextResponse
> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The role comes from the DATABASE, never from the token. Any failure to
  // read it is a denial, not a fallback.
  const { data: dbUser, error } = await supabase
    .from("users")
    .select("role_user, email_user")
    .eq("id_user", userId)
    .is("date_deleted", null)
    .maybeSingle();

  if (error) {
    console.error("[clients] role lookup failed — denying:", error.message);
    return NextResponse.json({ error: "Could not verify access" }, { status: 503 });
  }
  if (!dbUser?.role_user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isTCEStaff(dbUser.role_user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The workspace domain is derived from this address downstream, so an
  // account without one cannot run the client-meeting query at all.
  const email = (dbUser as any).email_user || session.user.email || "";
  if (!email) {
    return NextResponse.json({ error: "No email on account" }, { status: 403 });
  }

  return { userId, role: dbUser.role_user, email };
}

/**
 * May this viewer see money — contract values, revenue, invoice amounts?
 *
 * Separate from staff access on purpose: everyone in the section sees the
 * relationship and delivery picture, only finance holders see the figures.
 * Mirrors the per-user gate the chat and voice surfaces use, and fails closed
 * the same way — an unreadable flag is a no.
 */
export async function hasFinanceAccess(userId: number, workspaceId: string): Promise<boolean> {
  const { intelligenceDb } = await import("@/lib/supabase-intelligence");
  const { data, error } = await intelligenceDb
    .from("users_access")
    .select("flag_access_finance")
    .eq("id_workspace", workspaceId)
    .eq("user_target", userId)
    .maybeSingle();
  if (error) return false;
  return (data as any)?.flag_access_finance === 1;
}

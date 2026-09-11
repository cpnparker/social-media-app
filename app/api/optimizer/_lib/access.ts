/**
 * The Content Optimizer's front door.
 *
 * Every optimizer route calls this first. It exists as one helper rather than
 * inline boilerplate because there are three separate things to get right and
 * each has bitten this codebase before:
 *
 *  - the flag is read in its OWN PostgREST select (a select naming a column
 *    that a lagging deploy has not migrated yet fails ENTIRELY, silently
 *    revoking whatever else that select was fetching);
 *  - it fails closed on absent row, zero, null and query error alike;
 *  - session ownership is checked against the row, not assumed from the
 *    cookie. The intelligence client is service-role and bypasses RLS, so
 *    these checks ARE the access control — there is no database backstop.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { hasOptimizerAccess, verifyWorkspaceMembership } from "@/lib/permissions";

export interface OptimizerCaller {
  userId: number;
  email: string;
  workspaceId: string;
}

type Guard = { ok: true; caller: OptimizerCaller } | { ok: false; response: NextResponse };

export async function requireOptimizer(workspaceId: string | null): Promise<Guard> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!workspaceId) {
    return { ok: false, response: NextResponse.json({ error: "workspaceId is required" }, { status: 400 }) };
  }
  const userId = parseInt(session.user.id, 10);

  const role = await verifyWorkspaceMembership(userId, workspaceId);
  if (!role) {
    return { ok: false, response: NextResponse.json({ error: "Not a member of this workspace" }, { status: 403 }) };
  }

  const allowed = await hasOptimizerAccess(userId, workspaceId);
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "The Content Optimizer is not enabled for your account" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, caller: { userId, email: session.user.email, workspaceId } };
}

/**
 * Fetch a session the caller is entitled to, and say WHICH entitlement.
 *
 * This adopts the conversation model in lib/ai/access.ts rather than growing a
 * second one: owner gets everything, a workspace member gets `collaborate` on a
 * team-visible article, and a private article belongs to one person. Articles
 * sit beside conversations in the same sidebar under the same two tabs, so a
 * teammate clicking a team article and getting "not found" would be the model
 * visibly disagreeing with itself.
 *
 * There is no share tier here because there is no optimizer_shares table. That
 * is an absence, not a denial dressed up as one — private means private.
 */
export type OptimizerPermission = "owner" | "collaborate";

export async function loadSessionForCaller(sessionId: string, caller: OptimizerCaller) {
  const { data, error } = await intelligenceDb
    .from("optimizer_sessions")
    .select("*")
    .eq("id_session", sessionId)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, error: "Could not load that session" };
  if (!data) return { ok: false as const, status: 404, error: "Session not found" };

  const row = data as any;
  // Workspace first, always. Everything below assumes the article belongs to
  // the workspace the caller was admitted to.
  if (row.id_workspace !== caller.workspaceId) {
    return { ok: false as const, status: 404, error: "Session not found" };
  }
  if (row.user_created === caller.userId) {
    return { ok: true as const, session: row, permission: "owner" as OptimizerPermission };
  }
  // Strict equality, so a row whose visibility was never written is private by
  // omission rather than team by accident.
  if (row.type_visibility === "team") {
    return { ok: true as const, session: row, permission: "collaborate" as OptimizerPermission };
  }
  // 404 rather than 403: a wrong-owner 403 confirms the article exists.
  return { ok: false as const, status: 404, error: "Session not found" };
}

/** @deprecated Use loadSessionForCaller — this name outlived the owner-only model. */
export const loadOwnedSession = loadSessionForCaller;

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
 * Fetch a session the caller is entitled to.
 *
 * Ownership is `user_created` equality plus workspace match. Deliberately NOT
 * share-aware yet: the conversation sharing model (lib/ai/access.ts) is a real
 * design with view/collaborate semantics, and inventing a second, subtly
 * different one here would be worse than having none. When optimizer sessions
 * need sharing they should adopt that model, not grow their own.
 */
export async function loadOwnedSession(sessionId: string, caller: OptimizerCaller) {
  const { data, error } = await intelligenceDb
    .from("optimizer_sessions")
    .select("*")
    .eq("id_session", sessionId)
    .maybeSingle();

  if (error) return { ok: false as const, status: 500, error: "Could not load that session" };
  if (!data) return { ok: false as const, status: 404, error: "Session not found" };
  if ((data as any).id_workspace !== caller.workspaceId || (data as any).user_created !== caller.userId) {
    // 404 rather than 403: a wrong-owner 403 confirms the session exists.
    return { ok: false as const, status: 404, error: "Session not found" };
  }
  return { ok: true as const, session: data as any };
}

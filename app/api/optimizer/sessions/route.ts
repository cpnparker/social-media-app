/**
 * GET  /api/optimizer/sessions  — list the caller's sessions in a workspace.
 * POST /api/optimizer/sessions  — create one from a brief.
 *
 * Creating a session snapshots the client canon onto the row. That snapshot is
 * the point: the live canon refreshes on its own schedule, and an assessment
 * that silently re-grounds itself against facts the writer never saw is not
 * reproducible. See the header of the migration.
 */

import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { requireOptimizer } from "../_lib/access";
import { getClientCanon } from "@/lib/optimizer/client-canon";
import { canAccessClient, requireAuth } from "@/lib/permissions";
import { RUBRIC_VERSION } from "@/lib/optimizer/rubric";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  const guard = await requireOptimizer(workspaceId);
  if (!guard.ok) return guard.response;

  const { data, error } = await intelligenceDb
    .from("optimizer_sessions")
    .select("id_session, name_title, type_status, type_format, id_client, date_updated")
    .eq("id_workspace", guard.caller.workspaceId)
    .eq("user_created", guard.caller.userId)
    .order("date_updated", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[optimizer] session list failed:", error.message);
    return NextResponse.json({ error: "Could not load sessions" }, { status: 500 });
  }
  return NextResponse.json({ sessions: data || [] });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const guard = await requireOptimizer(body.workspaceId || null);
  if (!guard.ok) return guard.response;
  const { caller } = guard;

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled piece";
  const clientId = body.clientId != null ? Number(body.clientId) : null;

  // A client-scoped session must pass the same client gate as everything else
  // in the app. Without this a user could ground a draft in — and later file it
  // against — a client they cannot otherwise see.
  if (clientId != null && !Number.isNaN(clientId)) {
    const authed = await requireAuth();
    if ("userId" in authed) {
      const ok = await canAccessClient(authed.userId, authed.role, clientId);
      if (!ok) return NextResponse.json({ error: "No access to that client" }, { status: 403 });
    }
  }

  let canon: any = {};
  if (clientId != null && !Number.isNaN(clientId)) {
    try {
      canon = await getClientCanon(caller.workspaceId, clientId, caller.email);
    } catch (e) {
      // A canon that cannot be built is a thinner draft, not a failed request.
      console.warn("[optimizer] canon build failed:", e);
      canon = { gaps: [{ source: "engine", reason: "Canon unavailable at creation time" }] };
    }
  }

  const brief = {
    targetQueries: Array.isArray(body.targetQueries) ? body.targetQueries.slice(0, 5) : [],
    audience: typeof body.audience === "string" ? body.audience.slice(0, 2000) : "",
    goal: typeof body.goal === "string" ? body.goal.slice(0, 2000) : "",
    lengthBand: typeof body.lengthBand === "string" ? body.lengthBand : "800-1500",
    voice: typeof body.voice === "string" ? body.voice.slice(0, 500) : "",
  };

  const { data, error } = await intelligenceDb
    .from("optimizer_sessions")
    .insert({
      id_workspace: caller.workspaceId,
      user_created: caller.userId,
      id_client: clientId != null && !Number.isNaN(clientId) ? clientId : null,
      name_title: title,
      type_status: "brief",
      type_format: typeof body.format === "string" ? body.format : "explainer",
      type_platform: typeof body.platform === "string" ? body.platform : "balanced",
      config_brief: brief,
      config_canon: canon,
      name_rubric_version: RUBRIC_VERSION,
    })
    .select("id_session")
    .maybeSingle();

  if (error || !data) {
    console.error("[optimizer] session create failed:", error?.message);
    return NextResponse.json({ error: "Could not create that session" }, { status: 500 });
  }

  return NextResponse.json({ sessionId: (data as any).id_session, canon });
}

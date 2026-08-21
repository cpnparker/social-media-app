/**
 * GET   /api/optimizer/sessions/[id]/draft — latest draft + brief + canon.
 * PATCH /api/optimizer/sessions/[id]/draft — persist the writer's edits.
 *
 * The editor saves on a debounce, so PATCH is called often and must be cheap.
 * It UPDATES the current version rather than appending a new one — a version
 * per keystroke-batch would bury the meaningful snapshots (each generation,
 * each finalise) that the Phase 3 waterfall reads.
 */

import { NextRequest, NextResponse } from "next/server";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { requireOptimizer, loadOwnedSession } from "../../../_lib/access";

export const maxDuration = 30;

async function latestDraft(sessionId: string) {
  const { data } = await intelligenceDb
    .from("optimizer_drafts")
    .select("id_draft, units_version, document_body, units_words")
    .eq("id_session", sessionId)
    .order("units_version", { ascending: false })
    .limit(1);
  return data && data.length > 0 ? (data[0] as any) : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireOptimizer(req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;

  const owned = await loadOwnedSession(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const draft = await latestDraft(id);
  return NextResponse.json({
    session: {
      id: owned.session.id_session,
      title: owned.session.name_title,
      status: owned.session.type_status,
      format: owned.session.type_format,
      platform: owned.session.type_platform,
      clientId: owned.session.id_client,
      brief: owned.session.config_brief,
      canon: owned.session.config_canon,
      rubricVersion: owned.session.name_rubric_version,
    },
    draft,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof body.body !== "string") {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const guard = await requireOptimizer(body.workspaceId || null);
  if (!guard.ok) return guard.response;

  const owned = await loadOwnedSession(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const words = (body.body.match(/\S+/g) || []).length;
  const current = await latestDraft(id);

  if (current) {
    const { error } = await intelligenceDb
      .from("optimizer_drafts")
      .update({ document_body: body.body, units_words: words })
      .eq("id_draft", current.id_draft);
    if (error) {
      console.error("[optimizer] draft save failed:", error.message);
      return NextResponse.json({ error: "Could not save" }, { status: 500 });
    }
  } else {
    // No generation happened — the writer pasted their own content in. That is
    // a supported entry point, so it gets version 1 rather than an error.
    const { error } = await intelligenceDb.from("optimizer_drafts").insert({
      id_session: id,
      units_version: 1,
      document_body: body.body,
      units_words: words,
    });
    if (error) {
      console.error("[optimizer] draft create failed:", error.message);
      return NextResponse.json({ error: "Could not save" }, { status: 500 });
    }
  }

  // MUST NOT clobber an in-flight assessment.
  //
  // The editor autosaves on a 600ms debounce, so a writer typing while an
  // assessment runs — the normal case, not an edge case — was resetting
  // type_status out of "assessing" and unlocking the in-flight guard. A second
  // Assess click was then admitted and billed a second judge call. The guard
  // was defeated by our own autosave.
  await intelligenceDb
    .from("optimizer_sessions")
    .update({ type_status: "refining", date_updated: new Date().toISOString() })
    .eq("id_session", id)
    .neq("type_status", "assessing");

  return NextResponse.json({ ok: true, words });
}

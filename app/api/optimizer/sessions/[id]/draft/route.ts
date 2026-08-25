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
import { requireOptimizer, loadSessionForCaller } from "../../../_lib/access";

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

  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const draft = await latestDraft(id);

  // The most recent assessment and its findings, so reopening a piece shows the
  // marks that were already paid for. Without this, hydration cleared them and
  // the only way back was to press Assess again — which, on unchanged text,
  // hit the memo and returned nothing.
  let assessment: any = null;
  let findings: any[] = [];
  const { data: latest } = await intelligenceDb
    .from("optimizer_assessments")
    .select("id_assessment, units_overall, units_retrievability, units_citability, name_grade, date_created")
    .eq("id_session", id)
    .eq("type_kind", "full")
    .order("date_created", { ascending: false })
    .limit(1);
  if (latest && latest.length > 0) {
    assessment = latest[0];
    const { data: f } = await intelligenceDb
      .from("optimizer_findings")
      .select("id_finding, name_criterion, type_severity, document_quote, document_prefix, document_suffix, document_explanation, document_suggestion, type_status")
      .eq("id_assessment", (latest[0] as any).id_assessment)
      .neq("type_status", "dismissed");
    findings = (f || []).map((r: any) => ({
      id: r.id_finding,
      criterion: r.name_criterion,
      severity: r.type_severity,
      quote: r.document_quote,
      prefix: r.document_prefix || undefined,
      suffix: r.document_suffix || undefined,
      explanation: r.document_explanation,
      suggestedEdit: r.document_suggestion || null,
    }));
  }

  return NextResponse.json({
    assessment,
    findings,
    session: {
      id: owned.session.id_session,
      title: owned.session.name_title,
      status: owned.session.type_status,
      format: owned.session.type_format,
      platform: owned.session.type_platform,
      clientId: owned.session.id_client,
      source: owned.session.type_source,
      sourceRef: owned.session.document_source_ref,
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

  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

  // A CEILING ON WHAT CAN BE STORED, because everything downstream has one.
  //
  // The import path caps at MAX_IMPORT_CHARS, but this paste/save path had no
  // length check on either branch — so the unbounded way in was the one a
  // writer uses by hand. Assess then refuses the draft at 40k, and coverage
  // (which sends the whole thing to a model twice) had no ceiling at all until
  // today. A draft that cannot be assessed or analysed is not a draft the
  // studio can do anything with, so refusing it here is kinder than storing it
  // and failing at every press afterwards.
  //
  // Generous relative to the 40k analysis cap: the writer may legitimately be
  // holding a long source document they intend to cut down.
  const MAX_DRAFT_CHARS = 200000;
  if (body.body.length > MAX_DRAFT_CHARS) {
    return NextResponse.json(
      {
        error:
          `This draft is ${Math.round(body.body.length / 1000)}k characters, over the ${MAX_DRAFT_CHARS / 1000}k limit. ` +
          `Assessment caps at 40k and coverage analysis sends the whole draft to a model twice, so a piece this long ` +
          `cannot be scored — split it into sections and work on one at a time.`,
      },
      { status: 413 }
    );
  }

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

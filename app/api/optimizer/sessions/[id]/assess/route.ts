/**
 * POST /api/optimizer/sessions/[id]/assess — run the judge over the draft.
 *
 * The expensive path in the studio, and the one a writer can trigger by
 * clicking a button repeatedly. Four things stand between that button and the
 * bill, in cheapest-first order:
 *
 *   1. THE MEMO. Identical input never re-runs. This is not an optimisation —
 *      it is what makes "re-assessing unchanged text does not move the score"
 *      literally true, given claude-sonnet-5 accepts no temperature and the API
 *      has no seed. A second click on unchanged text returns the first result.
 *   2. THE IN-FLIGHT GUARD. A session already assessing rejects a second
 *      request rather than running a parallel judge pass whose result would
 *      overwrite the first.
 *   3. THE RATE LIMIT. Per session, because that is the unit a writer actually
 *      hammers.
 *   4. THE SPEND CAP. assertServiceAllowed, which now has a service_config row
 *      to read and ai_usage rows to count.
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { assertServiceAllowed } from "@/lib/admin/service-control";
import { logAiUsage } from "@/lib/ai/usage-logger";
import { requireOptimizer, loadSessionForCaller } from "../../../_lib/access";
import { parseDraft } from "@/lib/optimizer/parse";
import { analysisAllowed, bandCopy, contentTypeKeyPart, DEFAULT_CONTENT_TYPE } from "@/lib/optimizer/content-types";
import { computeDraftScores } from "@/lib/optimizer/engine";
import {
  buildJudgePrompt, parseJudgeResponse, scoreJudgeResponse,
  anchorJudgeFindings, assessmentKey, deriveVerdictFindings, JUDGE_MODEL,
} from "@/lib/optimizer/judge";
import type { JudgeInput } from "@/lib/optimizer/judge";
import { preGate } from "@/lib/optimizer/suggest-gate";
import { JUDGE_CRITERIA } from "@/lib/optimizer/judge-rubric";
import { RUBRIC_VERSION, PILLARS, scoreToGrade } from "@/lib/optimizer/rubric";
import type { CriterionResult } from "@/lib/optimizer/types";

/**
 * Read findings back for an assessment.
 *
 * optimizer_findings was written and never read — the table has been
 * accumulating rows since the feature shipped and nothing has ever selected
 * one. Both the memo path and a page reload need them, and paying a judge again
 * to recover work already stored is the expensive kind of wrong.
 */
async function loadStoredFindings(assessmentId: string) {
  const { data } = await intelligenceDb
    .from("optimizer_findings")
    .select("id_finding, name_criterion, type_severity, document_quote, document_prefix, document_suffix, document_explanation, document_suggestion, type_status")
    .eq("id_assessment", assessmentId)
    .neq("type_status", "dismissed");
  return (data || []).map((r: any) => ({
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

export const maxDuration = 300;

/** How long a claim may be held before another request may take it. Covers a
 *  platform timeout killing a request between claim and release. */
const ASSESS_LOCK_STALE_MS = 6 * 60 * 1000;

/**
 * Longest draft the judge will look at.
 *
 * Nothing previously bounded this, and an over-long draft is not a slow request
 * — it is an unbounded money loop. It blows max_tokens, the JSON fails to
 * parse, the call is billed, nothing is stored, no memo entry is written, and
 * the writer clicks again. Deterministically, forever, with no cap in the way.
 * 40,000 characters is far above the 800-2,500-word band the rubric is
 * calibrated for.
 */
const MAX_ASSESS_CHARS = 40000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: any = {};
  try { body = await req.json(); } catch { /* body optional */ }

  const guard = await requireOptimizer(body.workspaceId || req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;

  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
  const session = owned.session;

  const { data: drafts } = await intelligenceDb
    .from("optimizer_drafts")
    .select("id_draft, document_body")
    .eq("id_session", id)
    .order("units_version", { ascending: false })
    .limit(1);
  const draft = drafts && drafts.length > 0 ? (drafts[0] as any) : null;
  if (!draft || !draft.document_body || !draft.document_body.trim()) {
    return NextResponse.json({ error: "There is nothing to assess yet" }, { status: 400 });
  }
  // Refused BEFORE the claim and before any spend — an over-long draft would
  // otherwise bill on every attempt and never succeed.
  if (draft.document_body.length > MAX_ASSESS_CHARS) {
    return NextResponse.json(
      {
        // Band from the content type, not a constant. A report writer being
        // told their 6,000-word quarterly should be 800-2,500 words is the tool
        // being confidently wrong about its own subject.
        error:
          `This draft is too long to assess (${Math.round(draft.document_body.length / 1000)}k characters). ` +
          `Assess it in sections — the rubric is calibrated for ${bandCopy(String((session as any).type_content || DEFAULT_CONTENT_TYPE))}.`,
      },
      { status: 413 }
    );
  }

  // THE TYPE GATE, before assertServiceAllowed and before the claim.
  //
  // A type that does not carry a judge has no score to produce, so this is not
  // a budget question and must not consume one: an analysis a type turns off is
  // refused outright rather than paid for and discarded. The UI already hides
  // the button (chromeFor().showAssessAction), so reaching here means a direct
  // POST or a stale tab — both of which should cost nothing.
  const contentTypeId = String((session as any).type_content || DEFAULT_CONTENT_TYPE);
  if (!analysisAllowed(contentTypeId, "judge")) {
    return NextResponse.json(
      { error: "This document is not scored." },
      { status: 400 }
    );
  }

  const brief = session.config_brief || {};
  const canon = session.config_canon || {};
  const parsed = parseDraft({ body: draft.document_body, title: session.name_title });
  const judgeInput: JudgeInput = {
    parsed,
    title: session.name_title,
    targetQueries: Array.isArray(brief.targetQueries) ? brief.targetQueries : [],
    brandName: canon.brandName,
    brandAliases: canon.brandAliases,
    format: session.type_format,
  };

  // (1) The memo — queried BY KEY, not by scanning the most recent rows.
  //
  // Fetching the last N and matching in the application misses a valid entry
  // older than N, so an identical input that was already paid for is judged and
  // billed again. Equality on an indexed column cannot miss.
  // The type reaches the memo key, or re-typing a session serves a cached
  // assessment scored under the OLD type's weights and criteria — the exact
  // failure the rubric version constant exists to prevent, one field along.
  const memoKey = assessmentKey(judgeInput, `${RUBRIC_VERSION}|${contentTypeKeyPart(contentTypeId)}`);
  const { data: cached } = await intelligenceDb
    .from("optimizer_assessments")
    .select("id_assessment, units_overall, units_retrievability, units_citability, name_grade, config_pillars")
    .eq("id_session", id)
    .eq("name_memo_key", memoKey)
    .order("date_created", { ascending: false })
    .limit(1);
  if (cached && cached.length > 0) {
    // The findings must come back WITH the memoised score.
    //
    // This returned `{assessment, memoHit}` and no findings at all, so the
    // client dispatched an empty set into the highlight plugin and ERASED every
    // mark on the page. Pressing Assess a second time on unchanged text — or
    // the first time after reopening an assessed draft — wiped the very
    // annotations it had been pressed to produce, then reported success. The
    // panel said "hasn't been assessed yet" while the toast said "nothing
    // changed since the last assessment", which is the same bug seen from two
    // directions.
    const findings = await loadStoredFindings((cached[0] as any).id_assessment);
    return NextResponse.json({
      assessment: shapeAssessment(cached[0]),
      findings,
      memoHit: true,
      diagnostics: { dropped: 0, orphaned: 0, gateRejected: 0 },
    });
  }

  // (4) Kill switch and spend cap, once, covering judge and gate together.
  try {
    await assertServiceAllowed("engine", "optimizer");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "The optimizer is temporarily unavailable" }, { status: 503 });
  }

  // (2) THE CLAIM IS THE TEST.
  //
  // Reading type_status into a variable and checking it later is a
  // read-then-write race: the previous version tested a snapshot taken four
  // awaited round trips earlier, and claimed with an unconditional update that
  // never reported whether it had actually won. Two concurrent clicks both
  // passed every guard and both billed a judge call.
  //
  // This is a conditional update that returns its affected rows — the same
  // shape as the unique index on optimizer_drafts one file away. Zero rows back
  // means somebody else holds it.
  //
  // The staleness window exists because a platform timeout can kill a request
  // between claim and release; without it, one dead lambda strands the session
  // and the writer can never assess again.
  const staleBefore = new Date(Date.now() - ASSESS_LOCK_STALE_MS).toISOString();
  const { data: claimed } = await intelligenceDb
    .from("optimizer_sessions")
    .update({ type_status: "assessing", date_assessing: new Date().toISOString(), date_updated: new Date().toISOString() })
    .eq("id_session", id)
    .or(`type_status.neq.assessing,date_assessing.lt.${staleBefore}`)
    .select("id_session");

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "This draft is already being assessed" }, { status: 409 });
  }

  try {
    const { system, sessionBlock, user } = buildJudgePrompt(judgeInput);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // NO temperature. claude-sonnet-5 removed temperature/top_p/top_k and the
    // request 400s if they are sent — see lib/ai/anthropic-params.ts for the
    // same rule on the chat path. Determinism comes from the memo above.
    const response = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 8000,
      thinking: { type: "disabled" } as any,
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
        { type: "text", text: sessionBlock, cache_control: { type: "ephemeral" } },
      ] as any,
      messages: [{ role: "user", content: user }],
    });

    logAiUsage({
      workspaceId: guard.caller.workspaceId,
      userId: guard.caller.userId,
      model: JUDGE_MODEL,
      source: "optimizer",
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
      cacheReadTokens: (response.usage as any)?.cache_read_input_tokens,
      cacheWriteTokens: (response.usage as any)?.cache_creation_input_tokens,
    });

    let raw = "";
    for (let i = 0; i < response.content.length; i++) {
      const block: any = response.content[i];
      if (block.type === "text") raw += block.text;
    }

    // Truncation is not a transient failure — it is deterministic for the same
    // input, so "try again" is advice to spend the same money for the same
    // result. Distinguished from a genuine parse error so the message can say
    // something true, and so a retry loop cannot form.
    if (response.stop_reason === "max_tokens") {
      await setStatus(id, "refining");
      return NextResponse.json(
        {
          error:
            "The assessment ran out of room before it finished. This draft is too long or too complex to assess in one pass — try assessing it in sections.",
          retryable: false,
        },
        { status: 502 }
      );
    }

    const outcome = parseJudgeResponse(raw, parsed.text);
    if (!outcome.ok || !outcome.response) {
      await setStatus(id, "refining");
      return NextResponse.json(
        { error: "The assessment came back unreadable. Try again.", detail: outcome.error, retryable: true },
        { status: 502 }
      );
    }

    // The findings floor: derive one from every imperfect verdict the model
    // returned without one. Tested live before this existed — the model gave
    // "opening-quotability: no_answer" and an empty findings array, so the
    // score moved and the text stayed unmarked.
    const derived = deriveVerdictFindings(outcome.response, parsed);
    const anchored = anchorJudgeFindings(parsed.text, outcome.response.findings.concat(derived));
    const live = anchored.filter((a) => !a.orphaned).map((a) => a.finding);

    const det = computeDraftScores({
      body: draft.document_body,
      title: session.name_title,
      targetQueries: judgeInput.targetQueries,
      format: session.type_format,
      brandName: canon.brandName,
    publisherName: canon.publisherName,
      brandAliases: canon.brandAliases,
    });

    const passing: string[] = [];
    for (let i = 0; i < det.pillars.length; i++) {
      for (let c = 0; c < det.pillars[i].criteria.length; c++) {
        const cr = det.pillars[i].criteria[c];
        if (!cr.skipped && cr.passed) passing.push(cr.key);
      }
    }

    const judgeCriteria = scoreJudgeResponse(outcome.response, judgeInput, live);
    const gated = preGate({ findings: live, draftText: parsed.text, passingCriteria: passing });

    const merged = mergePillars(det, judgeCriteria);
    const assessmentRow = {
      id_session: id,
      id_draft: draft.id_draft,
      type_kind: "full",
      units_overall: merged.overall,
      units_retrievability: merged.retrievability,
      units_citability: merged.citability,
      name_grade: scoreToGrade(merged.overall),
      name_memo_key: memoKey,
      config_pillars: {
        pillars: merged.pillars,
        droppedFindings: outcome.dropped,
        orphanedCount: anchored.length - live.length,
      },
      name_rubric_version: RUBRIC_VERSION,
    };

    const { data: saved } = await intelligenceDb
      .from("optimizer_assessments")
      .insert(assessmentRow)
      .select("id_assessment")
      .maybeSingle();

    const assessmentId = saved ? (saved as any).id_assessment : null;
    if (assessmentId) {
      const rows: any[] = [];
      for (let i = 0; i < gated.length; i++) {
        const g = gated[i];
        if (g.verdict !== "APPROVED") continue;
        const f = live[g.index];
        const meta = metaOf(f.criterion);
        rows.push({
          id_assessment: assessmentId,
          name_criterion: f.criterion,
          name_pillar: PILLARS[meta.pillar - 1] ? PILLARS[meta.pillar - 1].name : String(meta.pillar),
          type_severity: f.severity,
          name_evidence: meta.evidence,
          document_quote: f.quote,
          document_prefix: f.prefix,
          document_suffix: f.suffix,
          document_explanation: f.explanation,
          document_suggestion: f.suggestedEdit || "",
          type_status: "open",
          name_fingerprint: f.criterion + ":" + f.quote.slice(0, 60),
        });
      }
      if (rows.length > 0) await intelligenceDb.from("optimizer_findings").insert(rows);
    }

    await setStatus(id, "refining");

    return NextResponse.json({
      assessment: {
        id: assessmentId,
        overall: merged.overall,
        grade: scoreToGrade(merged.overall),
        retrievability: merged.retrievability,
        citability: merged.citability,
        pillars: merged.pillars,
      },
      findings: gated
        .filter((g) => g.verdict === "APPROVED")
        .map((g) => ({ ...live[g.index], gateNote: g.reason })),
      // Surfaced, never swallowed: "the judge found nothing" and "the judge
      // found eight things and every quote was unmatchable" look identical
      // in the panel and mean opposite things.
      diagnostics: {
        dropped: outcome.dropped.length,
        orphaned: anchored.length - live.length,
        gateRejected: gated.filter((g) => g.verdict !== "APPROVED").length,
      },
      memoHit: false,
    });
  } catch (error: any) {
    console.error("[optimizer] assess failed:", error?.message);
    await setStatus(id, "refining");
    return NextResponse.json({ error: error?.message || "Assessment failed" }, { status: 500 });
  }
}

/** Release the claim as well as setting the status — leaving date_assessing set
 *  would make the next claim wait out the full staleness window. */
async function setStatus(id: string, status: string) {
  await intelligenceDb
    .from("optimizer_sessions")
    .update({ type_status: status, date_assessing: null, date_updated: new Date().toISOString() })
    .eq("id_session", id);
}

/**
 * Look the pillar and evidence grade up from the judge rubric — the single
 * source of truth — rather than re-deriving them here where they would drift.
 *
 * Throws rather than returning a default. parseJudgeResponse already hard-drops
 * any criterion outside JUDGE_CRITERION_KEYS, so an unknown key here means the
 * two files have diverged, and that is worth a loud failure. A silent fallback
 * would file the finding under the wrong pillar and read, to the next person,
 * like a safety net they could rely on.
 */
function metaOf(key: string): { pillar: number; evidence: string } {
  for (let i = 0; i < JUDGE_CRITERIA.length; i++) {
    if (JUDGE_CRITERIA[i].key === key) {
      return { pillar: JUDGE_CRITERIA[i].pillar, evidence: JUDGE_CRITERIA[i].evidence };
    }
  }
  throw new Error(`Unknown judge criterion "${key}" — judge.ts and judge-rubric.ts have diverged`);
}

/**
 * Fold the judge's criteria into the deterministic pillars ADDITIVELY.
 *
 * Not a blend. The two key spaces are disjoint, so there are no parallel
 * numbers to reconcile — a weighted average would only launder judge variance
 * into deterministic scores that are exact. Each pillar renormalises over the
 * union of its criteria, exactly as it already does over its own.
 */
function mergePillars(det: ReturnType<typeof computeDraftScores>, judgeCriteria: CriterionResult[]) {
  const byPillar: { [k: number]: CriterionResult[] } = {};
  for (let i = 0; i < judgeCriteria.length; i++) {
    // Judge criteria carry their pillar in judge-rubric; recovered by key here
    // to avoid importing the whole meta table into the route.
    const key = judgeCriteria[i].key;
    const pillarIndex = metaOf(key).pillar - 1;
    if (!byPillar[pillarIndex]) byPillar[pillarIndex] = [];
    byPillar[pillarIndex].push(judgeCriteria[i]);
  }

  const pillars: any[] = [];
  let weighted = 0;
  let applicableBp = 0;
  let rE = 0, rM = 0, cE = 0, cM = 0;

  for (let i = 0; i < det.pillars.length; i++) {
    const all = det.pillars[i].criteria.concat(byPillar[i] || []);
    let earned = 0, max = 0;
    for (let c = 0; c < all.length; c++) {
      if (all[c].skipped) continue;
      earned += all[c].earned;
      max += all[c].maxPoints;
      if (all[c].rollUp === "retrievability" || all[c].rollUp === "both") { rE += all[c].earned; rM += all[c].maxPoints; }
      if (all[c].rollUp === "citability" || all[c].rollUp === "both") { cE += all[c].earned; cM += all[c].maxPoints; }
    }
    const score = max > 0 ? (earned / max) * 100 : 0;
    pillars.push({
      name: PILLARS[i].name,
      score: Math.round(score * 100) / 100,
      grade: scoreToGrade(score),
      criteria: all,
    });
    if (max > 0) { weighted += score * PILLARS[i].weightBp; applicableBp += PILLARS[i].weightBp; }
  }

  return {
    overall: applicableBp > 0 ? Math.round((weighted / applicableBp) * 100) / 100 : 0,
    retrievability: rM > 0 ? Math.round((rE / rM) * 10000) / 100 : 0,
    citability: cM > 0 ? Math.round((cE / cM) * 10000) / 100 : 0,
    pillars,
  };
}

function shapeAssessment(row: any) {
  return {
    id: row.id_assessment,
    overall: Number(row.units_overall),
    grade: row.name_grade,
    retrievability: Number(row.units_retrievability),
    citability: Number(row.units_citability),
    pillars: row.config_pillars?.pillars || [],
  };
}

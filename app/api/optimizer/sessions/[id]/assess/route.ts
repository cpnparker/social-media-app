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
import { requireOptimizer, loadOwnedSession } from "../../../_lib/access";
import { parseDraft } from "@/lib/optimizer/parse";
import { computeDraftScores } from "@/lib/optimizer/engine";
import {
  buildJudgePrompt, parseJudgeResponse, scoreJudgeResponse,
  anchorJudgeFindings, assessmentKey, JUDGE_MODEL,
} from "@/lib/optimizer/judge";
import type { JudgeInput } from "@/lib/optimizer/judge";
import { preGate } from "@/lib/optimizer/suggest-gate";
import { JUDGE_CRITERIA } from "@/lib/optimizer/judge-rubric";
import { RUBRIC_VERSION, PILLARS, scoreToGrade } from "@/lib/optimizer/rubric";
import type { CriterionResult } from "@/lib/optimizer/types";

export const maxDuration = 300;

/** Per session. A writer editing and re-assessing every few minutes never
 *  notices this; a stuck retry loop hits it immediately. */
const MIN_SECONDS_BETWEEN_ASSESSMENTS = 20;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: any = {};
  try { body = await req.json(); } catch { /* body optional */ }

  const guard = await requireOptimizer(body.workspaceId || req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;

  const owned = await loadOwnedSession(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
  const session = owned.session;

  // (2) In flight. type_status was previously written and never read — a
  // status nobody checks is a comment.
  if (session.type_status === "assessing") {
    return NextResponse.json(
      { error: "This draft is already being assessed" },
      { status: 409 }
    );
  }

  const { data: recent } = await intelligenceDb
    .from("optimizer_assessments")
    .select("date_created")
    .eq("id_session", id)
    .order("date_created", { ascending: false })
    .limit(1);
  if (recent && recent.length > 0) {
    const age = (Date.now() - new Date((recent[0] as any).date_created).getTime()) / 1000;
    if (age < MIN_SECONDS_BETWEEN_ASSESSMENTS) {
      return NextResponse.json(
        { error: `Give it a moment — you can re-assess in ${Math.ceil(MIN_SECONDS_BETWEEN_ASSESSMENTS - age)}s` },
        { status: 429 }
      );
    }
  }

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

  // (1) The memo.
  const memoKey = assessmentKey(judgeInput, RUBRIC_VERSION);
  const { data: cached } = await intelligenceDb
    .from("optimizer_assessments")
    .select("id_assessment, units_overall, units_retrievability, units_citability, name_grade, config_pillars")
    .eq("id_session", id)
    .eq("type_kind", "full")
    .order("date_created", { ascending: false })
    .limit(5);
  if (cached) {
    for (let i = 0; i < cached.length; i++) {
      const c: any = cached[i];
      if (c.config_pillars && c.config_pillars.memoKey === memoKey) {
        return NextResponse.json({ assessment: shapeAssessment(c), memoHit: true });
      }
    }
  }

  // (4) Kill switch and spend cap, once, covering judge and gate together.
  try {
    await assertServiceAllowed("engine", "optimizer");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "The optimizer is temporarily unavailable" }, { status: 503 });
  }

  await intelligenceDb
    .from("optimizer_sessions")
    .update({ type_status: "assessing", date_updated: new Date().toISOString() })
    .eq("id_session", id);

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

    const outcome = parseJudgeResponse(raw, parsed.text);
    if (!outcome.ok || !outcome.response) {
      await setStatus(id, "refining");
      return NextResponse.json(
        { error: "The assessment came back unreadable. Try again.", detail: outcome.error },
        { status: 502 }
      );
    }

    const anchored = anchorJudgeFindings(parsed.text, outcome.response.findings);
    const live = anchored.filter((a) => !a.orphaned).map((a) => a.finding);

    const det = computeDraftScores({
      body: draft.document_body,
      title: session.name_title,
      targetQueries: judgeInput.targetQueries,
      format: session.type_format,
      brandName: canon.brandName,
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
      config_pillars: {
        memoKey,
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

async function setStatus(id: string, status: string) {
  await intelligenceDb
    .from("optimizer_sessions")
    .update({ type_status: status, date_updated: new Date().toISOString() })
    .eq("id_session", id);
}

/** Look the pillar and evidence grade up from the judge rubric — the single
 *  source of truth — rather than re-deriving them here where they would drift. */
function metaOf(key: string): { pillar: number; evidence: string } {
  for (let i = 0; i < JUDGE_CRITERIA.length; i++) {
    if (JUDGE_CRITERIA[i].key === key) {
      return { pillar: JUDGE_CRITERIA[i].pillar, evidence: JUDGE_CRITERIA[i].evidence };
    }
  }
  return { pillar: 1, evidence: "C" };
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

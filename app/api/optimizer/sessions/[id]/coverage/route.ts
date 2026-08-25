/**
 * POST /api/optimizer/sessions/[id]/coverage — fan-out coverage and the
 * novelty gap.
 *
 * Three model calls in TWO round trips: fan-out and the parametric answer are
 * independent and run together, the novelty comparison needs the parametric
 * answer and follows. The research budgets four to six calls per document and
 * says explicitly not to run one per check.
 *
 * MEMOISED on a hash of everything the run saw, for the same reason the judge
 * is: this costs real money per press, and a writer who reopens a tab should
 * not pay again for an answer nobody's draft has changed since.
 *
 * PARTIAL RESULTS ARE RETURNED. If fan-out succeeds and novelty fails, the
 * writer gets the coverage brief and an explicit note about what did not run.
 * Failing the whole request because one of three calls came back malformed
 * would throw away work that was already paid for, and the report's
 * `notAssessable` field exists precisely so the gap can be stated rather than
 * hidden.
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireOptimizer, loadSessionForCaller } from "../../../_lib/access";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { assertServiceAllowed } from "@/lib/admin/service-control";
import { logAiUsage } from "@/lib/ai/usage-logger";
import { parseDraft } from "@/lib/optimizer/parse";
import { analysisAllowed, DEFAULT_CONTENT_TYPE } from "@/lib/optimizer/content-types";
import {
  buildFanoutPrompt, parseFanoutResponse, buildParametricPrompt, buildNoveltyPrompt,
  parseNoveltyResponse, coverageKey, COVERAGE_PROMPT_VERSION,
  FANOUT_MODEL, PARAMETRIC_MODEL, NOVELTY_MODEL,
} from "@/lib/optimizer/coverage";
import type { CoverageInput, CoverageResult } from "@/lib/optimizer/coverage";

export const maxDuration = 120;

/**
 * Input ceiling, matching assess's MAX_ASSESS_CHARS exactly.
 *
 * Coverage had only a FLOOR (wordCount < 150). The full draft goes to fan-out
 * and again to novelty, so a draft that assess REFUSES at 40k chars was being
 * sent to the most expensive press in the studio twice over — and coverage is
 * the one route with two sequential round trips inside a 120s ceiling, so an
 * oversized input does not just cost more, it is the input most likely to time
 * out after it has already been billed.
 */
const MAX_COVERAGE_CHARS = 40000;

/** Same staleness window as assess: a platform timeout must not strand a session. */
const COVERAGE_LOCK_STALE_MS = 6 * 60 * 1000;

const MODELS = { fanout: FANOUT_MODEL, parametric: PARAMETRIC_MODEL, novelty: NOVELTY_MODEL };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const guard = await requireOptimizer(body.workspaceId || req.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;
  const owned = await loadSessionForCaller(id, guard.caller);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
  const session = owned.session as any;

  // THE TYPE GATE, before the kill switch and before any spend. "What would an
  // AI already say about this topic" is not a question about a document written
  // for one named audience about their own quarter, so coverage is off for
  // every type but the article — and an analysis a type turns off must cost
  // nothing to refuse.
  if (!analysisAllowed(String((session as any).type_content || DEFAULT_CONTENT_TYPE), "coverage")) {
    return NextResponse.json({ error: "Coverage analysis does not apply to this kind of document." }, { status: 400 });
  }

  // THE KILL SWITCH. This route had none, while assess, suggest and generate
  // all had it — and coverage is the most expensive press in the studio: three
  // calls (fan-out @4000, parametric @1200, novelty @4000). Its spend counts
  // toward the engine/optimizer bucket, so it could push the OTHER three over
  // the cap while remaining itself unstoppable; flipping `killed` stopped
  // generation, assessment and rewrites and left the priciest calls running.
  //
  // requireOptimizer above is access control, not a spend control — revoking it
  // takes the user's whole EngineAI access with it.
  //
  // Note this route talks to the Anthropic SDK directly rather than through
  // createStreamingResponse, so it is ALSO outside the global provider cap
  // (isOverProviderCap). This gate is the only spend control it has.
  try {
    await assertServiceAllowed("engine", "optimizer");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "The optimizer is temporarily unavailable" }, { status: 503 });
  }

  const { data: drafts } = await intelligenceDb
    .from("optimizer_drafts")
    .select("id_draft, document_body")
    .eq("id_session", id)
    .order("units_version", { ascending: false })
    .limit(1);
  const draft = drafts && drafts.length > 0 ? (drafts[0] as any) : null;
  if (!draft || !String(draft.document_body || "").trim()) {
    return NextResponse.json({ error: "There is no draft to analyse yet." }, { status: 400 });
  }

  const parsed = parseDraft({ body: draft.document_body, title: session.name_title || "" });
  if (parsed.wordCount < 150) {
    return NextResponse.json(
      { error: "This piece is too short to decompose into sub-queries — there is not enough here for the answer to be about the writing rather than the length." },
      { status: 400 }
    );
  }

  // THE CEILING. Checked on the PARSED text, which is what actually gets sent.
  if (parsed.text.length > MAX_COVERAGE_CHARS) {
    return NextResponse.json(
      {
        error:
          `This draft is ${Math.round(parsed.text.length / 1000)}k characters and coverage analysis is capped at ` +
          `${MAX_COVERAGE_CHARS / 1000}k. Analyse a section at a time — the whole draft goes to the model twice here, ` +
          `and beyond this size the run tends to time out after it has already been paid for.`,
      },
      { status: 413 }
    );
  }

  const brief = session.config_brief || {};
  const canon = session.config_canon || {};
  const input: CoverageInput = {
    title: session.name_title || "",
    draftText: parsed.text,
    targetQueries: brief.targetQueries || [],
    brandName: canon.brandName,
    format: session.type_format || "explainer",
  };
  const memoKey = coverageKey(input, COVERAGE_PROMPT_VERSION, MODELS);

  // Read the cache in its OWN select. PostgREST fails an ENTIRE statement on
  // one unknown column, so if the migration adding config_coverage has not run
  // this must fail alone rather than taking the whole route down with it.
  try {
    const { data: cached, error } = await intelligenceDb
      .from("optimizer_assessments")
      .select("config_coverage")
      .eq("id_session", id)
      .eq("type_kind", "coverage")
      .eq("name_memo_key", memoKey)
      .order("date_created", { ascending: false })
      .limit(1);
    if (!error && cached && cached.length > 0) {
      const hit = (cached[0] as any).config_coverage;
      // A memoised FAILURE is served as a failure, not replayed as a result.
      // Only success was cached before, so the one input that reliably fails —
      // the one that costs three calls and returns nothing — was precisely the
      // input never cached, and every re-press paid for all three again.
      if (hit && hit.failed) {
        return NextResponse.json(
          { error: "Neither analysis completed for this draft.", notAssessable: hit.notAssessable || [], cached: true },
          { status: 502 }
        );
      }
      if (hit && hit.generatedAt) return NextResponse.json({ ...hit, cached: true });
    }
  } catch { /* a cache miss must never fail the request */ }

  // THE CLAIM IS THE TEST — the same shape assess uses, and for the same
  // reason: its comment records that two concurrent clicks both passed every
  // guard and both billed. Coverage had only the client's disabled={loading},
  // which is per component instance — a second tab, a reload mid-run or a
  // direct POST all billed three calls in full.
  //
  // It reuses assess's `assessing` status deliberately. type_status carries a
  // CHECK constraint listing its allowed values, so inventing "covering" would
  // fail every claim with 23514 and lock the feature shut permanently. Sharing
  // the lock also happens to be correct: assess and coverage both read the same
  // draft, and running them together bills two presses of overlapping work.
  const priorStatus = String(session.type_status || "draft_ready");
  const staleBefore = new Date(Date.now() - COVERAGE_LOCK_STALE_MS).toISOString();
  const { data: claimed } = await intelligenceDb
    .from("optimizer_sessions")
    .update({ type_status: "assessing", date_assessing: new Date().toISOString(), date_updated: new Date().toISOString() })
    .eq("id_session", id)
    .or(`type_status.neq.assessing,date_assessing.lt.${staleBefore}`)
    .select("id_session");
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "This draft is already being analysed" }, { status: 409 });
  }

  // Released on EVERY path out of here, including the 502 and any throw.
  // A lock that leaks leaves the writer unable to press again until the
  // staleness window expires, which is a worse failure than the double-bill
  // it prevents. Restores the status the session actually had — except when
  // that was itself `assessing` (a stale takeover), where draft_ready is the
  // only safe value that satisfies the CHECK constraint.
  const releaseClaim = async () => {
    try {
      await intelligenceDb
        .from("optimizer_sessions")
        .update({
          type_status: priorStatus === "assessing" ? "draft_ready" : priorStatus,
          date_assessing: null,
          date_updated: new Date().toISOString(),
        })
        .eq("id_session", id);
    } catch { /* never fail the response on lock release */ }
  };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const notAssessable: string[] = [];

  const call = async (model: string, system: string, user: string, maxTokens: number) => {
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      thinking: { type: "disabled" } as any,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] as any,
      messages: [{ role: "user", content: user }],
    });
    logAiUsage({
      workspaceId: guard.caller.workspaceId,
      userId: guard.caller.userId,
      model,
      source: "optimizer",
      inputTokens: res.usage?.input_tokens || 0,
      outputTokens: res.usage?.output_tokens || 0,
      cacheReadTokens: (res.usage as any)?.cache_read_input_tokens,
      cacheWriteTokens: (res.usage as any)?.cache_creation_input_tokens,
    });
    let text = "";
    for (const block of res.content as any[]) if (block.type === "text") text += block.text;
    return text;
  };

  // Round trip one. The parametric call deliberately receives ONLY the query —
  // never the draft — or the comparison would be measuring the draft against
  // itself and every claim would read as commodity.
  const fanoutPrompt = buildFanoutPrompt(input);
  const provisionalQuery = (input.targetQueries.filter(Boolean)[0] || input.title || "").trim();
  const [fanoutRaw, parametricRaw] = await Promise.all([
    call(FANOUT_MODEL, fanoutPrompt.system, fanoutPrompt.user, 4000).catch((e) => `__ERR__${e?.message || e}`),
    provisionalQuery
      ? call(PARAMETRIC_MODEL, buildParametricPrompt(provisionalQuery).system, buildParametricPrompt(provisionalQuery).user, 1200)
          .catch((e) => `__ERR__${e?.message || e}`)
      : Promise.resolve("__ERR__no query to answer"),
  ]);

  let fanout = null;
  if (String(fanoutRaw).startsWith("__ERR__")) {
    notAssessable.push(`Fan-out coverage: the model call failed (${String(fanoutRaw).slice(7, 120)}).`);
  } else {
    const p = parseFanoutResponse(fanoutRaw, input.draftText);
    if (p.ok) {
      fanout = p.value!;
      if (p.dropped > 0) {
        notAssessable.push(`${p.dropped} coverage claim${p.dropped === 1 ? "" : "s"} could not be matched to a sentence in the draft and ${p.dropped === 1 ? "was" : "were"} treated as uncovered.`);
      }
    } else {
      notAssessable.push(`Fan-out coverage: ${p.error}`);
    }
  }

  // Round trip two.
  let novelty = null;
  if (String(parametricRaw).startsWith("__ERR__")) {
    notAssessable.push(`Novelty gap: could not produce a no-sources answer to compare against (${String(parametricRaw).slice(7, 120)}).`);
  } else {
    const np = buildNoveltyPrompt(parametricRaw, input.draftText);
    const noveltyRaw = await call(NOVELTY_MODEL, np.system, np.user, 4000).catch((e) => `__ERR__${e?.message || e}`);
    if (String(noveltyRaw).startsWith("__ERR__")) {
      notAssessable.push(`Novelty gap: the comparison call failed (${String(noveltyRaw).slice(7, 120)}).`);
    } else {
      const p = parseNoveltyResponse(noveltyRaw, input.draftText, parametricRaw);
      if (p.ok) {
        novelty = p.value!;
        if (p.dropped > 0) {
          notAssessable.push(`${p.dropped} novelty claim${p.dropped === 1 ? "" : "s"} quoted a sentence that is not in the draft and ${p.dropped === 1 ? "was" : "were"} discarded.`);
        }
      } else {
        notAssessable.push(`Novelty gap: ${p.error}`);
      }
    }
  }

  if (!fanout && !novelty) {
    // MEMOISE THE FAILURE. This path returns before the memo write below, so a
    // draft that reliably fails was billed three calls on every single press,
    // forever. Best-effort: if the migration adding config_coverage has not
    // run this insert fails, and the writer is no worse off than before.
    try {
      await intelligenceDb.from("optimizer_assessments").insert({
        id_session: id,
        id_draft: draft.id_draft,
        type_kind: "coverage",
        name_memo_key: memoKey,
        name_rubric_version: COVERAGE_PROMPT_VERSION,
        config_coverage: { failed: true, notAssessable, models: MODELS, generatedAt: new Date().toISOString() },
      });
    } catch { /* a failed memo must not mask the failure it describes */ }
    await releaseClaim();
    return NextResponse.json(
      { error: "Neither analysis completed.", notAssessable },
      { status: 502 }
    );
  }

  const result: CoverageResult = {
    fanout,
    novelty,
    notAssessable,
    models: MODELS,
    generatedAt: new Date().toISOString(),
  };

  // Persistence is best-effort and never fails the response: the writer has
  // already paid for this answer, and losing it to a migration that has not
  // run yet would be the worst of both.
  try {
    const { error } = await intelligenceDb.from("optimizer_assessments").insert({
      id_session: id,
      id_draft: draft.id_draft,
      type_kind: "coverage",
      name_memo_key: memoKey,
      name_rubric_version: COVERAGE_PROMPT_VERSION,
      config_coverage: result,
    });
    if (error) {
      console.warn("[optimizer] coverage not cached:", error.code, error.message);
      if (error.code === "23514" || error.code === "42703" || error.code === "PGRST204") {
        notAssessable.push(
          "This result was not saved: the database has not been migrated for coverage runs yet, so reopening this tab will pay for it again. Run the coverage ALTER at the end of supabase/migrations/20260821_content_optimizer.sql."
        );
      }
    }
  } catch (e: any) {
    console.warn("[optimizer] coverage not cached:", e?.message);
  }

  // Released on the success path too. Without this the writer would be locked
  // out of their own draft for the whole staleness window after a run that
  // WORKED — a 409 with nothing wrong. The window is the backstop for an
  // unexpected throw, not the normal release.
  await releaseClaim();
  return NextResponse.json({ ...result, notAssessable, cached: false });
}

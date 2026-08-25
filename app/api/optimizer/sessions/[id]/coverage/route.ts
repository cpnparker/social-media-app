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
import {
  buildFanoutPrompt, parseFanoutResponse, buildParametricPrompt, buildNoveltyPrompt,
  parseNoveltyResponse, coverageKey, COVERAGE_PROMPT_VERSION,
  FANOUT_MODEL, PARAMETRIC_MODEL, NOVELTY_MODEL,
} from "@/lib/optimizer/coverage";
import type { CoverageInput, CoverageResult } from "@/lib/optimizer/coverage";

export const maxDuration = 120;

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
      if (hit && hit.generatedAt) return NextResponse.json({ ...hit, cached: true });
    }
  } catch { /* a cache miss must never fail the request */ }

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

  return NextResponse.json({ ...result, notAssessable, cached: false });
}

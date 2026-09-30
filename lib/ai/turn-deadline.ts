/**
 * A CHAT TURN ALWAYS FINISHES — AND ENDS WITH AN ANSWER.
 *
 * THE INCIDENT, 2026-09-28 (thread 8479ea99). "Review and write up my weekly
 * summary" plus 1,328 characters of pasted Slack, auto-routed to grok-4.7.
 * Three tool rounds read 40 meetings, 50 tasks, Slack and one transcript; at
 * 184s the model was WARNED to build now, and spent round 3 reading four more
 * full transcripts instead. The platform killed the function at 300s. The
 * assistant row was left 'pending' and empty, the user saw a reply that simply
 * stopped, and nothing in the logs said why beyond the timeout. The other
 * death in the two weeks before it (2026-09-15, claude-sonnet-5, thread
 * 4b94c318) left the same empty 'pending' row.
 *
 * THE SECOND INCIDENT, the QA re-run of the same prompt on the fix (2026-09-28
 * 13:34Z, thread d949e94b). The row was finalised — but with NO ANSWER: round
 * 2 STARTED at 141s, before the old 170s soft budget, with tools still on, and
 * grok-4.7 reasoned for more than 134s inside that one round without a word of
 * text. The hard abort at 275s cut it, and nothing was left to write with. A
 * round that starts just before soft can consume everything to hard. A turn
 * that ENDS is not the goal; a turn that ends WITH THE ANSWER is.
 *
 * So the last stretch of every turn is RESERVED FOR WRITING, and nothing asks
 * the model for anything:
 *
 *   TOOL ROUNDS — a round with tools on starts only if the model's measured
 *          p90 round fits before the answer window opens (lastToolRoundAt).
 *          Later than that, the round that starts is the ANSWER, tools off
 *          (answerStep).
 *   WINDOW — at the model's `writeAtFor` the answer window opens. A round
 *          still running then is CUT unless it is visibly writing the answer
 *          (text streaming with no tool call begun, or a generate_* call — the
 *          artefact IS the answer). The answer is then written from everything
 *          gathered by the RESCUE WRITERS, in order: tools off, the provider's
 *          lowest reasoning, and — only as a last resort, for the final
 *          LAST_RESORT_MS — the same provider's fast model (rescueWritersFor).
 *   HARD — past it, a streaming provider call is ABORTED (the SDK request is
 *          cancelled, so it stops billing too) and the turn is finalised with
 *          whatever text exists plus one plain line saying what happened.
 *
 * And a third, outside the chain: the BACKSTOP, which the chat route arms for
 * the case the chain cannot bound — a tool executor that hangs (a Slides build,
 * a Drive fetch) is not a stream and cannot be aborted from here. At the
 * backstop the route finalises the row itself from what was streamed.
 *
 * EVERY BUDGET IS MEASURED FROM THE REQUEST, NOT FROM THE CHAIN. The old
 * warning started its clock when the chain started, after the route had spent
 * up to 13.5s building context (measured below), and a provider fallback
 * restarted it from zero — so a turn could be "inside its budget" by the
 * chain's clock and past the platform's. One deadline is created per request
 * and shared by every leg of it.
 *
 * SIZED FROM MEASUREMENT.
 *   Production, 735 enginegpt turns 2026-09-01 → 09-30 (intelligence.ai_messages
 *   + ai_usage, read-only):
 *   - Route prep, user row → pending row: p50 2.6s, p90 4.6s, p99 9.2s, max
 *     13.5s (438 turns to 09-28). The deadline is created before any of it.
 *   - ONE ANSWER ROUND (turns that made a single request): claude-sonnet p50
 *     13s, p90 35s (n=131); grok-4.7 p50 52s, p90 167s (n=13) — grok-4.7
 *     reasons at its default HIGH effort, and on real content that thinking is
 *     what takes the time.
 *   - Per round, multi-round turns (the p90 of each turn's mean round):
 *     grok-4.7 90s (n=18), grok-4.6 81s (n=25), claude-sonnet 24s (n=127).
 *   Direct, the tools-off answer round at the input sizes a late round carries
 *   (history + one large tool result, tools declared with tool_choice none,
 *   60k–150k prompt tokens, cold cache, asked for ~1,200 words; 2026-09-30,
 *   scratchpad probe, 6–9 samples each). Time to the first answer word, and a
 *   2,000-token answer estimated from each sample's own throughput:
 *     grok-4.7 default (high)  text 17–29s   2,000 tokens p50 51s  max 56s
 *     grok-4.7 low             text  7–26s   2,000 tokens p50 39s  max 55s
 *     grok-4.3 none            text  4–6s    2,000 tokens p50 27s  max 32s
 *     claude-sonnet-5 (no thinking) 1–2s     2,000 tokens p50 27s  max 28s
 *     gpt-6-sol none            2s           2,000 tokens      40s (n=2)
 *   xAI documents low/medium/high/xhigh for grok-4.7 and "Reasoning cannot be
 *   disabled" (docs.x.ai, reasoning, checked 2026-09-30).
 *
 * THE FAST WRITER WROTE THE WRONG ANSWER. The first version of this file had
 * grok-4.3 at "none" write every grok-4.7 rescue, because it fits a 50s window
 * with room. On the incident prompt it fitted and was wrong: in all six real
 * rescued runs it listed the colleagues' pasted Slack posts (Rob's W38 list,
 * Gabi's W40 priorities) as the user's OWN achievements and priorities, added
 * completions no source contains, and leaked the system note. Replaying the
 * captured rescue request (93,805 prompt tokens, the exact body the chain
 * sent) settled which knob it was: grok-4.3 at "none" misattributed 2 of 2,
 * with an explicit attribution sentence added 1 of 1, at "low" 3 of 3;
 * grok-4.7 at "low" attributed correctly 8 of 8. Time to its first answer word
 * on that request, n=8: 23, 36, 42, 44, 45, 48, 54, 56s; whole answer 26–63s;
 * a warm cache (93,696 tokens read) did not shorten it — the time is 1.5–3.6k
 * reasoning tokens, not the prompt. On a second captured request (113,563
 * tokens), n=4: 27, 28, 45, 55s. In the real chain it had written its whole
 * answer 26–59s after it started in twelve rescues of thirteen; in the other
 * (285k characters of context) it had not written a word 60s after it
 * started, and the last resort wrote instead. So a grok-4.5+ turn's answer
 * window is 100s: 70s for grok-4.7 at "low" to start writing, then the last
 * 30s for grok-4.3 at "none" should it not have (4–6s to text; 6–12s for a
 * whole real rescue). A wrong answer on time is not the goal either.
 *
 * For the 300s chat route that is: hard at 275s, backstop at 290s; the answer
 * window from 225s (Claude, OpenAI, Gemini) or 175s (grok-4.7, whose last
 * resort starts at 245s); a grok-4.7 tool round starts no later than 87.5s
 * and a claude-sonnet-5 one no later than 190s.
 *
 * The file imports nothing, so a check can drive it with its own clock.
 */

/** The chat route's `maxDuration`, in ms. The default for any caller that
 *  does not state its own ceiling. */
export const CHAT_ROUTE_MAX_DURATION_MS = 300_000;

/** Hard abort this long before the platform kills the function: time to
 *  append the notice, run the completion's five writes, and leave the
 *  backstop room of its own. */
export const FINALISE_RESERVE_MS = 25_000;

/** The route's own last resort fires this long before the platform kill. */
export const BACKSTOP_RESERVE_MS = 10_000;

/** THE ANSWER WINDOW: the last stretch before HARD, reserved for writing, for
 *  a model whose rescue writer needs no thinking time. The worst measured
 *  2,000-token answer at 150k tokens of context is claude-sonnet-5 28s,
 *  gpt-6-sol 40s, and xAI has had days answering an 8k prompt in anything from
 *  1s to 85s, so the window carries a margin on top. Anything still being
 *  written at HARD is cut there, and what was written is kept. */
export const ANSWER_WINDOW_MS = 50_000;

/** grok-4.7 at its LOWEST effort ("low"), tools off, on real late-turn
 *  requests: time to its first answer word, worst of 12 replays 56s, and one
 *  real rescue of thirteen still silent at 60s (header). A writer that has
 *  started writing is left to finish; one still thinking at the end of this
 *  is handed over to the last resort. */
export const REASONING_WRITER_FIRST_TEXT_MS = 70_000;

/** The LAST RESORT'S slice, the end of every grok-4.5+ window: grok-4.3 at
 *  "none" — 4–6s to its first word at 150k tokens, a whole real rescue in
 *  11–12s, a 2,000-token answer in ≤32s. Fast, and it misattributes (header),
 *  so it writes only what the reasoning writer did not start in time. */
export const LAST_RESORT_MS = 30_000;

/** grok-4.5 and later reason on every request and cannot be told not to. */
function isReasoningGrok(apiModel: string): boolean {
  return /^grok-4\.[5-9]/.test(apiModel);
}

/** No answer window is longer than this share of the time before HARD — a
 *  model that must think before it writes may take more (below). */
export const WINDOW_SHARE_CAP = 1 / 4;
/** …up to this share: 100s of the 300s route's 275, 38s of a 120s route's
 *  95. A quarter (69s) would cut grok-4.7's window short on the chat route. */
export const REASONING_WINDOW_SHARE_CAP = 0.4;

/** How long before HARD this model's answer window opens: 50s, or 100s on a
 *  model that must think before it writes (the reasoning writer's 70s to its
 *  first word, then the last resort's 30s). */
export function answerWindowMs(apiModel?: string | null): number {
  return isReasoningGrok(String(apiModel || "")) ? REASONING_WRITER_FIRST_TEXT_MS + LAST_RESORT_MS : ANSWER_WINDOW_MS;
}

/** When the answer window opens for a turn on `apiModel`. A short route caps
 *  it at a share of the usable time (createTurnDeadline). Without a model,
 *  the 50s window — TurnDeadline.writeAt. */
export function writeAtFor(d: TurnDeadline, apiModel?: string | null): number {
  const usable = Math.max(0, d.hardAt - d.startedAt);
  const share = isReasoningGrok(String(apiModel || "")) ? REASONING_WINDOW_SHARE_CAP : WINDOW_SHARE_CAP;
  return d.hardAt - Math.min(answerWindowMs(apiModel), usable * share);
}

/** A caller whose model is unknown gets the slowest measured chain's p90 tool
 *  round (grok-4.7), so an unknown model never starts a round that cannot
 *  finish before the window. */
export const DEFAULT_ROUND_P90_MS = 90_000;

/**
 * The p90 time of one tool round, per model family — the ROUND-START POLICY
 * reads it (lastToolRoundAt). Measured, see the header:
 *   - grok-4.x reasoning models (4.5 and later reason by default and cannot be
 *     told not to): 90s — grok-4.7's per-round p90 across multi-round turns.
 *   - claude-sonnet-5 / haiku (thinking disabled): 35s — the single-answer-round
 *     p90 (n=131), above the 24s per-round figure because a late round carries
 *     the whole turn's results.
 *   - Claude models that always think (opus-5*, fable, mythos): 60s — the only
 *     production figure is opus's single round p90 of 59s (n=3).
 *   - Non-reasoning legs (grok-4.3 and grok-3 at effort none, OpenAI at none,
 *     Gemini): 40s — gpt-6-sol took 33s for a 1,650-token answer at 98k tokens,
 *     grok-4.3 up to 44s total.
 */
export function roundP90Ms(apiModel?: string | null): number {
  const m = String(apiModel || "");
  if (!m) return DEFAULT_ROUND_P90_MS;
  if (/^grok-4\.[5-9]/.test(m)) return 90_000;
  if (/^claude-(opus-5|fable|mythos)/.test(m)) return 60_000;
  if (/^claude-/.test(m)) return 35_000;
  if (/^grok-/.test(m) || /^gpt-/.test(m) || /^gemini-/.test(m)) return 40_000;
  return DEFAULT_ROUND_P90_MS;
}

/** Below this much time before the hard abort, a request is not started at
 *  all: even the rescue writer needs ~6s before its first word at 150k tokens,
 *  so a request started later cannot land enough of an answer to be one. */
export const MIN_FINAL_ROUND_MS = 20_000;

/** The build-now warning goes out on a round that STARTS this close to the
 *  last tool-round start — it is that round, not a later one, that can still
 *  build. */
export const WARN_LEAD_MS = 45_000;

export interface TurnDeadline {
  /** When the REQUEST started (ms since epoch). */
  startedAt: number;
  /** The last moment a tool round may start for a caller that names no model
   *  (DEFAULT_ROUND_P90_MS before the window). A chain reads the model's own
   *  figure through lastToolRoundAt. */
  softAt: number;
  /** THE ANSWER WINDOW OPENS, for a model that needs no thinking time to
   *  write: a round still running and not writing the answer is cut, and the
   *  rescue writer writes it. A chain reads its own model's through
   *  writeAtFor — grok-4.5+ opens 50s earlier. */
  writeAt: number;
  /** A streaming provider call is aborted at this instant. */
  hardAt: number;
  /** The platform's kill: startedAt + the route's maxDuration. */
  endsAt: number;
}

/**
 * The deadline for a turn whose platform ceiling is `endsAt`.
 *
 * On a short route the full window would leave no room to gather at all, so
 * it is capped at a quarter of the usable time (WINDOW_SHARE_CAP), and the
 * round p90 at half of what precedes the window: a 120s route (the
 * fact-checker, "Run now") gets its answer window from ~71s and tool rounds
 * starting until ~36s, rather than no tools at all. That window (24s) is under
 * the rescue writer's measured time for a 2,000-token answer; those routes
 * write short ones, and whatever is written by HARD is kept. A grok-4.5+ turn
 * may take up to 40% (REASONING_WINDOW_SHARE_CAP): 38s on a 120s route, still
 * under grok-4.7's time to think at "low", so there its answer at the window
 * is the last resort's (answerStep).
 */
export function createTurnDeadline(opts: { startedAt: number; endsAt: number }): TurnDeadline {
  const startedAt = opts.startedAt;
  const endsAt = Math.max(opts.endsAt, startedAt);
  const hardAt = Math.max(startedAt, endsAt - FINALISE_RESERVE_MS);
  const usable = hardAt - startedAt;
  const writeAt = hardAt - Math.min(ANSWER_WINDOW_MS, usable * WINDOW_SHARE_CAP);
  const d: TurnDeadline = { startedAt, softAt: writeAt, writeAt, hardAt, endsAt };
  d.softAt = lastToolRoundAt(d, null);
  return d;
}

/** The deadline for a request that started at `startedAt` on a route whose
 *  maxDuration is `maxDurationSeconds`. */
export function deadlineForRoute(startedAt: number, maxDurationSeconds: number): TurnDeadline {
  return createTurnDeadline({ startedAt, endsAt: startedAt + maxDurationSeconds * 1000 });
}

/**
 * The deadline this turn runs under, created ONCE and stored on the holder so
 * a provider fallback shares it rather than starting a fresh clock.
 *
 * A caller that states no ceiling gets the chat route's, counted from now.
 * That is no worse than before for any route and strictly better for the
 * ones that never bounded a turn at all.
 */
export function turnDeadlineFor(holder: { turnDeadline?: TurnDeadline }, now: number = Date.now()): TurnDeadline {
  if (!holder.turnDeadline) {
    holder.turnDeadline = createTurnDeadline({ startedAt: now, endsAt: now + CHAT_ROUTE_MAX_DURATION_MS });
  }
  return holder.turnDeadline;
}

/**
 * THE ROUND-START POLICY: the last moment a round WITH TOOLS may start for
 * this model — its measured p90 round before ITS answer window opens. A round
 * starting later is the answer round. On 2026-09-28 grok-4.7's round 2 started
 * at 141s with tools on, 29s before the old soft budget, and was still
 * thinking at 275s; its p90 round (90s, capped at half of the 175s before its
 * window) puts the last useful start at 87.5s.
 */
export function lastToolRoundAt(d: TurnDeadline, apiModel?: string | null): number {
  const w = writeAtFor(d, apiModel);
  const room = Math.max(0, w - d.startedAt);
  return w - Math.min(roundP90Ms(apiModel), room / 2);
}

/**
 * What the next provider request may be.
 *   "tools"  — an ordinary round.
 *   "final"  — too late for a tool round to finish before the window: the
 *              answer, tools off (who writes it: answerStep).
 *   "rescue" — the answer window is open: the answer, written by the rescue
 *              writers (rescueWritersFor).
 *   "none"   — too close to HARD for any request to land: finalise now.
 * Without a model, the slowest measured chain's round is assumed.
 */
export type RoundPlan = "tools" | "final" | "rescue" | "none";

export function roundPlan(d: TurnDeadline, now: number = Date.now(), apiModel?: string | null): RoundPlan {
  if (now < lastToolRoundAt(d, apiModel)) return "tools";
  if (now < writeAtFor(d, apiModel)) return "final";
  if (d.hardAt - now >= MIN_FINAL_ROUND_MS) return "rescue";
  return "none";
}

/** Whether a round starting now is the one to warn: the last that can build.
 *
 *  NEVER ROUND 0. The warning says "stop gathering", and before the first
 *  round nothing has been gathered. On a 120s route the last tool-round start
 *  is 36s in, so the 45s lead reached back past the start of the turn and the
 *  first request of every fact-check and optimiser discussion was told to
 *  stop before its only search (review, 2026-09-30). `round` is required so a
 *  new caller cannot forget it. */
export function warnBuildNow(d: TurnDeadline, now: number, apiModel: string | null | undefined, round: number): boolean {
  if (round < 1) return false;
  const last = lastToolRoundAt(d, apiModel);
  return now >= last - WARN_LEAD_MS && now < last;
}

/** Milliseconds left before the hard abort (never negative). */
export function msToHard(d: TurnDeadline, now: number = Date.now()): number {
  return Math.max(0, d.hardAt - now);
}

/** When the chat route's backstop fires. */
export function backstopAt(d: TurnDeadline): number {
  return d.endsAt - BACKSTOP_RESERVE_MS;
}

/**
 * Whether a FALLBACK leg is worth starting. A fallback re-runs the whole turn
 * on another provider from the first round, so it needs the time a turn needs:
 * later, it would only produce a tools-off answer with none of the first
 * leg's gathering, and past the last useful moment nothing at all. Then the
 * original error is the honest answer, and the route states it. `apiModel` is
 * the FALLBACK's model — its round decides whether a round can still fit.
 */
export function canStartFallback(d: TurnDeadline, now: number = Date.now(), apiModel?: string | null): boolean {
  return roundPlan(d, now, apiModel) === "tools";
}

/**
 * THE RESCUE WRITERS for a turn on `apiModel`, in order: who writes the answer
 * once the window has opened. Tools off; the provider's LOWEST reasoning; and
 * the SAME provider's fast model only where the turn's own model may not start
 * writing in time even at its lowest effort (measured, see the header).
 *
 * NEVER ANOTHER PROVIDER. The rescue sends everything the turn gathered, and
 * where that may go is already decided: mailbox, calendar and Microsoft
 * content is Claude-only by contract (those tools register on the Claude
 * chains alone), a hard-tainted turn must not move provider, and the
 * gathered text of any turn is already with the provider it is on. Every
 * provider here has a writer of its own, so a move would buy nothing and
 * risk the one thing that must not happen.
 *   - grok-4.5 and later reason and cannot be told not to → the turn's own
 *     model at "low" (8 of 8 real rescues attributed correctly, 23–56s to its
 *     first word), then, for the last LAST_RESORT_MS only, grok-4.3 at "none"
 *     (4–6s to text — and it credited the colleagues' pasted posts to the
 *     user in 6 of 6 real rescues, so it is never the first choice).
 *   - Claude models that always think (Opus 5.x, Fable, Mythos) → Sonnet 5,
 *     whose thinking this app disables (anthropic-params.ts): 1–2s to text,
 *     and it kept the three people apart on the incident's data.
 *   - everything else already runs without reasoning, or its effort is not
 *     measured here (Gemini's key cannot be exercised locally) → itself.
 */
export interface AnswerWriter {
  /** The API model that writes. Always the same provider as the turn's. */
  model: string;
  /** Sent as reasoning_effort on the OpenAI-compatible chains when set;
   *  unset means the model's own registry setting. */
  reasoningEffort?: "none" | "low" | "medium" | "high";
}
export function rescueWritersFor(apiModel: string): AnswerWriter[] {
  const m = String(apiModel || "");
  if (isReasoningGrok(m)) return [{ model: m, reasoningEffort: "low" }, { model: "grok-4.3", reasoningEffort: "none" }];
  if (/^grok-(4\.[0-4]|3)/.test(m)) return [{ model: m, reasoningEffort: "none" }];
  if (/^claude-(opus-5|fable|mythos)/.test(m)) return [{ model: "claude-sonnet-5" }];
  return [{ model: m }];
}
/** The first rescue writer — who writes when the window has just opened. */
export function rescueWriterFor(apiModel: string): AnswerWriter {
  return rescueWritersFor(apiModel)[0];
}

/** When a rescue writer that has not started writing is handed over to the
 *  next one: the last resort's slice before HARD (capped, on a short route, at
 *  half the window). Null when there is no next one. */
export function lastResortAt(d: TurnDeadline, apiModel: string): number | null {
  if (rescueWritersFor(apiModel).length < 2) return null;
  return d.hardAt - Math.min(LAST_RESORT_MS, (d.hardAt - writeAtFor(d, apiModel)) / 2);
}

/**
 * ONE STEP OF THE ANSWER PATH: who writes the next answer request, and when
 * that request is cut if it has written nothing. The chain calls this after
 * its tool loop, then again after a step that was cut or wrote nothing, with
 * `fromStage` one past the last step it tried.
 *
 *   stage 0  the turn's own model at its own setting, cut at the window.
 *            Only while a tool round could still START (a forced final with
 *            time to spare) on a model that must think; until the window on
 *            the rest. grok-4.7 at its default effort is not the answer round
 *            late in a turn: its single answer round has a p90 of 167s.
 *   stage 1… the rescue writers in order. Each but the last is cut when only
 *            the last resort's slice is left and it has not started writing;
 *            one that has started runs to HARD. A step is only started with
 *            MIN_FINAL_ROUND_MS left before its own cut.
 *
 * The window never cuts a rescue writer: grok-4.7 at "low", started as the
 * answer round at 141s, keeps its time to the last resort's slice rather than
 * being cut at the window only to be asked again.
 * `named`: the answer's line names the writer (it is not the turn's own
 * model at its own setting). `lastResort`: the writer that only writes what
 * the one before it did not start in time — its line says to check it.
 * Null: no request can land — finalise.
 */
export interface AnswerStep {
  stage: number;
  writer: AnswerWriter;
  /** Cut if it has written no answer text by then; null — HARD only. */
  cutAt: number | null;
  named: boolean;
  lastResort: boolean;
}
export function answerStep(d: TurnDeadline, now: number, apiModel: string, fromStage: number, ownEffort?: AnswerWriter["reasoningEffort"]): AnswerStep | null {
  if (d.hardAt - now < MIN_FINAL_ROUND_MS) return null;
  const m = String(apiModel || "");
  const w = writeAtFor(d, m);
  const writers = rescueWritersFor(m);
  const resort = lastResortAt(d, m);
  const steps: { writer: AnswerWriter; startBy: number; cutAt: number | null; named: boolean; lastResort: boolean }[] = [
    { writer: { model: m, reasoningEffort: ownEffort }, startBy: isReasoningGrok(m) ? lastToolRoundAt(d, m) : w, cutAt: w, named: false, lastResort: false },
  ];
  for (let i = 0; i < writers.length; i++) {
    const handsOver = i < writers.length - 1 && resort !== null;
    steps.push({
      writer: writers[i],
      startBy: (handsOver ? resort! : d.hardAt) - MIN_FINAL_ROUND_MS,
      cutAt: handsOver ? resort : null,
      named: true,
      lastResort: i > 0 && i === writers.length - 1,
    });
  }
  for (let s = Math.max(0, fromStage); s < steps.length; s++) {
    if (now < steps[s].startBy) return { stage: s, writer: steps[s].writer, cutAt: steps[s].cutAt, named: steps[s].named, lastResort: steps[s].lastResort };
  }
  return null;
}

/** The provider family an API model belongs to — what rescueWriterFor must
 *  never change. */
export function providerOf(apiModel: string): "xai" | "anthropic" | "openai" | "gemini" | "other" {
  const m = String(apiModel || "");
  if (/^grok-/.test(m)) return "xai";
  if (/^claude-/.test(m)) return "anthropic";
  if (/^(gpt-|o\d)/.test(m)) return "openai";
  if (/^gemini-/.test(m)) return "gemini";
  return "other";
}

/** Thrown into a stream when the hard budget is reached, and the reason every
 *  deadline signal aborts with — so whoever reads the signal can tell OUR
 *  abort from anyone else's. */
export class TurnDeadlineError extends Error {
  constructor(public readonly deadline: TurnDeadline, detail: string) {
    super(`Turn deadline reached — ${detail}`);
    this.name = "TurnDeadlineError";
  }
}

/** The reason a round is cut when the answer window opens. A subclass, so the
 *  stream guard rejects with it exactly as it does for the hard budget
 *  (deadlineErrorOf); a chain tells the two apart with isWindowCut. */
export class AnswerWindowCut extends TurnDeadlineError {
  constructor(deadline: TurnDeadline, detail: string) {
    super(deadline, detail);
    this.name = "AnswerWindowCut";
  }
}

/**
 * THE ONE MECHANISM THAT ENDS A REQUEST AT THE HARD BUDGET: an AbortSignal
 * that fires at `hardAt`, given to the SDK request AND to the stream guard.
 *
 * ONE SIGNAL, NOT TWO TIMERS. The guard used to race its own timer against
 * this one, both set for the same instant, and the two SDKs lose an abort in
 * different ways (measured against the installed openai 6.25 and
 * @anthropic-ai/sdk 0.78, over real HTTP, 2026-09-28):
 *   - OpenAI's Stream, which the xAI, Gemini and OpenAI chains iterate, ENDS
 *     QUIETLY when its signal aborts mid-stream — `if (isAbortError(e))
 *     return;` — so whenever the signal won the race the chain saw a round
 *     that simply finished: no cut recorded, no notice, a sentence cut in
 *     half saved as a complete answer.
 *   - Both SDKs throw APIUserAbortError for an abort while waiting for the
 *     headers, and its `.name` is "Error", so a test on the name never
 *     matched and the turn was thrown as a provider failure — no completion,
 *     no usage row, no saved deck.
 * Now the guard listens on THIS signal and rejects with its reason the moment
 * it fires, before either SDK has turned the abort into anything, and a
 * request that fails while this signal has fired is ours whatever the SDK
 * called it (isTurnDeadlineError). The reason is a TurnDeadlineError.
 *
 * A plain timer rather than AbortSignal.timeout, so it runs on the same clock
 * as the rest of the turn; unref'd, so a finished request's pending timer
 * never holds a process (the cron, a script) open.
 */
export function hardDeadlineSignal(d: TurnDeadline, now: number = Date.now()): AbortSignal {
  const ac = new AbortController();
  const timer: any = setTimeout(
    () => ac.abort(new TurnDeadlineError(d, `request aborted ${Math.round((Date.now() - d.startedAt) / 1000)}s into the turn`)),
    Math.max(0, d.hardAt - now)
  );
  if (timer && typeof timer.unref === "function") timer.unref();
  return ac.signal;
}

/**
 * THE GUARD ON A ROUND THAT MAY STILL BE RUNNING WHEN THE WINDOW OPENS — every
 * tool round, and every answer request. Its signal is the hard-budget signal
 * above PLUS the window: at the model's window (writeAtFor), or at an answer
 * step's own `cutAt`, the round is cut (AnswerWindowCut) unless it is visibly
 * writing the answer — text streaming
 * with no tool call begun, or a generate_* call begun, because a deck being
 * written IS the answer and the rescue cannot build one. A lookup call that
 * begins after the window opened, in a round with no artefact in it, is cut
 * the moment it begins: nothing could run it.
 *
 * The chain reports what the stream is producing through text() and tool();
 * the guard never reads the stream itself. On 2026-09-28 the round that ate
 * the turn emitted nothing for 134s — no event to react to — which is why the
 * cut is a timer, not a check between chunks.
 */
export interface RoundGuard {
  readonly signal: AbortSignal;
  /** Visible answer text arrived. */
  text(): void;
  /** A tool call began (its name, as soon as the stream names it). */
  tool(name: string): void;
  /** Did this guard cut the round at the window? */
  cutAtWindow(): boolean;
  /** The round is over: stop both timers. */
  done(): void;
}

export function guardRound(d: TurnDeadline, now: number, apiModel: string | null, cutAt?: number | null): RoundGuard {
  // The window of the TURN's model (a grok-4.7 round is cut at 175s, not at
  // the 225s every other model gets), or the answer step's own cut; null —
  // HARD only.
  const windowAt = cutAt === undefined ? writeAtFor(d, apiModel) : cutAt;
  const ac = new AbortController();
  let sawText = false;
  let currentTool: string | null = null;
  // ONCE A ROUND HAS BEGUN AN ARTEFACT it carries the answer, and it is never
  // cut at the window: a deck call written in full and followed by a lookup
  // would otherwise be thrown away with the lookup. The lookup is refused
  // when it would run instead (toolTooLate).
  let sawGenerator = false;
  let cut = false;
  const writingAnswer = () => sawGenerator || (currentTool ? false : sawText);
  const cutNow = (why: string) => {
    if (ac.signal.aborted) return;
    cut = true;
    ac.abort(new AnswerWindowCut(d, `${why} (${Math.round((Date.now() - d.startedAt) / 1000)}s into the turn)`));
  };
  const hard: any = setTimeout(
    () => { if (!ac.signal.aborted) ac.abort(new TurnDeadlineError(d, `request aborted ${Math.round((Date.now() - d.startedAt) / 1000)}s into the turn`)); },
    Math.max(0, d.hardAt - now)
  );
  const win: any = windowAt === null ? null : setTimeout(() => {
    if (!writingAnswer()) cutNow(currentTool ? `still writing a ${currentTool} call when the answer window opened` : `no answer text by ${Math.round((windowAt - d.startedAt) / 1000)}s`);
  }, Math.max(0, windowAt - now));
  for (const t of [hard, win]) if (t && typeof t.unref === "function") t.unref();
  return {
    signal: ac.signal,
    // Text AFTER a tool began means that call is written and the model is
    // writing again — on Anthropic, prose after a server-side web search is
    // the answer continuing, and must not read as "still writing a call".
    text() { sawText = true; if (currentTool && currentTool.indexOf("generate_") !== 0) currentTool = null; },
    tool(name: string) {
      if (!name || name === currentTool) return;
      currentTool = name;
      if (name.indexOf("generate_") === 0) sawGenerator = true;
      else if (windowAt !== null && Date.now() >= windowAt && !sawGenerator) cutNow(`began ${name} after the answer window opened`);
    },
    cutAtWindow: () => cut,
    done() { clearTimeout(hard); if (win) clearTimeout(win); },
  };
}

/** Was this failure the answer window cutting the round (not the hard budget,
 *  not anyone else)? Checked BEFORE isTurnDeadlineError, which is true for it
 *  too — it is a TurnDeadlineError. */
export function isWindowCut(e: unknown, guard?: RoundGuard | null): boolean {
  if (guard && guard.cutAtWindow()) return true;
  return e instanceof AnswerWindowCut;
}

/** Has this deadline signal fired? Only OUR abort counts — a signal aborted
 *  for any other reason is somebody else's to explain. */
export function deadlineFired(signal: AbortSignal | null | undefined): boolean {
  return !!signal && signal.aborted && signal.reason instanceof TurnDeadlineError;
}

/**
 * Was this error the hard budget cutting a request, however the SDK chose to
 * report it?
 *   - TurnDeadlineError: the stream guard, which rejects with the signal's
 *     reason.
 *   - Anything at all while the request's own deadline signal has fired: the
 *     SDK's APIUserAbortError (name "Error", message "Request was aborted."),
 *     a fetch AbortError, whatever a later SDK throws. The signal is the
 *     fact; the error is only how the SDK happened to describe it.
 *   - Without the signal: an abort-shaped error once the hard budget has
 *     passed. An abort before it (the client going away) is not ours.
 */
export function isTurnDeadlineError(e: unknown, d: TurnDeadline, signal?: AbortSignal | null, now: number = Date.now()): boolean {
  if (e instanceof TurnDeadlineError) return true;
  if (deadlineFired(signal)) return true;
  const name = (e as any)?.name;
  const message = String((e as any)?.message ?? "");
  const aborted =
    name === "AbortError" || name === "APIUserAbortError" || name === "TimeoutError" || message === "Request was aborted.";
  return aborted && now >= d.hardAt - 1_000;
}

/** The error a stream guard throws for a fired deadline signal. */
export function deadlineErrorOf(signal: AbortSignal): TurnDeadlineError | Error {
  return signal.reason instanceof TurnDeadlineError ? signal.reason : new Error("Request was aborted.");
}

/** Where the deadline stopped a turn, for the notice. */
export interface DeadlineCut {
  /** "soft": tools went off and the turn answered from what it had.
   *  "window": the answer window opened on a round that was not writing, and
   *            the rescue writer was owed the answer.
   *  "hard": a request was aborted, or none could be started. */
  kind: "soft" | "window" | "hard";
  /** The tool whose call was still being WRITTEN when the abort landed, or —
   *  with `unstarted` — the one there was no time left to RUN. */
  tool?: string;
  /** The call was written in full but never run: too little time was left to
   *  use its result (see toolTooLate). */
  unstarted?: boolean;
  /** Set when a RESCUE WRITER wrote the answer: how the notice names it,
   *  e.g. "Grok 4.7 at low reasoning effort". */
  writer?: string;
  /** That writer was the LAST RESORT (answerStep): fast, and measured to
   *  mix up whose work is whose — the line says to check it. */
  lastResort?: boolean;
}

/**
 * No tool call STARTS when its result could not be used:
 *   - a GENERATOR once no request can follow it (roundPlan "none"): a deck is
 *     ~60s with images, the executors are not streams and cannot be aborted
 *     once started, and one started at 260s runs into the platform's kill;
 *   - a LOOKUP once the answer window is open: whatever it fetched would eat
 *     the time the rescue writer needs to write the answer with what the turn
 *     already has.
 * Without a tool name the generator rule applies. `apiModel` is the turn's:
 * its window is the one that decides.
 */
export function toolTooLate(d: TurnDeadline, now: number = Date.now(), tool?: string, apiModel?: string | null): boolean {
  if (d.hardAt - now < MIN_FINAL_ROUND_MS) return true;
  return !!tool && tool.indexOf("generate_") !== 0 && now >= writeAtFor(d, apiModel);
}

/** The cut after a tool call was skipped by toolTooLate: a generator is the
 *  thing the notice should name, over any lookup skipped beside it. A lookup
 *  skipped at the window leaves the answer owed, not the turn over. */
export function skippedToolCut(cut: DeadlineCut | null, tool: string, now: number = Date.now(), d?: TurnDeadline): DeadlineCut {
  const keep = cut && cut.tool && cut.tool.indexOf("generate_") === 0;
  if (keep) return { kind: "hard", tool: cut!.tool, unstarted: cut!.unstarted };
  if (tool.indexOf("generate_") !== 0 && d && d.hardAt - now >= MIN_FINAL_ROUND_MS) return { kind: "window", tool, unstarted: true };
  return { kind: "hard", tool, unstarted: true };
}

/** What a user calls the thing a generator was building. */
function artefactName(tool: string): string {
  if (tool === "generate_slides") return "deck";
  if (tool === "generate_word_document" || tool === "generate_document") return "document";
  if (tool === "generate_chart") return "chart";
  if (tool === "generate_image") return "image";
  return "tool call";
}

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * THE TURN SAYS WHAT THE CLOCK DID, deterministically, in one line. The model
 * cannot see its own abort, and a reply that just stops reads the same as one
 * that finished — this repo's cut-off notice in ChatPanel exists because of
 * exactly that. OUR limit, never a statement about the source.
 *
 * `answered` is whether the turn put an answer on screen AFTER its last
 * tool round — the narration of a round that ended in tool calls is not one.
 * `gathered` names what the turn read (tool-activity subjects), for the one
 * case where there is no answer to point at.
 *
 * NEVER "ASK AGAIN, NARROWER". That was the advice when a turn ran out while
 * gathering, and it was wrong for the ask that ran out: a weekly summary needs
 * everything it gathered, and narrowing it would answer a different question.
 * When the answer was rescued the line says HOW it was written and by what;
 * when it could not be, it says what was read and offers to go on.
 *
 * NOTHING HERE PROMISES A NEXT TURN. "Ask for it on its own and it WILL be
 * fetched" was struck from the cut-short notice (tool-loop-guard.ts) because
 * the frozen router does not always hand a follow-up the tools; the lines
 * here offer, and never guarantee.
 */
export function turnDeadlineNotice(cut: DeadlineCut | null, answered: boolean, gathered: string[] = []): string {
  if (!cut) return "";
  const lead = "\n\n---\n\n⏱ ";
  if (cut.tool && cut.tool.indexOf("generate_") === 0) {
    const what = artefactName(cut.tool);
    if (cut.unstarted) {
      return `${lead}**Out of time** — too little of this turn was left to build the ${what}, so it was not started; ask again, in smaller parts if it is large.`;
    }
    return `${lead}**Cut off at this turn's time limit** — the ${what} was still being written, so it was not created; ask again, in smaller parts if it is large.`;
  }
  // THE LAST RESORT SAYS TO CHECK IT. grok-4.3 at "none" writes it when
  // grok-4.7 has not started in time, and on the incident's prompt it listed
  // colleagues' pasted posts as the user's own work in every real rescue it
  // wrote (and with an explicit attribution note added, 3 of 3 again). An
  // answer on time is owed; one that may credit the wrong person must say so.
  if (answered && cut.writer && cut.lastResort) {
    return `${lead}**Written in the last seconds of this turn's time limit** — the answer above was written by ${cut.writer}, a fast model, with tools off, from what had been gathered by then. It can mix up whose work is whose in pasted material: check names and owners before you use it, or reply "continue" to have it written again.`;
  }
  if (answered && cut.writer) {
    return `${lead}**Written quickly at this turn's time limit** — looking things up took most of the time, so the answer above was written by ${cut.writer}, with tools off, from what had been gathered by then; ask for anything missing by name.`;
  }
  if (answered && cut.kind === "soft") {
    return `${lead}**Stopped looking things up at this turn's time limit** — the answer above uses what was gathered by then; ask for anything missing by name.`;
  }
  if (answered && cut.kind === "hard") {
    return `${lead}**Cut off at this turn's time limit** — the reply above stops before it finished; say "continue" and it will pick up from there.`;
  }
  // No answer. Either the clock ran out (a request cut at HARD, or none could
  // start), or the answer request failed on its own account after tools went
  // off — the second is not "out of time" and must not be called that.
  const read = gathered.length ? `read ${listOf(gathered)}, but ` : "";
  if (cut.kind === "hard") {
    return `${lead}**Out of time before the answer was written** — this turn ${read}ran out of time before it could write the answer up. Reply "continue" to have it try again.`;
  }
  const had = gathered.length ? ` — this turn read ${listOf(gathered)}` : "";
  return `${lead}**Stopped looking things up at this turn's time limit**, and the answer that should have followed did not arrive${had}. Reply "continue" to have it try again.`;
}

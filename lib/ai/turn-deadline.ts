/**
 * A CHAT TURN ALWAYS FINISHES.
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
 * The warning was ADVICE, and the model is free to ignore advice. So there are
 * now two budgets, and neither asks the model for anything:
 *
 *   SOFT — past it, no further tool round STARTS. The next request is the
 *          final answer with tools off, through the forced-final path every
 *          chain already has.
 *   HARD — past it, a streaming provider call is ABORTED (the SDK request is
 *          cancelled, so it stops billing too) and the turn is finalised with
 *          whatever text exists plus one plain line saying what it did not
 *          finish and how to carry on.
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
 * SIZED FROM MEASUREMENT, 438 assistant turns 2026-09-14 → 09-28
 * (intelligence.ai_messages + ai_usage, read-only):
 *   - Route prep, user row → pending row: p50 2.6s, p90 4.6s, p99 9.2s, max
 *     13.5s. The deadline is created before any of it, so it is inside.
 *   - ONE ANSWER ROUND (turns that made a single request, i.e. an answer with
 *     no tools): claude p50 12s, p90 35s, max 126s; grok p50 17s, p90 83s,
 *     max 170s. FINAL_ROUND_RESERVE_MS is the slowest chain's p90 with a
 *     quarter on top. The tail beyond it is exactly what the hard abort is for.
 *   - Whole turns: grok-4.7 p90 237s and grok-4.6 p90 178s against claude
 *     p90 44s. Only grok turns ever came near the ceiling, and on 2026-09-28
 *     xAI was answering an 8k-token prompt in anything from 1s to 85s, with
 *     "model at capacity" errors mid-stream — the budgets have to hold on a
 *     bad day, not only a median one.
 *   - Finalising: the completion writes five rows in sequence (message,
 *     slides draft, tool card, conversation, usage). FINALISE_RESERVE_MS is
 *     that plus the backstop's own margin.
 * For the 300s chat route that is: hard at 275s, soft at 170s, backstop at
 * 290s. 14 of the 432 turns that completed ran past 170s (13 grok, one Claude
 * deck build) and none past 275s; only those of the 14 that still wanted
 * another tool round after 170s answer earlier now. The two that died are
 * the ones the hard budget is for.
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

/** What a final, tools-off answer round is given before the hard abort:
 *  grok's single-answer-round p90 (83s) plus a quarter, rounded. */
export const FINAL_ROUND_RESERVE_MS = 105_000;

/** Below this much time before the hard abort, a request is not started at
 *  all: a reasoning model spends longer than this thinking before its first
 *  visible word, so a request started later cannot land anything. */
export const MIN_FINAL_ROUND_MS = 20_000;

/** The build-now warning goes out on a round that STARTS this close to the
 *  soft budget — it is that round, not a later one, that can still build. */
export const WARN_LEAD_MS = 45_000;

export interface TurnDeadline {
  /** When the REQUEST started (ms since epoch). */
  startedAt: number;
  /** No further tool round starts after this. */
  softAt: number;
  /** A streaming provider call is aborted at this instant. */
  hardAt: number;
  /** The platform's kill: startedAt + the route's maxDuration. */
  endsAt: number;
}

/**
 * The deadline for a turn whose platform ceiling is `endsAt`.
 *
 * On a short route the final-round reserve would put SOFT before the turn
 * began, which means no tool round could ever run. So the reserve is capped
 * at half the usable window: a 120s route (the fact-checker, "Run now") gets
 * soft at ~47s and hard at 95s, rather than no tools at all.
 */
export function createTurnDeadline(opts: { startedAt: number; endsAt: number }): TurnDeadline {
  const startedAt = opts.startedAt;
  const endsAt = Math.max(opts.endsAt, startedAt);
  const hardAt = Math.max(startedAt, endsAt - FINALISE_RESERVE_MS);
  const usable = hardAt - startedAt;
  const softAt = hardAt - Math.min(FINAL_ROUND_RESERVE_MS, usable / 2);
  return { startedAt, softAt, hardAt, endsAt };
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
 * What the next provider request may be.
 *   "tools" — an ordinary round.
 *   "final" — past SOFT: the answer, with tools off.
 *   "none"  — too close to HARD for any request to land: finalise now.
 */
export type RoundPlan = "tools" | "final" | "none";

export function roundPlan(d: TurnDeadline, now: number = Date.now()): RoundPlan {
  if (now < d.softAt) return "tools";
  if (d.hardAt - now >= MIN_FINAL_ROUND_MS) return "final";
  return "none";
}

/** Whether a round starting now is the one to warn: the last that can build. */
export function warnBuildNow(d: TurnDeadline, now: number = Date.now()): boolean {
  return now >= d.softAt - WARN_LEAD_MS && now < d.softAt;
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
 * past SOFT it would only produce a tools-off answer with none of the first
 * leg's gathering, and past the last useful moment nothing at all. Then the
 * original error is the honest answer, and the route states it.
 */
export function canStartFallback(d: TurnDeadline, now: number = Date.now()): boolean {
  return roundPlan(d, now) === "tools";
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
   *  "hard": a request was aborted, or none could be started. */
  kind: "soft" | "hard";
  /** The tool whose call was still being WRITTEN when the abort landed, or —
   *  with `unstarted` — the one there was no time left to RUN. */
  tool?: string;
  /** The call was written in full but never run: too little time was left to
   *  use its result (see toolTooLate). */
  unstarted?: boolean;
}

/**
 * No tool call STARTS once the turn is too close to its hard budget for any
 * request to follow it (roundPlan "none"): nothing after it could read the
 * result, and a generator started at 260s — a deck is ~60s with images — runs
 * straight into the platform's kill. The executors are not streams and cannot
 * be aborted once started, so the only place to stop one is before it starts.
 */
export function toolTooLate(d: TurnDeadline, now: number = Date.now()): boolean {
  return roundPlan(d, now) === "none";
}

/** The cut after a tool call was skipped by toolTooLate: a generator is the
 *  thing the notice should name, over any lookup skipped beside it. */
export function skippedToolCut(cut: DeadlineCut | null, tool: string): DeadlineCut {
  const keep = cut && cut.tool && cut.tool.indexOf("generate_") === 0;
  if (keep) return { kind: "hard", tool: cut!.tool, unstarted: cut!.unstarted };
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

/**
 * THE TURN SAYS WHAT THE CLOCK DID, deterministically, in one line. The model
 * cannot see its own abort, and a reply that just stops reads the same as one
 * that finished — this repo's cut-off notice in ChatPanel exists because of
 * exactly that. OUR limit, never a statement about the source.
 *
 * `answered` is whether the turn put an answer on screen AFTER its last
 * tool round — the narration of a round that ended in tool calls is not one.
 *
 * NOTHING HERE PROMISES A NEXT TURN. "Ask for it on its own and it WILL be
 * fetched" was struck from the cut-short notice (tool-loop-guard.ts) because
 * the frozen router does not always hand a follow-up the tools; the soft and
 * out-of-time lines said the same thing in the same words, and now ask
 * instead of guaranteeing.
 */
export function turnDeadlineNotice(cut: DeadlineCut | null, answered: boolean): string {
  if (!cut) return "";
  const lead = "\n\n---\n\n⏱ ";
  if (cut.kind === "soft") {
    // The tools-off answer can still fail on its own account (a provider
    // error mid-way). Then there is no "answer above" to vouch for, and the
    // line must not claim one.
    if (!answered) {
      return `${lead}**Stopped looking things up at this turn's time limit**, and the answer that should have followed did not arrive — ask again, narrower (one meeting, one week).`;
    }
    return `${lead}**Stopped looking things up at this turn's time limit** — the answer above uses what was gathered by then; ask for anything missing by name.`;
  }
  if (cut.tool && cut.tool.indexOf("generate_") === 0) {
    const what = artefactName(cut.tool);
    if (cut.unstarted) {
      return `${lead}**Out of time** — too little of this turn was left to build the ${what}, so it was not started; ask again, in smaller parts if it is large.`;
    }
    return `${lead}**Cut off at this turn's time limit** — the ${what} was still being written, so it was not created; ask again, in smaller parts if it is large.`;
  }
  if (answered) {
    return `${lead}**Cut off at this turn's time limit** — the reply above stops before it finished; say "continue" and it will pick up from there.`;
  }
  return `${lead}**Out of time** — this turn spent its time limit gathering and stopped before writing the answer; ask again, narrower (one meeting, one week).`;
}

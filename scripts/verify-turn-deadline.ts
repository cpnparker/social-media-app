/**
 * A chat turn always finishes — checked through the chains that run it.
 * Run with `npx tsx scripts/verify-turn-deadline.ts`.
 *
 * WHY. 2026-09-28, thread 8479ea99: a grok-4.7 turn read 40 meetings, 50
 * tasks, Slack and five full transcripts, was WARNED at 184s to build, kept
 * reading, and was killed by the platform at 300s. The assistant row stayed
 * 'pending' and empty. 2026-09-15, thread 4b94c318, claude-sonnet-5: the same
 * row, still pending thirteen days later. The time handling was one sentence
 * of advice to the model; nothing stopped a turn.
 *
 * AND THE SECOND WHY, the one this check now leads with. 2026-09-28 13:34Z,
 * thread d949e94b, the QA re-run of that prompt on the fix: the row WAS
 * finalised — with no answer. grok-4.7's round 2 started at 141s, inside the
 * old 170s soft budget and so with tools on, and reasoned past the 275s hard
 * abort without a word. Ending a turn is not the goal; ending it with the
 * answer is. Sections 12–15b drive exactly that shape on every chain — a round
 * that keeps sending events (so no stall guard fires) none of which is text —
 * and assert the ANSWER TEXT is on the row, not merely that a row exists:
 * cut at the model's answer window (225s; 175s on grok-4.7), written by the
 * rescue writer (grok-4.7 itself at "low", the model itself or Sonnet 5 on
 * Claude), never on another provider, and said in a line that names who
 * wrote it.
 *
 * AND THE THIRD. The first rescue writer for grok-4.7 was grok-4.3 at
 * "none", chosen because it fits a 50s window. It fitted, and in 6 real
 * rescues of 6 it wrote the wrong summary: the colleagues' pasted posts
 * listed as the user's own work. A check that asserts the answer is PRESENT
 * cannot see that; it can only pin who is asked to write it. Section 12b does:
 * grok-4.7 at "low" first, from a window opened 90s before hard, and grok-4.3
 * only for the last 30s and only if grok-4.7 has not started writing.
 *
 * WHAT IS DRIVEN. The app's REAL createStreamingResponse and the four REAL
 * provider chains, through the REAL openai and @anthropic-ai/sdk clients, over
 * real HTTP, to a fake provider on 127.0.0.1: fetch is shimmed only to point
 * api.x.ai, api.anthropic.com, Gemini's OpenAI endpoint and api.openai.com at
 * it. The fake answers each request from a per-turn SCRIPT — text, tool calls,
 * a stream that goes silent, one that keeps dripping, one whose headers never
 * come, a provider error mid-stream — in each provider's own SSE format, and
 * records what arrived: the body (tools, tool_choice), the HEADERS (the cache
 * key), and whether the client hung up (the abort). MeetingBrain is the real
 * queryMeetingBrain with its Supabase RPC answered at fetch, meetings the size
 * of the incident's. Anything else reaching the network fails the run.
 *
 * WHY REAL SDKs. The first version of this check replaced the SDK methods with
 * stand-ins, and the stand-ins aborted the way a reasonable person would
 * expect: they threw an error NAMED "APIUserAbortError". The installed SDKs do
 * neither. Both name that error "Error", and OpenAI's Stream does not throw on
 * an abort mid-stream at all — it RETURNS. So this check passed, 99 assertions
 * green, while through the real clients every Anthropic hard cut and every
 * header wait was thrown away as a provider failure (no completion, no usage
 * row), and most xAI, Gemini and OpenAI cuts were saved as finished answers
 * with no note. A stand-in proves the stand-in. What the SDK does with an
 * abort is exactly the part under test, so the SDK has to be the real one.
 *
 * TIME IS VIRTUAL. Date.now runs WARP times faster than real time and every
 * setTimeout is shortened by the same factor, so a timer the app sets for "20
 * seconds from now" fires when Date.now says 20 seconds have passed; the
 * fake's own pacing and every watchdog use the REAL timer. On top of that the
 * clock can JUMP (clockTo) — a round that "takes" three minutes. A jump does
 * not move a timer already set, and a request's deadline signal is set when
 * the request is CREATED, so every scenario that needs a request cut at the
 * hard budget jumps BEFORE that request exists and then lets it run on the
 * warped clock — a dripping stream from 160s to 275s is about a second here.
 * The deadline itself is the real one, deadlineForRoute(now, 300): the chat
 * route's numbers, not a test copy of them.
 *
 * WHAT IS NOT DRIVEN, said plainly. The chat ROUTE itself — auth, context
 * building and the database — cannot be run here. Its pieces are: the backstop
 * timer, the finalised row's wording and the SSE tap that reads what was
 * shown are exercised as functions below, and the route is only checked for
 * CALLING them (section 9). That is a presence check and is labelled as one.
 *
 * MUTATION LOG (2026-09-30, third pass — the warning on round 0). Section
 * 17 was written first and run against the unfixed code, then the fix; the
 * second mutation in a scratch copy (scratchpad/wt-mut-warn).
 *   KILLED  W1  no round guard in warnBuildNow (the reviewed defect) → 4 red,
 *               one per chain: round 0 of a 120s turn carried the warning
 *   KILLED  W2  the Anthropic chain passes 0 instead of its round → 1 red:
 *               claude-sonnet-5's last buildable round is never warned
 *
 * MUTATION LOG (2026-09-30, second pass — the writer that got it wrong).
 * Same method, in a scratch copy synced from the worktree; the unmutated copy
 * passed before the batch and again before the re-run. 35 mutations, 33
 * killed, 2 survivors — both equivalent.
 *   KILLED  S1  grok-4.7 rescued first by grok-4.3 at "none" again (the
 *               defect this pass fixes) → 24 red
 *   KILLED  S2  grok-4.5+ window back to 50s → 6 red (unit, and 12b's
 *               literal 175s — every scenario that reads the window back
 *               through writeAtFor moves with it, which is why 12b pins the
 *               seconds)
 *   KILLED  S3  the round-start policy reads the default window → 2 red (unit)
 *   KILLED  S4  roundPlan's window ignores the model → 1 red (unit: either
 *               side of it the answer path is the same; only the label moves)
 *   KILLED  S5  guardRound's window ignores the model → 13 red
 *   KILLED  S6x the xAI tool round's guard is not given the model → 13 red
 *   KILLED  S7x the xAI chain's toolTooLate is not given the model → 1 red
 *   KILLED  S8  the last resort never takes over → 13 red
 *   KILLED  S9  the reasoning writer is never cut for the last resort → 10
 *   KILLED  S10 grok-4.7 at its own effort stays the answer round until the
 *               window → 8 red
 *   KILLED  S11 the line drops "at low reasoning effort" → 5 red
 *   KILLED  S15x the xAI answer step sends the turn's effort, not its own → 13
 *   KILLED  S17 answerStep ignores fromStage (the ladder restarts) → 3 red
 *   KILLED  S18 a reasoning model's window capped at a quarter → 6 red
 *   KILLED  S19 the reasoning writer's time to its first word cut to 20s → 6
 *   KILLED  S20 grok's last resort moved to Claude → 8 red
 *   KILLED  S21 the last resort never flagged as such → 2 red
 *   KILLED  S21x the xAI chain drops the flag on its way to the line → 2 red
 *   KILLED  S22 the last resort's line loses its caveat → 4 red (7 in the
 *               batch, which shared the machine with real runs; one of them
 *               was a timing flake — re-run alone: 4, every one on the line)
 *   Per chain (Anthropic / xAI / Gemini / OpenAI), each alone:
 *   KILLED  S12 an answer step's guard not given its own cut → 23/28/15/15
 *   KILLED  S13 an answer step that was cut not handed on → 4/8/4/4 red
 *   KILLED  S14 an answer step that came back EMPTY not handed on → 1 each —
 *               SURVIVED on all four chains at first: no scenario had an
 *               answer request finish with no text. Section 13b added.
 *   KILLED  S16A/S16x the answer request sent on the turn's model → 2/3 red
 *   SURVIVED S16G/S16O the same on Gemini and OpenAI: EQUIVALENT — every
 *               writer on those chains is the turn's model.
 * WHAT NO MUTATION HERE CAN SHOW: whether the writer's summary is RIGHT. The
 * check pins who is asked; the real runs are the evidence that grok-4.7 at
 * "low" keeps colleagues' items out of the user's lists, and that grok-4.3 at
 * "none" does not.
 *
 * MUTATION LOG (2026-09-30, the answer window). Same method: each mutation
 * applied alone to a scratch COPY of the tree (never the worktree), this
 * check run there, the file restored; the unmutated copy passed first, twice.
 * 46 mutations, 44 killed, 2 survivors — both equivalent, recorded as such.
 *   KILLED  R1  the window timer never cuts → 52 red (the QA shape: the
 *               thinking round runs to HARD and nothing is left to write with)
 *   KILLED  R2  a round that began an artefact is cut at the window like any
 *               other → 9 red — found as a LIVE defect by section 7b before
 *               this log existed: a deck call written in full and followed by
 *               a lookup was thrown away with the lookup
 *   KILLED  R3  no round-start policy (tool rounds start until the window)
 *               → 31 red
 *   KILLED  R4  the policy ignores the model (slowest p90 for all) → 3 red
 *   KILLED  R5  grok-4.7 rescued by itself → 6 red
 *   KILLED  R6  grok-4.7 rescued on ANOTHER provider (Claude) → 7 red
 *   KILLED  R7  an always-thinking Claude rescued by itself → 3 red
 *   KILLED  R8  lookups still start after the window opens → 3 red (1 of them
 *               unit-only at first; the straddling-read scenario was added)
 *   KILLED  R9  the fallback gate ignores the fallback's model → 2 red (the
 *               same: unit-only at first; the 180s fallback was added)
 *   KILLED  R10 the rescued line does not name the writer → 9 red
 *   KILLED  R11 "ask again, narrower" restored → 6 red
 *   KILLED  R12 guardRound's HARD timer removed → 34 red
 *   KILLED  R13 gathered subjects count refused calls → 2 red
 *   KILLED  R14 the notices are not told what was gathered → 4 red
 *   KILLED  R15 Anthropic's rescue drops the taint narrowing → 1 red
 *   KILLED  R16 xAI's rescue does not send its effort → 2 red
 *   KILLED  R17 prose after a server-side web search still reads as writing
 *               the call → 1 red — a LIVE defect too: a Claude round that
 *               searched and went on writing was cut at the window
 *   KILLED  R18 the window shrinks to 20s → 87 red
 *   Per chain (Anthropic / xAI / Gemini / OpenAI), each alone:
 *   KILLED  C1  the answer round not guarded by the window → 3 red each
 *   KILLED  C2  a window cut treated as the hard budget → 3 red each
 *   KILLED  C3  the cut round's words not closed off as narration → 2 each
 *   KILLED  C4  a round's text not reported to its guard → 7/1/6/6 red
 *   KILLED  C5  a rescued answer not recorded as the writer's → 4 red each
 *   KILLED  C6A/C6x the rescue request sent on the turn's model → 2, 3 red
 *   KILLED  C7  an answer round cut at the window not handed to the rescue
 *               → 4 red each
 *   SURVIVED C6G/C6O the same on Gemini and OpenAI: EQUIVALENT — on those
 *               chains the rescue writer IS the turn's model.
 * A check that asserted the ROW rather than the ANSWER would have passed the
 * QA turn: its row was 'complete'. Every scenario in 12–15b asserts the
 * answer's own words on the saved row.
 *
 * MUTATION LOG (2026-09-28, second version — real SDKs). Each mutation
 * applied alone to a separate scratch copy of the tree, the check run there,
 * the file restored; driver in the session scratchpad. Survivors are findings
 * about the check and are recorded as such.
 *
 * THE FIRST VERSION'S KILLS ARE NOT EVIDENCE. Its log recorded 26 kills,
 * including M2, M3, M8, M17, M25 and M26 below, against SDK stand-ins that
 * aborted the opposite way to the real clients; those kills proved the
 * stand-in. Every mutation below was re-run against this version.
 *
 * The three confirmed defects, reintroduced:
 *   KILLED  N1  isTurnDeadlineError trusts the error's NAME only → 4 red (every
 *               OpenAI-SDK header wait thrown away; the forced final's "Out
 *               of time" became the soft line claiming an answer above)
 *   KILLED  N2  the stream guard no longer rejects on the signal → 15 red
 *               (OpenAI's Stream ends quietly: half sentences saved as
 *               answers on xAI, Gemini and OpenAI, no deck line)
 *   KILLED  N3/N3a/N3b/N3c  a forced final's catch no longer marks a hard cut
 *               (xAI / Anthropic / Gemini / OpenAI) → 3 red each
 * The rest of this version:
 *   KILLED  N4  the runner's backstop never armed → 3 red (it hung on the
 *               MeetingBrain call that never answers)
 *   KILLED  N5a–d  a tool call started however late, per chain → 1–2 red
 *   KILLED  N6  (V1) `&& hasNotes` removed → 12 red: a transcript-only meeting
 *               withheld to an empty record, on all four chains
 *   KILLED  N7/N8/N8a  (V2/V5) the Anthropic / OpenAI / Gemini executor does
 *               not pass the budget → 9 red each
 *   KILLED  N9/N9a/N9b  (V3) Gemini / Anthropic / OpenAI drop the notes
 *               notice → 2 red each
 *   KILLED  N10a–d  full_transcript not passed through, per chain → 2–4 red
 *   KILLED  N11 the cap on transcripts asked for by name removed → 3 red
 *   KILLED  N12 the notice promises again the transcript "will be read" → 5 red
 *   KILLED  N12a a refused explicit ask is told to retry with the flag → 1 red
 *   KILLED  N13 a skipped deck loses "not started" (xAI) → 1 red
 *   KILLED  N14 a dead run's provider error not carried to the run row → 1 red
 *   KILLED  N15 skippedToolCut no longer prefers the generator → 1 red —
 *               SURVIVED at first: no batch skipped a lookup after a deck.
 *               Section 7b's deck batch now carries one.
 *   KILLED  N16 a soft cut whose answer failed vouches for "the answer
 *               above" → 1 red
 *   KILLED  N17 the soft line promises a follow-up "will be fetched" → 1 red
 *   SURVIVED N1a/N1b  either half of the classification alone (the signal
 *               test, or the SDK-message fallback): each covers the other.
 *               N1, both removed, is killed.
 *   SURVIVED N2a the guard's check for a signal that fired BETWEEN events:
 *               every chain's loop body is synchronous, so a timer cannot
 *               fire between two events. It is there for a body that awaits.
 * The first version's set, re-anchored and re-run:
 *   KILLED  M1, M11, M21, M22  the soft break removed (xAI, Gemini,
 *               Anthropic, OpenAI) → 4, 2, 2, 2 red
 *   KILLED  M2, M17a, M17  a round's guard not given the signal (xAI, Gemini,
 *               OpenAI) → 3 red each
 *   KILLED  M3  no signal on the xAI request → 4 red
 *   KILLED  M4, M23, M24  a fallback not gated on time → 3, 1, 1 red
 *   KILLED  M5  the runner resolves only on completion → 1 red
 *   KILLED  M6  the xAI executor does not pass the budget → 12 red
 *   KILLED  M7  x-grok-conv-id dropped → 4 red (read off the wire now)
 *   KILLED  M8  Anthropic round catch's deadline branch removed → 8 red
 *   KILLED  M9  the deadline notice never written → 31 red
 *   KILLED  M10 a soft cut no longer owes the answer → 4 red
 *   KILLED  M12 backstop armed for the platform kill → 2 red
 *   KILLED  M13 the SSE tap no longer restarts at a fallback → 1 red
 *   KILLED  M14 a withheld transcript labelled with its recorded status → 8 red
 *   KILLED  M15 the first transcript no longer always whole → 3 red
 *   KILLED  M16 the route no longer arms the backstop → 1 red (PRESENCE)
 *   KILLED  M18 the runner does not pass the caller's deadline → 1 red
 *   KILLED  M19 the xAI notes notice never written → 3 red
 *   KILLED  M20 soft moved onto hard → 30 red
 *   KILLED  M25, M25a, M25b  a forced final's guard not given the signal
 *               (xAI, Gemini, OpenAI) → 2 red each
 *   KILLED  S4  the xAI forced final stops asking for usage → 1 red
 *   KILLED  S5  the build-now warning never sent → 1 red
 *   SURVIVED M17b/S2  Anthropic: the round's guard, or its SDK request,
 *               without the signal. Either alone still cuts the stream at
 *               hard — MessageStream THROWS on its signal, unlike OpenAI's —
 *               so the two are belt and braces. P1, both removed, is killed
 *               (4 red: the 90s stall guard fired after hard instead).
 *   SURVIVED M26 the same for Anthropic's forced final. P2, both removed, is
 *               killed (2 red) — and it SURVIVED at first: the stall guard
 *               ended the stream 51 virtual seconds past hard, which is under
 *               a second of real time. The timing assertions now read the
 *               VIRTUAL clock (beforeBackstop), not real milliseconds.
 *   SURVIVED S1 the signal's timer not unref'd: the check exits explicitly.
 *   SURVIVED S3 a stall past the last useful moment also gets the deadline
 *               notice: no scenario stalls that late.
 */
import http from "http";
import { readFileSync } from "fs";
import { join } from "path";

// ── Virtual clock ───────────────────────────────────────────────────────
const WARP = 100;
const realNow = Date.now.bind(Date);
const realSetTimeout = setTimeout;
const epoch = realNow();
let skew = 0;
Date.now = () => epoch + (realNow() - epoch) * WARP + skew;
(globalThis as any).setTimeout = ((fn: any, ms?: number, ...args: any[]) =>
  realSetTimeout(fn, Math.max(0, (ms || 0) / WARP), ...args)) as any;
/** Move the clock to `ms` after the deadline's start. */
function clockTo(startedAt: number, ms: number) {
  skew += startedAt + ms - Date.now();
}
function realSleep(ms: number): Promise<void> {
  return new Promise((res) => realSetTimeout(res, ms));
}

// ── Reporting ───────────────────────────────────────────────────────────
let failures = 0;
function ok(msg: string) { console.log(`  ok   ${msg}`); }
function fail(msg: string) { failures++; console.log(`  FAIL ${msg}`); }
function check(cond: boolean, msg: string, detail?: string) { cond ? ok(msg) : fail(detail ? `${msg} — ${detail}` : msg); }

// Anything the SDKs or the chains leave rejected with nobody listening.
const unhandled: string[] = [];
process.on("unhandledRejection", (e: any) => { unhandled.push(String(e?.message ?? e)); });

// ── Silence the chains' logs, keep them for assertions ──────────────────
const logs: string[] = [];
const verbose = process.argv.indexOf("--verbose") >= 0;
const origLog = console.log, origWarn = console.warn, origErr = console.error;
function capture(...a: any[]) { const line = a.map((x) => (typeof x === "string" ? x : String(x?.message ?? JSON.stringify(x)))).join(" "); logs.push(line); if (verbose) origErr("    · " + line.slice(0, 240)); }
function quiet() { console.log = capture; console.warn = capture; console.error = capture; }
function loud() { console.log = origLog; console.warn = origWarn; console.error = origErr; }

// ── The fake provider ───────────────────────────────────────────────────
interface Round {
  /** Runs when the request arrives — the place a round "takes" time. */
  before?: () => void;
  text?: string[];
  toolCalls?: { name: string; args: any }[];
  /** "headers": never answers. "stream": goes silent after the text.
   *  "drip": after the text keeps writing a little more every DRIP_MS until
   *  the client hangs up — a slow answer, never a silent one, so the stall
   *  guard cannot be what ends it. "drip-tool": the same, inside a
   *  generate_slides call's arguments. */
  hang?: "headers" | "stream" | "drip" | "drip-tool" | "think";
  /** With hang "drip": once the VIRTUAL clock passes `at`, a call to `name`
   *  begins mid-drip — a round that was writing and then reached for a tool. */
  toolAt?: { at: number; name: string };
  /** Anthropic, with hang "drip": the text is followed by a SERVER-side web
   *  search (its call and its result, inside the stream) and then the answer
   *  goes on dripping — prose after a search is still the answer. */
  serverSearch?: boolean;
  /** Sent mid-stream after the text, in the provider's own error format. */
  error?: string;
}
/** What arrived at the fake. `abortedAt`: the client closed the connection
 *  before the fake had finished answering — the SDK request was cancelled. */
interface Sent { provider: string; body: any; headers: http.IncomingHttpHeaders; abortedAt: number; finished: boolean; abortedVirtual: number }
let script: Round[] = [];
let sent: Sent[] = [];
/** Non-streaming requests (none are expected in these turns). */
const aux: string[] = [];
function newTurnScript(rounds: Round[]) { script = rounds.slice(); sent = []; }

/** How far from the window a cut may land and still count as "at the window"
 *  — 10 virtual seconds, 100ms of real time, for event-loop jitter on a busy
 *  machine. The window and HARD are 50s apart, so it cannot blur the two. */
const WINDOW_SLACK_MS = 10_000;

/** Virtual ms between drips. */
const DRIP_MS = 2_000;

function drip(res: http.ServerResponse, frame: () => string) {
  const tick = () => {
    if (res.destroyed || res.writableEnded) return;
    res.write(frame());
    realSetTimeout(tick, DRIP_MS / WARP);
  };
  realSetTimeout(tick, DRIP_MS / WARP);
}

function oaChunk(delta: any, finish: string | null = null): string {
  return `data: ${JSON.stringify({ id: "chatcmpl-verify", object: "chat.completion.chunk", created: 1, model: "verify", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

function answerOpenAI(res: http.ServerResponse, round: Round, body: any, finish: () => void) {
  const text = round.text || [];
  res.write(oaChunk({ role: "assistant", content: "" }));
  for (let i = 0; i < text.length; i++) res.write(oaChunk({ content: text[i] }));
  if (round.error) {
    // xAI's shape for a failure after the headers: an `error` frame.
    res.write(`data: ${JSON.stringify({ error: { message: round.error, type: "server_error" } })}\n\n`);
    finish();
    return;
  }
  if (round.hang === "stream") return;
  // A REASONING model thinking: events keep coming, so no stall guard fires,
  // and not one of them is answer text — the 2026-09-28 QA round, 134s of it.
  if (round.hang === "think") { drip(res, () => oaChunk({ reasoning_content: "…" })); return; }
  if (round.hang === "drip" && round.toolAt) {
    const at = round.toolAt;
    let began = false;
    drip(res, () => {
      if (!began && Date.now() >= at.at) { began = true; return oaChunk({ tool_calls: [{ index: 0, id: "call_late", type: "function", function: { name: at.name, arguments: "{\"report\":" } }] }); }
      return began ? oaChunk({ tool_calls: [{ index: 0, function: { arguments: " " } }] }) : oaChunk({ content: " …" });
    });
    return;
  }
  if (round.hang === "drip") { drip(res, () => oaChunk({ content: " …" })); return; }
  if (round.hang === "drip-tool") {
    res.write(oaChunk({ tool_calls: [{ index: 0, id: "call_deck", type: "function", function: { name: "generate_slides", arguments: "{\"title\":\"Weekly" } }] }));
    drip(res, () => oaChunk({ tool_calls: [{ index: 0, function: { arguments: " summary" } }] }));
    return;
  }
  const calls = round.toolCalls || [];
  for (let i = 0; i < calls.length; i++) {
    res.write(oaChunk({ tool_calls: [{ index: i, id: `call_${i}_${sent.length}`, type: "function", function: { name: calls[i].name, arguments: JSON.stringify(calls[i].args) } }] }));
  }
  res.write(oaChunk({}, calls.length ? "tool_calls" : "stop"));
  // The streaming contract: NO usage frame unless the request asked for one.
  if (body.stream_options && body.stream_options.include_usage) {
    res.write(`data: ${JSON.stringify({ id: "chatcmpl-verify", object: "chat.completion.chunk", created: 1, model: "verify", choices: [], usage: { prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } } })}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  finish();
}

function anEvent(type: string, data: any): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

function answerAnthropic(res: http.ServerResponse, round: Round, finish: () => void) {
  res.write(anEvent("message_start", { message: { id: "msg_verify", type: "message", role: "assistant", model: "verify", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 0 } } }));
  const text = round.text || [];
  if (round.hang === "think") {
    res.write(anEvent("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }));
    drip(res, () => anEvent("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "…" } }));
    return;
  }
  if (round.hang === "drip" && round.serverSearch) {
    res.write(anEvent("content_block_start", { index: 0, content_block: { type: "text", text: "" } }));
    for (let i = 0; i < text.length; i++) res.write(anEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: text[i] } }));
    res.write(anEvent("content_block_stop", { index: 0 }));
    res.write(anEvent("content_block_start", { index: 1, content_block: { type: "server_tool_use", id: "srvtoolu_verify", name: "web_search", input: {} } }));
    res.write(anEvent("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: "{\"query\":\"Siemens ITM\"}" } }));
    res.write(anEvent("content_block_stop", { index: 1 }));
    res.write(anEvent("content_block_start", { index: 2, content_block: { type: "web_search_tool_result", tool_use_id: "srvtoolu_verify", content: [] } }));
    res.write(anEvent("content_block_stop", { index: 2 }));
    res.write(anEvent("content_block_start", { index: 3, content_block: { type: "text", text: "" } }));
    res.write(anEvent("content_block_delta", { index: 3, delta: { type: "text_delta", text: "After the search, the summary goes on: " } }));
    drip(res, () => anEvent("content_block_delta", { index: 3, delta: { type: "text_delta", text: " …" } }));
    return;
  }
  const textBlock = text.length > 0 || round.hang === "drip";
  if (textBlock) {
    res.write(anEvent("content_block_start", { index: 0, content_block: { type: "text", text: "" } }));
    for (let i = 0; i < text.length; i++) res.write(anEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: text[i] } }));
  }
  if (round.error) {
    res.write(anEvent("error", { error: { type: "overloaded_error", message: round.error } }));
    finish();
    return;
  }
  if (round.hang === "stream") return;
  if (round.hang === "drip" && round.toolAt) {
    const at = round.toolAt;
    let began = false;
    drip(res, () => {
      if (!began && Date.now() >= at.at) {
        began = true;
        return anEvent("content_block_stop", { index: 0 }) + anEvent("content_block_start", { index: 1, content_block: { type: "tool_use", id: "toolu_late", name: at.name, input: {} } });
      }
      return began ? anEvent("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: " " } }) : anEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: " …" } });
    });
    return;
  }
  if (round.hang === "drip") { drip(res, () => anEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: " …" } })); return; }
  let next = 0;
  if (textBlock) { res.write(anEvent("content_block_stop", { index: 0 })); next = 1; }
  if (round.hang === "drip-tool") {
    const at = next;
    res.write(anEvent("content_block_start", { index: at, content_block: { type: "tool_use", id: "toolu_deck", name: "generate_slides", input: {} } }));
    res.write(anEvent("content_block_delta", { index: at, delta: { type: "input_json_delta", partial_json: "{\"title\":\"Weekly" } }));
    drip(res, () => anEvent("content_block_delta", { index: at, delta: { type: "input_json_delta", partial_json: " summary" } }));
    return;
  }
  const calls = round.toolCalls || [];
  for (let i = 0; i < calls.length; i++) {
    const at = next + i;
    res.write(anEvent("content_block_start", { index: at, content_block: { type: "tool_use", id: `toolu_${i}_${sent.length}`, name: calls[i].name, input: {} } }));
    res.write(anEvent("content_block_delta", { index: at, delta: { type: "input_json_delta", partial_json: JSON.stringify(calls[i].args) } }));
    res.write(anEvent("content_block_stop", { index: at }));
  }
  res.write(anEvent("message_delta", { delta: { stop_reason: calls.length ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } }));
  res.write(anEvent("message_stop", {}));
  finish();
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const provider = String(req.url || "").split("/")[1] || "";
    let body: any = {};
    try { body = JSON.parse(raw || "{}"); } catch { /* not JSON */ }
    if (!body.stream) {
      aux.push(provider);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(provider === "anthropic"
        ? { id: "msg_verify", type: "message", role: "assistant", model: "verify", content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } }
        : { id: "chatcmpl-verify", object: "chat.completion", created: 1, model: "verify", choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }));
      return;
    }
    const rec: Sent = { provider, body, headers: req.headers, abortedAt: 0, finished: false, abortedVirtual: 0 };
    sent.push(rec);
    res.on("close", () => { if (!rec.finished && !rec.abortedAt) { rec.abortedAt = realNow(); rec.abortedVirtual = Date.now(); } });
    const round = script.shift() || { text: ["(unscripted reply)"] };
    if (round.before) round.before();
    if (round.hang === "headers") return;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const finish = () => { rec.finished = true; res.end(); };
    if (provider === "anthropic") answerAnthropic(res, round, finish);
    else answerOpenAI(res, round, body, finish);
  });
});

// ── MeetingBrain behind fetch: meetings the size of the incident's ──────
interface Meeting { id: string; title: string; chars: number; bare?: boolean }
const INCIDENT_MEETINGS: Meeting[] = [
  { id: "32092727-51e7-454d-bfde-9b91857d1af1", title: "Morning meeting - Priorities", chars: 2138 },
  { id: "417aa41b-9e61-4120-b8e4-32e78ef746e5", title: "NatureFinance | The Content Engine", chars: 42516 },
  { id: "c2425383-0d3a-4f85-b588-985d0fe56e39", title: "Angst+Pfister meets The Content Engine", chars: 2507 },
  { id: "15509326-e4a0-4f23-b8dd-8258bf759955", title: "ITM - AI Visibility Audit -- Report-out", chars: 47538 },
  { id: "2fec861d-5630-4510-a8f9-3c8d4ffd6a86", title: "The Content Engine // Searchable Consultation", chars: 37787 },
];
/** A recorded meeting with a transcript and NO notes — nothing to stand in for it. */
const BARE: Meeting = { id: "cccccccc-0000-4000-8000-000000000003", title: "Unprocessed client call", chars: 30000, bare: true };
/** Two more long calls, for the per-turn cap on transcripts asked for by name. */
const BOARD: Meeting = { id: "dddddddd-0000-4000-8000-000000000004", title: "Board review", chars: 51760 };
const ALLHANDS: Meeting = { id: "eeeeeeee-0000-4000-8000-000000000005", title: "Quarterly all-hands", chars: 45000 };
const ALL_MEETINGS: Meeting[] = INCIDENT_MEETINGS.concat([BARE, BOARD, ALLHANDS]);
function transcriptOf(id: string, chars: number): string {
  const unit = `[${id.slice(0, 8)}] Speaker: we agreed the next step on the audit. `;
  let s = "";
  while (s.length < chars) s += unit;
  return s.slice(0, chars);
}
const SUPABASE_HOST = "verify-turn-deadline.invalid";
const strayFetches: string[] = [];
/** get_meeting_details calls answered (or left hanging). */
let mbCalls = 0;
/** When set, get_meeting_details never answers — a tool executor that hangs. */
let mbHang = false;
/** When set, each get_meeting_details call "takes" this long: the clock jumps
 *  by it before the answer comes back — a slow read straddling the window. */
let mbTakesMs = 0;
const realFetch = globalThis.fetch;
let port = 0;
const PROVIDER_ROUTES: [string, string][] = [
  ["https://api.x.ai/v1", "/xai"],
  ["https://api.anthropic.com", "/anthropic"],
  ["https://generativelanguage.googleapis.com/v1beta/openai", "/gemini"],
  ["https://api.openai.com/v1", "/openai"],
];
function installFetch() {
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url ?? input);
    for (let i = 0; i < PROVIDER_ROUTES.length; i++) {
      const from = PROVIDER_ROUTES[i][0];
      if (url.indexOf(from) === 0) return realFetch(`http://127.0.0.1:${port}${PROVIDER_ROUTES[i][1]}${url.slice(from.length)}`, init);
    }
    if (url.indexOf(SUPABASE_HOST) >= 0) {
      if (url.indexOf("/rpc/get_meeting_details") >= 0) {
        mbCalls++;
        if (mbHang) return new Promise<Response>(() => { /* never answers */ });
        if (mbTakesMs) skew += mbTakesMs;
        let id = "";
        try { id = JSON.parse(String(init?.body ?? "{}")).p_meeting_id || ""; } catch { /* none */ }
        let m: Meeting | null = null;
        for (let i = 0; i < ALL_MEETINGS.length; i++) if (ALL_MEETINGS[i].id === id) m = ALL_MEETINGS[i];
        const rows = m ? [{
          meeting_title: m.title, meeting_date: "2026-09-24T09:00:00Z", attendees: "chris@thecontentengine.com",
          summary: m.bare ? null : `Summary of ${m.title}: decisions and owners.`,
          next_steps: m.bare ? null : "Send the proposal by Friday.",
          insights: null, key_topics: m.bare ? null : ["audit"], external_summary: null,
          tasks: m.bare ? [] : [{ title: "Send proposal" }],
          transcript: transcriptOf(m.id, m.chars),
        }] : [];
        return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
      }
      const method = String(init?.method ?? "GET").toUpperCase();
      if (method !== "GET") return new Response("", { status: 201 });
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    strayFetches.push(url);
    throw new Error(`verify-turn-deadline: unexpected network call to ${url}`);
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${SUPABASE_HOST}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "verify";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "verify";
  process.env.OPENAI_API_KEY = "verify";
  process.env.XAI_API_KEY = "verify";
  process.env.ANTHROPIC_API_KEY = "verify";
  process.env.GEMINI_API_KEY = "verify";
}

// ── One turn through the real stream ────────────────────────────────────
interface TurnOutcome {
  finished: boolean;
  ms: number;
  sse: string;
  shown: string;
  error: string;
  fallback: boolean;
  done: boolean;
  completion: any | null;
  kept: string;
  /** VIRTUAL time the completion ran — when the route would write the row. */
  completedAt: number;
}
async function runTurn(providers: any, config: any, messages?: any[], watchdogMs = 10_000): Promise<TurnOutcome> {
  const t0 = realNow();
  let completion: any = null;
  let completedAt = 0;
  const stream: ReadableStream = providers.createStreamingResponse(
    messages || [{ role: "user", content: "can you review and write up my weekly summary" }],
    config,
    async (r: any) => { completion = r; completedAt = Date.now(); }
  );
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let sse = "";
  const readAll = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return true;
      sse += dec.decode(value, { stream: true });
    }
  })();
  const finished = await Promise.race([
    readAll,
    new Promise<boolean>((res) => realSetTimeout(() => res(false), watchdogMs)),
  ]);
  if (!finished) { try { await reader.cancel(); } catch { /* already gone */ } }
  // Let the fake see the client hang up before anything reads `abortedAt`.
  await realSleep(40);
  const { createSseTap } = await import("../lib/ai/turn-finaliser");
  const tap = createSseTap();
  tap.feed(sse);
  return {
    finished, ms: realNow() - t0, sse, shown: tap.text(), error: tap.error(),
    fallback: sse.indexOf('"fallback":true') >= 0, done: sse.indexOf("data: [DONE]") >= 0, completion,
    kept: completion ? String(completion.keptText) : "",
    completedAt,
  };
}

/** The tool results the LAST request carried back to the model, in order, in
 *  either provider's shape. */
function toolResults(): string[] {
  const out: string[] = [];
  const last = sent[sent.length - 1];
  const msgs: any[] = last ? (last.body.messages || []) : [];
  const text = (c: any): string => {
    if (typeof c === "string") return c;
    if (Array.isArray(c)) { let s = ""; for (let i = 0; i < c.length; i++) s += typeof c[i] === "string" ? c[i] : (c[i] && typeof c[i].text === "string" ? c[i].text : JSON.stringify(c[i])); return s; }
    return JSON.stringify(c);
  };
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "tool") out.push(text(m.content));
    if (m.role === "user" && Array.isArray(m.content)) {
      for (let j = 0; j < m.content.length; j++) if (m.content[j] && m.content[j].type === "tool_result") out.push(text(m.content[j].content));
    }
  }
  return out;
}

const LONG_NARRATION =
  "Right — to write this up properly I am reading the week's meetings alongside Rob and Gabi's notes, because the priorities " +
  "they list only make sense against what was decided in the client calls. The Siemens report-out, the NatureFinance session " +
  "and the Searchable consultation all changed what goes into next week, so they need to be read before anything is written. " +
  "That is why this takes a couple of passes rather than one.";

const CHAINS = ["grok-4-7", "claude-sonnet-5", "gemini-3.8-flash", "gpt-6-luna"];

/** In VIRTUAL time: the row was finalised by the chain before the route's
 *  backstop would have had to — real milliseconds say nothing here, because a
 *  90s stall is under a second of them. */
function beforeBackstop(out: TurnOutcome, d: { endsAt: number; startedAt: number }): [boolean, string] {
  const backstop = d.endsAt - 10_000;
  return [!!out.completion && out.completedAt > 0 && out.completedAt < backstop,
    out.completion ? `finalised at ${Math.round((out.completedAt - d.startedAt) / 1000)}s, backstop at ${Math.round((backstop - d.startedAt) / 1000)}s` : "no completion"];
}

async function main() {
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
  port = (server.address() as any).port;
  installFetch();
  quiet();
  const providers = await import("../lib/ai/providers");
  const td = await import("../lib/ai/turn-deadline");
  const fin = await import("../lib/ai/turn-finaliser");
  const tb = await import("../lib/ai/transcript-budget");
  const guard = await import("../lib/ai/tool-loop-guard");
  const runner = await import("../lib/scheduled/runner");
  loud();

  // ── 1. The budgets, as the chat route gets them ──────────────────────
  console.log("\n1. The budgets are sized to land before the platform's kill");
  {
    const t = 1_000_000;
    const d = td.deadlineForRoute(t, 300);
    check(d.hardAt - t === 275_000, "hard budget for the 300s chat route is 275s", `${(d.hardAt - t) / 1000}s`);
    check(d.writeAt - t === 225_000, "the answer window opens at 225s: 50s reserved for writing", `${(d.writeAt - t) / 1000}s`);
    check(td.backstopAt(d) - t === 290_000, "the route's backstop fires at 290s", `${(td.backstopAt(d) - t) / 1000}s`);
    check(d.softAt < d.writeAt && d.writeAt < d.hardAt && d.hardAt < td.backstopAt(d) && td.backstopAt(d) < d.endsAt, "last tool start < window < hard < backstop < the platform's kill");
    // THE WINDOW FITS THE RESCUE WRITER, measured (turn-deadline.ts header):
    // claude-sonnet-5 wrote a 2,000-token answer at 150k tokens in ≤28s,
    // gpt-6-sol in 40s — the 50s window every model but grok-4.5+ gets.
    const wGrok = td.writeAtFor(d, "grok-4.7"), wClaude = td.writeAtFor(d, "claude-sonnet-5");
    check(d.hardAt - wClaude >= 40_000 && d.hardAt - wClaude < 55_000 && wClaude === d.writeAt, "claude-sonnet-5's window holds the slowest measured writer that needs no thinking (gpt-6-sol, 40s): 225s", `${(d.hardAt - wClaude) / 1000}s`);
    // grok-4.7 MUST THINK BEFORE IT WRITES, and grok-4.3 — which does not —
    // wrote the wrong summary. So its window holds grok-4.7 at "low" reaching
    // its first word (worst of 12 replays 56s; one real rescue of thirteen
    // still silent at 60s) AND the last resort's 30s after it: 100s, from 175s.
    const resort = td.lastResortAt(d, "grok-4.7");
    check(wGrok - t === 175_000 && resort !== null && resort - wGrok >= 60_000 && d.hardAt - resort === td.LAST_RESORT_MS && td.LAST_RESORT_MS >= 30_000,
      "grok-4.7's window opens at 175s: 70s for grok-4.7 at low to start writing (worst measured 56s, one real case >60s), then 30s for the last resort", `window ${(wGrok - t) / 1000}s, last resort ${resort === null ? "none" : (resort - t) / 1000}s`);
    // THE ROUND-START POLICY, per model: a tool round starts only with its
    // measured p90 round left before ITS window.
    const lastGrok = td.lastToolRoundAt(d, "grok-4.7") - t, lastClaude = td.lastToolRoundAt(d, "claude-sonnet-5") - t;
    check(lastGrok === 87_500 && lastClaude === 190_000, "the last tool-round start: grok-4.7 87.5s (p90 round 90s, capped at half the 175s before its window), claude-sonnet-5 190s (35s before 225s)", `grok ${lastGrok / 1000}s, claude ${lastClaude / 1000}s`);
    // 2026-09-28 13:34Z: grok-4.7's round 2 started at 141s WITH TOOLS ON.
    check(td.roundPlan(d, t + 141_000, "grok-4.7") === "final", "the QA turn's round 2, started at 141s on grok-4.7, is now the tools-off answer round", td.roundPlan(d, t + 141_000, "grok-4.7"));
    check(td.roundPlan(d, t + 141_000, "claude-sonnet-5") === "tools", "the same moment still has room for a claude-sonnet-5 tool round");
    check(td.roundPlan(d, t + 87_499, "grok-4.7") === "tools" && td.roundPlan(d, wGrok - 1, "grok-4.7") === "final" && td.roundPlan(d, wGrok, "grok-4.7") === "rescue", "grok-4.7: tools → answer round → rescue, at its last start and at its window");
    check(td.roundPlan(d, t + 189_999, "claude-sonnet-5") === "tools" && td.roundPlan(d, wClaude - 1, "claude-sonnet-5") === "final" && td.roundPlan(d, wClaude, "claude-sonnet-5") === "rescue", "claude-sonnet-5: the same, at 190s and 225s");
    check(td.roundPlan(d, d.hardAt - td.MIN_FINAL_ROUND_MS + 1, "grok-4.7") === "none", "and no request at all when even the rescue cannot land");
    check(d.softAt === td.lastToolRoundAt(d, null) && d.softAt - t === 135_000, "a caller that names no model: the slowest p90 round (90s) before the 50s window — 135s");
    const short = td.deadlineForRoute(t, 120);
    check(short.hardAt - t === 95_000 && td.lastToolRoundAt(short, "claude-sonnet-5") > t + 30_000 && short.writeAt - t > 60_000, "a 120s route still gets tool rounds and a window, and stops at 95s", `last start ${(td.lastToolRoundAt(short, "claude-sonnet-5") - t) / 1000}s window ${(short.writeAt - t) / 1000}s hard ${(short.hardAt - t) / 1000}s`);
    // A 120s route cannot hold grok-4.7's thinking: its window is capped at 40%
    // of the route, and once it is open the answer is the last resort's.
    const shortStep = td.answerStep(short, td.writeAtFor(short, "grok-4.7"), "grok-4.7", 0);
    check(short.hardAt - td.writeAtFor(short, "grok-4.7") === 38_000 && !!shortStep && shortStep.writer.model === "grok-4.3" && shortStep.writer.reasoningEffort === "none",
      "on a 120s route grok-4.7's window is capped (38s of 95), and the answer at it goes to the last resort", `window ${(short.hardAt - td.writeAtFor(short, "grok-4.7")) / 1000}s, ${shortStep ? `${shortStep.writer.model} ${shortStep.writer.reasoningEffort}` : "none"}`);
    check(td.canStartFallback(d, t + 87_499, "grok-4.7") && !td.canStartFallback(d, t + 87_500, "grok-4.7") && td.canStartFallback(d, t + 180_000, "claude-sonnet-5"), "a fallback starts only while ITS model can still run a tool round");
    check(!td.toolTooLate(d, d.hardAt - td.MIN_FINAL_ROUND_MS) && td.toolTooLate(d, d.hardAt - td.MIN_FINAL_ROUND_MS + 1), "a generator stops being started when no request could follow it");
    check(!td.toolTooLate(d, d.writeAt - 1, "query_meetingbrain", "claude-sonnet-5") && td.toolTooLate(d, d.writeAt, "query_meetingbrain", "claude-sonnet-5") && !td.toolTooLate(d, d.writeAt, "generate_slides", "claude-sonnet-5"), "a LOOKUP stops being started when the window opens; a generator does not");
    check(!td.toolTooLate(d, wGrok - 1, "query_meetingbrain", "grok-4.7") && td.toolTooLate(d, wGrok, "query_meetingbrain", "grok-4.7"), "…at the TURN's window: 175s on grok-4.7");
    // THE ANSWER STEPS (answerStep), grok-4.7 and the others.
    const st = (now: number, model: string, from: number) => {
      const x = td.answerStep(d, t + now, model, from);
      return x ? `${x.stage}:${x.writer.model}/${x.writer.reasoningEffort || "own"}/${x.cutAt === null ? "hard" : (x.cutAt - t) / 1000}${x.named ? "/named" : ""}` : "none";
    };
    const ladder = [
      [st(50_000, "grok-4.7", 0), "0:grok-4.7/own/175"],
      [st(141_000, "grok-4.7", 0), "1:grok-4.7/low/245/named"],
      [st(185_000, "grok-4.7", 1), "1:grok-4.7/low/245/named"],
      [st(224_999, "grok-4.7", 1), "1:grok-4.7/low/245/named"],
      [st(226_000, "grok-4.7", 0), "2:grok-4.3/none/hard/named"],
      [st(245_000, "grok-4.7", 2), "2:grok-4.3/none/hard/named"],
      [st(256_000, "grok-4.7", 0), "none"],
      [st(200_000, "claude-sonnet-5", 0), "0:claude-sonnet-5/own/225"],
      [st(225_000, "claude-sonnet-5", 0), "1:claude-sonnet-5/own/hard/named"],
      [st(225_000, "claude-opus-5-5", 0), "1:claude-sonnet-5/own/hard/named"],
      [st(200_000, "claude-opus-5-5", 1), "1:claude-sonnet-5/own/hard/named"],
    ];
    const wrong: string[] = [];
    for (let i = 0; i < ladder.length; i++) if (ladder[i][0] !== ladder[i][1]) wrong.push(`${ladder[i][1]} → got ${ladder[i][0]}`);
    check(wrong.length === 0, "the answer steps: grok-4.7 at its own setting only while a tool round could start, then grok-4.7 at low until 225s (cut at 245s), then grok-4.3; Sonnet/Opus as before", wrong.join("; "));
    // NOTHING PROMISES A NEXT TURN (tool-loop-guard.ts struck "it WILL be
    // fetched" for the same reason): every line the clock can write, checked.
    const cuts: any[] = [
      { kind: "soft" }, { kind: "hard" }, { kind: "hard", tool: "generate_slides" },
      { kind: "hard", tool: "generate_slides", unstarted: true }, { kind: "hard", tool: "query_meetingbrain", unstarted: true },
    ];
    const promises: string[] = [];
    for (let i = 0; i < cuts.length; i++) {
      for (let a = 0; a < 2; a++) {
        const line = td.turnDeadlineNotice(cuts[i], a === 1);
        if (/will be fetched|will be read|will fit|will be (created|built)/.test(line)) promises.push(line.slice(0, 120));
      }
    }
    check(promises.length === 0, "no deadline line guarantees what a follow-up will get", promises.join(" | "));
  }

  // ── 1b. What the installed SDKs actually do with an abort ────────────
  // The two facts the first version of this check got wrong, pinned against
  // the installed packages so an SDK upgrade that changes them is noticed.
  console.log("\n1b. The installed SDKs' abort behaviour (the reason this check uses them)");
  {
    const OpenAI = (await import("openai")).default;
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    check(new (OpenAI as any).APIUserAbortError().name === "Error" && new (Anthropic as any).APIUserAbortError().name === "Error",
      "both SDKs name their abort error \"Error\" — a test on the NAME can never recognise it");
    // Through the real OpenAI client: a stream whose signal aborts mid-way ENDS.
    const ac = new AbortController();
    const client = new OpenAI({ apiKey: "verify", baseURL: "https://api.x.ai/v1" });
    newTurnScript([{ text: ["Half a sentence "], hang: "stream" }]);
    const s: any = await client.chat.completions.create({ model: "verify", messages: [{ role: "user", content: "x" }], stream: true } as any, { signal: ac.signal });
    let threw = false;
    let chunks = 0;
    realSetTimeout(() => ac.abort(), 60);
    try { for await (const _c of s) { void _c; chunks++; } } catch { threw = true; }
    check(!threw && chunks > 0, "OpenAI's Stream RETURNS on an abort mid-stream rather than throwing — so an abort the chain does not catch itself looks like a finished round", `threw=${threw} chunks=${chunks}`);
  }

  const BASE = { systemPrompt: "You are terse.", maxTokens: 4096, webSearch: false, imageGeneration: false, source: "verify-turn-deadline" };
  const MB_CONFIG = { userEmail: "chris@thecontentengine.com", conversationVisibility: "private", workspaceId: "verify-ws" };

  // ── 2. xAI: past SOFT, the next request is the answer with tools off ──
  console.log("\n2. xAI — past the soft budget no further tool round starts (the 8479ea99 shape)");
  {
    const deadline = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      // Round 0: long narration and a tool call, and the round "takes" until
      // 170s — the incident's round 3 began at 184s; 170s is past grok-4.7's
      // last tool-round start (87.5s) and still before its window (175s), so
      // the call is written and RUN, and nothing else may start.
      { text: [LONG_NARRATION], toolCalls: [{ name: "query_content_score", args: { text: "A short draft to score." } }], before: () => clockTo(deadline.startedAt, 170_000) },
      // Whatever comes next must be the final answer — the fake answers it.
      { text: ["Here is the weekly summary: three client calls, two proposals out."] },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-soft-1", turnDeadline: deadline });
    loud();
    check(out.finished, "the turn finished", `${out.ms}ms`);
    check(sent.length === 2, "exactly two requests: the tool round and the answer", `${sent.length}`);
    const second = sent[1];
    check(!!second && second.body.tool_choice === "none", "the second request is the forced final, tool_choice none", JSON.stringify(second && second.body.tool_choice));
    check(!!out.completion, "the completion ran — the route would have finalised the row");
    check(out.kept.indexOf("Here is the weekly summary") >= 0, "the answer is on the saved row");
    // At 170s the answer is grok-4.7's at "low": its own effort is not the
    // answer round this late (single answer round p90 167s).
    check(!!second && second.body.model === "grok-4.7" && second.body.reasoning_effort === "low", "the answer is asked of grok-4.7 at reasoning effort low", second ? `${second.body.model} ${second.body.reasoning_effort}` : "none");
    check(out.kept.indexOf("Written quickly at this turn's time limit") >= 0 && out.kept.indexOf("written by Grok 4.7 at low reasoning effort") >= 0, "and the row says it was written quickly, by Grok 4.7 at low reasoning effort", out.kept.slice(-240));
    check(!out.fallback, "no provider fallback was started");
    check(out.done, "the stream closed with [DONE]");
    // THE CACHE KEY, read off the wire: every request of the turn, the final one too.
    let headed = 0;
    for (let i = 0; i < sent.length; i++) if (sent[i].headers["x-grok-conv-id"] === "conv-soft-1") headed++;
    check(headed === sent.length && sent.length > 0, "every xAI request arrives with the header x-grok-conv-id = the conversation id", `${headed} of ${sent.length}`);
    // The final pass is BILLED: both requests' usage is on the row (the fake
    // reports 1,000 prompt tokens and 10 out, and only when asked).
    check(!!out.completion && out.completion.inputTokens === 2000 && out.completion.outputTokens === 20, "the forced final's tokens reach the ledger row", out.completion ? `in=${out.completion.inputTokens} out=${out.completion.outputTokens}` : "no completion");

    // The build-now warning still goes out, on the round that starts in the
    // last WARN_LEAD_MS before soft — the one round that can still build.
    const dw = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: ["Reading."], toolCalls: [{ name: "query_content_score", args: { text: "x" } }], before: () => clockTo(dw.startedAt, td.lastToolRoundAt(dw, "grok-4.7") - dw.startedAt - 40_000) },
      { text: ["Built."] },
    ]);
    quiet();
    await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-warn", turnDeadline: dw });
    loud();
    const warnedMsgs = sent[1] ? sent[1].body.messages : [];
    let warned = false;
    for (let i = 0; i < warnedMsgs.length; i++) if (warnedMsgs[i].role === "user" && String(warnedMsgs[i].content).indexOf("Build any artefact you have promised NOW") >= 0) warned = true;
    check(warned && sent.length === 2 && sent[1].body.tool_choice !== "none", "a round starting 40s before grok-4.7's last tool-round start is warned to build, with its tools still on");
  }

  // ── 3. HARD, mid-stream, on every chain ──────────────────────────────
  // A tool round that starts inside soft (160s) and is still writing at 275s.
  // It DRIPS, so it is never silent: only the deadline can end it.
  console.log("\n3. Every chain — a round still streaming at the hard budget is aborted, and the turn keeps its text");
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    clockTo(d.startedAt, 160_000);
    newTurnScript([{ text: ["Here is the first half of the weekly summary. Siemens: report-out delivered. "], hang: "drip" }]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model, conversationId: `conv-hard-${model}`, turnDeadline: d });
    loud();
    const [inTime3, when3] = beforeBackstop(out, d);
    check(out.finished && inTime3, `${model}: the turn was finalised at the hard budget, before the backstop and the platform's kill`, when3);
    check(sent.length === 1 && sent[0].abortedAt > 0, `${model}: the provider request was ABORTED (the fake saw the client hang up)`, `${sent.length} requests, abortedAt=${sent[0] && sent[0].abortedAt}`);
    check(!!out.completion, `${model}: the completion ran — the row is finalised, not failed`, out.error);
    check(out.kept.indexOf("Here is the first half") >= 0, `${model}: what was written before the abort is on the row`);
    check(out.kept.indexOf('say "continue" and it will pick up from there') >= 0, `${model}: and one line says it was cut off and how to continue`, out.kept.slice(-220));
    check(!out.fallback, `${model}: no fallback leg was started at 275s`);
    check(sent[0] && sent[0].abortedVirtual >= d.hardAt - 1_000, `${model}: a round WRITING its answer is not cut at the window — at HARD`, sent[0] ? `cut at ${Math.round((sent[0].abortedVirtual - d.startedAt) / 1000)}s` : "none");
  }

  // ── 3b. HARD while a deck is being written ───────────────────────────
  console.log("\n3b. Every chain — a deck still being written at the window is NOT cut there; at the hard budget it is named as not created");
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    // 80s: a tool round on every chain (grok-4.7's last start is 87.5s).
    clockTo(d.startedAt, 80_000);
    newTurnScript([{ text: ["Building the weekly deck now. "], hang: "drip-tool" }]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model, conversationId: `conv-deck-${model}`, turnDeadline: d });
    loud();
    check(out.finished && !!out.completion && out.kept.indexOf("the deck was still being written, so it was not created") >= 0, `${model}: the row says the deck was not created`, out.completion ? out.kept.slice(-200) : `no completion: ${out.error}`);
    const [inTime3b, when3b] = beforeBackstop(out, d);
    check(inTime3b, `${model}:   …finalised before the backstop`, when3b);
    // A DECK BEING WRITTEN IS THE ANSWER: the window does not cut it, and no
    // rescue writer is sent to write prose over it.
    check(sent.length === 1 && sent[0].abortedVirtual >= d.hardAt - 1_000, `${model}:   …it ran through the window and was cut at HARD, with no rescue request`, `${sent.length} requests, cut at ${Math.round((sent[0].abortedVirtual - d.startedAt) / 1000)}s`);
  }

  // ── 3c. HARD after a billed round: its usage still reaches the ledger ─
  console.log("\n3c. Every chain — a cut in round 1 keeps round 0's usage for the ledger");
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: ["Scoring the draft first. "], toolCalls: [{ name: "query_content_score", args: { text: "A short draft." } }], before: () => clockTo(d.startedAt, 150_000) },
      { text: ["Here is the summary so far: Siemens delivered. "], hang: "drip" },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model, conversationId: `conv-multi-${model}`, turnDeadline: d });
    loud();
    check(out.finished && !!out.completion && out.completion.inputTokens === 1000 && out.completion.outputTokens >= 10, `${model}: the completion carries round 0's billed tokens`, out.completion ? `in=${out.completion.inputTokens} out=${out.completion.outputTokens}` : `no completion: ${out.error}`);
    check(out.kept.indexOf("Here is the summary so far") >= 0 && out.kept.indexOf("Cut off at this turn's time limit") >= 0, `${model}: round 1's partial text and the cut-off line are on the row`, out.kept.slice(-200));
  }

  // ── 4. HARD while still waiting for the headers ──────────────────────
  console.log("\n4. Every chain — a request whose headers never come is cut at the hard budget");
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    // 240s: past soft, so the first request is the tools-off answer, 35s
    // before hard — a legitimate start — and then nothing comes back.
    clockTo(d.startedAt, 240_000);
    newTurnScript([{ hang: "headers" }]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model, conversationId: `conv-headers-${model}`, turnDeadline: d });
    loud();
    const [inTime4, when4] = beforeBackstop(out, d);
    check(out.finished && inTime4, `${model}: the turn was finalised before the backstop`, when4);
    check(sent.length === 1 && sent[0].abortedAt > 0, `${model}: the waiting request was cancelled by its deadline signal`);
    check(!!out.completion, `${model}: the completion ran — not thrown away as a provider failure`, out.error);
    check(out.kept.indexOf("Out of time") >= 0, `${model}: a turn with nothing written says it ran out of time`, out.completion ? out.kept.slice(0, 200) : out.error);
    check(!out.fallback, `${model}: and does not start a fallback it has no time for`);
  }
  // The same wait on a TOOL round: started at 60s, the SDK request is the
  // only thing waiting, and only its signal can end it — at grok-4.7's WINDOW
  // now, so the rescue writer still has the time to answer.
  {
    const d = td.deadlineForRoute(Date.now(), 300);
    clockTo(d.startedAt, 60_000);
    newTurnScript([{ hang: "headers" }, { text: ["Answer written after the wait."] }]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-headers-tools", turnDeadline: d });
    loud();
    check(out.finished && sent.length === 2 && sent[0].abortedAt > 0 && Math.abs(sent[0].abortedVirtual - td.writeAtFor(d, "grok-4.7")) < WINDOW_SLACK_MS, "grok-4-7: a TOOL round waiting from 60s for headers is cut at grok-4.7's window (175s)", sent[0] ? `cut at ${Math.round((sent[0].abortedVirtual - d.startedAt) / 1000)}s, ${sent.length} requests` : "none");
    check(!!out.completion && out.kept.indexOf("Answer written after the wait.") >= 0, "and the rescue writer's answer is on the row", out.completion ? out.kept.slice(0, 200) : out.error);
  }

  // ── 5. SOFT on the other chains ──────────────────────────────────────
  console.log("\n5. Every chain — past its last tool-round start, the next request is the tools-off answer");
  for (let c = 1; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      // 200s: past every chain's last tool-round start (claude 190s, gemini
      // and gpt 185s), before the window.
      { text: [LONG_NARRATION], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d.startedAt, 200_000) },
      { text: ["Answer from what was gathered."] },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model, conversationId: `conv-soft-${model}`, turnDeadline: d });
    loud();
    const tc = sent[1] ? sent[1].body.tool_choice : undefined;
    const off = model === "claude-sonnet-5" ? !!tc && tc.type === "none" : tc === "none";
    check(sent.length === 2 && off, `${model}: past its last tool-round start, the next request is the tools-off answer`, `${sent.length} requests, tool_choice ${JSON.stringify(tc)}`);
    check(out.kept.indexOf("Answer from what was gathered.") >= 0 && out.kept.indexOf("Stopped looking things up") >= 0, `${model}: the answer and the soft notice are on the row`, out.kept.slice(-160));
  }

  // ── 6. The tools-off final answer is itself bounded ──────────────────
  console.log("\n6. Every chain — the final answer after a soft cut is itself cut at the hard budget");
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      // A tool round that ends at 235s: past soft, with 40s left — room for
      // a final answer, which then writes half a sentence and goes quiet.
      { text: ["Checking the draft. "], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d.startedAt, 235_000) },
      { text: ["The weekly summary begins: Siemens report-out delivered, NatureFinance "], hang: "stream" },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model, conversationId: `conv-final-${model}`, turnDeadline: d });
    loud();
    const [inTime6, when6] = beforeBackstop(out, d);
    check(out.finished && inTime6, `${model}: the turn was finalised before the backstop — cut at hard, not by the 90s stall guard after it`, when6);
    check(sent.length === 2 && sent[1].abortedAt > 0, `${model}: the final answer's request was aborted`);
    check(out.kept.indexOf("The weekly summary begins") >= 0 && out.kept.indexOf('say "continue"') >= 0, `${model}: the partial answer and the CUT-OFF line are on the row`, out.kept.slice(-200));
    check(out.kept.indexOf("the answer above uses what was gathered") < 0, `${model}: not the soft line, which would call a half sentence a complete answer`);
  }

  // ── 7. A provider error mid-stream: stated, never left pending ───────
  console.log("\n7. A provider error mid-stream is stated on the row");
  {
    // Past soft: no time for a whole second turn on another provider.
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([{ text: ["Here is what I have so far. "], error: "The model is currently at capacity due to high demand.", before: () => clockTo(d.startedAt, 200_000) }]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-err-1", turnDeadline: d });
    loud();
    check(out.finished, "the turn finished");
    check(!out.fallback && sent.length === 1, "past soft, the failure is not handed to a fallback that cannot finish", `${sent.length} requests`);
    check(out.completion === null && out.error.indexOf("at capacity") >= 0, "the stream carries the provider's error", out.error);
    // What the route's safety net writes, from what the route's tap read.
    const row = fin.failedRow(out.shown, out.error);
    check(row.status_message === "failed", "the row is finalised as a failure, not left pending");
    check(row.document_message.indexOf("Here is what I have so far.") >= 0 && row.document_message.indexOf("at capacity") >= 0, "it keeps what was shown and says what failed", row.document_message);

    // A soft cut whose tools-off answer fails on its own account gets ONE
    // more try, from the rescue writer — the answer is what the turn owes.
    const d5 = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: [LONG_NARRATION], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d5.startedAt, 181_000) },
      { error: "The model is currently at capacity due to high demand." },
      { text: ["The summary, from the rescue writer."] },
    ]);
    quiet();
    const out5 = await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-soft-retry", turnDeadline: d5 });
    loud();
    check(sent.length === 3 && sent[1].body.model === "grok-4.7" && sent[1].body.reasoning_effort === "low" && sent[2].body.model === "grok-4.3" && sent[2].body.reasoning_effort === "none" && !!out5.completion && out5.kept.indexOf("The summary, from the rescue writer.") >= 0,
      "an answer round (grok-4.7 at low) that fails is followed by the last resort (grok-4.3 at none), which answers", `${sent.length} requests: ${sent.map((x) => `${x.body.model}/${x.body.reasoning_effort}`).join(", ")}`);
    // And when that fails too, the row must not vouch for an "answer above"
    // that never came — nor call a provider failure running out of time.
    const d4 = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: [LONG_NARRATION], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d4.startedAt, 181_000) },
      { error: "The model is currently at capacity due to high demand." },
      { error: "The model is currently at capacity due to high demand." },
    ]);
    quiet();
    const out4 = await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-soft-fail", turnDeadline: d4 });
    loud();
    check(!!out4.completion && out4.kept.indexOf("the answer that should have followed did not arrive") >= 0 && out4.kept.indexOf("the answer above uses what was gathered") < 0 && out4.kept.indexOf("Out of time") < 0,
      "a soft cut whose answer then failed says so, and does not vouch for an answer above or blame the clock", out4.completion ? out4.kept.slice(-200) : out4.error);

    // Before soft, the fallback still runs — the gate is on time, not on error.
    const d2 = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { error: "The model is currently at capacity due to high demand.", before: () => clockTo(d2.startedAt, 5_000) },
      { text: ["Claude answered instead."] },
    ]);
    quiet();
    const out2 = await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-err-2", turnDeadline: d2 });
    loud();
    check(out2.fallback && out2.kept.indexOf("Claude answered instead.") >= 0, "before soft, a failed leg still falls back and answers", out2.error);
    // The gate reads the FALLBACK's model: at 180s grok-4.7 could not start a
    // tool round (its last start is 135s), but Claude, the leg xAI falls back
    // to, still can (190s) — so the fallback runs.
    const d6 = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { error: "The model is currently at capacity due to high demand.", before: () => clockTo(d6.startedAt, 180_000) },
      { text: ["Claude answered at 180s."] },
    ]);
    quiet();
    const out6 = await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-err-180", turnDeadline: d6 });
    loud();
    check(out6.fallback && out6.kept.indexOf("Claude answered at 180s.") >= 0, "at 180s an xAI failure still falls back to Claude, whose tool round still fits", `fallback=${out6.fallback} ${out6.error}`);

    // The same gate on the other two fallback paths: Claude→Grok, and the
    // shared withGrokFallback the Gemini and OpenAI chains run through.
    for (const model of ["claude-sonnet-5", "gemini-3.8-flash"]) {
      const d3 = td.deadlineForRoute(Date.now(), 300);
      newTurnScript([
        { text: ["Partial. "], error: "overloaded", before: () => clockTo(d3.startedAt, 200_000) },
        { text: ["A fallback leg that should never have started."] },
      ]);
      quiet();
      const out3 = await runTurn(providers, { ...BASE, model, conversationId: `conv-err-${model}`, turnDeadline: d3 });
      loud();
      check(!out3.fallback && sent.length === 1 && out3.error.indexOf("overloaded") >= 0, `${model}: past soft, a failure is stated, not handed to a fallback`, `${sent.length} requests, fallback=${out3.fallback}, error=${out3.error.slice(0, 80)}`);
    }
  }

  // ── 7b. No tool call starts once nothing could follow it ─────────────
  console.log("\n7b. Every chain — a tool call written after the last useful moment is not started");
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    const before = mbCalls;
    newTurnScript([
      { text: ["Opening the ITM report-out. "], toolCalls: [{ name: "query_meetingbrain", args: { report: "meeting_details", meeting_id: INCIDENT_MEETINGS[3].id } }], before: () => clockTo(d.startedAt, 262_000) },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, ...MB_CONFIG, model, conversationId: `conv-late-${model}`, turnDeadline: d });
    loud();
    check(mbCalls === before, `${model}: the MeetingBrain call written at 262s was never started`, `${mbCalls - before} calls`);
    check(out.finished && sent.length === 1 && !!out.completion && out.kept.indexOf("Out of time") >= 0, `${model}: the turn finalises at once and says it ran out of time`, out.completion ? out.kept.slice(-200) : out.error);
  }
  {
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      // The deck, and a lookup written after it in the same batch: the line
      // must name what the user asked for, not the lookup beside it.
      { text: ["Building the deck. "], toolCalls: [
        { name: "generate_slides", args: { title: "Weekly summary", slides: [{ layout: "title", title: "Week 39" }] } },
        { name: "query_meetingbrain", args: { report: "meeting_details", meeting_id: INCIDENT_MEETINGS[0].id } },
      ], before: () => clockTo(d.startedAt, 262_000) },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, ...MB_CONFIG, model: "grok-4-7", conversationId: "conv-late-deck", turnDeadline: d });
    loud();
    check(out.kept.indexOf("too little of this turn was left to build the deck, so it was not started") >= 0, "a deck call written at 262s is named as never started, over a lookup skipped after it", out.kept.slice(-200));
  }

  // ── 8. The scheduled runner: never hangs on a turn that died ─────────
  console.log("\n8. The scheduled runner finishes when the turn dies, and runs on its caller's clock");
  const task: any = {
    id_prompt: "verify-task", id_workspace: "verify-ws", user_created: 1, email_user: "chris@thecontentengine.com",
    name_title: "Weekly brief", document_prompt: "Summarise the ITM report-out meeting", type_task: "brief",
    name_model: "grok-4-7", id_client: null, config_context: null, flag_email: 0, id_conversation: null,
  };
  {
    // Both legs fail: xAI, then (before soft) the Claude fallback.
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { error: "xAI down", before: () => clockTo(d.startedAt, 1_000) },
      { error: "Anthropic down" },
    ]);
    quiet();
    const r = await Promise.race([
      runner.runScheduledPrompt(task, { deadline: d }),
      new Promise<null>((res) => realSetTimeout(() => res(null), 8_000)),
    ]);
    loud();
    check(r !== null, "the run returned instead of waiting for a completion that never comes");
    check(!!r && (r as any).status === "failed", "and returned as failed, so its run row is closed", r ? (r as any).status : "hung");
    check(!!r && String((r as any).error || "").indexOf("Anthropic down") >= 0, "with the provider's own error, not a generic line", r ? String((r as any).error) : "hung");

    // Its deadline reaches the chain: started past soft, the first request is
    // already the tools-off answer.
    const late = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([{ text: ["Brief from what is known."] }]);
    clockTo(late.startedAt, 200_000);
    quiet();
    await Promise.race([
      runner.runScheduledPrompt(task, { deadline: late }),
      new Promise<null>((res) => realSetTimeout(() => res(null), 8_000)),
    ]);
    loud();
    check(sent.length >= 1 && sent[0].body.tool_choice === "none", "a run whose caller is past soft makes no tool round", `${sent.length} requests, first tool_choice ${JSON.stringify(sent[0] && sent[0].body.tool_choice)}`);
  }
  // THE RESCUE REACHES THE RUNNER TOO: a scheduled grok-4-7 run whose tool
  // round is still thinking at the window is cut there, and the rescue writer
  // is asked for the brief — the same chain code, on the caller's clock.
  {
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: ["Reading."], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d.startedAt, 60_000) },
      { text: [], hang: "think" },
      { text: ["Brief: the ITM report-out landed; two proposals out this week."] },
    ]);
    quiet();
    const r = await Promise.race([
      runner.runScheduledPrompt(task, { deadline: d }),
      new Promise<null>((res) => realSetTimeout(() => res(null), 8_000)),
    ]);
    loud();
    check(r !== null && sent.length === 3 && Math.abs(sent[1].abortedVirtual - td.writeAtFor(d, "grok-4.7")) < WINDOW_SLACK_MS && sent[2].body.model === "grok-4.7" && sent[2].body.reasoning_effort === "low" && sent[2].body.tool_choice === "none",
      "a scheduled run's thinking round is cut at the window and the rescue writer is asked for the brief", `${sent.length} requests: ${sent.map((x) => x.body.model).join(", ")}${sent[1] ? `, cut at ${Math.round((sent[1].abortedVirtual - d.startedAt) / 1000)}s` : ""}`);
  }
  // A TOOL EXECUTOR THAT HANGS: the chain cannot abort it, the stream never
  // ends and no completion comes. The runner's own backstop is all there is.
  {
    const t0 = Date.now();
    const d = td.createTurnDeadline({ startedAt: t0, endsAt: t0 + 120_000 });
    const before = mbCalls;
    mbHang = true;
    newTurnScript([{ text: ["Reading the meeting. "], toolCalls: [{ name: "query_meetingbrain", args: { report: "meeting_details", meeting_id: INCIDENT_MEETINGS[3].id } }] }]);
    quiet();
    const r = await Promise.race([
      runner.runScheduledPrompt(task, { deadline: d }),
      new Promise<null>((res) => realSetTimeout(() => res(null), 8_000)),
    ]);
    const at = Date.now();
    loud();
    mbHang = false;
    check(mbCalls > before, "the run reached a MeetingBrain call that never answers", `${mbCalls - before} calls`);
    check(r !== null, "the run RETURNED although a tool executor never did");
    check(!!r && (r as any).status === "failed" && at < d.endsAt, "as failed, before its caller's ceiling — so the cron can close the run row", r ? `${(r as any).status} at ${Math.round((at - t0) / 1000)}s of 120s` : "hung");
    check(!!r && String((r as any).error || "").indexOf("Cut off at this turn's time limit") >= 0 && String((r as any).error || "").indexOf("Reading the meeting.") >= 0, "and says it was cut off, with what it had streamed", r ? String((r as any).error).slice(0, 200) : "hung");
  }

  // ── 9. The route's last resort ───────────────────────────────────────
  console.log("\n9. The route's backstop and the row it writes");
  {
    // In VIRTUAL time: the backstop is meant to fire 3s after it is armed.
    const now = Date.now();
    const d = td.createTurnDeadline({ startedAt: now, endsAt: now + td.BACKSTOP_RESERVE_MS + 3_000 });
    let fired = 0;
    fin.armBackstop(d, () => { fired = Date.now() - now; });
    await realSleep(300);
    check(fired >= 2_900 && fired < 8_000, "the backstop fires at its instant", `${fired}ms after arming, virtual`);
    let cancelled = true;
    const cancel = fin.armBackstop(td.createTurnDeadline({ startedAt: Date.now(), endsAt: Date.now() + td.BACKSTOP_RESERVE_MS + 2_000 }), () => { cancelled = false; });
    cancel();
    await realSleep(300);
    check(cancelled, "and not once the turn has finished (cancelled)");
    const shownRow = fin.backstopRow("Half a deck plan.");
    check(shownRow.status_message === "failed" && shownRow.document_message.indexOf("Half a deck plan.") === 0 && shownRow.document_message.indexOf("Cut off at this turn's time limit") > 0, "the backstop row keeps what was shown and says it was cut off");
    check(fin.backstopRow("").document_message.indexOf("---") !== 0, "with nothing shown it is the note alone, without a stray rule");
    // The tap reads what the user saw: split frames, and a fallback resets it.
    const tap = fin.createSseTap();
    tap.feed('data: {"token":"Gro'); tap.feed('k says hi"}\n\n');
    tap.feed('data: {"fallback":true,"reason":"x"}\n\ndata: {"token":"Claude"}\n\n');
    check(tap.text() === "Claude", "the tap keeps a frame split across reads and restarts at a fallback", JSON.stringify(tap.text()));
    // A dead row is dead only past the platform's own kill.
    const created = new Date(realNow() - 300_000).toISOString();
    check(!fin.isDeadPending({ role_message: "assistant", status_message: "pending", date_created: created }, realNow()), "a 300s-old pending row is NOT reaped (it may still be finishing)");
    check(fin.isDeadPending({ role_message: "assistant", status_message: "pending", date_created: "2026-09-28T08:48:41.388768+00:00" }, Date.parse("2026-09-28T09:30:00Z")), "8479ea99's row, 41 minutes old, IS reaped");
    check(fin.reapedRow("").document_message === fin.REAPED_TEXT && /Retry/.test(fin.REAPED_TEXT), "a reaped row says what happened and to retry");
    check(fin.STALE_PENDING_MS > 300_000, "the reaper waits past the route's 300s ceiling", `${fin.STALE_PENDING_MS}`);
    // PRESENCE ONLY — the route cannot be driven here (see the header).
    const route = readFileSync(join(__dirname, "../app/api/ai/conversations/[id]/messages/route.ts"), "utf8");
    check(/const turnDeadline = deadlineForRoute\(Date\.now\(\), maxDuration\);/.test(route) && route.indexOf("export async function POST") < route.indexOf("const turnDeadline = deadlineForRoute"), "(presence) the route starts the clock at the top of POST");
    check(/allowPersonalData: true,[\s\S]{0,200}turnDeadline \};/.test(route), "(presence) the route hands its deadline to the chains");
    check(/armBackstop\(turnDeadline,/.test(route) && /cancelBackstop\(\);/.test(route), "(presence) the route arms the backstop and cancels it when the stream ends");
    check(/\.update\(failedRow\(tap\.text\(\), tap\.error\(\)\)\)/.test(route) && /\.update\(backstopRow\(tap\.text\(\)\)\)/.test(route), "(presence) both last-resort writes use the shared rows");
    const getRoute = readFileSync(join(__dirname, "../app/api/ai/conversations/[id]/route.ts"), "utf8");
    check(/isDeadPending\(m, nowMs\)/.test(getRoute) && /reapedRow\(m\.document_message\)/.test(getRoute), "(presence) reopening a thread reaps with the shared predicate");
  }

  // ── 10. The transcript allowance, through the real MeetingBrain path ──
  // On EVERY chain: each has its own executor, and each has to hand the
  // budget over and write the notice itself.
  console.log("\n10. Every chain — meeting transcripts past the turn's allowance come back as notes");
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    const calls: { name: string; args: any }[] = [];
    for (let i = 0; i < INCIDENT_MEETINGS.length; i++) calls.push({ name: "query_meetingbrain", args: { report: "meeting_details", meeting_id: INCIDENT_MEETINGS[i].id } });
    // Last, past the allowance: a meeting that is ONLY a transcript.
    calls.push({ name: "query_meetingbrain", args: { report: "meeting_details", meeting_id: BARE.id } });
    newTurnScript([
      { text: ["Reading the week's meetings."], toolCalls: calls, before: () => clockTo(d.startedAt, 3_000) },
      { text: ["Weekly summary written from the meetings."], before: () => clockTo(d.startedAt, 40_000) },
    ]);
    const logStart = logs.length;
    quiet();
    const out = await runTurn(providers, { ...BASE, ...MB_CONFIG, model, conversationId: `conv-mb-${model}`, turnDeadline: d });
    loud();
    const tr = toolResults();
    check(out.finished && sent.length === 2 && tr.length === 6, `${model}: the turn ran both rounds and six meeting results went back`, `${sent.length} requests, ${tr.length} results`);
    const has = (i: number, s: string) => !!tr[i] && tr[i].indexOf(s) >= 0;
    const whole = [0, 1, 2];
    let wholeOk = true;
    for (let k = 0; k < whole.length; k++) if (!has(whole[k], transcriptOf(INCIDENT_MEETINGS[whole[k]].id, 400)) || has(whole[k], "TRANSCRIPT NOT INCLUDED")) wholeOk = false;
    check(wholeOk, `${model}: the first three meetings (47,161 chars together) are read in full`);
    const held = [3, 4];
    for (let k = 0; k < held.length; k++) {
      const i = held[k];
      const m = INCIDENT_MEETINGS[i];
      check(has(i, "TRANSCRIPT NOT INCLUDED") && !has(i, transcriptOf(m.id, 400)), `${model}: "${m.title}" (${m.chars} chars) comes back without its transcript`);
      check(has(i, `Summary of ${m.title}`) && has(i, "Send the proposal by Friday."), `${model}:   …with its summary and next steps`);
      check(/"transcript_status":\s*"withheld_turn_budget"/.test(tr[i] || "") && new RegExp(`"transcript_chars":\\s*${m.chars}\\b`).test(tr[i] || ""), `${model}:   …labelled WITHHELD with its size, never 'none'`);
      check(has(i, guard.OUR_LIMIT_CUT_IT_SHORT) && has(i, guard.DO_NOT_BLAME_THE_SOURCE), `${model}:   …and told the limit is OURS, in the shared wording, verbatim`);
    }
    // NOTHING TO STAND IN FOR IT: a meeting that is only a transcript comes
    // back whole, allowance or not — withheld, it would be an empty record.
    check(has(5, transcriptOf(BARE.id, 400)) && !has(5, "TRANSCRIPT NOT INCLUDED") && /"transcript_status":\s*"full"/.test(tr[5] || ""), `${model}: a meeting with NO notes, past the allowance, still comes back whole`);
    check(out.kept.indexOf("Read from their notes, not their transcripts") >= 0 && out.kept.indexOf(INCIDENT_MEETINGS[3].title) >= 0 && out.kept.indexOf(INCIDENT_MEETINGS[4].title) >= 0 && out.kept.indexOf(BARE.title) < 0, `${model}: the user is told exactly which meetings were read from notes`, out.kept.slice(-400));
    check(out.kept.indexOf("not a gap in the recording") >= 0 && out.kept.indexOf("ask for it by name") >= 0, `${model}: that it is a limit at this end, and how to get a transcript`);
    check(logs.slice(logStart).join("\n").indexOf("transcripts_held=2") >= 0, `${model}: the turn's log line counts them`);
  }

  // ── 10b. A transcript the user ASKED FOR is not held back ────────────
  console.log("\n10b. Every chain — the transcript the user named is read in full, even after a wrong candidate");
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    const NF = INCIDENT_MEETINGS[1], SEARCH = INCIDENT_MEETINGS[4];
    newTurnScript([
      // The disambiguation move that defeated "first transcript is whole":
      // a wrong candidate (42,516 chars) opened first.
      { text: ["Checking candidates."], toolCalls: [{ name: "query_meetingbrain", args: { report: "meeting_details", meeting_id: NF.id } }], before: () => clockTo(d.startedAt, 2_000) },
      { text: ["That was the wrong one; opening the Searchable consultation."], toolCalls: [{ name: "query_meetingbrain", args: { report: "meeting_details", meeting_id: SEARCH.id, full_transcript: true } }], before: () => clockTo(d.startedAt, 8_000) },
      { text: ["Here is the transcript."], before: () => clockTo(d.startedAt, 20_000) },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, ...MB_CONFIG, model, conversationId: `conv-ask-${model}`, turnDeadline: d }, [{ role: "user", content: "Give me the full transcript of the Searchable consultation" }]);
    loud();
    const tr = toolResults();
    check(tr.length === 2 && tr[1].indexOf(transcriptOf(SEARCH.id, 400)) >= 0 && tr[1].indexOf("TRANSCRIPT NOT INCLUDED") < 0, `${model}: the Searchable transcript (37,787 chars, 80,303 read in the turn) comes back whole`, tr[1] ? tr[1].slice(0, 160) : `${tr.length} results`);
    check(out.kept.indexOf("Read from") < 0, `${model}: and the user is not told to ask for what they just asked for`, out.kept.slice(-200));
  }
  // The flag is bounded: a model that sets it on everything cannot restore
  // the incident. Four long calls asked for by name after a first read.
  {
    const d = td.deadlineForRoute(Date.now(), 300);
    const order: Meeting[] = [INCIDENT_MEETINGS[3], INCIDENT_MEETINGS[4], INCIDENT_MEETINGS[1], BOARD, ALLHANDS];
    const calls: { name: string; args: any }[] = [];
    for (let i = 0; i < order.length; i++) calls.push({ name: "query_meetingbrain", args: { report: "meeting_details", meeting_id: order[i].id, full_transcript: true } });
    newTurnScript([
      { text: ["Reading all of them in full."], toolCalls: calls, before: () => clockTo(d.startedAt, 2_000) },
      { text: ["Done."], before: () => clockTo(d.startedAt, 20_000) },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, ...MB_CONFIG, model: "grok-4-7", conversationId: "conv-ask-cap", turnDeadline: d });
    loud();
    const tr = toolResults();
    let wholeN = 0;
    for (let i = 0; i < 4; i++) if (tr[i] && tr[i].indexOf(transcriptOf(order[i].id, 400)) >= 0) wholeN++;
    check(tr.length === 5 && wholeN === 4, `the first read plus ${tb.EXPLICIT_TRANSCRIPTS_PER_TURN} asked for by name come back whole`, `${wholeN} of 4 whole, ${tr.length} results`);
    const fifth = tr[4] || "";
    check(fifth.indexOf("TRANSCRIPT NOT INCLUDED") >= 0 && fifth.indexOf(transcriptOf(ALLHANDS.id, 400)) < 0, "and the next one asked for by name is held back — the flag has a ceiling");
    check(fifth.indexOf("in a new message") >= 0 && fifth.indexOf("full_transcript: true") < 0, "which tells the model to point the user at a new message, not to ask again with the flag", fifth.slice(-300));
    check(out.kept.indexOf(ALLHANDS.title) >= 0, "and the user is told it was read from notes", out.kept.slice(-300));
  }
  // The wording promises only what the code does.
  {
    const b = tb.createTranscriptBudget();
    check(b.admit(90_000) && b.used() === 90_000, "the first transcript of a turn is whole whatever its size");
    check(!b.admit(1_000), "and after that the allowance holds");
    check(b.admit(1_000, true) && b.explicitUsed() === 1, "unless it was asked for by name");
    b.withhold("Board review", 51_760);
    const said = tb.summarisedTranscriptsNotice(b) + tb.transcriptWithheldHint("Board review", 51_760, 91_000) + tb.transcriptWithheldHint("Board review", 51_760, 91_000, true);
    check(said.indexOf("will be read") < 0, "nothing tells the user a transcript \"will be read\" — the code does not guarantee a next turn does");
  }

  // ── 11. The xAI cache key without a conversation ─────────────────────
  console.log("\n11. xAI — a turn with no conversation still keeps its rounds on one cache");
  {
    const keys: string[] = [];
    for (let t = 0; t < 2; t++) {
      const d = td.deadlineForRoute(Date.now(), 300);
      newTurnScript([
        { text: ["one"], toolCalls: [{ name: "query_content_score", args: { text: "x" } }], before: () => clockTo(d.startedAt, 1_000) },
        { text: ["two"] },
      ]);
      quiet();
      await runTurn(providers, { ...BASE, model: "grok-4-7", turnDeadline: d });
      loud();
      const a = sent[0] ? String(sent[0].headers["x-grok-conv-id"] || "") : "";
      const b = sent[1] ? String(sent[1].headers["x-grok-conv-id"] || "") : "";
      check(!!a && a === b && a.indexOf("turn-") === 0, `turn ${t + 1}: both rounds arrive with one turn key`, `${a} / ${b}`);
      keys.push(a);
    }
    check(keys[0] !== keys[1], "and two turns do not share one");
  }

  // ── 12. THE QA INCIDENT: a tool round still thinking at the window ────
  // 2026-09-28 13:34Z, thread d949e94b, production cdd15fb: grok-4.7's round
  // 2 started at 141s with tools on and reasoned past 275s without a word; the
  // row was finalised with no answer. Here a tool round starts at 60s — a
  // legitimate start on every chain (the real grok-4.7 run that reproduced
  // the incident at production timing started its round 2 at 66.6s) — and
  // THINKS: events keep coming (so no stall guard fires), none of them text.
  // The window must cut it, and the rescue writer must write the answer,
  // which must be on the row.
  console.log("\n12. Every chain — a tool round still thinking when the window opens is cut, and the rescue writer answers (d949e94b)");
  // grok-4.7 is rescued by ITSELF at "low": grok-4.3 at "none", the first
  // version's writer, credited colleagues' pasted posts to the user in 6 of 6
  // real rescues (turn-deadline.ts header).
  const RESCUE_EXPECT: Record<string, { model: string; effort?: string; label: string }> = {
    "grok-4-7": { model: "grok-4.7", effort: "low", label: "Grok 4.7 at low reasoning effort" },
    "claude-sonnet-5": { model: "claude-sonnet-5", label: "Claude Sonnet 5" },
    "gemini-3.8-flash": { model: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    "gpt-6-luna": { model: "gpt-6-luna", effort: "none", label: "GPT-6 Luna without reasoning" },
  };
  const ANSWER = "Weekly summary — W39 achievements: Siemens ITM report-out delivered; NatureFinance kickoff held. W40 priorities: offsite on 1 October.";
  /** The API model each chain id runs — the window is the model's. */
  const API: Record<string, string> = { "grok-4-7": "grok-4.7", "claude-sonnet-5": "claude-sonnet-5", "gemini-3.8-flash": "gemini-3.8-flash", "gpt-6-luna": "gpt-6-luna" };
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const want = RESCUE_EXPECT[model];
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: ["Pulling the week's meetings first."], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d.startedAt, 60_000) },
      { text: [], hang: "think" },
      { text: [ANSWER] },
    ]);
    const w12 = td.writeAtFor(d, API[model]);
    const logStart = logs.length;
    quiet();
    const out = await runTurn(providers, { ...BASE, model, conversationId: `conv-window-${model}`, turnDeadline: d });
    loud();
    const turnLog = logs.slice(logStart).join("\n");
    const toolsOn = (b: any) => Array.isArray(b.tools) && b.tools.length > 0 && !(b.tool_choice === "none" || (b.tool_choice && b.tool_choice.type === "none"));
    check(out.finished && sent.length === 3, `${model}: three requests — the gathering round, the round that thought, the rescue`, `${sent.length}`);
    check(!!sent[1] && toolsOn(sent[1].body) && sent[1].abortedAt > 0, `${model}: the thinking round had tools on and was ABORTED`);
    check(!!sent[1] && Math.abs(sent[1].abortedVirtual - w12) < WINDOW_SLACK_MS, `${model}:   …at ITS window (${(w12 - d.startedAt) / 1000}s), not at hard (275s)`, sent[1] ? `cut at ${Math.round((sent[1].abortedVirtual - d.startedAt) / 1000)}s` : "none");
    const r = sent[2] ? sent[2].body : {};
    const effortSent = r.reasoning_effort;
    check(!!sent[2] && !toolsOn(r) && r.model === want.model && (want.effort ? effortSent === want.effort : effortSent === undefined), `${model}: the rescue is tools-off, on ${want.model}${want.effort ? ` at effort ${want.effort}` : ""}`, `${r.model} effort=${effortSent} tool_choice=${JSON.stringify(r.tool_choice)}`);
    if (model === "claude-sonnet-5") check(!!r.thinking && r.thinking.type === "disabled", `${model}:   …with thinking disabled`, JSON.stringify(r.thinking));
    // THE ANSWER, not merely a finalised row.
    check(!!out.completion && out.kept.indexOf(ANSWER) >= 0, `${model}: THE ANSWER IS ON THE SAVED ROW`, out.completion ? out.kept.slice(0, 240) : out.error);
    check(out.shown.indexOf(ANSWER) >= 0 && out.shown.indexOf("Pulling the week's meetings first.") === 0, `${model}: and on screen, after the narration the user already saw`, out.shown.slice(0, 160));
    check(out.kept.indexOf("Written quickly at this turn's time limit") >= 0 && out.kept.indexOf(`written by ${want.label}`) >= 0 && out.kept.indexOf("check names and owners") < 0, `${model}: the line says it was written quickly, and by which model — not the last resort's caveat`, out.kept.slice(-260));
    check(out.kept.indexOf("narrower") < 0, `${model}: and never tells a summary to ask again narrower`);
    check(turnLog.indexOf("cut at the answer window") >= 0 && turnLog.indexOf(`Rescue: the answer was written by ${want.model}`) >= 0 && turnLog.indexOf(`writer="${want.label}"`) >= 0, `${model}: the log names the cut, the writer, and carries it on the Turn line`);
    const [inTime12, when12] = beforeBackstop(out, d);
    check(inTime12 && out.completedAt <= d.hardAt, `${model}: finalised by hard, well inside the platform's 300s`, when12);
    // THE PROVIDER NEVER CHANGES: every request of the turn went to one.
    let same = true;
    for (let i = 1; i < sent.length; i++) if (sent[i].provider !== sent[0].provider) same = false;
    check(same, `${model}: every request of the turn went to one provider`, sent.map((x) => x.provider).join(", "));
  }

  // ── 12b. grok-4.7: the last resort, and only as one ────────────────────
  // The tool round thinks past the window (175s) and grok-4.7 at "low" — the
  // rescue writer — ALSO thinks, past 245s: only then is the answer handed to
  // grok-4.3 at "none", with the last 30s. And a grok-4.7 at "low" that has
  // STARTED writing by 245s is left to write: no grok-4.3 request at all.
  console.log("\n12b. grok-4-7 — the last resort writes only what grok-4.7 at low did not start in time");
  {
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: ["Pulling the week's meetings first."], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d.startedAt, 60_000) },
      { text: [], hang: "think" },
      { text: [], hang: "think" },
      { text: [ANSWER] },
    ]);
    const logStart = logs.length;
    quiet();
    const out = await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-last-resort", turnDeadline: d });
    loud();
    const turnLog = logs.slice(logStart).join("\n");
    const resortAt = td.lastResortAt(d, "grok-4.7") || 0;
    const shape = sent.map((x) => `${x.body.model}/${x.body.reasoning_effort || "default"}${x.abortedAt ? `@${Math.round((x.abortedVirtual - d.startedAt) / 1000)}s` : ""}`).join(", ");
    // LITERAL SECONDS, not writeAtFor: a window moved consistently everywhere
    // would pass every assertion that reads it back.
    check(sent.length === 4 && sent[1].body.model === "grok-4.7" && Math.abs(sent[1].abortedVirtual - (d.startedAt + 175_000)) < WINDOW_SLACK_MS, "grok-4-7: the thinking tool round is cut at the window (175s)", shape);
    check(!!sent[2] && sent[2].body.model === "grok-4.7" && sent[2].body.reasoning_effort === "low" && sent[2].body.tool_choice === "none" && Math.abs(sent[2].abortedVirtual - resortAt) < WINDOW_SLACK_MS && Math.abs(resortAt - (d.startedAt + 245_000)) < 1,
      "  …grok-4.7 at low, tools off, still thinking at 245s, is cut there", shape);
    check(!!sent[3] && sent[3].body.model === "grok-4.3" && sent[3].body.reasoning_effort === "none" && sent[3].body.tool_choice === "none" && sent[3].provider === "xai",
      "  …and only then does grok-4.3 at none write, on xAI, tools off", shape);
    check(!!out.completion && out.kept.indexOf(ANSWER) >= 0 && out.kept.indexOf("written by Grok 4.3 without reasoning") >= 0 && turnLog.indexOf('writer="Grok 4.3 without reasoning"') >= 0,
      "  …THE ANSWER IS ON THE ROW, and the line and the log name grok-4.3 as its writer", out.completion ? out.kept.slice(-240) : out.error);
    // The last resort misattributed in every real rescue it wrote: its line
    // says to check names and owners, and no other rescued line does.
    check(out.kept.indexOf("Written in the last seconds") >= 0 && out.kept.indexOf("check names and owners before you use it") >= 0 && out.kept.indexOf("Written quickly") < 0,
      "  …and its line says it was the last resort, and to check whose work is whose", out.kept.slice(-300));
    const [inTime12b, when12b] = beforeBackstop(out, d);
    check(inTime12b && out.completedAt <= d.hardAt, "  …finalised by hard", when12b);

    // STARTED WRITING BY 245s: kept, never handed over.
    const d2 = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: ["Pulling the week's meetings first."], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d2.startedAt, 60_000) },
      { text: [], hang: "think" },
      { text: ["Weekly summary, written slowly: "], hang: "drip" },
      { text: ["A last-resort answer that must never be asked for."] },
    ]);
    quiet();
    const out2 = await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-low-writes", turnDeadline: d2 });
    loud();
    const shape2 = sent.map((x) => `${x.body.model}/${x.body.reasoning_effort || "default"}${x.abortedAt ? `@${Math.round((x.abortedVirtual - d2.startedAt) / 1000)}s` : ""}`).join(", ");
    check(sent.length === 3 && sent[2].body.reasoning_effort === "low" && sent[2].abortedVirtual >= d2.hardAt - 1_000 && out2.kept.indexOf("Weekly summary, written slowly:") >= 0 && out2.kept.indexOf("must never be asked for") < 0,
      "grok-4-7: grok-4.7 at low that is WRITING at 245s is left to write, to hard — the last resort is never asked", shape2);
  }

  // ── 13. The round-start policy, and the answer round's own window ─────
  console.log("\n13. Every chain — too late for a tool round to finish: the next round is the answer, and it is guarded too");
  const LATE_START: Record<string, number> = { "grok-4-7": 141_000, "claude-sonnet-5": 195_000, "gemini-3.8-flash": 190_000, "gpt-6-luna": 190_000 };
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: ["Reading."], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d.startedAt, LATE_START[model]) },
      { text: ["The answer, written by the turn's own model."] },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model, conversationId: `conv-policy-${model}`, turnDeadline: d });
    loud();
    const tc = sent[1] ? sent[1].body.tool_choice : undefined;
    const off = model === "claude-sonnet-5" ? !!tc && tc.type === "none" : tc === "none";
    const own = sent[1] ? sent[1].body.model : "";
    check(sent.length === 2 && off && own === API[model], `${model}: a round starting at ${LATE_START[model] / 1000}s is tools-off, on the turn's own model`, `${sent.length} requests, model ${own}, tool_choice ${JSON.stringify(tc)}`);
    if (model === "grok-4-7") {
      // grok-4.7 at its own effort is not the answer round this late: its
      // single answer round has a p90 of 167s. It is asked at "low", and the
      // line says so.
      check(sent[1].body.reasoning_effort === "low" && out.kept.indexOf("The answer, written by the turn's own model.") >= 0 && out.kept.indexOf("written by Grok 4.7 at low reasoning effort") >= 0,
        `${model}:   …at reasoning effort low, and the line names it`, `${sent[1].body.reasoning_effort}; ${out.kept.slice(-200)}`);
    } else {
      check(out.kept.indexOf("The answer, written by the turn's own model.") >= 0 && out.kept.indexOf("Stopped looking things up at this turn's time limit") >= 0 && out.kept.indexOf("Written quickly") < 0, `${model}: its answer is on the row with the soft line, not the rescue line`, out.kept.slice(-200));
    }
  }
  // The answer round itself thinks past the window: cut, and rescued — on
  // every chain, because each chain guards its own answer round. On grok-4.7
  // that round IS the rescue writer (grok-4.7 at low), so the window does not
  // cut it: it keeps its time to 245s, and the last resort writes.
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const want = RESCUE_EXPECT[model];
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: ["Reading."], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d.startedAt, LATE_START[model]) },
      { text: [], hang: "think" },
      { text: [ANSWER] },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model, conversationId: `conv-policy-think-${model}`, turnDeadline: d });
    loud();
    const tc1 = sent[1] ? sent[1].body.tool_choice : undefined;
    const off1 = model === "claude-sonnet-5" ? !!tc1 && tc1.type === "none" : tc1 === "none";
    const grok = model === "grok-4-7";
    const cutWant = grok ? (td.lastResortAt(d, "grok-4.7") || 0) : d.writeAt;
    const then = grok ? { model: "grok-4.3", label: "Grok 4.3 without reasoning" } : want;
    check(sent.length === 3 && sent[1].body.model === API[model] && off1 && Math.abs(sent[1].abortedVirtual - cutWant) < WINDOW_SLACK_MS,
      `${model}: the tools-off answer round started at ${LATE_START[model] / 1000}s, still thinking at ${(cutWant - d.startedAt) / 1000}s, is cut there`, sent[1] ? `${sent.length} requests, cut at ${Math.round((sent[1].abortedVirtual - d.startedAt) / 1000)}s` : `${sent.length} requests`);
    check(!!sent[2] && sent[2].body.model === then.model && out.kept.indexOf(ANSWER) >= 0 && out.kept.indexOf(`written by ${then.label}`) >= 0,
      `${model}:   …and ${then.label} writes the answer, which is on the row`, out.kept.slice(-240));
  }

  // ── 13b. An answer request that comes back EMPTY hands on too ─────────
  // Not cut, not failed: finished, with no text (a model that only thought).
  // The next writer answers; a turn does not end on an empty answer.
  console.log("\n13b. Every chain — an answer request that finishes with no text is followed by the next writer");
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: ["Reading."], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d.startedAt, LATE_START[model]) },
      { text: [] },
      { text: [ANSWER] },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model, conversationId: `conv-empty-${model}`, turnDeadline: d });
    loud();
    const grok = model === "grok-4-7";
    const then = grok ? { model: "grok-4.3", line: "check names and owners before you use it" } : { model: RESCUE_EXPECT[model].model, line: `written by ${RESCUE_EXPECT[model].label}` };
    check(sent.length === 3 && !sent[1].abortedAt && sent[2].body.model === then.model && out.kept.indexOf(ANSWER) >= 0 && out.kept.indexOf(then.line) >= 0,
      `${model}: the empty answer request is followed by ${then.model}, whose answer is on the row`, `${sent.length} requests: ${sent.map((x) => `${x.body.model}/${x.body.reasoning_effort || "default"}`).join(", ")}; ${out.kept.slice(-160)}`);
  }

  // ── 14. A lookup that begins after the window opens is cut as it begins ─
  console.log("\n14. A round writing at the window that then reaches for a lookup is cut the moment it does");
  // Longer than what the cut round wrote: round-text.ts never cuts narration
  // that outweighs the answer it would leave behind.
  const LONG_ANSWER = `${ANSWER} ${ANSWER}`;
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: ["Reading."], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d.startedAt, 60_000) },
      { text: ["Here is a first pass at the summary. "], hang: "drip", toolAt: { at: d.startedAt + 240_000, name: "query_meetingbrain" } },
      { text: [LONG_ANSWER] },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, ...MB_CONFIG, model, conversationId: `conv-late-lookup-${model}`, turnDeadline: d });
    loud();
    const cutAt = sent[1] ? sent[1].abortedVirtual - d.startedAt : 0;
    check(sent.length === 3 && cutAt >= 239_000 && cutAt < 240_000 + WINDOW_SLACK_MS, `${model}: the round was left running past the window while it wrote, and cut when query_meetingbrain began (~240s)`, `${sent.length} requests, cut at ${Math.round(cutAt / 1000)}s`);
    // At 240s grok-4.7 at low could not start writing before 245s, so the
    // last resort writes — and its line says to check it.
    const line14 = model === "grok-4-7" ? "check names and owners before you use it" : "Written quickly";
    check(out.kept.indexOf(LONG_ANSWER) >= 0 && out.kept.indexOf(line14) >= 0, `${model}: the rescue writer answered${model === "grok-4-7" ? " (the last resort, at 240s, with its caveat)" : ""}`, out.kept.slice(-200));
    // What the cut round said was said before any result: on screen, it
    // stays; on the saved row — what later turns are rebuilt from — it goes.
    check(out.shown.indexOf("Here is a first pass at the summary.") >= 0 && out.kept.indexOf("Here is a first pass at the summary.") < 0, `${model}: the cut round's words stay on screen and leave the saved copy`, out.kept.slice(0, 120));
  }

  // A LOOKUP DOES NOT START ONCE THE WINDOW IS OPEN. Two reads written just
  // before it — the TURN's window: 175s on grok-4.7, 225s on Claude; the
  // first takes 4s and the window opens while it runs, so the second is
  // refused, and the rescue writes from what the first returned.
  for (const model of ["grok-4-7", "claude-sonnet-5"]) {
    const d = td.deadlineForRoute(Date.now(), 300);
    const writeAt14 = td.writeAtFor(d, API[model]);
    const before = mbCalls;
    newTurnScript([
      { text: ["Reading two meetings."], toolCalls: [
        { name: "query_meetingbrain", args: { report: "meeting_details", meeting_id: INCIDENT_MEETINGS[0].id } },
        { name: "query_meetingbrain", args: { report: "meeting_details", meeting_id: INCIDENT_MEETINGS[2].id } },
      ], before: () => clockTo(d.startedAt, writeAt14 - d.startedAt - 3_000) },
      { text: [ANSWER] },
    ]);
    mbTakesMs = 4_000;
    quiet();
    const out = await runTurn(providers, { ...BASE, ...MB_CONFIG, model, conversationId: `conv-straddle-${model}`, turnDeadline: d });
    loud();
    mbTakesMs = 0;
    const tr = toolResults();
    check(mbCalls - before === 1 && tr.length === 2 && tr[1].indexOf("NOT RUN") === 0, `${model}: the read that would start after the window is not started`, `${mbCalls - before} calls; second result: ${(tr[1] || "").slice(0, 60)}`);
    check(sent.length === 2 && out.kept.indexOf(ANSWER) >= 0 && out.kept.indexOf("Written quickly") >= 0, `${model}:   …and the rescue writer answers from what the first returned`, out.kept.slice(-200));
  }

  // PROSE AFTER A SERVER-SIDE SEARCH IS STILL THE ANSWER: a Claude round
  // that searched and went on writing is not "still writing a call" at the
  // window, and runs to HARD like any round writing its answer.
  {
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: ["Reading."], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d.startedAt, 150_000) },
      { text: ["Checking one fact first. "], hang: "drip", serverSearch: true },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model: "claude-sonnet-5", webSearch: true, conversationId: "conv-search-prose", turnDeadline: d });
    loud();
    check(sent.length === 2 && sent[1].abortedVirtual >= d.hardAt - 1_000 && out.kept.indexOf("After the search, the summary goes on:") >= 0,
      "claude-sonnet-5: a round writing prose after a server-side web search is not cut at the window — at HARD, with its text kept", sent[1] ? `${sent.length} requests, cut at ${Math.round((sent[1].abortedVirtual - d.startedAt) / 1000)}s` : `${sent.length} requests`);
  }

  // ── 15. The rescue never moves provider — mailbox, taint, every model ──
  console.log("\n15. The rescue writer stays on the turn's provider, for every registered model and on a tainted turn");
  {
    const reg: Record<string, { apiModel: string }> = (providers as any).MODEL_REGISTRY;
    const moved: string[] = [];
    const ids = Object.keys(reg);
    let writersSeen = 0;
    for (let i = 0; i < ids.length; i++) {
      const m = reg[ids[i]].apiModel;
      const ws = td.rescueWritersFor(m);
      for (let j = 0; j < ws.length; j++) {
        const w = ws[j];
        writersSeen++;
        if (td.providerOf(w.model) !== td.providerOf(m)) moved.push(`${m} → ${w.model}`);
        if (!reg[Object.keys(reg).find((k) => reg[k].apiModel === w.model) || ""]) moved.push(`${m} → ${w.model} (not a registered model)`);
      }
    }
    check(ids.length > 10 && writersSeen > ids.length && moved.length === 0, `no registered model (${ids.length}) is rescued, by any of its ${writersSeen} writers, on another provider or by an unregistered id`, moved.join("; "));
    const gw = td.rescueWritersFor("grok-4.7");
    check(gw.length === 2 && gw[0].model === "grok-4.7" && gw[0].reasoningEffort === "low" && gw[1].model === "grok-4.3" && gw[1].reasoningEffort === "none",
      "grok-4.7 is rescued by itself at low first, and by grok-4.3 at none only as the last resort", JSON.stringify(gw));
    check(td.rescueWriterFor("claude-opus-5-5").model === "claude-sonnet-5" && td.rescueWriterFor("claude-fable-5-1").model === "claude-sonnet-5",
      "the always-thinking Claude models hand the answer to Sonnet 5, thinking off");
    // A HARD-TAINTED Claude turn (mailbox read): the rescue is Anthropic,
    // and its tool list is still narrowed to the post-taint reads. Run twice,
    // untainted first, so the narrowing is shown to REMOVE something — with
    // web search and the generators registered, the untainted rescue carries
    // them, and the tainted one must not.
    const forbidden = (n: string) => n === "web_search" || n === "create_scheduled_task" || n.indexOf("generate_") === 0;
    const rescueTools: string[][] = [];
    const rescueOut: TurnOutcome[] = [];
    for (let k = 0; k < 2; k++) {
      const d = td.deadlineForRoute(Date.now(), 300);
      newTurnScript([
        { text: ["Reading."], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d.startedAt, 100_000) },
        { text: [], hang: "think" },
        { text: [ANSWER] },
      ]);
      quiet();
      const out = await runTurn(providers, { ...BASE, ...MB_CONFIG, webSearch: true, imageGeneration: true, model: "claude-opus-5-5", conversationId: `conv-taint-${k}`, turnDeadline: d, sawUntrustedContent: k === 1, allowPersonalData: true, gmailAccess: true });
      loud();
      rescueOut.push(out);
      const r = sent.length === 3 ? sent[2] : null;
      rescueTools.push(r && Array.isArray(r.body.tools) ? r.body.tools.map((t: any) => String(t.name || "")) : []);
      check(!!r && r.provider === "anthropic" && r.body.model === "claude-sonnet-5" && out.kept.indexOf(ANSWER) >= 0,
        `a ${k === 1 ? "HARD-TAINTED " : ""}claude-opus-5-5 turn is rescued on Anthropic (Sonnet 5), and answers`, `${sent.length} requests, rescue ${r ? `${r.provider}/${r.body.model}` : "none"}`);
    }
    check(rescueTools[0].some(forbidden), "  (precondition) untainted, the rescue request carries web_search and the generators", rescueTools[0].join(","));
    check(rescueTools[1].length > 0 && !rescueTools[1].some(forbidden), "  …tainted, its tools are narrowed to the post-taint reads", rescueTools[1].join(","));
    // A soft-tainted grok turn (Slack, MeetingBrain) is rescued on xAI.
    const d2 = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: ["Reading."], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d2.startedAt, 60_000) },
      { text: [], hang: "think" },
      { text: [ANSWER] },
    ]);
    quiet();
    const out2 = await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-soft-taint", turnDeadline: d2, sawThirdPartyContent: true });
    loud();
    check(sent.length === 3 && sent[2].provider === "xai" && out2.kept.indexOf(ANSWER) >= 0, "a soft-tainted grok-4-7 turn is rescued on xAI", sent.map((x) => x.provider).join(", "));
  }

  // ── 15b. When even the rescue cannot write ────────────────────────────
  console.log("\n15b. Every chain — the answer round AND the rescue both silent: the line says what was read and offers to continue");
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      // A real read 5s before the turn's window — so it runs — then silence.
      { text: ["Reading the ITM report-out."], toolCalls: [{ name: "query_meetingbrain", args: { report: "meeting_details", meeting_id: INCIDENT_MEETINGS[0].id } }], before: () => clockTo(d.startedAt, td.writeAtFor(d, API[model]) - d.startedAt - 5_000) },
      { hang: "headers" },
      { hang: "headers" },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, ...MB_CONFIG, model, conversationId: `conv-norescue-${model}`, turnDeadline: d });
    loud();
    check(sent.length === 3 && sent[1].abortedAt > 0 && sent[2].abortedAt > 0, `${model}: the answer round was cut (at the window, or at 245s on grok-4.7) and the last writer at hard`, `${sent.length} requests`);
    check(!!out.completion && out.kept.indexOf("Out of time before the answer was written") >= 0 && out.kept.indexOf("read your meeting records") >= 0 && out.kept.indexOf('Reply "continue"') >= 0 && out.kept.indexOf("narrower") < 0,
      `${model}: the row says what was read and offers to continue — never "narrower"`, out.completion ? out.kept.slice(-240) : out.error);
    const [inTime15, when15] = beforeBackstop(out, d);
    check(inTime15, `${model}: finalised before the backstop`, when15);
  }

  // ── 16. The line, by case ─────────────────────────────────────────────
  console.log("\n16. The deadline line says what happened, and never \"ask again, narrower\"");
  {
    const gathered = (providers as any).gatheredSubjects([
      { name: "query_meetingbrain", calls: 3, blockedBudget: 0, blockedRepeat: 0 },
      { name: "query_slack", calls: 3, blockedBudget: 0, blockedRepeat: 0 },
      { name: "query_engine", calls: 1, blockedBudget: 0, blockedRepeat: 0 },
      { name: "search_memory", calls: 1, blockedBudget: 1, blockedRepeat: 0 },
      { name: "query_content_score", calls: 1, blockedBudget: 0, blockedRepeat: 0 },
    ]) as string[];
    check(gathered.join("|") === "your meeting records|Slack|the Engine database", "what the incident turn read, in the notices' own words — refused calls and the scorer left out", gathered.join(" | "));
    const rescued = td.turnDeadlineNotice({ kind: "window", writer: "Grok 4.3 without reasoning" }, true, gathered);
    check(/Written quickly at this turn's time limit/.test(rescued) && rescued.indexOf("written by Grok 4.3 without reasoning, with tools off, from what had been gathered by then") >= 0, "rescued: says it was written quickly, by which model, from what was gathered", rescued);
    const low = (providers as any).describeWriter({ model: "grok-4.7", reasoningEffort: "low" });
    const rescuedLow = td.turnDeadlineNotice({ kind: "window", writer: low }, true, gathered);
    check(low === "Grok 4.7 at low reasoning effort" && rescuedLow.indexOf("written by Grok 4.7 at low reasoning effort, with tools off") >= 0, "rescued by grok-4.7 at low: the line names the model AND the effort it was asked for", rescuedLow);
    const resortLine = td.turnDeadlineNotice({ kind: "window", writer: "Grok 4.3 without reasoning", lastResort: true }, true, gathered);
    check(resortLine.indexOf("written by Grok 4.3 without reasoning, a fast model") >= 0 && resortLine.indexOf("check names and owners before you use it") >= 0 && resortLine.indexOf('reply "continue"') >= 0 && resortLine.indexOf("Written quickly") < 0,
      "rescued by the LAST RESORT: says so, names it, and says to check whose work is whose", resortLine);
    const noAnswer = td.turnDeadlineNotice({ kind: "hard" }, false, gathered);
    check(noAnswer.indexOf("Out of time before the answer was written") >= 0 && noAnswer.indexOf("read your meeting records, Slack and the Engine database") >= 0 && noAnswer.indexOf('Reply "continue"') >= 0, "not written: says what was read, and offers to continue", noAnswer);
    const failed = td.turnDeadlineNotice({ kind: "window" }, false, gathered);
    check(failed.indexOf("did not arrive") >= 0 && failed.indexOf("Out of time") < 0 && failed.indexOf("read your meeting records") >= 0, "an answer request that FAILED is not called running out of time", failed);
    const own = td.turnDeadlineNotice({ kind: "soft" }, true, gathered);
    check(own.indexOf("the answer above uses what was gathered by then") >= 0 && own.indexOf("Written quickly") < 0, "answered by the turn's own model after tools went off: the soft line", own);
    const every: any[] = [
      { kind: "soft" }, { kind: "window" }, { kind: "hard" }, { kind: "window", writer: "X" }, { kind: "window", writer: "X", lastResort: true }, { kind: "hard", tool: "generate_slides" },
      { kind: "hard", tool: "generate_slides", unstarted: true }, { kind: "hard", tool: "query_meetingbrain", unstarted: true }, { kind: "window", tool: "query_meetingbrain", unstarted: true },
    ];
    const bad: string[] = [];
    for (let i = 0; i < every.length; i++) for (let a = 0; a < 2; a++) for (let g = 0; g < 2; g++) {
      const line = td.turnDeadlineNotice(every[i], a === 1, g ? gathered : []);
      if (/narrower|one meeting, one week/.test(line)) bad.push(line.slice(0, 120));
      if (/will be fetched|will be read|will fit|will be (created|built)/.test(line)) bad.push(line.slice(0, 120));
    }
    check(bad.length === 0, "no line, in any case, says \"narrower\" or guarantees what a follow-up will get", bad.join(" | "));
  }

  // ── 17. The build-now warning never goes out before anything was read ──
  // Review of the answer-window change (2026-09-30): the warning is aimed at
  // the round 45s before the last tool-round start, and on a 120s route that
  // start is 36s in — so the window reached back to 0s and ROUND 0 was told
  // "most of this turn's time budget is gone… stop gathering". A fact-check
  // or an optimiser discussion was told to stop before its only search. Under
  // cdd15fb the window began at 5s and round 0 escaped by a few seconds. The
  // assertion is on what each chain SENT, round by round; the second half
  // pins that the warning still reaches the round that can build.
  console.log("\n17. Every chain — the build-now warning never reaches round 0, and still reaches the last round that can build");
  const WARN_TEXT = "most of this turn's time budget is gone";
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 120);
    newTurnScript([
      { text: ["Checking that."], toolCalls: [{ name: "query_content_score", args: { text: "A claim to check." } }] },
      // 20s: inside every chain's warning window on a 120s route, before its
      // last tool-round start — the round that can still build.
      { text: ["Checked."], toolCalls: [{ name: "query_content_score", args: { text: "Another claim." } }], before: () => clockTo(d.startedAt, 20_000) },
      { text: ["The answer."] },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model, conversationId: `conv-warn0-${model}`, turnDeadline: d });
    loud();
    const warned = (i: number) => !!sent[i] && JSON.stringify(sent[i].body).indexOf(WARN_TEXT) >= 0;
    check(out.finished && sent.length >= 2 && !warned(0), `${model}: on a 120s route, round 0 carries no build-now warning`, `${sent.length} requests, round 0 warned=${warned(0)}`);
    check(warned(1), `${model}:   …and the round starting at 20s — the last that can build — does`, `${sent.length} requests, round 1 warned=${warned(1)}`);
  }

  check(strayFetches.length === 0, "nothing reached the network", strayFetches.slice(0, 3).join(", "));
  check(aux.length === 0, "no non-streaming provider request was made", aux.join(", "));
  check(unhandled.length === 0, "no promise was left rejected with nobody listening", unhandled.slice(0, 3).join(" | "));
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  server.closeAllConnections();
  server.close();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { loud(); console.error(e); process.exit(1); });

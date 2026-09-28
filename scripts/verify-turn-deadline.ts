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
  hang?: "headers" | "stream" | "drip" | "drip-tool";
  /** Sent mid-stream after the text, in the provider's own error format. */
  error?: string;
}
/** What arrived at the fake. `abortedAt`: the client closed the connection
 *  before the fake had finished answering — the SDK request was cancelled. */
interface Sent { provider: string; body: any; headers: http.IncomingHttpHeaders; abortedAt: number; finished: boolean }
let script: Round[] = [];
let sent: Sent[] = [];
/** Non-streaming requests (none are expected in these turns). */
const aux: string[] = [];
function newTurnScript(rounds: Round[]) { script = rounds.slice(); sent = []; }

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
    const rec: Sent = { provider, body, headers: req.headers, abortedAt: 0, finished: false };
    sent.push(rec);
    res.on("close", () => { if (!rec.finished && !rec.abortedAt) rec.abortedAt = realNow(); });
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
    check(d.softAt - t === 170_000, "soft budget for the 300s chat route is 170s", `${(d.softAt - t) / 1000}s`);
    check(td.backstopAt(d) - t === 290_000, "the route's backstop fires at 290s", `${(td.backstopAt(d) - t) / 1000}s`);
    check(d.softAt < d.hardAt && d.hardAt < td.backstopAt(d) && td.backstopAt(d) < d.endsAt, "soft < hard < backstop < the platform's kill");
    // Measured: grok's single-answer-round p90 was 83s, claude's 35s.
    check(d.hardAt - d.softAt >= 83_000, "a final round gets at least grok's measured single-round p90 (83s)", `${(d.hardAt - d.softAt) / 1000}s`);
    const short = td.deadlineForRoute(t, 120);
    check(short.softAt > t + 30_000 && short.hardAt - t === 95_000, "a 120s route still gets tool rounds, and stops at 95s", `soft ${(short.softAt - t) / 1000}s hard ${(short.hardAt - t) / 1000}s`);
    check(td.roundPlan(d, d.softAt - 1) === "tools" && td.roundPlan(d, d.softAt) === "final", "the plan turns to a tools-off final at soft");
    check(td.roundPlan(d, d.hardAt - td.MIN_FINAL_ROUND_MS + 1) === "none", "and to no request at all when a final round cannot land");
    check(td.canStartFallback(d, d.softAt - 1) && !td.canStartFallback(d, d.softAt), "a provider fallback is started only before soft");
    check(!td.toolTooLate(d, d.hardAt - td.MIN_FINAL_ROUND_MS) && td.toolTooLate(d, d.hardAt - td.MIN_FINAL_ROUND_MS + 1), "a tool call stops being started when no request could follow it");
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
      // 180s — which is where the incident's round 3 began (184s).
      { text: [LONG_NARRATION], toolCalls: [{ name: "query_content_score", args: { text: "A short draft to score." } }], before: () => clockTo(deadline.startedAt, 180_000) },
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
    check(out.kept.indexOf("Stopped looking things up at this turn's time limit") >= 0, "and the row says the lookup stopped at the time limit", out.kept.slice(-200));
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
      { text: ["Reading."], toolCalls: [{ name: "query_content_score", args: { text: "x" } }], before: () => clockTo(dw.startedAt, dw.softAt - dw.startedAt - 40_000) },
      { text: ["Built."] },
    ]);
    quiet();
    await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-warn", turnDeadline: dw });
    loud();
    const warnedMsgs = sent[1] ? sent[1].body.messages : [];
    let warned = false;
    for (let i = 0; i < warnedMsgs.length; i++) if (warnedMsgs[i].role === "user" && String(warnedMsgs[i].content).indexOf("Build any artefact you have promised NOW") >= 0) warned = true;
    check(warned && sent.length === 2 && sent[1].body.tool_choice !== "none", "a round starting 40s before soft is warned to build, with its tools still on");
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
  }

  // ── 3b. HARD while a deck is being written ───────────────────────────
  console.log("\n3b. Every chain — a deck still being written at the hard budget is named as not created");
  for (let c = 0; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    clockTo(d.startedAt, 150_000);
    newTurnScript([{ text: ["Building the weekly deck now. "], hang: "drip-tool" }]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model, conversationId: `conv-deck-${model}`, turnDeadline: d });
    loud();
    check(out.finished && !!out.completion && out.kept.indexOf("the deck was still being written, so it was not created") >= 0, `${model}: the row says the deck was not created`, out.completion ? out.kept.slice(-200) : `no completion: ${out.error}`);
    const [inTime3b, when3b] = beforeBackstop(out, d);
    check(inTime3b, `${model}:   …finalised before the backstop`, when3b);
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
  // The same wait on a TOOL round: started inside soft, the SDK request is
  // the only thing waiting, and only its signal can end it.
  {
    const d = td.deadlineForRoute(Date.now(), 300);
    clockTo(d.startedAt, 160_000);
    newTurnScript([{ hang: "headers" }]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-headers-tools", turnDeadline: d });
    loud();
    check(out.finished && !!out.completion && out.kept.indexOf("Out of time") >= 0 && sent.length === 1 && sent[0].abortedAt > 0, "grok-4-7: a TOOL round waiting 115s for headers is cut at hard and finalised", out.completion ? out.kept.slice(0, 160) : out.error);
  }

  // ── 5. SOFT on the other chains ──────────────────────────────────────
  console.log("\n5. Every chain — past soft, the next request is the tools-off answer");
  for (let c = 1; c < CHAINS.length; c++) {
    const model = CHAINS[c];
    const d = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: [LONG_NARRATION], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d.startedAt, 181_000) },
      { text: ["Answer from what was gathered."] },
    ]);
    quiet();
    const out = await runTurn(providers, { ...BASE, model, conversationId: `conv-soft-${model}`, turnDeadline: d });
    loud();
    const tc = sent[1] ? sent[1].body.tool_choice : undefined;
    const off = model === "claude-sonnet-5" ? !!tc && tc.type === "none" : tc === "none";
    check(sent.length === 2 && off, `${model}: past soft, the next request is the tools-off answer`, `${sent.length} requests, tool_choice ${JSON.stringify(tc)}`);
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

    // A soft cut whose tools-off answer then fails on its own account: the
    // row must not vouch for an "answer above" that never came.
    const d4 = td.deadlineForRoute(Date.now(), 300);
    newTurnScript([
      { text: [LONG_NARRATION], toolCalls: [{ name: "query_content_score", args: { text: "Draft." } }], before: () => clockTo(d4.startedAt, 181_000) },
      { error: "The model is currently at capacity due to high demand." },
    ]);
    quiet();
    const out4 = await runTurn(providers, { ...BASE, model: "grok-4-7", conversationId: "conv-soft-fail", turnDeadline: d4 });
    loud();
    check(!!out4.completion && out4.kept.indexOf("the answer that should have followed did not arrive") >= 0 && out4.kept.indexOf("the answer above uses what was gathered") < 0,
      "a soft cut whose answer then failed says so, and does not vouch for an answer above", out4.completion ? out4.kept.slice(-200) : out4.error);

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

  check(strayFetches.length === 0, "nothing reached the network", strayFetches.slice(0, 3).join(", "));
  check(aux.length === 0, "no non-streaming provider request was made", aux.join(", "));
  check(unhandled.length === 0, "no promise was left rejected with nobody listening", unhandled.slice(0, 3).join(" | "));
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  server.closeAllConnections();
  server.close();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { loud(); console.error(e); process.exit(1); });

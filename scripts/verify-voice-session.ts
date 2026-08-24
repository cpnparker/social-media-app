/**
 * The rules a live voice session applies to itself.
 * Run with `npx tsx scripts/verify-voice-session.ts --self-test`.
 *
 * Every case below is a defect the audit found in VoiceDock, pinned so a later
 * edit cannot quietly undo it. Three are the kind that lose money or data
 * silently, which is why they are asserted as arithmetic rather than as prose:
 *
 *   - An unanchored end-phrase pattern tore the session down mid-question when
 *     the user asked ABOUT ending something.
 *   - A bare "stop" or "cancel" — ordinary answers to ordinary questions —
 *     ended the whole session.
 *   - No idle timeout existed on any session that can currently run, because
 *     the close check returned false unless the session was a WAKE session and
 *     wake is off. A forgotten tab streamed the mic at $0.05/min indefinitely.
 *
 * IT IMPORTS THE REAL RULES. lib/ai/voice-session.ts exists so this file can:
 * VoiceDock opens a WebSocket and a microphone at mount and cannot be imported
 * by a script, so a check written against it would re-implement these patterns
 * and test its own copy — the failure this repo has already shipped twice.
 */
import { readFileSync } from "fs";
import {
  isHardStop, HARD_END_RE, BARE_STOP_RE,
  idleVerdict, IDLE_WARN_MS, IDLE_END_MS,
  toolLabel, toolArgsPhrase, TOOL_LABEL_TEXT,
} from "../lib/ai/voice-session";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

console.log("\n1. Ending the session takes the whole utterance, not a phrase inside one");
// The reported bug, verbatim in shape.
const MUST_NOT_END = [
  "how should I end the conversation with Galderma",
  "what's the best way to end the chat with a client who's gone quiet",
  "can you stop listening for keywords in the transcript",
  "draft something about how we stop listening to our own assumptions",
  "cancel",
  "stop",
  "shall I cancel the Tuesday session",
  "no, stop the Zurich one",
];
for (let i = 0; i < MUST_NOT_END.length; i++) {
  const u = MUST_NOT_END[i];
  !isHardStop(u) ? pass(`"${u.slice(0, 52)}" keeps talking`) : fail(`"${u}" ENDS the session — it should not`);
}

console.log("\n2. But the real sign-offs still work");
const MUST_END = [
  "stop listening",
  "end the conversation",
  "end conversation",
  "that's all thanks",
  "ok, that's all thanks",
  "thanks, that's all",
  "never mind",
  "go to sleep",
  "that's enough",
  "orac, stop listening",
];
for (let i = 0; i < MUST_END.length; i++) {
  const u = MUST_END[i];
  isHardStop(u) ? pass(`"${u}" ends it`) : fail(`"${u}" no longer ends the session — the sign-off is unreachable`);
}

console.log("\n3. An ordinary session times out — it never had one");
const v0 = idleVerdict(0);
const vWarnEdge = idleVerdict(IDLE_WARN_MS + 1_000);
const vExpired = idleVerdict(IDLE_END_MS + 1);
v0.state === "active" ? pass("fresh session is active") : fail(`fresh session reports ${v0.state}`);
vWarnEdge.state === "warning" ? pass(`warns after ${IDLE_WARN_MS / 1000}s of silence`) : fail(`no warning at ${IDLE_WARN_MS / 1000}s`);
vExpired.state === "expired" ? pass(`expires after ${IDLE_END_MS / 1000}s`) : fail(`never expires — the mic streams at $0.05/min indefinitely`);
IDLE_WARN_MS < IDLE_END_MS
  ? pass("the warning comes before the end, so nothing closes unannounced")
  : fail("the session would close before it warned");
vWarnEdge.secondsLeft !== null && vWarnEdge.secondsLeft > 0 && vWarnEdge.secondsLeft <= 30
  ? pass(`counts down (${vWarnEdge.secondsLeft}s left at the warning edge)`)
  : fail(`countdown is ${vWarnEdge.secondsLeft}`);

console.log("\n4. Every tool has a label, including one nobody wrote a label for");
// The two slowest tools on this surface were the two missing from the map.
for (const t of ["query_xero", "query_resourcing"]) {
  const l = toolLabel(t);
  l && l !== t ? pass(`${t} → "${l}"`) : fail(`${t} renders as "${l}" — the chip stays blank on the slowest tool`);
}
const invented = toolLabel("query_something_nobody_has_written_yet");
invented && invented.indexOf("_") < 0
  ? pass(`an unknown tool still reads as prose: "${invented}"`)
  : fail(`an unknown tool renders "${invented}" — a new tool can ship label-less again`);
toolLabel("") === "Working" ? pass("an empty name still says something") : fail("an empty tool name renders blank");

console.log("\n5. Arguments render as a phrase, and never take the dock down");
toolArgsPhrase('{"report":"contracts","client":"Galderma","days":90}') === "contracts · Galderma · 90"
  ? pass("values joined, keys omitted")
  : fail(`args phrase is "${toolArgsPhrase('{"report":"contracts","client":"Galderma","days":90}')}"`);
toolArgsPhrase("not json at all") === "" ? pass("unparseable arguments yield nothing, not a throw") : fail("bad JSON was not handled");
toolArgsPhrase(null) === "" && toolArgsPhrase(undefined) === "" && toolArgsPhrase("[]") === ""
  ? pass("null, undefined and arrays are all safe")
  : fail("a non-object argument was not handled");
toolArgsPhrase('{"q":"' + "x".repeat(400) + '"}').length <= 30
  ? pass("a long argument is capped, so the bar cannot outgrow the composer")
  : fail("a long argument is rendered in full");

console.log("\n6. The component uses these rules rather than keeping its own");
const dock = readFileSync("components/ai-writer/VoiceDock.tsx", "utf8");
/from "@\/lib\/ai\/voice-session"/.test(dock)
  ? pass("VoiceDock imports the shared rules")
  : fail("VoiceDock no longer imports them — it has its own copy again");
dock.indexOf("const HARD_END_RE") < 0 && dock.indexOf("const BARE_STOP_RE") < 0
  ? pass("no local end-phrase patterns remain")
  : fail("VoiceDock redeclares an end-phrase pattern — the two can now diverge");

console.log("\n7. The fixes that live in the component, asserted on the component");
// These are source assertions because their failure mode is an absence, and an
// absence cannot be tested behaviourally without a browser and a socket.
/** The body of a named handler, bounded by its own closing brace rather than a
 *  character count — so adding a comment cannot make a present fix look absent. */
function blockAfter(src: string, marker: string): string {
  const i = src.indexOf(marker);
  if (i < 0) return "";
  const end = src.indexOf("\n        };", i);
  return end < 0 ? src.slice(i, i + 2000) : src.slice(i, end);
}
const onerrorBlock = blockAfter(dock, "ws.onerror");
const intervalBlock = blockAfter(dock, "idleTimerRef.current = window.setInterval");

const CHECKS: [string, boolean, string][] = [
  ["a non-OK save is not treated as a save", /if \(!res\.ok\)/.test(dock),
   "turns are marked saved before the request; without this a 403 or 500 drops the conversation silently"],
  ["the save result is inspected before onTranscriptSaved", /wrote > 0/.test(dock),
   "an incognito thread returns saved: 0 and the client would report success"],
  // Block-scoped, not a fixed window: a regex with a character budget silently
  // stops matching when someone adds a comment, and reports the fix as missing.
  ["a socket error tears down", onerrorBlock.indexOf("teardown()") >= 0,
   "onerror only painted the state red, and onclose then skipped teardown BECAUSE it was red — the mic stayed open"],
  ["pagehide flushes", /addEventListener\("pagehide"/.test(dock),
   "the final flush carries durationSeconds and writes the ai_usage row; an unloaded tab lost both"],
  ["the session clock runs off an interval", intervalBlock.indexOf("setElapsed") >= 0,
   "browsers stop rAF in a hidden tab, so the clock froze while the session and the bill ran on"],
  ["the state line is a live region", /aria-live="polite"/.test(dock),
   "there was not one aria-live in the file"],
  ["tools are tracked as a list", /setTools\(/.test(dock),
   "setActiveTool overwrote, so a turn calling two tools showed only the last"],
  ["the transcript is two attributed rows", /setUserSaid/.test(dock) && /setBotSaid/.test(dock),
   "one caption slot meant the two speakers overwrote each other"],
  ["the persistence badge exists", /savingTo/.test(dock),
   "nothing told the user where their words were going"],
];
for (let i = 0; i < CHECKS.length; i++) {
  const [name, ok, why] = CHECKS[i];
  ok ? pass(name) : fail(`${name} — ${why}`);
}

console.log("\n8. Voice start honours Incognito, like the composer beside it");
const page = readFileSync("app/engineai/page.tsx", "utf8");
const voiceStart = page.slice(page.indexOf("Failed to start voice session") - 1400, page.indexOf("Failed to start voice session"));
/isIncognito/.test(voiceStart)
  ? pass("the voice conversation is created with isIncognito")
  : fail("voice start still omits isIncognito — Incognito is selected in the UI and ignored by the server");
/incognito=\{incognitoMode\}/.test(page)
  ? pass("the dock is told, so the badge can say so")
  : fail("the dock does not know whether anything is being persisted");

// ── Self-test ───────────────────────────────────────────────────────────
if (process.argv.indexOf("--self-test") >= 0) {
  console.log("\n9. Self-test — the old rules would fail these assertions");
  let selfFails = 0;
  const detects = (name: string, caught: boolean) => {
    if (caught) console.log(`  ok    ${name}`);
    else { selfFails++; console.log(`  FAIL  ${name}`); }
  };

  // The patterns exactly as they were before the fix.
  const OLD_HARD = /\b(stop listening|end (the )?(conversation|chat|session)|that('|’)?s all,? thanks?)\b/i;
  const OLD_BARE = /^\s*(orac[,!.]?\s*)?(stop|cancel|never ?mind|go to sleep|shut up|that('|’)?s (all|enough))[.!?]?\s*$/i;

  detects("the OLD pattern ends the session on \"how should I end the conversation with Galderma\"",
    OLD_HARD.test("how should I end the conversation with Galderma"));
  detects("the NEW pattern does not", !HARD_END_RE.test("how should I end the conversation with Galderma"));
  detects("the OLD pattern ends the session on a bare \"cancel\"", OLD_BARE.test("cancel"));
  detects("the NEW pattern does not", !BARE_STOP_RE.test("cancel"));
  detects("both still end on \"stop listening\"", OLD_HARD.test("stop listening") && HARD_END_RE.test("stop listening"));

  // The old idle rule: non-wake sessions never closed.
  const oldIdle = (idleForMs: number, wakeSession: boolean) => (wakeSession ? idleForMs > 60_000 : false);
  detects("the OLD rule never expires an ordinary session, however long the silence",
    oldIdle(60 * 60 * 1000, false) === false && idleVerdict(60 * 60 * 1000).state === "expired");

  // The old label map, missing its two slowest entries.
  const OLD_LABELS: Record<string, string> = {
    query_engine: "Checking the Engine", lookup_client_context: "Pulling client profile",
    search_memory: "Searching memories", query_meetingbrain: "Checking meetings",
    query_slack: "Checking Slack", consult_analyst: "Consulting the analyst",
  };
  detects("the OLD map has no label for query_xero (so the chip did not render)",
    OLD_LABELS["query_xero"] === undefined && toolLabel("query_xero") !== "");

  // And the fixture must still be exercising the real module.
  detects("the shared module is the one under test",
    Object.keys(TOOL_LABEL_TEXT).indexOf("query_xero") >= 0);

  if (selfFails) { console.log(`\n  ${selfFails} detector(s) do not work — nothing above can be trusted.\n`); process.exit(2); }
  console.log("  — all detectors confirmed working");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

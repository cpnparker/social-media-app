/**
 * A turn that needs a Claude-only tool must REACH a Claude chain.
 * Run with `npx tsx scripts/verify-personal-data-routing.ts --self-test`.
 *
 * query_gmail, query_calendar and query_microsoft register only on the Claude
 * chains — a deliberate data-processing boundary, not a capability gap. So when
 * an auto-routed turn that needs one lands on Grok, the failure is not a
 * degraded answer. The tool is simply absent, and the model answers from
 * nothing while sounding certain.
 *
 * THE TURN THIS EXISTS FOR. "Did Carol send the kick off meeting invite?" — a
 * calendar question by any reading, and the router classified it correctly as
 * meeting_data. It matched neither word list ("send" is not a mail verb here,
 * and it names no possessive calendar noun), so it stayed on Grok, where
 * query_calendar is not registered. It answered "No, Carol did not send it"
 * from a MeetingBrain search that structurally has no organiser field — and
 * produced the real organiser, Carol, one turn later from the calendar.
 *
 * The one turn correctly identified as a calendar question was the one turn
 * that lost the calendar.
 *
 * IT IMPORTS THE REAL PREDICATES. A script that re-implements these regexes
 * tests its own copy and passes while the product is wrong — the failure this
 * repo has already booked twice. lib/ai/personal-data-intent.ts exists so this
 * file can import what the route actually runs.
 */
import { needsClaudeForPersonalData, MAIL_INTENT, PERSONAL_SCHEDULE_INTENT } from "../lib/ai/personal-data-intent";
import { routeQuery } from "../lib/ai/query-router";
import { normalizeContextConfig } from "../lib/ai/system-prompts";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

/** A user with the calendar flag, auto-routed to Grok — the failing setup. */
const ON_GROK = {
  gmailAccess: true, calendarAccess: true, microsoftAccess: true,
  isTeamThread: false, wasAutoRouted: true, model: "grok-4-1-fast",
};

/** Run a real phrasing through the real router, then the real predicate. */
function escalates(text: string, opts?: Partial<typeof ON_GROK>): boolean {
  const route = routeQuery(text, normalizeContextConfig({}) as any);
  return needsClaudeForPersonalData({
    userMessage: text,
    intent: route.intent,
    ...ON_GROK,
    ...(opts || {}),
  });
}

console.log("\nPreconditions");
const probe = routeQuery("Did Carol send the kick off meeting invite?", normalizeContextConfig({}) as any);
probe && typeof probe.intent === "string"
  ? pass(`router reachable — that question classifies as "${probe.intent}"`)
  : fail("routeQuery did not return an intent — this check is testing nothing");

console.log("\n1. The exact turn that failed");
escalates("Did Carol send the kick off meeting invite?")
  ? pass('"Did Carol send the kick off meeting invite?" escalates to Claude')
  : fail('"Did Carol send the kick off meeting invite?" still does NOT escalate — the calendar is unreachable on the turn that needs it');

console.log("\n2. Questions that need a personal-data tool");
const MUST_ESCALATE = [
  "check my gmail",
  "any unread emails?",
  "did Ceri email me back?",
  "what's the email from Gavi about?",
  "what's on my calendar tomorrow?",
  "am I free at 3?",
  "when do I next meet Sharanya?",
  "what's my next meeting?",
];
for (let i = 0; i < MUST_ESCALATE.length; i++) {
  const q = MUST_ESCALATE[i];
  escalates(q) ? pass(`"${q}"`) : fail(`"${q}" does not escalate — it needs a Claude-only tool`);
}

// ── The gap this fix does NOT close ─────────────────────────────────────
// The escalation keys off the ROUTER's classification, so it reaches a calendar
// question only when the router recognises one. These are the same class as the
// turn that failed — "who organised X" is a question about an invite's
// organiser — but they use "call"/"handover" rather than a meeting word, so
// routeQuery returns "general" and they stay on Grok without the calendar.
//
// Printed rather than failed, deliberately: widening the meeting_data
// classifier changes hint generation and cost for every turn it newly matches,
// which is a product decision, not a test fixture. Shown here so the gap is
// visible instead of silently absent.
console.log("\n2b. Known gap — same class, phrased without a meeting word");
const GAP = [
  "who organised the kickoff call?",
  "who set up the IFFIm handover?",
  "what time does the client run-through start?",
];
let stillGapped = 0;
for (let i = 0; i < GAP.length; i++) {
  const g = GAP[i];
  const intent = routeQuery(g, normalizeContextConfig({}) as any).intent;
  if (escalates(g)) console.log(`  ok    "${g}" now escalates (intent=${intent}) — the gap narrowed`);
  else { stillGapped++; console.log(`  NOTE  "${g}" stays on Grok (intent=${intent}) — no calendar on this turn`); }
}
console.log(`  ${stillGapped}/${GAP.length} still gapped. Closing them means widening meeting_data in query-router.ts, which costs money on every newly-matched turn.`);

console.log("\n3. Decoys — ordinary work that must NOT be moved off the fast model");
// Everyday words in a content agency. Escalating these would silently swap the
// model mid-conversation, and pay Claude prices, for routine work.
const MUST_NOT_ESCALATE = [
  "draft an email campaign for Galderma",
  "write the email subject lines for the newsletter",
  "how many emails did the campaign send?",
  "what's in the social inbox?",
  "email marketing best practice for 2026",
  "add a calendar of content for September",
  "build an editorial calendar",
  "what's the content pipeline looking like?",
  "summarise the contracts ending this quarter",
  "write a LinkedIn post about our AI work",
];
for (let i = 0; i < MUST_NOT_ESCALATE.length; i++) {
  const q = MUST_NOT_ESCALATE[i];
  !escalates(q) ? pass(`"${q}" stays put`) : fail(`"${q}" escalates — ordinary work would move to Claude`);
}

console.log("\n4. The gates hold");
const q = "what's on my calendar tomorrow?";
!escalates(q, { isTeamThread: true })
  ? pass("team thread never escalates — personal data stays out of shared threads")
  : fail("a team thread escalated toward personal-data tools");
!escalates(q, { wasAutoRouted: false })
  ? pass("a model the user picked themselves is left alone")
  : fail("escalated over an explicit user model choice");
!escalates(q, { model: "claude-sonnet-5" })
  ? pass("already on Claude — no-op")
  : fail("escalated a turn that is already on Claude");
!escalates(q, { gmailAccess: false, calendarAccess: false, microsoftAccess: false })
  ? pass("no access flags — never escalates toward a tool the user cannot reach")
  : fail("escalated for a user with no personal-data access at all");
!escalates("Did Carol send the kick off meeting invite?", { calendarAccess: false })
  ? pass("meeting_data without calendar access does not escalate")
  : fail("meeting_data escalated without calendar access — pointless model switch");

console.log("\n5. Every Claude-only tool is named by a routing rule");
// A fifth tool gated on /^claude/ with no escalation branch would be
// unreachable in exactly the way query_calendar was on the failing turn.
import { readFileSync } from "fs";
const providers = readFileSync("lib/ai/providers.ts", "utf8");
const gated = providers.match(/\/\^claude\/\.test\(apiModel[^)]*\)/g) || [];
gated.length >= 3
  ? pass(`${gated.length} Claude-only tool gates found in providers.ts`)
  : fail(`only ${gated.length} Claude-only gates matched — the pattern moved and this check is now blind`);
const intentSrc = readFileSync("lib/ai/personal-data-intent.ts", "utf8");
for (const tool of ["gmail", "calendar", "microsoft"]) {
  new RegExp(tool, "i").test(intentSrc)
    ? pass(`${tool} has a routing rule`)
    : fail(`${tool} is Claude-only but no routing rule mentions it`);
}

// ── Self-test ───────────────────────────────────────────────────────────
if (process.argv.indexOf("--self-test") >= 0) {
  console.log("\n6. Self-test — the fix is what makes case 1 pass");
  let selfFails = 0;
  const detects = (name: string, caught: boolean) => {
    if (caught) console.log(`  ok    ${name}`);
    else { selfFails++; console.log(`  FAIL  ${name}`); }
  };

  // The predicate as it stood BEFORE the fix: the two word lists only.
  const OLD = (text: string, intent: string) =>
    MAIL_INTENT.test(text) || PERSONAL_SCHEDULE_INTENT.test(text);

  const CASE1 = "Did Carol send the kick off meeting invite?";
  const intent1 = routeQuery(CASE1, normalizeContextConfig({}) as any).intent;
  detects("the OLD predicate misses the failing turn (so the clause is load-bearing)", OLD(CASE1, intent1) === false);
  detects("the NEW predicate catches it", escalates(CASE1) === true);
  detects("the router really does classify it meeting_data", intent1 === "meeting_data");

  // And the decoys must not be caught by the new clause either — a rule that
  // escalates everything would also make case 1 pass, vacuously.
  let decoyEscalations = 0;
  for (let i = 0; i < MUST_NOT_ESCALATE.length; i++) if (escalates(MUST_NOT_ESCALATE[i])) decoyEscalations++;
  detects(`the new clause is not a catch-all (${decoyEscalations}/${MUST_NOT_ESCALATE.length} decoys escalate)`, decoyEscalations === 0);

  if (selfFails) { console.log(`\n  ${selfFails} detector(s) do not work — nothing above can be trusted.\n`); process.exit(2); }
  console.log("  — all detectors confirmed working");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

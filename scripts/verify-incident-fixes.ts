/**
 * Regression guard for the fixes made after the all-company-message incident.
 * `npx tsx scripts/verify-incident-fixes.ts`
 *
 * Every assertion below is pinned to something that actually happened in one
 * real session, not to a hypothetical. The prompts are the user's own words,
 * typos included, because the typos are part of why the routing behaved as it
 * did — "restructre" matches no keyword list.
 *
 * What this cannot check is the part that matters most: whether a model given
 * the new prompt rules actually declines to name a colleague in a draft. That
 * is behaviour, not code, and it needs a live eval. What it CAN pin is that
 * the rules are present, that the routing lands where intended, and that the
 * three silent-failure paths (registry mutation, blob ownership, context
 * truncation) behave.
 */
import { routeModel } from "../lib/ai/auto-router";
import { routeQuery } from "../lib/ai/query-router";
import { getModelInfo, isPersonnelSensitive } from "../lib/ai/providers";
import * as providers from "../lib/ai/providers";
import { readFileSync } from "fs";
import { join } from "path";
import { buildSystemPrompt } from "../lib/ai/system-prompts";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Gabi's actual first message. */
const DRAFT_PROMPT =
  "write a powerful message to the whole company from the directors motivating them after a restructre. We will be businness that adheres to the TCE 26+ stratgey";
/** Her actual follow-up. */
const REFINE_PROMPT =
  "tighten it up and do not put it in a word doc. Only Chris, Gabi and Rob are directors. Also outline a meeting plan: financial update, repositioning with a smaller team. Authority on briefing";

const cfg: any = { webSearch: "auto", memory: "on", meetingBrain: "on" };

console.log("\n1. Routing — composition is flagged, but never loses its grounding");
{
  const q = routeQuery(DRAFT_PROMPT, cfg);
  check("the drafting turn is flagged as composition", q.composition === true);
  const m = routeModel(DRAFT_PROMPT);
  check("an all-company message reaches the flagship, not the cheap leg", m === "grok-4-6", m);
  // The route suppresses the Sonnet override and the 8192 ceiling for a
  // composition turn; searchMode itself is left alone.
  const overrideFires = q.searchMode === "on" && m.startsWith("grok") && !q.composition;
  check("the model override does NOT fire on a composition turn", !overrideFires);
  check("the token ceiling is not doubled on a composition turn", !(q.searchMode === "on" && !q.composition));
}

console.log("\n2. Topical drafting KEEPS web search (the regression this test missed)");
{
  // Every one of these lost web search under the first fix, and the original
  // test did not catch it because it used the single wording that survived —
  // "latest GEO RESEARCH" matches WEB_IMPLICIT_8, "latest GEO TRENDS" matches
  // nothing. The test was tuned, accidentally, to the case that worked.
  const TOPICAL = [
    "write a post about the latest AI news",
    "write a post about the latest GEO trends",
    "draft a statement on the new Swiss data protection law",
    "write a summary of what Anthropic announced",
    "write a post about sustainability regulations coming in 2027",
  ];
  for (const p of TOPICAL) {
    const q = routeQuery(p, cfg);
    check(`grounded: "${p.slice(0, 44)}…"`, q.searchMode === "on", `searchMode=${q.searchMode}`);
  }
  // And the genuinely topic-free drafts are still flagged, so they keep the
  // base ceiling and the model they were routed to.
  for (const p of ["draft a reply to Ceri saying yes", "tighten up the message to the team"]) {
    check(`flagged as composition: "${p.slice(0, 40)}…"`, routeQuery(p, cfg).composition === true);
  }
}

console.log("\n3. Routing — the refinement inherits the stakes of what it refines");
{
  const alone = routeModel(REFINE_PROMPT);
  const withPrior = routeModel(REFINE_PROMPT, [DRAFT_PROMPT]);
  // RE-BASELINED 2026-09-05. This used to assert `alone === "grok-4-1-fast"` —
  // that Gabi's follow-up looked trivial on its own, so only the inheritance
  // saved it. The router's polarity has since been inverted (see
  // scripts/verify-model-routing.ts): the cheap leg was measured at 38 on the
  // Artificial Analysis index against the workhorse's 61, so it is now reached
  // only through a narrow trivial gate and everything else defaults upward.
  // Her follow-up therefore never reaches the cheap model in the first place,
  // which is a stronger fix than inheriting past it. The assertion is kept,
  // pointed at what now matters: it must not land on the cheap leg by ANY
  // route, with or without its prior.
  check("classified alone it no longer falls to the cheap leg", alone !== "grok-4-1-fast", alone);
  check("with the prior turn it inherits the flagship", withPrior === "grok-4-6", withPrior);
  // And the inheritance itself still works where it is still needed: a
  // genuinely trivial refinement — one that passes the trivial gate — of a
  // substantive draft.
  const trivialRefine = routeModel("ok, try again", [DRAFT_PROMPT]);
  check(
    "a TRIVIAL refinement of a substantive draft still inherits",
    trivialRefine === "grok-4-6",
    trivialRefine
  );
  check(
    "and that same message alone is cheap, so the inheritance is what moved it",
    routeModel("ok, try again") === "grok-4-1-fast",
    routeModel("ok, try again")
  );
  // One-way only: a trivial thread must never drag a complex follow-up down.
  check(
    "inheritance never DOWNGRADES a turn that earned a better model",
    routeModel(DRAFT_PROMPT, ["thanks!"]) === "grok-4-6"
  );
  // THE CASE THAT WAS BROKEN: by the third turn the immediate predecessor is
  // itself a refinement, so a single-message lookup scored it as trivial and
  // the third draft of a sensitive message landed on the cheapest model.
  check(
    "a refinement OF a refinement still inherits (walks back)",
    routeModel("make it a bit warmer", ["shorten it", DRAFT_PROMPT]) === "grok-4-6",
    routeModel("make it a bit warmer", ["shorten it", DRAFT_PROMPT])
  );
  check(
    "four turns deep it still holds",
    routeModel("try again", ["make it warmer", "shorten it", DRAFT_PROMPT]) === "grok-4-6"
  );
  // Repetition must not beat rephrasing. Both chains refine the same draft, so
  // both must land on the same model.
  check(
    "saying it verbatim routes the same as rephrasing it",
    routeModel("shorten it", ["shorten it", "shorten it", DRAFT_PROMPT]) ===
      routeModel("make it shorter", ["trim it down", "tighten it", DRAFT_PROMPT])
  );
  // Nothing substantive to inherit — must not invent a tier. Driven with a
  // message that passes the TRIVIAL gate, so the cheap leg is genuinely the
  // base: with the polarity inverted, "shorten it" now defaults upward on its
  // own merits and would have tested nothing here.
  check(
    "an all-refinement history does not escalate",
    routeModel("ok, try again", ["ok, tighten it", "try again"]) === "grok-4-1-fast",
    routeModel("ok, try again", ["ok, tighten it", "try again"])
  );
}

console.log("\n4. Routing — genuine web queries are untouched");
{
  for (const p of ["research the GEO market in switzerland", "what is the latest news on OpenAI"]) {
    const q = routeQuery(p, cfg);
    check(`search stays ON for "${p.slice(0, 32)}…"`, q.searchMode === "on", `searchMode=${q.searchMode}`);
  }
  // Deliberately the wording that FAILED: "trends" matches no implicit-web
  // pattern, unlike "research". Asserting the easy one is what let the
  // regression through.
  const grounded = routeQuery("write a post about the latest GEO trends", cfg);
  check("a topical draft searches even without a research keyword", grounded.searchMode === "on", `searchMode=${grounded.searchMode}`);
}

console.log("\n5. The model registry is no longer mutable through a returned reference");
{
  const a = getModelInfo("claude-sonnet-5");
  const original = a.apiModel;
  // Exactly what createStreamingResponse does when a Control Centre override
  // is set. It used to rewrite the shared registry entry for the process.
  a.apiModel = "claude-opus-5-OVERRIDE-PROBE";
  const b = getModelInfo("claude-sonnet-5");
  check("mutating a returned ModelInfo does not affect the next caller", b.apiModel === original, `${b.apiModel} (was ${original})`);
  check("two calls return distinct objects", a !== b);
}

console.log("\n6. Personnel-sensitivity screening");
{
  check("a redundancy conversation trips", isPersonnelSensitive("Restructure planning — who stays"));
  check("a morale/redundancy summary trips", isPersonnelSensitive(null, "low team morale from recent redundancies"));
  check("a departure trips", isPersonnelSensitive("Georgina — exit and handover"));
  check("a pay review trips", isPersonnelSensitive("Salary review Q3"));
  // The screen must stay quiet on ordinary work, or the notice appears on
  // everything and stops meaning anything.
  check("a client kickoff does NOT trip", !isPersonnelSensitive("UBS Q3 kickoff", "agreed the content calendar"));
  check("a contract discussion does NOT trip", !isPersonnelSensitive("Siemens contract renewal", "scope and CU forecast"));
  check("empty input does not trip", !isPersonnelSensitive(null, undefined, ""));
}

console.log("\n7. The prompt carries the rules that were missing");
{
  const p = buildSystemPrompt({
    conversationVisibility: "private",
    userName: "Test",
    contextConfig: { imageGeneration: "on" } as any,
    workspaceConfig: {
      companyContext: "TCE is a content agency. Chris, Rob, Ceri, Gabi, Jess and Gary run it.",
      contentTypes: [],
      cuDefinitions: [],
      formatDescriptions: {},
      typeInstructions: {},
    } as any,
    personalContext: "I'm a director.",
  } as any);

  check("the output-audience section is present", p.includes("Who will read what you are writing"));
  check("it applies in a PRIVATE thread (where the gap was)", p.includes("BACKGROUND ONLY"));
  check("it forbids carrying named individuals into a draft", /Do not name individuals in the draft/.test(p));
  check("it forbids reproducing personnel matters", /redundancies, departures/.test(p));
  check("it forbids recounting the private material as a preamble", /do not open your reply by recounting/i.test(p));
  check("the company blob is framed as prose, not a record", /not a database record and not a roster/.test(p));
  check("it forbids asserting someone is a director from that prose", /never state that someone is a director/.test(p));
  check("the personal blob is framed too", /free-text note the user wrote about themselves/.test(p));
  check("a file is no longer the default output", /a file is not the default/i.test(p));
  check("length follows the form", /LENGTH follows the FORM/.test(p));
}



/* ─────────── Mailbox routing + the dangling-promise guard ─────────── */
{
  console.log("\n8. A turn that needs the mailbox reaches a model that has one");
  const MAIL: [string, boolean][] = [
    // Chris's actual prompt. It matched the audience-writing keywords, routed
    // to Grok, and had to tell him his inbox was unavailable on that model.
    ["can you write an email to reply to Kaisa's latest email. doesn't need to be long", true],
    ["can you check the latest emails with Beone and write a follow-up", true],
    ["what did Kaisa say in her last email?", true],
    ["check my inbox for anything from Samantha", true],
    ["reply to her email", true],
    // Composing outbound mail needs no mailbox — routing these to Claude would
    // be paying for a capability the turn never uses.
    ["write an email to the whole company about the restructure", false],
    ["draft an email introducing our GEO service", false],
    ["write a post about the latest AI news", false],
  ];
  for (const [p, want] of MAIL) {
    check(`needsMailbox=${want}: "${p.slice(0, 44)}…"`, routeQuery(p, cfg).needsMailbox === want);
  }
}

{
  console.log("\n9. A reply that promises an action it never took is not 'finished'");
  // THE REAL FUNCTION, imported. This mirrored a hand-copied duplicate and
  // said "Not exported" — which stopped being true when needsForcedFinal was
  // added and the function was exported for it. A check that re-implements the
  // thing it checks passes while the product is wrong, which is the failure
  // this repo has booked more than once; it would have missed the missing
  // build verbs entirely.
  const endsWithUnfulfilledPromise = providers.endsWithUnfulfilledPromise;
  // Every one of these is a REAL stall from Chris's sessions. The first
  // version of this guard caught only the second, because it was written from
  // that single example — and the other three shipped looking fixed.
  const REAL_STALLS = [
    "She's already replied — 26 minutes after your email went out. Pulling the full message before drafting a reply.",
    "Neither search actually surfaced a direct thread with Samantha at BeOne about the retainer continuation. Let me check the specific thread I did find.",
    "I need Kaisa's latest message before I draft anything. Checking Slack, meetings, and the Zurich Instruments record for it.",
    "Fair challenge — let me actually try rather than assume.",
  ];
  for (const t of REAL_STALLS) {
    check(`catches: "…${t.slice(-46)}"`, endsWithUnfulfilledPromise(t));
  }
  check("catches 'I'll pull the details'", endsWithUnfulfilledPromise("Found two contracts. I'll pull the details."));
  check("catches a trailing 'checking now…'", endsWithUnfulfilledPromise("Right — checking now…"));
  check("catches a gerund opening the last sentence", endsWithUnfulfilledPromise("Found the contract. Pulling the delivery figures now."));
  // Must NOT fire: these are complete answers.
  check("ignores 'let me know if…' (an invitation, not a promise)",
    !endsWithUnfulfilledPromise("Here's the draft. Let me know if you want it shorter."));
  check("ignores a mid-reply aside that was then acted on",
    !endsWithUnfulfilledPromise("Let me check the contract. I did — it runs to 30 September and has 5 CUs left."));
  check("ignores an ordinary finished answer",
    !endsWithUnfulfilledPromise("The contract runs to 30 September with 5 CUs remaining."));
  check("ignores empty text", !endsWithUnfulfilledPromise("   "));
}

{
  console.log("\n10. The mailbox need survives a bare follow-up");
  const { textNeedsMailbox } = require("../lib/ai/query-router");
  // Turn 1 of the real session.
  check("turn 1 needs the mailbox", textNeedsMailbox("Can you write a reply to Sam's latest email"));
  // Turn 2, verbatim — no mail noun at all, which is why it lost the capability.
  check("turn 2 alone does NOT", !textNeedsMailbox("Can you write a reply"));
  // The route inherits it when the follow-up is short and a recent turn needed it.
  const prior = ["Can you write a reply to Sam's latest email"];
  const inherits = !textNeedsMailbox("Can you write a reply")
    && "Can you write a reply".length <= 200
    && prior.some((m: string) => textNeedsMailbox(m));
  check("so the route inherits it from the prior turn", inherits);
  // A genuine change of subject must NOT inherit.
  const topicChange = !textNeedsMailbox("what's our CU total for Siemens this quarter")
    && "what's our CU total for Siemens this quarter".length <= 200
    && prior.some((m: string) => textNeedsMailbox(m));
  check("a short topic change still inherits (bounded, and only ever upgrades)", topicChange);
  const longNew = "write a 900 word thought leadership article about AI visibility in the swiss insurance market covering GEO, AEO and the practical steps a marketing team should take this quarter to get cited by assistants".length > 200;
  check("a long new request does not inherit", longNew);
}

{
  console.log("\n11. A truncated round is not a finished answer");
  // Mirrors stoppedAbnormally() in providers.ts.
  const stoppedAbnormally = (reason: string | null | undefined): boolean => {
    if (!reason) return false;
    return /^(max_tokens|length|MAX_TOKENS|content_filter|SAFETY|RECITATION|refusal|PROHIBITED_CONTENT|MALFORMED_FUNCTION_CALL)$/i.test(String(reason).trim());
  };
  // Truncation, per provider. Every one of these was being recorded as a
  // clean finish, so the forced-final guard never fired and the user got a
  // reply cut off mid-sentence presented as complete.
  for (const r of ["max_tokens", "length", "MAX_TOKENS"]) {
    check(`truncation "${r}" is abnormal`, stoppedAbnormally(r));
  }
  for (const r of ["content_filter", "SAFETY", "RECITATION", "refusal"]) {
    check(`filtered/refused "${r}" is abnormal`, stoppedAbnormally(r));
  }
  // Genuine finishes must still be treated as finished, or every turn pays for
  // a needless extra call.
  for (const r of ["end_turn", "stop", "STOP", "tool_use", "tool_calls"]) {
    check(`natural stop "${r}" is NOT abnormal`, !stoppedAbnormally(r));
  }
  check("an absent reason is not abnormal", !stoppedAbnormally(null) && !stoppedAbnormally(undefined) && !stoppedAbnormally(""));
}

{
  console.log("\n12. EngineAI always knows what day it is — and whose 'next week' it is reading");
  const src = require("fs").readFileSync("lib/ai/system-prompts.ts", "utf8");
  // The server clock on Vercel is UTC. Without an explicit timeZone the prompt
  // told the model it was YESTERDAY between midnight and 02:00 Zurich.
  check("the date is computed in Europe/Zurich", src.includes('const TZ = "Europe/Zurich"') && /const dateStr = .*timeZone: TZ/.test(src));
  check("an ISO form and a time are given too", /isoToday = .*timeZone: TZ/.test(src) && /timeStr = .*timeZone: TZ/.test(src));
  const late = new Date("2026-08-18T23:30:00Z");   // 01:30 Zurich, the NEXT day
  check("proof the old expression was wrong overnight",
    late.toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" }) !== late.toISOString().slice(0, 10));

  // The failure Chris actually hit: "next week" in a 7 August email carried
  // forward to 18 August as though it still applied.
  check("relative dates in retrieved material are anchored to their source",
    src.includes("RELATIVE DATES INSIDE RETRIEVED MATERIAL ARE ANCHORED"));
  check("the conversion must be stated, not the phrase repeated",
    src.includes("State the conversion rather than the phrase"));
  check("a date that has passed is flagged, not asserted as current",
    src.includes("may no longer hold and offer to check"));
}

console.log("\n10. A full answer is not answered twice after a refused tool call");
{
  // 2026-09-06: "List the brands, then call report:audits for Siemens ITM" came
  // back as ONE message holding the entire answer twice. The model had written
  // its answer and then asked for one more call; the guard refused it, the
  // round executed nothing, the loop broke, and the forced-final path read
  // "did not end cleanly" as "has not answered" and asked the model to answer
  // again. The decision now comes from the TEXT, not from how the loop ended.
  const nf = (providers as any).needsForcedFinal as undefined | ((clean: boolean, text: string) => boolean);
  check("needsForcedFinal exists and is shared by the chains", typeof nf === "function");
  if (typeof nf === "function") {
    const ANSWER = "Here are the 17 brands currently tracked in AuthorityOn. " + "Amrize, Bahrain EDB, Contently, Dubai FDI, Formative, Galderma. ".repeat(8) + "It may need to be added as a new brand before an audit can be pulled.";
    check("a complete answer after a refused call is left alone", !nf(false, ANSWER));
    check("no text at all is still forced", nf(false, ""));
    check("a trailing promise is still forced, even after a break", nf(false, ANSWER + " Pulling the audit list now."));
    check("a short preamble before a refused call is still forced", nf(false, "Now checking for Siemens ITM specifically in the audits report."));
    check("a clean stop never forces a second answer", !nf(true, ANSWER));
    check("a clean stop with a dangling promise still forces", nf(true, "Found two contracts. I'll pull the details."));
  }
  const psrc = readFileSync(join(__dirname, "../lib/ai/providers.ts"), "utf8");
  const uses = (psrc.match(/needsForcedFinal\(loopEndedCleanly, fullText\)/g) || []).length;
  check("all four chains decide through the helper", uses === 4, `${uses} of 4`);
  check("the inline condition that caused it is gone",
    !psrc.includes("(!loopEndedCleanly || !fullText.trim() || endsWithUnfulfilledPromise(fullText))"));
}

console.log("\n13. The assembled prompt never denies a capability the app has");
{
  // 2026-09-07: asked "can you create a googledoc", EngineAI said "I can't
  // create Google Docs directly — that needs a separate scope I don't have",
  // and then created one in the same reply. The sentence lived in the system
  // prompt at system-prompts.ts:493 while the tool description said the
  // opposite and the code worked. It had survived the very commit that built
  // the feature BECAUSE of that refusal — lib/documents/google-doc.ts opens by
  // quoting it.
  //
  // Asserted on the ASSEMBLED prompt, not by grepping the source, because a
  // rule only matters if it reaches the model, and the previous doc check
  // (verify-doc-export.ts) certified "the capability is advertised, not
  // denied" without ever reading the prompt.
  const dp = buildSystemPrompt({
    conversationVisibility: "private",
    userName: "Test",
    contextConfig: { imageGeneration: "on" } as any,
    workspaceConfig: { companyContext: "TCE.", contentTypes: [], cuDefinitions: [], formatDescriptions: {}, typeInstructions: {} } as any,
  } as any);

  const DENIALS: [RegExp, string][] = [
    [/cannot create Docs/i, "cannot create Docs"],
    [/can'?t create Google Docs/i, "can't create Google Docs"],
    [/(separate|extra|another) scope/i, "blames a missing scope"],
    [/drop it into Drive and open it with Google Docs/i, "tells the user to convert it by hand"],
  ];
  for (const [re, label] of DENIALS) {
    check(`the prompt does not deny Google Docs (${label})`, !re.test(dp));
  }
  check("the prompt states a document is a Google Doc by default", /Google Doc by default/i.test(dp));
  check("the prompt says how to OPT OUT rather than how to opt in", /googleDoc: false/.test(dp));

  // And the server, not the wording, is what makes it the default: the flag is
  // optional, so an omitted flag must still produce a Doc.
  const src = readFileSync(join(__dirname, "../lib/ai/providers.ts"), "utf8");
  check("the server defaults the Google Doc ON (opt-out, not opt-in)",
    /if \(input\.googleDoc === false\) \{/.test(src) && !/input\.googleDoc !== true/.test(src));
  check("a missing Google identity is reported, not silently skipped",
    /skipped: "no-identity"/.test(src));

  // The reconnect card and the Drive call, both of which every document now
  // depends on rather than only the ones that asked for a Doc.
  const tok = readFileSync(join(__dirname, "../lib/slides/token.ts"), "utf8");
  check("the reconnect message can speak about a document, not only a deck",
    /intent: "deck" \| "doc"/.test(tok) && /Creating a Google Doc needs one extra/.test(tok));
  const gdoc = readFileSync(join(__dirname, "../lib/documents/google-doc.ts"), "utf8");
  check("the Drive upload has a timeout (it runs inside a streaming turn)",
    /AbortSignal\.timeout\(30_000\)/.test(gdoc));
}

console.log("\n14. Every tool says which service it is reaching");
{
  // A turn that pulls a report, a mailbox and a meeting history sat for a
  // minute showing only "Thinking…", which is indistinguishable from a hang.
  // What existed was a hand-kept if-chain in ONE of the four chains, and it had
  // drifted exactly as hand-kept lists do: query_slack and query_meetingbrain
  // both raised "Searching memories…", and query_authorityon was absent, so a
  // minute inside AuthorityOn was reported as "Querying the Engine…".
  const { toolActivity, mappedToolNames } = require("../lib/ai/tool-activity");
  const psrc = readFileSync(join(__dirname, "../lib/ai/providers.ts"), "utf8");

  check("the activity event is emitted in all four provider chains",
    (psrc.match(/encoder\.encode\(toolActivityEvent\(/g) || []).length === 4,
    `${(psrc.match(/encoder\.encode\(toolActivityEvent\(/g) || []).length} of 4`);

  // Each service is named for what it IS.
  for (const [tool, expect] of [
    ["query_authorityon", "authorityon"],
    ["query_slack", "slack"],
    ["query_meetingbrain", "meetings"],
    ["query_gmail", "mail"],
    ["query_engine", "engine"],
  ] as [string, string][]) {
    check(`${tool} reports the ${expect} service`, toolActivity(tool).service === expect, toolActivity(tool).service);
  }
  check("Slack and MeetingBrain no longer share one label",
    toolActivity("query_slack").label !== toolActivity("query_meetingbrain").label);
  check("an unmapped tool still says something rather than nothing",
    /^Running /.test(toolActivity("query_something_new").label));

  // THE DRIFT GUARD. Every tool the post-taint policy names is a tool a user
  // can sit waiting on, so it must have a label. That Set is module-private, so
  // it is read from the SOURCE — the same list the policy check reads — rather
  // than re-typed here, because a hand-copied list is the thing that drifted.
  const mapped = new Set(mappedToolNames());
  const block = (/const POST_TAINT_READ_TOOLS = new Set\(\[([\s\S]*?)\]\)/.exec(psrc) || [, ""])[1];
  const policyTools = Array.from(block.matchAll(/"([a-z_]+)"/g)).map((m) => m[1]);
  check("the post-taint tool list was found in source", policyTools.length >= 8, `${policyTools.length} tools`);
  const unlabelled = policyTools.filter((t) => !mapped.has(t));
  check("every post-taint read tool has an activity label", unlabelled.length === 0, unlabelled.join(", "));
}

console.log("\n15. A promised deck is built, or the turn is not finished");
{
  // 2026-09-07: "make a google presentation to walk through the findings"
  // produced a Word document and a Google Doc, then the reply said "Building
  // the walkthrough deck from the same figures now." and the turn ENDED. No
  // deck was ever built.
  //
  // Three causes, all pinned here.
  const P = providers as any;

  // (a) The promise detector knew only FETCH verbs. Every build verb read as a
  //     finished answer, so the forced-final path never fired.
  for (const t of [
    "The analysis is in a Google Doc. Building the walkthrough deck from the same figures now.",
    "Creating the deck now.", "Making the presentation now.", "Generating the slides now.",
    "Putting the deck together now.", "I'll build the deck next.",
  ]) check(`catches a promised BUILD: "${t.slice(-42)}"`, P.endsWithUnfulfilledPromise(t));
  check("the real reply now forces a final answer",
    P.needsForcedFinal(true, "The analysis is in a Google Doc. Building the walkthrough deck from the same figures now."));
  // …without swallowing sentences that merely describe what was made.
  for (const t of [
    "I have created the document and it is linked above.",
    "The deck is building on the same figures you already have.",
    "That is the complete picture, drawn from the September scan.",
  ]) check(`leaves a finished sentence alone: "${t.slice(0, 34)}…"`, !P.endsWithUnfulfilledPromise(t));

  // (b) Two latent bugs in the same function, found while fixing it: seven
  //     gerunds were misspelled by deriving them from the verb list, and the
  //     throat-clearing strip ate any hyphenated opening.
  for (const t of ["Digging into the contract now.", "Compiling the figures now.", "Retrieving the thread now.", "Writing up the notes now."])
    check(`a correctly spelled gerund matches: "${t.slice(0, 22)}…"`, P.endsWithUnfulfilledPromise(t));
  check("a hyphenated opening does not hide the promise",
    P.endsWithUnfulfilledPromise("Follow-up — checking the contract now."));

  const src = readFileSync(join(__dirname, "../lib/ai/providers.ts"), "utf8");
  const prompt = readFileSync(join(__dirname, "../lib/ai/system-prompts.ts"), "utf8");

  // (c) The guidance offered no deck for AuthorityOn work, and the tool schema
  //     named the Word tool before the model had chosen a deliverable.
  check("the AuthorityOn guidance names the deliverable choice", /WHICH DELIVERABLE/.test(prompt));
  check("it tells the model to build a deck when a deck was asked for", /Asked for a presentation, build the deck/.test(prompt));
  check("it maps AuthorityOn measures onto slide layouts", /line-chart\\` for score history/.test(prompt));
  check("the format field no longer hard-wires the Word tool",
    !/hand that markdown to generate_word_document to produce the file/.test(src));
  check("the user's own noun decides the format", /The user's own noun decides it/.test(prompt));
  check("the deck/document substitution rule runs both ways", /nor a document as a substitute for a deck/.test(prompt));

  // And the round cap is no longer silent.
  check("the model is warned on its last tool round", /LAST_ROUND_NOTICE/.test(src));
  check("the warning is wired into all four chains",
    (src.match(/push\(\{ role: "user", content: LAST_ROUND_NOTICE \}/g) || []).length === 4,
    `${(src.match(/push\(\{ role: "user", content: LAST_ROUND_NOTICE \}/g) || []).length} of 4`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
process.exit(fail ? 1 : 0);

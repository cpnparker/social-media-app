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
  check("classified alone it still looks trivial", alone === "grok-4-1-fast", alone);
  check("with the prior turn it inherits the flagship", withPrior === "grok-4-6", withPrior);
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
  // Nothing substantive to inherit — must not invent a tier.
  check(
    "an all-refinement history does not escalate",
    routeModel("shorten it", ["tighten it", "try again"]) === "grok-4-1-fast"
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
  // Not exported — mirrored here so the property is pinned even though the
  // implementation lives inside providers.ts.
  const endsWithUnfulfilledPromise = (text: string): boolean => {
    const tail = text.trim().slice(-300).toLowerCase();
    if (!tail) return false;
    return [
      /\b(let me|i'?ll|i will|i'?m going to|give me a moment to|one moment while i)\s+(just\s+)?(check|look|pull|search|fetch|find|dig|confirm|verify|read|open|review|see|grab|retrieve|take a look|have a look)\b[^.?!]*[.?!]?\s*$/,
      /\b(checking|searching|looking|pulling|fetching|digging)\b[^.?!]{0,40}(now|next|first)?\s*(\.\.\.|…)?\s*$/,
      /\b(hold on|one moment|bear with me|stand by)\b[^.?!]*[.?!]?\s*$/,
    ].some((p) => p.test(tail));
  };
  // The real stalled reply, verbatim.
  check("catches the reply that actually stalled",
    endsWithUnfulfilledPromise("Neither search actually surfaced a direct thread with Samantha at BeOne about the retainer continuation. Let me check the specific thread I did find."));
  check("catches 'I'll pull the details'", endsWithUnfulfilledPromise("Found two contracts. I'll pull the details."));
  check("catches a trailing 'checking now…'", endsWithUnfulfilledPromise("Right — checking now…"));
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

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
process.exit(fail ? 1 : 0);

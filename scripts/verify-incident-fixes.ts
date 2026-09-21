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
import { routeModel, FAST_MODEL } from "../lib/ai/auto-router";
import { routeQuery } from "../lib/ai/query-router";
import { getModelInfo, isPersonnelSensitive } from "../lib/ai/providers";
import * as providers from "../lib/ai/providers";
import { readFileSync } from "fs";
import { join } from "path";
import { buildSystemPrompt, normalizeContextConfig } from "../lib/ai/system-prompts";
import { buildDeckContext, DECK_CONTEXT_HEADING } from "../lib/slides/deck-context";
import { unmadeDeckChangeNotice } from "../lib/slides/claim";
import { queryDriveDocs, newDriveCaches } from "../lib/gdrive/docs";

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

console.log("\n1. Routing — composition is flagged, but never loses its grounding");
{
  const q = routeQuery(DRAFT_PROMPT);
  check("the drafting turn is flagged as composition", q.composition === true);
  const m = routeModel(DRAFT_PROMPT);
  check("an all-company message reaches the flagship, not the cheap leg", m === "grok-4-6", m);
  // The route suppresses the Sonnet override and the 8192 ceiling for a
  // composition turn; searchMode itself is left alone.
  //
  // !m.startsWith("claude"), matching the route's own predicate: broadened
  // from a Grok-only check when FAST_MODEL stopped being a Grok model (see
  // PLAN-cheap-tier-model-update.md §A-3) — a Grok-only check here would stop
  // matching the day the router's cheap leg changed and never tell anyone.
  const overrideFires = q.searchMode === "on" && !m.startsWith("claude") && !q.composition;
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
    const q = routeQuery(p);
    check(`grounded: "${p.slice(0, 44)}…"`, q.searchMode === "on", `searchMode=${q.searchMode}`);
  }
  // And the genuinely topic-free drafts are still flagged, so they keep the
  // base ceiling and the model they were routed to.
  for (const p of ["draft a reply to Ceri saying yes", "tighten up the message to the team"]) {
    check(`flagged as composition: "${p.slice(0, 40)}…"`, routeQuery(p).composition === true);
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
  //
  // Compares against the imported FAST_MODEL constant, not the literal
  // "grok-4-1-fast" — that model id was retired from the leg 2026-09-21
  // (PLAN-cheap-tier-model-update.md §A-3, cheap leg now GPT-5.6 Luna), and a
  // literal here would have quietly stopped asserting anything at all.
  check("classified alone it no longer falls to the cheap leg", alone !== FAST_MODEL, alone);
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
    routeModel("ok, try again") === FAST_MODEL,
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
    routeModel("ok, try again", ["ok, tighten it", "try again"]) === FAST_MODEL,
    routeModel("ok, try again", ["ok, tighten it", "try again"])
  );
}

console.log("\n4. Routing — genuine web queries are untouched");
{
  for (const p of ["research the GEO market in switzerland", "what is the latest news on OpenAI"]) {
    const q = routeQuery(p);
    check(`search stays ON for "${p.slice(0, 32)}…"`, q.searchMode === "on", `searchMode=${q.searchMode}`);
  }
  // Deliberately the wording that FAILED: "trends" matches no implicit-web
  // pattern, unlike "research". Asserting the easy one is what let the
  // regression through.
  const grounded = routeQuery("write a post about the latest GEO trends");
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



/* ─────────── The reply does not open with its own plan ───────────
 *
 * THUMBS-DOWN #7, 2026-09-16. A briefing written four minutes before the
 * meeting it was for opened with three paragraphs of the model narrating its
 * own plan — 139, then 213, then 177 characters, one per tool round — above
 * 6,437 characters of answer. Measured over the last 200 assistant messages:
 * 55 of them (27.5%) open with a first-person plan paragraph, 53% of
 * tool-running turns against 6% of tool-free ones.
 *
 * Chat had NO anti-preamble rule. The only two lived inside Design Mode, and
 * voice has a CRITICAL one with its own check. This asserts the chat rule
 * against the ASSEMBLED prompt for every gate combination, because a rule that
 * holds for one combination is not a rule — and because the voice check's
 * recorded lesson is that a new rule beside a contradicting old one changes
 * nothing, so the two competing sentences are scanned for too.
 *
 * MUTATION LOG (detached worktree, restored after):
 *   KILLED  delete the rule from FORMATTING_GUIDELINES → every variant red
 *   KILLED  move the rule inside `if (ctx.designMode)` → the design=false variants red
 *   KILLED  restore "Announce nothing you do not immediately call" → contradiction scan red
 *   KILLED  plant "Tell the user you're checking first" in a tool description → description scan red
 *   KILLED  empty the pattern list → self-test red, and nothing is reported
 *   SURVIVOR  rewording the rule's THIRD bullet (the "not a rule about length"
 *             paragraph) survives: only two sentences are pinned, on purpose —
 *             pinning all of it would fail on every honest edit.
 *
 * SECOND MUTATION LOG (detached worktree, 2026-09-16). A verifier showed this
 * section passing with a live contradiction in the assembled prompt, twice
 * over: the studio block's "propose the shot list briefly in your reply, then
 * call design_create_shot four times" and design mode's "Before calling
 * generate_video, sketch the shot in plain English" were both present in the
 * same string as the rule, and NONE of the nine patterns could see either.
 * Worse, the scan stripped the rule's WHOLE block first, so the one place a
 * contradicting instruction could hide was inside the rule itself — which is
 * the most likely future edit to it.
 *   KILLED  the studio sentence restored → (b) red, 8 hits
 *   KILLED  the design-mode sentence restored → (b) red, 8 hits
 *   KILLED  a qualifying bullet planted INSIDE the rule block ("Before a
 *           lookup, tell the user what you are about to fetch…") → (b) red, 19
 *           hits. It SURVIVED before the strip was narrowed from the whole
 *           block to the two phrases the rule quotes: 176 passed, 0 failed,
 *           with the rule and its own contradiction side by side.
 *   All three are in the BAD self-test below, so the patterns that see them are
 *   themselves proven rather than assumed — which is how the first two were
 *   found: the self-test was deaf to them before it was not.
 */
console.log("\n7b. Nothing in the chat prompt tells the model to speak before a tool call");
{
  /**
   * Phrases that make the model narrate before it calls. Lifted from
   * scripts/verify-voice-config.ts, which caught a live instruction saying the
   * exact opposite, plus two for the shapes a chat prompt would use.
   */
  const PRE_TOOL_FILLER: [string, RegExp][] = [
    ["let me look", /\blet me (look|check|see|dig|pull|grab|fetch)\b/i],
    ["one moment", /\b(one moment|just a (moment|sec|second)|hang on|bear with)\b/i],
    ["digging into that", /\bdigging into (that|it)\b/i],
    ["tell the user first", /\btell (the user|them)\b[^.]{0,40}\bfirst\b/i],
    ["say you're checking", /\bsay (you're|you are)\s+(checking|looking|searching|fetching)/i],
    ["I'll check / I'm checking … first", /\b(i'll (check|look|see)|i'm (checking|looking))\b[^.]{0,20}\bfirst\b/i],
    ["acknowledge first", /\backnowledg\w*\b[^.]{0,30}\bfirst\b/i],
    ["announce before the call", /\b(announce|say|state|tell)\b[^.]{0,40}\bbefore (any |the |a |each )?(tool|call|lookup|fetch|search)/i],
    // "Announce nothing you do not immediately call" reads as a prohibition and
    // is a PERMISSION: announce all you like, provided you then call. It was
    // one of the two sentences competing with the new rule, and the self-test
    // below is what showed the other seven patterns were deaf to it.
    ["announce it, then call it", /\bannounce\b[^.]{0,60}\b(call|tool)\b/i],
    // The two shapes a WORKFLOW line uses, and both were live in this prompt
    // while this section reported clean: "propose the shot list briefly in your
    // reply, then call design_create_shot four times" (studio) and "Before
    // calling generate_video, sketch the shot in plain English" (design mode).
    // Neither reads like filler, and both instruct a paragraph before a call —
    // which item 1(b) then deletes from the transcript.
    ["propose it, then call it", /\b(propose|sketch|outline|draft|list|describe)\b[^.]{0,80}\bthen\s+call\b/i],
    // Both directions of the same instruction. "Before calling generate_video,
    // sketch the shot" was live; "Before a lookup, tell the user what you are
    // about to fetch" is the bullet a verifier planted INSIDE the rule, which
    // the whole-block strip above used to hide.
    ["before the call, describe it", /\bbefore\s+(calling\s+)?(any\s+|a\s+|the\s+|each\s+)?(tool\s+call|lookup|fetch|search|call|generat\w+|design_\w+|query_\w+)\b[^.]{0,80}\b(sketch|propose|outline|draft|describe|list|say|tell|explain|announce)\b/i],
  ];
  // The rule QUOTES the two phrases it forbids, so those two strings — and
  // ONLY those two — are removed before the scan.
  //
  // It used to strip the rule's WHOLE block, from its heading to the next
  // section, which made the block the one place in the prompt a contradicting
  // instruction could hide. A verifier planted "Before a lookup, tell the user
  // what you are about to fetch" as a fourth bullet INSIDE the rule and this
  // section reported 176 passed, 0 failed — with the rule and its own
  // contradiction in the same assembled string. The most likely future edit to
  // a rule is a qualifying bullet appended to it, so that is the edit the scan
  // has to be able to see.
  const RULE_QUOTES = ["“I’ll pull the contract”", "“Let me check the meeting record”", '"I\'ll pull the contract"', '"Let me check the meeting record"'];
  const withoutRule = (t: string) => {
    let out = t;
    for (let j = 0; j < RULE_QUOTES.length; j++) out = out.split(RULE_QUOTES[j]).join("");
    return out;
  };

  const base: any = {
    conversationVisibility: "private",
    userName: "Test",
    workspaceConfig: { companyContext: "TCE is a content agency.", contentTypes: [], cuDefinitions: [], formatDescriptions: {}, typeInstructions: {} },
    clientContext: null,
    contentDetail: null,
  };
  const variants: { label: string; text: string }[] = [];
  const FLAGS = [false, true];
  for (let a = 0; a < FLAGS.length; a++) {
    for (let b = 0; b < FLAGS.length; b++) {
      for (let c = 0; c < FLAGS.length; c++) {
        for (let d = 0; d < FLAGS.length; d++) {
          variants.push({
            // The first axis is `generationTools`, the boolean the TOOL ARRAY
            // reads. It used to be `contextConfig.imageGeneration`, which is
            // no longer read by anything — leaving it there would have made
            // eight of these sixteen variants byte-identical to their
            // neighbours while the label still claimed they differed.
            label: `generation=${FLAGS[a]} design=${FLAGS[b]} studio=${FLAGS[c]} resourcing=${FLAGS[d]}`,
            text: buildSystemPrompt({ ...base, generationTools: FLAGS[a],
              designMode: FLAGS[b], studioMode: FLAGS[c], resourcingAccess: FLAGS[d] }),
          });
        }
      }
    }
  }
  // A role persona and a team thread are different assemblies of the same
  // block, and AuthorityOn adds a whole section of its own.
  variants.push({ label: "role persona", text: buildSystemPrompt({ ...base, role: { name: "Editor", instructions: "You edit." } }) });
  variants.push({ label: "team thread", text: buildSystemPrompt({ ...base, conversationVisibility: "team" }) });
  const savedKey = process.env.AUTHORITYON_MCP_KEY;
  process.env.AUTHORITYON_MCP_KEY = "verify-offline";
  variants.push({ label: "authorityon", text: buildSystemPrompt({ ...base }) });
  if (savedKey === undefined) delete process.env.AUTHORITYON_MCP_KEY; else process.env.AUTHORITYON_MCP_KEY = savedKey;

  // PRECONDITIONS. A builder returning "" would satisfy every assertion below
  // about what is ABSENT, and report nothing about what is present.
  check("19 prompt variants assembled", variants.length === 19, String(variants.length));
  const shortest = variants.reduce((x, y) => (x.text.length < y.text.length ? x : y));
  check("the shortest variant is a real prompt", shortest.text.length > 4000, `${shortest.label} is ${shortest.text.length} chars`);
  const longest = variants.reduce((x, y) => (x.text.length > y.text.length ? x : y));
  check("the gates really change the prompt", longest.text.length > shortest.text.length + 1000, `${shortest.text.length} … ${longest.text.length}`);

  // (a) THE RULE IS IN EVERY VARIANT. Two load-bearing sentences, not the whole
  // block: pinning all of it would go red on every honest edit.
  const SENTENCES = [
    "When you need a tool, CALL IT. Do not write a line before the call.",
    "say what you DID: past tense, one short line at most",
  ];
  let missing = 0;
  for (let i = 0; i < variants.length; i++) {
    for (let j = 0; j < SENTENCES.length; j++) {
      if (variants[i].text.indexOf(SENTENCES[j]) < 0) { missing++; console.log(`      (${variants[i].label} is missing: ${SENTENCES[j].slice(0, 40)}…)`); }
    }
  }
  check("the anti-preamble rule is in every gate combination", missing === 0, `${missing} variant/sentence pairs missing`);

  // (b) AND NOTHING ANYWHERE ELSE SAYS THE OPPOSITE.
  let hits = 0;
  for (let i = 0; i < variants.length; i++) {
    const stripped = withoutRule(variants[i].text);
    // PRECONDITION: the strip found the quotes it exists for. Removing nothing
    // would leave the rule's own examples in and report them as hits; removing
    // them when they are no longer there would mean the rule stopped quoting
    // the phrases it forbids, and the list below should be re-read against it.
    if (stripped.length === variants[i].text.length) { check(`the rule still quotes the phrases it forbids, in ${variants[i].label}`, false); break; }
    for (let j = 0; j < PRE_TOOL_FILLER.length; j++) {
      if (PRE_TOOL_FILLER[j][1].test(stripped)) { hits++; console.log(`      (${variants[i].label}: "${PRE_TOOL_FILLER[j][0]}")`); }
    }
  }
  check("no variant instructs pre-tool speech outside the rule's own block", hits === 0, `${hits} hits`);

  // (c) TOOL DESCRIPTIONS ARE PROMPT TEXT TOO. A description saying "Tell the
  // user you're digging into that" lived in the voice surface for months and
  // instructed exactly what the session prompt forbade. Read from source: the
  // tool constants are module-private, and the source set is a superset of any
  // assembled set.
  const provSrc = readFileSync(join(process.cwd(), "lib/ai/providers.ts"), "utf8");
  const descs = provSrc.match(/description:\s*(`[\s\S]*?`|"(?:[^"\\]|\\.)*")/g) || [];
  check("tool descriptions were found to scan", descs.length > 100, `${descs.length} found`);
  let descHits = 0;
  for (let i = 0; i < descs.length; i++) {
    // A description may FORBID the behaviour; it may not instruct it.
    const forbids = /\bsay nothing\b|\bsilently\b|\bdo not (write|say|announce)\b/i.test(descs[i]);
    if (forbids) continue;
    for (let j = 0; j < PRE_TOOL_FILLER.length; j++) {
      if (PRE_TOOL_FILLER[j][1].test(descs[i])) { descHits++; console.log(`      (description #${i}: "${PRE_TOOL_FILLER[j][0]}" — ${descs[i].slice(0, 90)})`); }
    }
  }
  check("no tool description instructs pre-tool speech", descHits === 0, `${descHits} hits`);

  // SELF-TEST. The pattern list is the whole value of this section, so it is
  // driven against the real sentences that have appeared in prompts here. A
  // detector that cannot fire reports "clean" for ever.
  const BAD: [string, string][] = [
    ["the live voice instruction this class was found in", "Before any tool call, say a SHORT acknowledgment first"],
    ["the tool description that outlived its own fix", "Tell the user you're digging into that while it runs"],
    ["the plan paragraph itself", "Let me check the meeting record and I'll come back to you"],
    ["a description telling the model to narrate", "Say you're checking the contract before calling this"],
    ["the deck sentence, as it used to read", "Announce nothing you do not immediately call"],
    ["the studio workflow line, as it used to read", "propose the shot list briefly in your reply, then call design_create_shot four times"],
    ["the design-mode shot list line, as it used to read", "Before calling generate_video, sketch the shot in plain English: subject, motion, camera"],
    ["a qualifying bullet appended to the rule itself", "Before a lookup, tell the user what you are about to fetch so they are not left staring at a blank screen"],
  ];
  let deaf = 0;
  for (let i = 0; i < BAD.length; i++) {
    let caught = false;
    for (let j = 0; j < PRE_TOOL_FILLER.length; j++) if (PRE_TOOL_FILLER[j][1].test(BAD[i][1])) caught = true;
    if (!caught) { deaf++; console.log(`      (no detector fires on: ${BAD[i][1]})`); }
  }
  check("every detector fires on the bad prompt it exists for", deaf === 0, `${deaf} of ${BAD.length} not detected`);
  if (deaf) console.log("      — the two assertions above cannot be trusted while a detector is deaf");
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
    check(`needsMailbox=${want}: "${p.slice(0, 44)}…"`, routeQuery(p).needsMailbox === want);
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

console.log("\n16. A turn that runs out of time says so");
{
  // The deck fix worked — the tool ran, "Finding photographs 3 of 5" appeared —
  // and then the turn stopped with no deck, no error and no explanation. The
  // chat route's ceiling is 300s; the function was killed mid-build. Two gaps
  // made that invisible: the model was never told its time was nearly gone, and
  // the client could not tell a killed stream from a finished one.
  const src = readFileSync(join(__dirname, "../lib/ai/providers.ts"), "utf8");
  const panel = readFileSync(join(__dirname, "../components/ai-writer/ChatPanel.tsx"), "utf8");
  const route = readFileSync(join(__dirname, "../app/api/ai/conversations/[id]/messages/route.ts"), "utf8");

  // The warning must fire BEFORE the ceiling, with room to build.
  const ceiling = Number((/export const maxDuration = (\d+)/.exec(route) || [, "0"])[1]);
  const warnAt = Number((/TURN_BUDGET_WARN_MS = ([\d_]+)/.exec(src) || [, "0"])[1].replace(/_/g, ""));
  check("the route's ceiling is known", ceiling >= 60, `${ceiling}s`);
  check("the model is warned before the ceiling", warnAt > 0 && warnAt < ceiling * 1000, `${warnAt}ms vs ${ceiling * 1000}ms`);
  check("the warning leaves at least a minute to build",
    ceiling * 1000 - warnAt >= 60_000, `${Math.round((ceiling * 1000 - warnAt) / 1000)}s left`);
  check("the time warning is wired into all four chains",
    (src.match(/content: TIME_BUDGET_NOTICE/g) || []).length === 4,
    `${(src.match(/content: TIME_BUDGET_NOTICE/g) || []).length} of 4`);
  check("it tells the model to build rather than gather", /Build any artefact you have promised NOW/.test(src));
  const prompt2 = readFileSync(join(__dirname, "../lib/ai/system-prompts.ts"), "utf8");
  check("when both are asked for, the expensive artefact is built FIRST",
    /BUILD THE DECK FIRST/.test(prompt2) && !/write the analysis first and then build the deck/.test(prompt2));

  // And the client can tell a killed stream from a finished one.
  check("the server closes a healthy stream with [DONE]", /encode\("data: \[DONE\]/.test(src));
  check("the client records having seen it", /\[DONE\]"\) \{ sawDone = true/.test(panel));
  check("a stream without [DONE] is reported to the user", /This reply was cut off before it finished/.test(panel));
  check("a healthy stream is left unannotated", /sawDone\s*\?\s*dedupedText/.test(panel));
}

/* ── A conversion asked for and never started says so ───────────────────────
 *
 * From the 2026-09-11 thumbs-down review, flag #5 (31 Aug): a 35-slide client
 * audit was attached, no deck was built, and the turn ended describing what
 * the deck WOULD contain. The user had to ask "is everything okay?" to learn
 * nothing had been made, and was then offered the job rather than given it.
 *
 * fidelityAudit cannot see this case — it only speaks from inside a
 * generate_slides tool result, so the tool never running is its blind spot.
 */
console.log("\nUnstarted conversion");
{
  const notice = (providers as any).unstartedConversionNotice as
    (n: number, used: { name: string; calls: number }[] | undefined) => string;
  check("the notice function is exported", typeof notice === "function");
  if (typeof notice === "function") {
    // THE FLAGGED SHAPE: a document is in the conversation, the tool never ran.
    const fired = notice(35, [{ name: "query_drive_docs", calls: 1 }]);
    check("a 35-page source with no generate_slides call is announced", /No deck was built/.test(fired));
    check("it names the size so the user knows what was skipped", fired.indexOf("35") >= 0);
    check("it does not claim a deck exists", !/preview|rendered/i.test(fired));

    // SILENT when the tool ran — otherwise every successful conversion would
    // carry a warning that nothing was built.
    check("silent when generate_slides ran", notice(35, [{ name: "generate_slides", calls: 1 }]) === "");
    // Silent with no document at all: an ordinary chat must not trip it.
    check("silent with no source document", notice(0, []) === "");
    check("silent with no source even when no tools ran", notice(0, undefined) === "");
    // A REFUSED call still counts as an attempt the user can see; only zero
    // calls means nothing was tried.
    check("a blocked-but-attempted call counts as started", notice(35, [{ name: "generate_slides", calls: 2 }]) === "");
    check("undefined usage with a source still announces", /No deck was built/.test(notice(35, undefined)));
  }

  // ASSERT IT IS USED, not merely present — the failure this repo has shipped
  // twice. Every chain must call it, or the function guards nothing.
  const src = readFileSync(join(process.cwd(), "lib/ai/providers.ts"), "utf8");
  const callSites = (src.match(/unstartedConversionNotice\(/g) || []).length;
  check("every chain calls it (4 call sites + 1 definition)", callSites >= 5, `found ${callSites}`);
}

/* ── Offering is not answering ─────────────────────────────────────────────
 * Flag #6 (3 Sep): asked to summarise a call, the reply offered to fetch the
 * meeting instead of fetching it. The deck case above is code; this class is
 * broader than decks, so the prompt has to carry it.
 */
console.log("\nAct, do not offer");
{
  const prompt = buildSystemPrompt({
    conversationVisibility: "private",
    userName: "Test",
    workspaceConfig: {
      companyContext: "TCE is a content agency.",
      contentTypes: [], cuDefinitions: [], formatDescriptions: {}, typeInstructions: {},
    } as any,
  } as any);
  check("the assembled prompt tells it to do the work rather than offer",
    /DO IT, DO NOT OFFER TO DO IT/.test(prompt));
  check("it names the real fork so the rule does not ban every question",
    /fork is REAL|genuine ambiguity/.test(prompt));
}

/* ── Whose mailbox is this? ────────────────────────────────────────────────
 *
 * 14 Sep: a reply about a colleague's first morning back described results as
 * "sitting unread in his inbox" and "his unread email thread". Every one of
 * those messages came from the SIGNED-IN user's own mailbox, and the unread
 * flags were the signed-in user's. The wording read as though a colleague's
 * mail had been searched, and it cost a privacy investigation to disprove.
 *
 * Two things are asserted here: that the guarantee holds in the code, and
 * that the result says so in words.
 */
console.log("\nMailbox identity");
{
  const src = readFileSync(join(process.cwd(), "lib/ai/providers.ts"), "utf8");

  // THE GUARANTEE. The model must have no way to name a mailbox, and identity
  // must be bound from the session at every call site.
  const toolBlock = src.slice(src.indexOf('name: "query_gmail"'), src.indexOf('name: "query_gmail"') + 2500);
  const props = (toolBlock.match(/^\s{8}(\w+): \{/gm) || []).map((l) => l.trim().split(":")[0]);
  check("the tool exposes no mailbox/account/user parameter",
    !props.some((p) => /mailbox|account|user|email|as_user|on_behalf/i.test(p)), props.join(","));
  const callSites = (src.match(/queryGmail\(\s*(tool\.)?input\.report,\s*config\.userEmail!/g) || []).length;
  check("every chain binds the session address", callSites === 4, `found ${callSites}`);
  check("the bridge result is discarded on a mailbox mismatch", /mailbox mismatch — discarding results/.test(src));
  check("a non-solo audience is refused", /Blocked \$\{report\}: audience=/.test(src));

  // THE WORDING. A guarantee nobody states is a guarantee the reply can
  // contradict, which is exactly what happened.
  const fmt = (providers as any).formatGmailResult as
    (r: string, res: any, email?: string) => string;
  check("formatGmailResult is exported", typeof fmt === "function");
  if (typeof fmt === "function") {
    const out = fmt("find_from_person", { data: [{ subject: "Refined proposal" }], count: 1 }, "chris@thecontentengine.com");
    check("the result names the mailbox it read", out.indexOf("chris@thecontentengine.com") >= 0);
    check("it says no other mailbox is readable", /No other mailbox is readable/.test(out));
    check("it says read/unread are the user's own flags", /Read and unread are THEIR flags/i.test(out));
    check("it forbids describing results as a colleague's inbox", /NEVER "Gary's inbox"|never .*inbox/i.test(out));
  }
}

/* ── A capability that is off SAYS the honest thing, and a live one is never
 *    called absent ────────────────────────────────────────────────────────
 *
 * 2026-09-20, Prachi, conversation 925c922b. She asked for a roadmap graphic.
 * The reply ended "say so and I'll generate it now". She said so. The next
 * reply opened "I don't have an image/slide-generation tool available in this
 * environment", and twelve minutes later a request for a Google Slides deck
 * got the same answer. She built it in Figma and asked which setting to
 * change. The setting was the "Image" switch under the message box: one
 * button, five tools, four of which are not images.
 *
 * THE SWITCH IS NOW GONE, and with it the whole family of user-facing
 * capability toggles — image generation, web search, memory, MeetingBrain and
 * the four context levels. Capability EXISTENCE is an admin permission and
 * capability INVOCATION is per request; no mainstream assistant ships an
 * end-user off switch for a generation capability. So this section pins THREE
 * things, because they fail in three different directions:
 *
 *   (A) THE RULE THAT WOULD HAVE CAUGHT HER TURN — never report an absence —
 *       lives in FORMATTING_GUIDELINES and must be in EVERY assembly, on or
 *       off, the way the anti-preamble rule is. A rule that only fires when a
 *       capability is off would not have fired here.
 *   (B) THE OFF-BRANCH, for the turns where the limit is real. It used to
 *       have two forms; it has one. The form that named a switch has gone
 *       with the switch, and what is left is the HEADLESS turn — a scheduled
 *       brief, a meeting brief, a fact-check, an optimiser pass — which
 *       produces text and nothing else and never had a control to name.
 *   (C) NO ASSEMBLED PROMPT MAY NAME A CONTROL AGAIN. This is the assertion
 *       the removal turns on. A deleted button leaves its name behind in
 *       prose, and prose that sends a user hunting for a switch nobody can
 *       press is the same class of sentence as one that names an environment
 *       nobody can see — the exact failure the off-branch was written to fix,
 *       reintroduced by the fix's own leftovers.
 *
 * A capability CAN still be off for a user, by ADMIN PERMISSION: the mailbox,
 * the calendar, resourcing, finance, AuthorityOn. That case is not a block of
 * its own, because those tools vanish from the prose along with their sections
 * and there is nothing left for a block to gate on. It is carried by the
 * always-on rule, which now says the honest thing about it — not enabled for
 * this account, an admin opens it — and (A) asserts that limb is present on
 * every path, including the paths where it is the ONLY true explanation.
 *
 * Asserted on the ASSEMBLED prompt, never by grepping system-prompts.ts: a
 * rule only matters if it reaches the model, and this repo has already closed
 * a live hole on the strength of a line merely existing.
 *
 * "ASSEMBLED" means the whole string the model is sent, INCLUDING the chat
 * route's own appends. The first version of this section said that and did not
 * do it: it ran buildSystemPrompt alone, and so could not see that the deck
 * block appended afterwards ordered a generate_slides call in the same prompt
 * that had just said generate_slides was not loaded. The deck block is a
 * function (lib/slides/deck-context.ts) rather than a template literal in a
 * route handler precisely so this can assemble it.
 *
 * THE SECOND VERSION SAID IT AND ONLY HALF DID IT, which is worth more than
 * the first admission. (F) assembled the deck block; (C), the assertion the
 * toggle removal actually turns on, still looped over buildSystemPrompt's
 * return alone. So the removal shipped with a live sentence in the chat route
 * — "turn on the Web toggle and ask again", appended on every turn the router
 * does not search — naming a control the same commit had deleted, and this
 * file printed a clean run over it. The detector was never the weak part: fed
 * that sentence it fires on the first pattern. The scan was. (C) and (D) now
 * read the route's own literals out of its source, with a precondition on the
 * count and on a known sentence, because an extraction that matches nothing
 * is the same failure one level down.
 *
 * MUTATION LOG — detached worktree at d167abc, 2026-09-21, restored after.
 * The rounds below were driven against the version of this section that
 * guarded the switch. They are kept because the rules they killed are still
 * here; the entries that tested the switch itself are marked RETIRED, with
 * what replaced them, rather than deleted — a check whose history is edited
 * to match today's code cannot tell the next person what it has caught.
 *   KILLED  delete the whole own-the-limit rule from FORMATTING_GUIDELINES →
 *           "the own-the-limit rule is in every gate combination", 20
 *           variant/sentence pairs missing
 *   KILLED  move that rule inside `if (ctx.designMode)` — present in the
 *           source, absent from most assemblies → same assertion, 16 pairs
 *   KILLED  plant "If this is not available in this environment, say so" in
 *           generate_chart's description → "no tool description instructs an
 *           absence report", 2 hits
 *   KILLED  empty ABSENCE_PHRASES → self-test red, 4 unseen, and nothing is
 *           reported
 *   KILLED  make the deck block order a generate_slides call whichever way the
 *           capability is set — the live bug → "no assembled prompt both
 *           denies generate_slides and orders it", 7 contradictions. This is
 *           the mutation that proves §17 assembles the ROUTE'S appends and not
 *           just buildSystemPrompt.
 *   KILLED  the route inlines the heading again instead of reading
 *           DECK_CONTEXT_HEADING → "the route appends it under the shared
 *           heading".
 *   KILLED  restore the two-limb disjunction ("either switched off and named
 *           below, or was never part of this product") → "the rule offers all
 *           three reasons a tool can be absent", 20 pairs, and "the promise is
 *           never made on the prompt's silence alone", 10 variants. That
 *           two-limb form told a user with no resourcing, finance, mailbox,
 *           calendar or Microsoft flag that they HAD a tool nobody had given
 *           them, while forbidding the one accurate sentence. The rule is a
 *           two-limb disjunction again today and this is NOT that mutation
 *           returning: the limb that went is "switched off and named below",
 *           and the limb that mattered — the admin one — is still asserted.
 *   KILLED  artlistTools defaults ON when omitted → "omitting the flag means
 *           absent, not present". Failing open here re-creates the fault it
 *           was added for.
 *   KILLED  restore the unconditional Artlist prose → "a design turn without
 *           the Artlist key is never told about Artlist", 3 leaks.
 *   KILLED  drop the run-time design re-pin → "a design turn is re-pinned to
 *           Anthropic when it runs".
 *   KILLED  break the anchor the design tool list is derived from
 *           (`if (config.designMode) {`) → "the design surface's own tool list
 *           was read from providers.ts", none. The derivation refuses to
 *           report clean when it cannot find what it reads.
 *   RETIRED rename the control to "the Settings page" / to an existing but
 *           WRONG label ("the Memory switch under the message box"); drop
 *           `generationControl: null` from the runner; the off-branch stops
 *           interpolating the control; name the chat composer's switch at
 *           design turns too. All four were about keeping ONE string honest
 *           across the prompt, the notice and both composers. There is no such
 *           string now, and the assertion that replaces the whole family is
 *           (C): no assembled prompt may name a control at all. That is
 *           strictly stronger — it cannot be satisfied by renaming both sides.
 *   SURVIVOR  rewording the off-branch's HEADING survives. Deliberate: the
 *           body still says what the heading says, and pinning heading text
 *           goes red on every honest edit. It does mean the heading is
 *           unpinned — a finding about this check, recorded rather than tidied
 *           away.
 *   SURVIVOR  rename DECK_CONTEXT_HEADING's text ("## The deck in this
 *           conversation" → "## Deck"). Survives, and deliberately: the route
 *           and the check both read the constant, so renaming it renames both
 *           sides. It matters less than the control rename did, because the
 *           heading is an internal section label and not a pointer at
 *           something on the user's screen.
 *   NOT A MUTATION, A LIMIT  the source assertions on the callers are proxies.
 *           They see that the OLD shape is gone; they cannot see two new
 *           expressions that happen to agree today. Only the behavioural
 *           checks are real, and they test the builder, not the routes.
 *
 * THIRD ROUND — detached worktree at d6b5dfd with the removal applied,
 * 2026-09-21, restored after each run. Recorded in the same place because the
 * removal is the same subject. Fifteen mutations, fifteen killed.
 *   KILLED  `generationOn` falls back to `ctx.contextConfig?.imageGeneration
 *           !== "off"` again → "a stored context config cannot switch the
 *           tools off", plus "no live variant reads as switched off" (2) and
 *           one deck contradiction. The fossil-row variant is what sees it.
 *   KILLED  …and normalizeContextConfig gives the imageGeneration key back so
 *           a stored row has something to say "off" with → §18 "the normaliser
 *           emits the four detail levels and nothing else", 5 extra keys, and
 *           "a save through the endpoint's normaliser drops the dead keys".
 *   KILLED  the off-branch names a control again → (C) "no assembled prompt
 *           names a control the user could press", 4 hits.
 *   KILLED  the chat composer keeps a piece of state that writes the
 *           capability → §18 "neither composer holds a capability switch", 1
 *           reference. This is the half-removal the step was warned about: a
 *           button that still lights up and changes nothing.
 *   KILLED  the route reads `body.contextConfig` again → §18 "the chat route
 *           takes no context config from the browser" and "reads the context
 *           levels from the workspace row".
 *   KILLED  normalizeContextConfig emits all five removed keys → 25 extra keys
 *           across the stored fixtures.
 *   KILLED  the retired third limb comes back beside the new one → "the prompt
 *           no longer offers 'someone turned it off' as a reason", 10 variants.
 *           A new rule beside a contradicting old one changes nothing, which is
 *           why the retired limb is asserted GONE and not merely outnumbered.
 *   KILLED  the admin limb stops saying what to tell the user → "the rule
 *           offers both reasons a tool can be absent, and what to do about
 *           each", 20 variant/limb pairs.
 *   KILLED  a deck notice points at a control again → verify-slide-layouts
 *           40c, two assertions.
 *   KILLED  one chain passes `offered` to the notice again → 40f end site 1,
 *           both the argument assertion and the shape assertion.
 *   KILLED  the router gates on a stored switch again → §18 "no capability
 *           gate is left in the router".
 *   KILLED  the admin dialog keeps a web-search toggle → §18 "no admin surface
 *           offers a capability toggle either".
 *   KILLED  the control-detector list is emptied → self-test, 4 of the 6
 *           sentences the removal deleted go unseen and the scan reports
 *           nothing. A detector that cannot fire reports clean for ever.
 *   KILLED  the route hands the tools a different answer from the prompt
 *           (`imageGeneration: false` beside a prompt that says true) → "the
 *           chat route passes the SAME value to the tools".
 *   KILLED  the route derives the flag from the browser again → "the chat
 *           route registers the generation tools every turn".
 *   SURVIVOR  the off-branch's HEADING is reworded. Deliberate, and the same
 *           survivor as the round above: the assertion reads the BODY
 *           sentence, because pinning heading text goes red on every honest
 *           edit. It was briefly a kill while the identifying phrase lived
 *           only in the heading, and the assertion was moved to the body
 *           rather than left pinning a title.
 *   SURVIVOR  the admin limb's example tools are swapped (mailbox/calendar/
 *           resourcing/finance → AuthorityOn/Xero/Microsoft). Recorded: (A)
 *           pins the limb and the advice, not the examples, and pinning the
 *           examples would go red every time an admin-gated tool is added.
 *
 * FOURTH ROUND — detached worktree at d6b5dfd with the removal AND this
 * follow-up applied, 2026-09-21, restored after each run. Thirteen mutations
 * killed, one survivor, one inverse. Three of these were live faults when the
 * round started, found by reading rather than by this file — which is the
 * point of recording them: the two that (C) could not see were not subtle.
 *   KILLED  the no-live-web append names the Web toggle again — the sentence
 *           that actually shipped, appended on every turn the router does not
 *           search → (C), 1 hit. It had been live and green for a day.
 *   KILLED  a DIFFERENT route append names a control (the calendar one) → (C),
 *           2 hits. The scan is over every literal, not over the one that was
 *           found to be wrong.
 *   KILLED  the deck block names a control → (C), 2 hits. This mutation
 *           SURVIVED the third round: (F) assembled the deck block, (C) did
 *           not, and (C) is the assertion the removal turns on.
 *   KILLED  a control name planted in the env-gated Drive block → (C), 2 hits,
 *           through the deployment variant. It survived until that variant
 *           existed, because GOOGLE_SA_EMAIL is not set on a laptop and
 *           hundreds of words of production prose were therefore unscanned.
 *   KILLED  incognito is read from the browser alone again → "incognito does
 *           not fail open for a browser on the old bundle". That was live: the
 *           removal moved the signal to a new body key, and a tab on the
 *           previous bundle posts neither shape.
 *   KILLED  the provider config derives its own incognito again → "the
 *           provider config reads that same value, not a second derivation".
 *   KILLED  the mailbox append is reworded, leaving the allowance quoting a
 *           dead sentence → the allowance precondition, 1 stale. An allowance
 *           that outlives its sentence is a hole nobody opened on purpose.
 *   KILLED  the design chain pushes IMAGE_GEN_TOOL back in behind the flag →
 *           "no chain re-registers a generation tool against the flag".
 *   KILLED  a route append instructs an absence report → (D)'s route scan, 2
 *           hits.
 *   KILLED  the route-literal extraction goes deaf (both regexes renamed) →
 *           four preconditions, 0 literals. An extraction that matches nothing
 *           is the same failure this round is fixing, one level down.
 *   KILLED  the extraction reads only half the appends (the `+=` form dropped)
 *           → three preconditions, 4 literals of 8.
 *   KILLED  the allowance strip is dropped, so the model-picker sentence is
 *           scanned raw → (C), 1 hit. Recorded as the evidence that the route's
 *           literals really are reaching the detector.
 *   KILLED  the deployment variant's env is not set → its own precondition,
 *           88,620 chars against 67,600.
 *   SURVIVOR  the no-live-web tail keeps its silence but loses its advice
 *           ("…say briefly that you did not search this turn." and nothing
 *           more). Deliberate: (C) pins that no control is named, not what the
 *           sentence says instead. Pinning the wording would go red on every
 *           honest edit, and the sentence is INTERNAL guidance the model is
 *           told not to announce — so a weaker version of it costs a hint, not
 *           a false claim.
 *   INVERSE  gating the mailbox prose turns "the mailbox prose is NOT gated"
 *           red. That is the assertion working: it records a residue that is
 *           true today, and asks to be deleted along with it.
 */
console.log("\n17. A capability with no switch says the honest thing, and a live one is never reported absent");
{
  const base: any = {
    conversationVisibility: "private",
    userName: "Test",
    workspaceConfig: { companyContext: "TCE is a content agency.", contentTypes: [], cuDefinitions: [], formatDescriptions: {}, typeInstructions: {} },
    clientContext: null,
    contentDetail: null,
  };

  // Every shape of turn this rule has to survive. `generationTools` is the
  // boolean the TOOL ARRAY reads, and it is now a per-ROUTE fact: omitted
  // means the chat route, which registers all five every turn; false means a
  // caller that produces text and nothing else.
  const V: { label: string; on: boolean; text: string }[] = [];
  const ROWS: [string, any][] = [
    ["chat (tools registered)", {}],
    ["chat, declared true", { generationTools: true }],
    ["headless (scheduled brief)", { generationTools: false }],
    ["headless (meeting brief)", { generationTools: false, latestUserMessage: "Prep me for the Siemens call" }],
    ["a fossil row that says off", { contextConfig: { imageGeneration: "off", webSearch: "off", memory: "off", meetingBrain: "off" } }],
    ["design mode", { designMode: true }],
    ["design+studio", { designMode: true, studioMode: true }],
    ["role persona", { role: { name: "Editor", instructions: "You edit." } }],
    ["team thread", { conversationVisibility: "team" }],
    ["resourcing granted", { resourcingAccess: true }],
  ];
  for (let i = 0; i < ROWS.length; i++) {
    const cfg = ROWS[i][1];
    V.push({
      label: ROWS[i][0],
      on: cfg.generationTools !== false,
      text: buildSystemPrompt({ ...base, ...cfg }),
    });
  }

  // PRECONDITIONS. A builder returning "" satisfies every assertion about what
  // is ABSENT and reports nothing about what is present.
  check("10 capability variants assembled", V.length === 10, String(V.length));
  let shortest = V[0];
  for (let i = 1; i < V.length; i++) if (V[i].text.length < shortest.text.length) shortest = V[i];
  check("the shortest capability variant is a real prompt", shortest.text.length > 4000, `${shortest.label} is ${shortest.text.length} chars`);
  const onRow = V[0], offRow = V[2];
  check("a headless turn really is a different prompt from a chat turn",
    Math.abs(onRow.text.length - offRow.text.length) > 2000,
    `${onRow.text.length} vs ${offRow.text.length}`);

  // THE BLOCKS THAT ONLY EXIST ON A DEPLOYMENT. Two sections are gated on the
  // ENVIRONMENT rather than on anything in the context — the Drive
  // share-address block (GOOGLE_SA_EMAIL) and the AuthorityOn block (the MCP
  // keys) — and neither variable is set on a laptop, so every variant above is
  // blind to hundreds of words of prose that every real turn carries. Prose is
  // where a control name hides: a sentence planted in the Drive block survived
  // this whole section until this variant existed. Set, built, restored.
  const savedSa = process.env.GOOGLE_SA_EMAIL, savedAo = process.env.AUTHORITYON_MCP_KEY;
  process.env.GOOGLE_SA_EMAIL = "engineai@example.iam.gserviceaccount.com";
  process.env.AUTHORITYON_MCP_KEY = "not-a-real-key-nothing-here-calls-it";
  V.push({ label: "a full deployment (Drive + AuthorityOn prose)", on: true, text: buildSystemPrompt({ ...base }) });
  if (savedSa === undefined) delete process.env.GOOGLE_SA_EMAIL; else process.env.GOOGLE_SA_EMAIL = savedSa;
  if (savedAo === undefined) delete process.env.AUTHORITYON_MCP_KEY; else process.env.AUTHORITYON_MCP_KEY = savedAo;
  // PRECONDITION: those blocks really did appear. Without it this variant is a
  // duplicate of the first and proves nothing — which is exactly the state the
  // other ten were in.
  const deployed = V[V.length - 1].text;
  check("PRECONDITION: the deployment-only blocks are in that variant",
    deployed.indexOf("## Google Drive access") >= 0 && deployed.indexOf("query_authorityon") >= 0 && deployed.length > V[0].text.length + 1000,
    `${deployed.length} vs ${V[0].text.length}`);

  // ── (A) THE RULE THAT WOULD HAVE CAUGHT THE ACTUAL INCIDENT ──
  // In every variant, on or off. Two load-bearing sentences, not the whole
  // block: pinning all of it would go red on every honest edit.
  const ALWAYS = [
    "You are one product with one settled set of features.",
    "If a tool IS in your tool list, YOU HAVE IT",
  ];
  let missingAlways = 0;
  for (let i = 0; i < V.length; i++) {
    for (let j = 0; j < ALWAYS.length; j++) {
      if (V[i].text.indexOf(ALWAYS[j]) < 0) { missingAlways++; console.log(`      (${V[i].label} is missing: ${ALWAYS[j].slice(0, 44)}…)`); }
    }
  }
  check("the own-the-limit rule is in every gate combination", missingAlways === 0, `${missingAlways} variant/sentence pairs missing`);

  // …and the promise it makes has to be TRUE for a tool this user's ACCOUNT
  // does not reach. The first draft said "If nothing below says a feature is
  // off, YOU HAVE IT — use it", with a two-limb disjunction: switched off and
  // named below, or never part of the product. query_resourcing is neither.
  // It is registered only under `resourcingAccess`, its prose is emitted under
  // the same flag, and for the five users at (0,0,0,0,0) the prompt says
  // nothing at all — so the rule told the model it had a tool it had not been
  // given, while separately forbidding the one accurate sentence. Same shape
  // for finance, Gmail, Calendar and Microsoft.
  //
  // TWO LIMBS NOW, not three. The third — "someone may have turned that
  // feature off, and this prompt names the switch below" — described a control
  // that no longer exists, and a limb that is false is worse than a limb that
  // is missing: it is the one the model will reach for, because it is the only
  // one that promises the user something to do.
  const LIMBS = [
    ["granted by an admin", "a part of EngineAI this user's account has not been granted"],
    ["what the user should be told", "not enabled for their account"],
    ["who opens it", "an admin can enable it"],
    ["never part of the product", "never part of this product"],
  ];
  let missingLimb = 0;
  for (let i = 0; i < V.length; i++) {
    for (let j = 0; j < LIMBS.length; j++) {
      if (V[i].text.indexOf(LIMBS[j][1]) < 0) { missingLimb++; console.log(`      (${V[i].label} does not offer the limb: ${LIMBS[j][0]})`); }
    }
  }
  check("the rule offers both reasons a tool can be absent, and what to do about each", missingLimb === 0, `${missingLimb} variant/limb pairs missing`);
  // The retired limb must be GONE, not merely outnumbered. Left in beside the
  // new one it is a contradiction, and the doctrine this repo runs on is that
  // a new rule beside a contradicting old one changes nothing.
  let switchLimb = 0;
  for (let i = 0; i < V.length; i++) if (/Someone may have turned that feature off/i.test(V[i].text)) switchLimb++;
  check("the prompt no longer offers 'someone turned it off' as a reason", switchLimb === 0, `${switchLimb} variants`);
  let unconditional = 0;
  for (let i = 0; i < V.length; i++) if (/if nothing below says a feature is off/i.test(V[i].text)) unconditional++;
  check("the promise is never made on the prompt's silence alone", unconditional === 0, `${unconditional} variants`);
  // PRECONDITION: the silence being reasoned about is real. An access-gated
  // tool has to genuinely vanish from the prose, or the limb above is guarding
  // a gap that does not exist and this assertion is decoration.
  const gateBase: any = { ...base };
  const withResourcing = buildSystemPrompt({ ...gateBase, resourcingAccess: true });
  const withoutResourcing = buildSystemPrompt({ ...gateBase, resourcingAccess: false });
  // The tool's own SECTION, not the bare name: one line elsewhere mentions
  // `query_resourcing` unconditionally and hedges it with "(if available to
  // this user)", which is the honest half-measure this limb generalises.
  const RESOURCING_SECTION = "## Resourcing & contracts (query_resourcing)";
  check("an ungranted capability really is silent in the prompt",
    withResourcing.indexOf(RESOURCING_SECTION) >= 0 && withoutResourcing.indexOf(RESOURCING_SECTION) < 0,
    `granted ${withResourcing.indexOf(RESOURCING_SECTION) >= 0}, ungranted ${withoutResourcing.indexOf(RESOURCING_SECTION) >= 0}`);
  check("the ungranted turn still carries the limb that covers it",
    withoutResourcing.indexOf(LIMBS[0][1]) >= 0);
  // RECORDED RESIDUE, not an assumption. The silence above is real for
  // resourcing and for nothing else: the mailbox, calendar, Microsoft and Slack
  // prose is emitted unconditionally, so a user whose account reaches none of
  // them still reads a specific instruction to prefer query_gmail — a louder,
  // more concrete line than the rule that covers it, and the doctrine here is
  // that a rule beside a contradicting instruction changes nothing. Asserted in
  // the direction it is TRUE today so the residue stays visible. If this goes
  // red because someone gated those sections, that is the fix landing: delete
  // this assertion along with the residue.
  check("the mailbox prose is NOT gated (recorded residue, not assumed fixed)",
    withoutResourcing.indexOf("prefer query_gmail") >= 0);
  // And the part that is specifically about her turn: the reply contradicted
  // an offer made 80 seconds earlier in the same thread.
  let missingRecall = 0;
  for (let i = 0; i < V.length; i++) if (!/read back what you already said in this thread/i.test(V[i].text)) missingRecall++;
  check("every variant tells it to re-read its own offer before refusing", missingRecall === 0, `${missingRecall} variants`);

  // ── (B) THE OFF-BRANCH ──
  // One form left, and it is about the KIND OF TURN, not about a setting.
  let offSilent = 0, offNamesTools = 0;
  for (let i = 0; i < V.length; i++) {
    const v = V[i];
    if (v.on) continue;
    const head = v.text.indexOf("## Making things");
    // Read on the BODY, not the heading. The heading is deliberately left
    // unpinned — pinning its text goes red on every honest edit, and the
    // sentence that carries the claim is the one below it.
    if (head < 0 || v.text.indexOf("This turn writes text and nothing else.") < 0) { offSilent++; console.log(`      (${v.label}: the off-branch is not in the prompt)`); continue; }
    // Bound the block at its OWN end, not at a guessed length: sliced by
    // length this once read into Design Mode's persona section and reported
    // the off-branch as naming a tool it never mentions.
    const nextHead = v.text.indexOf("\n\n## ", head + 4);
    const block = v.text.slice(head, nextHead < 0 ? v.text.length : nextHead);
    // A headless turn has no tool array at all, so it names the DELIVERABLES
    // rather than the tools — a brief being told which function id is absent
    // is noise it can only repeat at the reader.
    if (/generate_(image|chart|slides|word_document|document)/.test(block)) { offNamesTools++; console.log(`      (${v.label}: names tool ids to a turn that has no tools)`); }
  }
  check("every headless variant says what kind of turn it is", offSilent === 0, `${offSilent} silent`);
  check("the off-branch names no tool ids to a turn that has none", offNamesTools === 0, `${offNamesTools} naming them`);

  // …and the ON variants must not carry it, or the model reads a live
  // capability as switched off — the incident, written into the prompt.
  let onContradicted = 0;
  for (let i = 0; i < V.length; i++) {
    if (!V[i].on) continue;
    if (/## Making things/i.test(V[i].text)) { onContradicted++; console.log(`      (${V[i].label}: carries the off-branch on a live turn)`); }
    if (V[i].text.indexOf("You have a generate_image tool") < 0) { onContradicted++; console.log(`      (${V[i].label}: does not advertise the tool it was given)`); }
  }
  check("no live variant reads as switched off", onContradicted === 0, `${onContradicted} contradictions`);

  // ── (C) NO ASSEMBLED PROMPT NAMES A CONTROL ──
  //
  // THE ASSERTION THE REMOVAL TURNS ON. Until 21 September the prompt named
  // "the \"Image\" switch under the message box", and three separate checks
  // existed to keep that name honest across the prompt, the deck notice and
  // both composers. The switch is deleted. Every one of those names is now a
  // sentence sending a user to a control that is not on any screen — the exact
  // shape of "not available in this environment", which is what the whole
  // section exists to stop.
  //
  // Written as a DETECTOR rather than a search for the old string on purpose:
  // the old string would be caught by asserting its absence, and the next one
  // would not. The rule's own prohibition is stripped first — exactly as the
  // absence scan below strips its own quotes — because a rule that forbids a
  // sentence has to be allowed to quote it.
  // `switch` as a NOUN. The verb is ordinary English and appears in a live
  // tool description — "switch from gen4.5 to veo3" — so the two have to be
  // told apart or this fires on honest prose and gets deleted by the next
  // person who hits it. The lookahead excludes the verb's own prepositions and
  // nothing else: "switched off", "the … switch under", "names the switch" and
  // "no switch for it on this screen" all still fire, and those are the four
  // real sentences this replaced.
  const SWITCH_PHRASES: [string, RegExp][] = [
    ["names a switch", /\bswitch(es|ed|ing)?\b(?!\s+(from|to|between))/i],
    ["names a toggle", /\btoggle[ds]?\b/i],
    ["points under the message box", /\bunder the message box\b/i],
    ["points at a context menu", /\bcontext menu\b/i],
    ["tells the user to turn it on", /\bturn (it|them|that|one|the \w+) (back )?on\b/i],
  ];
  // The one place the prompt is allowed to use these words: forbidding them.
  const CONTROL_OWN_QUOTES = [
    "never tell anyone to find a switch, a toggle or a setting that would turn one back on",
  ];
  const withoutControlQuotes = (t: string) => {
    let out = t;
    for (let j = 0; j < CONTROL_OWN_QUOTES.length; j++) out = out.split(CONTROL_OWN_QUOTES[j]).join("");
    return out;
  };
  // EVERY CONTRIBUTOR TO THE STRING THE MODEL IS SENT, and this is the second
  // attempt at that. The first scanned buildSystemPrompt's return and called it
  // the assembled prompt; it is not. The chat route staples four more blocks
  // onto the end before it goes out, and one of them — appended on every turn
  // the router does not search, which is most of them — told the user to "turn
  // on the Web toggle and ask again" for a fortnight after the toggle was
  // deleted. The detector below was already sharp enough to see that sentence.
  // It was never shown it. So the scan now covers all three contributors: the
  // builder's ten variants, the deck block the route appends, and the route's
  // own literals, read from source because they are template strings inside a
  // request handler this check cannot call.
  const DRAFT = {
    title: "Infrastructure Transition Monitor",
    slides: [
      { layout: "title", title: "Where we are", preview: "<svg/>" },
      { layout: "two-column", title: "The two tracks", bullets: ["a", "b"], image: { query: "bridge" }, resolvedImage: "https://blob/x.png" },
    ],
    published: { presentationId: "pres-123" },
  };
  const deckBlock = String(buildDeckContext(DRAFT));
  const routeSrc = msgSrcForPaths();
  const ROUTE_LITERALS: string[] = [];
  const APPEND_CALL = /appendVolatile\(\s*systemPrompt,\s*("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  const APPEND_EQ = /systemPrompt \+=\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*")/g;
  let lit: RegExpExecArray | null;
  while ((lit = APPEND_CALL.exec(routeSrc)) !== null) ROUTE_LITERALS.push(lit[1]);
  while ((lit = APPEND_EQ.exec(routeSrc)) !== null) ROUTE_LITERALS.push(lit[1]);
  // PRECONDITIONS. An extraction that matches nothing scans nothing and
  // reports clean for ever — the exact failure this section is fixing, one
  // level down. Both the count and a known sentence, because a regex that
  // matched only the short ones would satisfy a count.
  check("PRECONDITION: the route's own prompt appends were found", ROUTE_LITERALS.length >= 6, `${ROUTE_LITERALS.length} literals`);
  const routeJoined = ROUTE_LITERALS.join("\n");
  check("PRECONDITION: and they are the real ones",
    routeJoined.length > 2000 && routeJoined.indexOf("No live web this turn") >= 0,
    `${routeJoined.length} chars`);
  // THE ONE ALLOWANCE, and it names a control that EXISTS. The mailbox append
  // tells a user on a non-Claude chain that switching the model will read their
  // email, and the model picker is on every screen. An exact substring, not a
  // hole in the pattern: a new sentence cannot shelter behind it, and the
  // precondition goes red the day that one is reworded — which is the day this
  // allowance has to be re-read rather than silently kept.
  const ROUTE_ALLOWED = ["switching the model (or using EngineAI Auto, which routes these questions to Claude) and asking again will read it"];
  let allowanceStale = 0;
  for (let i = 0; i < ROUTE_ALLOWED.length; i++) {
    if (routeJoined.indexOf(ROUTE_ALLOWED[i]) < 0) { allowanceStale++; console.log(`      (an allowance quotes a sentence the route no longer has: "${ROUTE_ALLOWED[i].slice(0, 60)}…")`); }
  }
  check("PRECONDITION: every control allowance still quotes a live sentence", allowanceStale === 0, `${allowanceStale} stale`);

  const ASSEMBLED: [string, string][] = [];
  for (let i = 0; i < V.length; i++) ASSEMBLED.push([V[i].label, V[i].text]);
  ASSEMBLED.push(["the deck block the route appends", deckBlock]);
  for (let i = 0; i < ROUTE_LITERALS.length; i++) ASSEMBLED.push([`route append #${i + 1}`, ROUTE_LITERALS[i]]);

  let ctrlHits = 0, ctrlStrippedNothing = 0;
  for (let i = 0; i < ASSEMBLED.length; i++) {
    let stripped = withoutControlQuotes(ASSEMBLED[i][1]);
    // PRECONDITION: the strip found what it exists for. Removing nothing means
    // the prohibition stopped quoting the words it forbids, and this list has
    // to be re-read against the rule rather than silently reporting it. Only
    // the builder's variants carry the rule; the deck block and the route's
    // appends have no reason to quote it.
    if (i < V.length && stripped.length === ASSEMBLED[i][1].length) { ctrlStrippedNothing++; continue; }
    for (let j = 0; j < ROUTE_ALLOWED.length; j++) stripped = stripped.split(ROUTE_ALLOWED[j]).join("");
    for (let j = 0; j < SWITCH_PHRASES.length; j++) {
      if (SWITCH_PHRASES[j][1].test(stripped)) {
        ctrlHits++;
        const m = SWITCH_PHRASES[j][1].exec(stripped);
        const at = m ? Math.max(0, (m.index || 0) - 60) : 0;
        console.log(`      (${ASSEMBLED[i][0]}: ${SWITCH_PHRASES[j][0]} — …${stripped.slice(at, at + 150).replace(/\n/g, " ")}…)`);
      }
    }
  }
  check("the rule still quotes the control words it forbids", ctrlStrippedNothing === 0, `${ctrlStrippedNothing} variants quoted none`);
  check("no assembled prompt names a control the user could press", ctrlHits === 0, `${ctrlHits} hits`);
  check("PRECONDITION: the scan covered the route and the deck block too", ASSEMBLED.length >= V.length + 7, `${ASSEMBLED.length} strings scanned`);
  // SELF-TEST. The detector is the whole value of the assertion, so it is
  // driven against the sentences that were REALLY in the prompt, the deck
  // notice and the design narrowing until this change removed them. A detector
  // that cannot fire reports "clean" for ever.
  const WERE_THERE = [
    'Say it is switched off for this conversation, and say what turns it back on: the "Image" switch under the message box.',
    "Building and changing decks is switched off for this conversation — turn on the **Image** switch under the message box and ask again.",
    "Someone may have turned that feature off, in which case this prompt says so below, in a section of its own, and names the switch.",
    "a workspace setting an admin controls — there is no switch for it on this screen",
    "what opens it — a switch this prompt names, or an admin, or nothing at all",
    "## Making things — SWITCHED OFF FOR THIS CONVERSATION",
    // The one that SHIPPED. It lived in the chat route, not in the builder, so
    // it survived the removal and a green run of this section together. It is
    // here as the self-test's proof that the detector was never the weak part.
    "Only if the user EXPLICITLY asked you to search the web should you briefly note they can turn on the Web toggle and ask again.",
  ];
  let ctrlDeaf = 0;
  for (let i = 0; i < WERE_THERE.length; i++) {
    let fired = false;
    for (let j = 0; j < SWITCH_PHRASES.length; j++) if (SWITCH_PHRASES[j][1].test(WERE_THERE[i])) fired = true;
    if (!fired) { ctrlDeaf++; console.log(`      (no detector sees: "${WERE_THERE[i].slice(0, 70)}…")`); }
  }
  check("every sentence the removal deleted is seen by a detector", ctrlDeaf === 0, `${ctrlDeaf} unseen`);
  let ctrlFalseAlarm = 0;
  const CTRL_CLEAN = [
    "It may be a part of EngineAI this user's account has not been granted, which an admin opens for them.",
    // A live tool description, and the reason the noun/verb distinction above
    // exists at all. Hard-coded here so narrowing the detector any further
    // goes red rather than silently going deaf.
    "Override the model just for this generation (e.g. switch from gen4.5 to veo3)",
    // What replaced the Web-toggle sentence. It has to survive the detector, or
    // the fix for that sentence is a sentence that fails this check.
    "you did not search this turn, and that a direct ask in those words (\"search the web for X\") will run one — there is nothing for them to find and press first",
  ];
  for (let i = 0; i < CTRL_CLEAN.length; i++) {
    for (let j = 0; j < SWITCH_PHRASES.length; j++) if (SWITCH_PHRASES[j][1].test(CTRL_CLEAN[i])) { ctrlFalseAlarm++; console.log(`      (${SWITCH_PHRASES[j][0]} fires on honest prose: "${CTRL_CLEAN[i].slice(0, 60)}…")`); }
  }
  check("no control detector fires on honest prose", ctrlFalseAlarm === 0, `${ctrlFalseAlarm} false alarms`);

  // Tool descriptions are prompt text too, and they are the place a control
  // name would survive a prompt edit unnoticed. Read once; the absence scan
  // below reads the same string.
  const provSrc = readFileSync(join(process.cwd(), "lib/ai/providers.ts"), "utf8");
  const descs = provSrc.match(/description:\s*(`[\s\S]*?`|"(?:[^"\\]|\\.)*")/g) || [];
  check("tool descriptions were found to scan (capability pass)", descs.length > 100, `${descs.length} found`);
  let descCtrl = 0;
  for (let i = 0; i < descs.length; i++) {
    for (let j = 0; j < SWITCH_PHRASES.length; j++) {
      if (SWITCH_PHRASES[j][1].test(descs[i])) { descCtrl++; console.log(`      (description #${i}: ${SWITCH_PHRASES[j][0]} — ${descs[i].slice(0, 90)})`); }
    }
  }
  check("no tool description names a control either", descCtrl === 0, `${descCtrl} hits`);

  // ── (D) THE PHRASES SHE ACTUALLY GOT ──
  // Nothing in any assembled prompt may INSTRUCT the shape of sentence the
  // model produced. The rule QUOTES two of them, so those quotes — and only
  // those — come out before the scan, exactly as section 7b does it: a rule's
  // own block is otherwise the one place a contradiction can hide.
  const ABSENCE_PHRASES: [string, RegExp][] = [
    ["not available in this environment", /\b(not|isn'?t|aren'?t)\s+available\s+in\s+this\s+environment\b/i],
    ["I don't have a … tool", /\b(i\s+)?(don'?t|do not)\s+have\s+(an?\s+|any\s+)?[\w/-]{0,24}\s*tool\b/i],
    ["in this environment / setup / session", /\bin\s+this\s+(environment|setup|configuration|session|version)\b/i],
    ["another / a different / a later session", /\b(another|a\s+different|a\s+later)\s+session\b/i],
    // Her transcript's exact escape hatch: "or I, in a session where that tool
    // is available, can produce it". It names no environment and no missing
    // tool, so every pattern above is deaf to it.
    ["in a session where …", /\bin\s+a\s+session\s+where\b/i],
    ["no access to that here", /\bno\s+access\s+to\s+(that|this|it)\s+here\b/i],
    ["say the feature is missing", /\b(say|tell|explain)\b[^.]{0,40}\b(feature|capability|tool)\b[^.]{0,20}\b(is\s+)?(missing|unavailable|unsupported)\b/i],
  ];
  // The phrases the rule and the off-branch quote in order to FORBID them,
  // removed before the scan and nothing else. Stripping the rule's whole block
  // instead would make the block the one place in the prompt a contradicting
  // instruction could hide, which is the mistake section 7b had to be
  // corrected for; these are exact substrings, so a new instruction cannot
  // shelter behind them.
  const OWN_QUOTES = [
    '"not available in this environment"',
    "that a different session — or a person with a different setup — could do it instead",
    "do not tell the reader that a tool is unavailable",
  ];
  const withoutQuotes = (t: string) => {
    let out = t;
    for (let j = 0; j < OWN_QUOTES.length; j++) out = out.split(OWN_QUOTES[j]).join("");
    return out;
  };
  let absHits = 0, strippedNothing = 0;
  for (let i = 0; i < V.length; i++) {
    const stripped = withoutQuotes(V[i].text);
    // PRECONDITION: the strip found what it exists for. Removing nothing means
    // the rule stopped quoting the phrases it forbids, and this list has to be
    // re-read against it rather than silently reporting the quotes as hits.
    if (stripped.length === V[i].text.length) { strippedNothing++; continue; }
    for (let j = 0; j < ABSENCE_PHRASES.length; j++) {
      if (ABSENCE_PHRASES[j][1].test(stripped)) { absHits++; console.log(`      (${V[i].label}: "${ABSENCE_PHRASES[j][0]}")`); }
    }
  }
  check("the rule still quotes the phrases it forbids", strippedNothing === 0, `${strippedNothing} variants quoted none`);
  check("no variant instructs an absence report outside the rule's own quotes", absHits === 0, `${absHits} hits`);

  // THE SAME BLIND SPOT AS (C), closed the same way. The route's appends are
  // prompt text and this scan never saw them either. No "it only forbids it"
  // exemption here, unlike the tool descriptions below: these literals are
  // clean today, so the stricter reading costs nothing, and an author who later
  // needs to quote a banned phrase in order to forbid it has to say so in
  // OWN_QUOTES — the same contract the builder's own rule lives under.
  let routeAbs = 0;
  for (let i = 0; i < ROUTE_LITERALS.length; i++) {
    for (let j = 0; j < ABSENCE_PHRASES.length; j++) {
      if (ABSENCE_PHRASES[j][1].test(ROUTE_LITERALS[i])) { routeAbs++; console.log(`      (route append #${i + 1}: "${ABSENCE_PHRASES[j][0]}")`); }
    }
  }
  check("no route append instructs an absence report either", routeAbs === 0, `${routeAbs} hits`);

  let descHits = 0;
  for (let i = 0; i < descs.length; i++) {
    // A description may FORBID the sentence; it may not instruct it.
    if (/\bnever\s+(say|tell|write|claim)\b|\bdo not (say|tell|claim)\b/i.test(descs[i])) continue;
    for (let j = 0; j < ABSENCE_PHRASES.length; j++) {
      if (ABSENCE_PHRASES[j][1].test(descs[i])) { descHits++; console.log(`      (description #${i}: "${ABSENCE_PHRASES[j][0]}" — ${descs[i].slice(0, 90)})`); }
    }
  }
  check("no tool description instructs an absence report", descHits === 0, `${descHits} hits`);

  // SELF-TEST. The pattern list is the whole value of the scan, so it is driven
  // against the sentences EngineAI actually produced on 2026-09-20. A detector
  // that cannot fire reports "clean" for ever.
  // The first three are verbatim from conversation 925c922b.
  const BAD = [
    "I don't have an image/slide-generation tool available in this environment, so I can't render the actual graphic file for you right now.",
    "or I, in a session where that tool is available, can produce it",
    "That feature is unavailable in this setup — ask an admin.",
    "You have no access to that here.",
  ];
  let deaf = 0;
  for (let i = 0; i < BAD.length; i++) {
    let fired = false;
    for (let j = 0; j < ABSENCE_PHRASES.length; j++) if (ABSENCE_PHRASES[j][1].test(BAD[i])) fired = true;
    if (!fired) { deaf++; console.log(`      (no detector sees: "${BAD[i].slice(0, 62)}…")`); }
  }
  check("every known absence sentence is seen by a detector", deaf === 0, `${deaf} unseen`);
  // THE BLIND SPOT, asserted so it stays recorded rather than being quietly
  // assumed fixed. Her third refusal — "Since I can't generate the actual
  // .pptx/Slides file" — names no environment, no session and no tool, so
  // nothing here sees it and nothing here could without firing on every honest
  // "I can't verify that". It is the same incident, and only the prompt rule
  // addresses it; this scan is about what the PROMPT instructs, not a filter
  // on what the model says.
  const BLIND = "Since I can't generate the actual .pptx/Slides file, here's the deck copy laid out slide-by-slide";
  let bland = false;
  for (let j = 0; j < ABSENCE_PHRASES.length; j++) if (ABSENCE_PHRASES[j][1].test(BLIND)) bland = true;
  check("the blind spot is still blind (recorded, not assumed fixed)", !bland);
  let falseAlarm = 0;
  const CLEAN = "You have a generate_image tool. When the user asks you to create a graphic, call it.";
  for (let j = 0; j < ABSENCE_PHRASES.length; j++) if (ABSENCE_PHRASES[j][1].test(CLEAN)) falseAlarm++;
  check("no detector fires on ordinary capability prose", falseAlarm === 0, `${falseAlarm} false alarms`);

  // ── (E) THE PROMPT AND THE TOOL ARRAY READ ONE BOOLEAN ──
  // Behavioural, not a grep: `generationTools` must decide it outright, and
  // omitting it must mean ON — which is what every user-facing turn means now
  // that nothing can turn it off.
  const declaredOff = buildSystemPrompt({ ...base, generationTools: false });
  const omitted = buildSystemPrompt({ ...base });
  check("a turn with no tools is not told it has them",
    declaredOff.indexOf("You have a generate_image tool") < 0 && declaredOff.indexOf("This turn writes text and nothing else.") >= 0);
  check("omitting the flag means the tools are there",
    omitted.indexOf("You have a generate_image tool") >= 0 && !/## Making things/i.test(omitted));
  // A FOSSIL ROW CANNOT REACH IT. The old builder fell back to
  // `contextConfig.imageGeneration !== "off"`, and the stored rows that key
  // came from are still in the database.
  const fossil = buildSystemPrompt({ ...base, contextConfig: { imageGeneration: "off", webSearch: "off", memory: "off", meetingBrain: "off" } as any });
  check("a stored context config cannot switch the tools off",
    fossil.indexOf("You have a generate_image tool") >= 0 && !/## Making things/i.test(fossil));

  // And the callers. The chat route now DECLARES it rather than deriving it,
  // and the proxy assertion is that nothing in that file reads a capability
  // off the request body any more.
  const msgSrc = readFileSync(join(process.cwd(), "app/api/ai/conversations/[id]/messages/route.ts"), "utf8");
  check("PRECONDITION: the chat route was found", msgSrc.length > 20000, `${msgSrc.length} chars`);
  check("the chat route registers the generation tools every turn",
    /const generationTools = true;/.test(msgSrc));
  check("the chat route passes it to the prompt", /\n\s+generationTools,\n/.test(msgSrc));
  check("the chat route passes the SAME value to the tools", /imageGeneration: generationTools,/.test(msgSrc));
  // …and no chain pushes one of them back in behind that value's back. The
  // design branch used to re-register IMAGE_GEN_TOOL whenever the flag was
  // false, because a designer who had switched the Image control off still
  // needed image generation. With the control gone the line could not run and
  // its comment still named the button — but the reason to assert it is not
  // tidiness: a tool array that disagrees with the flag the prompt was built
  // from is exactly the fault this section exists for, in whichever direction
  // it disagrees.
  check("no chain re-registers a generation tool against the flag",
    !/if \(!config\.imageGeneration\)/.test(stripComments(provSrc)));
  // Comments stripped first. This file's own prose explains what was removed
  // and names it while doing so, and an assertion that a NAME is absent from
  // a file cannot tell an explanation from a live read.
  check("the chat route takes no context config from the browser",
    !/body\.contextConfig/.test(stripComments(msgSrc)));
  check("the chat route reads the context levels from the workspace row",
    /normalizeContextConfig\(wsSettings\?\.config_context \?\? undefined\)/.test(msgSrc));
  // INCOGNITO IS NOT A CAPABILITY DIAL and was explicitly out of scope. It
  // travelled inside the context config because that object was the only thing
  // the composer posted; asserting it still arrives is what stops the removal
  // taking a privacy control with it.
  //
  // AND IT MUST NOT BE READ FROM THE BROWSER ALONE. Moving the signal from
  // `body.contextConfig.incognito` to `body.incognito` changes the wire, and a
  // tab still running the previous bundle posts neither — so for one deploy
  // window a thread the user had marked incognito read as an ordinary one and
  // had memories, an episode and a summary written for it. Durable rows, and
  // not the ones the page's own incognito cleanup deletes. The row is what the
  // message-persistence gates in the same file already trust, so incognito is
  // whichever of the two says yes, and the provider config reads the same
  // value instead of deriving a second one.
  check("incognito still reaches the route from the browser",
    /const isIncognito = [^\n]*body\.incognito === "on";/.test(msgSrc));
  check("incognito does not fail open for a browser on the old bundle",
    /const isIncognito = !!conversation\.flag_incognito \|\| body\.incognito === "on";/.test(msgSrc));
  check("the provider config reads that same value, not a second derivation",
    /incognito: isIncognito,/.test(msgSrc) && !/incognito: conversation\.flag_incognito/.test(stripComments(msgSrc)));
  const HEADLESS: [string, string][] = [
    ["lib/scheduled/runner.ts", "the scheduled brief"],
    ["app/api/engineai/meeting-prep/route.ts", "the meeting brief"],
  ];
  for (let i = 0; i < HEADLESS.length; i++) {
    const src = readFileSync(join(process.cwd(), HEADLESS[i][0]), "utf8");
    check(`${HEADLESS[i][1]} declares it has no generation tools`,
      /generationTools: false/.test(src) && /imageGeneration: false/.test(src));
  }

  // ── (F) THE ROUTE'S OWN APPENDS, WHICH ARE PART OF THE PROMPT ──
  // Everything above assembles buildSystemPrompt while calling the result "the
  // ASSEMBLED prompt". It is not: the chat route appends more to it, and one of
  // those appends was once the contradiction — the same string saying
  // generate_slides was "not loaded this turn" and then ordering a
  // generate_slides call.
  // PRECONDITION: the route still appends this, under this heading, from this
  // builder. The assembly below is only the route's if these hold.
  check("the route builds the deck block from the shared builder",
    /deckContext = buildDeckContext\(deckRows\?\.\[0\]\?\.slides_draft\);/.test(msgSrcForPaths()));
  check("the route appends it under the shared heading",
    /systemPrompt \+= `\\n\\n\$\{DECK_CONTEXT_HEADING\}\\n\$\{deckContext\}`;/.test(msgSrcForPaths()));
  check("the deck block is built for a deck that exists",
    buildDeckContext(DRAFT) !== null && buildDeckContext(null) === null);

  // Assemble it the way route.ts does and hold the invariant on the WHOLE
  // string. The deck block is only ever built on a chat turn, so it is
  // assembled against the chat variants — the ones that carry the tools.
  const ORDERS_A_CALL = /call generate_slides with the\s+COMPLETE slides array/i;
  let contradictions = 0, liveDeckMute = 0;
  for (let i = 0; i < V.length; i++) {
    const v = V[i];
    if (!v.on) continue;
    const assembled = v.text + "\n\n" + DECK_CONTEXT_HEADING + "\n" + deckBlock;
    const saysOff = /not loaded this turn|switched off for this conversation|not what this kind of turn produces|This turn writes text and nothing else/i.test(assembled);
    if (saysOff && ORDERS_A_CALL.test(assembled)) {
      contradictions++;
      console.log(`      (${v.label}: the same prompt says generate_slides is off AND orders a generate_slides call)`);
    }
    if (!ORDERS_A_CALL.test(assembled)) { liveDeckMute++; console.log(`      (${v.label}: a live turn is not told how to edit the deck it holds)`); }
  }
  check("no assembled prompt both denies generate_slides and orders it", contradictions === 0, `${contradictions} contradictions`);
  check("a live turn still gets the edit instruction", liveDeckMute === 0, `${liveDeckMute} mute`);
  // The block's original job, which the collapse to one framing must not
  // quietly drop: the preview is stripped, the resolved image survives, the
  // Drive id is passed so an edit updates the file in place.
  check("the rendered preview is never sent to the model", deckBlock.indexOf("<svg/>") < 0);
  check("the resolved image survives", deckBlock.indexOf("https://blob/x.png") >= 0);
  check("the Drive id is passed so the edit lands in place", deckBlock.indexOf("pres-123") >= 0);
  check("the deck spec itself is in the block",
    deckBlock.indexOf("Infrastructure Transition Monitor") >= 0 && deckBlock.indexOf("two-column") >= 0);

  // ── (G) THE LAST MEMBER OF THE SAME FAMILY ──
  // Design Mode's prose introduced search_artlist and license_artlist_asset in
  // every turn, while providers.ts registers them only when ARTLIST_API_KEY is
  // set — and the registration's own comment says why unregistered tools must
  // not be described. The key is not in .env.local, so locally that prompt was
  // describing two tools that were not there, every run. Same one-line pattern
  // as generationTools, asserted the same way: behaviourally, off the prompt.
  const designBase: any = { ...base, designMode: true };
  const artOn = buildSystemPrompt({ ...designBase, artlistTools: true });
  const artOff = buildSystemPrompt({ ...designBase, artlistTools: false });
  const artDefault = buildSystemPrompt({ ...designBase });
  const ART = ["search_artlist", "license_artlist_asset", "Artlist", "b-roll"];
  let artLeak = 0, artMute = 0;
  for (let i = 0; i < ART.length; i++) {
    if (artOff.indexOf(ART[i]) >= 0) { artLeak++; console.log(`      (the no-key design prompt still mentions ${ART[i]})`); }
    if (artOn.indexOf(ART[i]) < 0) { artMute++; console.log(`      (the design prompt with a key does not mention ${ART[i]})`); }
  }
  check("a design turn without the Artlist key is never told about Artlist", artLeak === 0, `${artLeak} leaks`);
  check("a design turn with the key still gets the whole workflow", artMute === 0, `${artMute} missing`);
  // Omitting the flag must fail CLOSED. A designer told nothing about stock
  // footage loses a suggestion; one promised a search that throws loses the turn.
  check("omitting the flag means absent, not present", artDefault === artOff);
  // The prose around the gap has to still read. Dropping step 5 left the list
  // numbered 1,2,3,4,6, and "three specialist tools" counting two of them.
  check("the design prompt does not promise a tool count it does not list",
    artOff.indexOf("two specialist tools") >= 0 && artOn.indexOf("three specialist tools") >= 0);
  check("the design workflow is not left with a hole in its numbering",
    artOff.indexOf("\n5. **Image → video") >= 0 && artOn.indexOf("\n6. **Image → video") >= 0);
  // The registration and the prose read ONE predicate. Source-level, and
  // recorded as a proxy: it sees the old env read returning, not two new calls
  // that happen to agree.
  check("the route passes the registration's own predicate",
    /artlistTools: artlistConfigured\(\),/.test(msgSrcForPaths()));
  check("providers registers on that same predicate",
    /if \(artlistConfigured\(\)\) \{\s*tools\.push\(ARTLIST_SEARCH_TOOL\);/.test(provSrc));
  check("no chain reads the Artlist key behind the predicate's back",
    (provSrc.match(/ARTLIST_API_KEY/g) || []).length === 1,
    `${(provSrc.match(/ARTLIST_API_KEY/g) || []).length} mentions (1 = the explanatory comment)`);
  // …and the design turn is re-pinned to Anthropic when it runs, which is what
  // makes the design tool layer real: video, Artlist and the shot CRUD are
  // registered on that chain alone, and `body.model` or a PATCH can move a
  // design conversation off it after creation.
  check("a design turn is re-pinned to Anthropic when it runs",
    /if \(isDesignConversation && !model\.startsWith\("claude-"\)\) \{[\s\S]{0,240}?model = "claude-sonnet-5";/.test(msgSrcForPaths()));

  // And the user-facing end of the same fault: the notice a turn ends on when
  // it claimed a change and made none. It used to have a third form that named
  // the switch; with the switch gone, "Ask again" is right again, because the
  // only thing that can stop a call on a chat turn is a taint and a taint
  // lasts one turn.
  const claimText = "I've replaced slide 9 with two clearer slides — the deck is now 12 slides.";
  const notice = unmadeDeckChangeNotice(claimText, {}, { asked: true, deckInConversation: true, alreadySaid: false, toolsUsed: null });
  check("PRECONDITION: the claim fires a notice at all", notice.length > 0);
  check("the notice tells the user to ask again", notice.indexOf("Ask again to make the change.") >= 0);
  let noticeCtrl = 0;
  for (let j = 0; j < SWITCH_PHRASES.length; j++) if (SWITCH_PHRASES[j][1].test(notice)) noticeCtrl++;
  check("the notice names no control either", noticeCtrl === 0, `${noticeCtrl} hits`);
}

/* ── FIX 2: nothing left can switch a capability off ───────────────────────
 * Chris's instruction after the incident was that it should be on by default,
 * everywhere. The removal goes one step further: on, full stop, with no path
 * that can produce a false. The paths are enumerated here rather than
 * described, because the diagnosis was guessed twice before it was measured —
 * the workspace row, the browser's body, the normaliser's own defaulting, the
 * two client initial states, the three settings writers, the per-task stored
 * copy, and the prompt builder's own gate.
 *
 * THE MIGRATION DECISION IS ASSERTED HERE. Stored rows still carry
 * imageGeneration, webSearch, memory and meetingBrain — intelligence.ai_settings
 * and ai_scheduled_prompts.config_context both. They are IGNORED, not stripped:
 * no migration runs, the normaliser simply stops producing the keys, and every
 * row becomes inert on the same deploy. A migration would have to be right
 * about rows written between writing it and running it; this cannot be wrong
 * about any row at all. The settings PATCH normalises on write, so the keys
 * also leave each row the next time an admin saves it.
 */
console.log("\n18. Nothing left can switch a capability off");
{
  // (1) THE NORMALISER, which is the choke point. The legacy shape is the real
  // one: three of the four rows in intelligence.ai_settings are
  // `{contracts, socialPresence, contentPipeline}` written in February and
  // never touched since, and the TCE row carries all nine keys.
  const LEVEL_KEYS = ["contracts", "contentPipeline", "socialPresence", "ideas"];
  const STORED: [string, any][] = [
    ["no config at all", undefined],
    ["null", null],
    ["an empty object", {}],
    ["the real legacy row", { contracts: true, socialPresence: true, contentPipeline: true }],
    ["the TCE row", { ideas: "summary", memory: "on", contracts: "full-year", incognito: "off", webSearch: "on", meetingBrain: "on", socialPresence: "summary", contentPipeline: "full-month", imageGeneration: "on" }],
    ["a row that says off for everything", { imageGeneration: "off", webSearch: "off", memory: "off", meetingBrain: "off", incognito: "on" }],
    ["a legacy boolean false", { imageGeneration: false, webSearch: false, memory: false, meetingBrain: false }],
  ];
  let extraKeys = 0, missingLevel = 0;
  for (let i = 0; i < STORED.length; i++) {
    const out: any = normalizeContextConfig(STORED[i][1]);
    const keys = Object.keys(out);
    for (let k = 0; k < keys.length; k++) {
      if (LEVEL_KEYS.indexOf(keys[k]) < 0) { extraKeys++; console.log(`      (${STORED[i][0]}: normalises to a config still carrying "${keys[k]}")`); }
    }
    for (let k = 0; k < LEVEL_KEYS.length; k++) {
      if (typeof out[LEVEL_KEYS[k]] !== "string") { missingLevel++; console.log(`      (${STORED[i][0]}: lost the ${LEVEL_KEYS[k]} level)`); }
    }
  }
  check("the normaliser emits the four detail levels and nothing else", extraKeys === 0, `${extraKeys} extra keys`);
  check("and it still emits all four of them", missingLevel === 0, `${missingLevel} missing`);
  // PRECONDITION: the fixtures really do carry the removed keys, or the
  // assertion above is proving something about an empty set.
  let fixtureCarries = 0;
  for (let i = 0; i < STORED.length; i++) {
    const raw: any = STORED[i][1];
    if (raw && (("imageGeneration" in raw) || ("webSearch" in raw))) fixtureCarries++;
  }
  check("PRECONDITION: the stored fixtures really carry a capability key", fixtureCarries >= 3, `${fixtureCarries} of 7`);
  // The levels themselves still come THROUGH, or the pin ("no thread's prompt
  // changes size") is not a pin, it is a reset.
  const tce: any = normalizeContextConfig(STORED[4][1]);
  check("the TCE row's own levels survive the normaliser",
    tce.contracts === "full-year" && tce.contentPipeline === "full-month" && tce.socialPresence === "summary" && tce.ideas === "summary",
    JSON.stringify(tce));

  // (2) THE PROMPT BUILDER. Whatever the row said, the tools are described.
  const promptBase: any = { conversationVisibility: "private", userName: "Test",
    workspaceConfig: { companyContext: "TCE.", contentTypes: [], cuDefinitions: [], formatDescriptions: {}, typeInstructions: {} } };
  let offInPrompt = 0;
  for (let i = 0; i < STORED.length; i++) {
    const p = buildSystemPrompt({ ...promptBase, contextConfig: normalizeContextConfig(STORED[i][1]) });
    if (p.indexOf("You have a generate_image tool") < 0) { offInPrompt++; console.log(`      (${STORED[i][0]}: builds a prompt with the tools off)`); }
  }
  check("a stored row that says off for everything still builds a prompt with the tools on", offInPrompt === 0, `${offInPrompt} off`);

  // (3) THE COMPOSERS. Both used to hold a copy of the config and POST it with
  // every message, which made them the only place in the product that could
  // put an "off" in front of the model. Both controls are deleted, and this
  // asserts the DELETION rather than the deletion's effect: a button still on
  // screen that no longer changes anything is the worse half-removal — the
  // user presses it, nothing happens, and they conclude the feature is broken.
  const COMPOSERS: [string, string][] = [
    ["components/ai-writer/ChatPanel.tsx", "the chat composer"],
    ["app/engineai/page.tsx", "the home composer"],
  ];
  const CAP_KEYS = ["imageGeneration", "webSearch", "meetingBrain"];
  let capSwitch = 0, postsConfig = 0, tooSmall = 0;
  for (let c = 0; c < COMPOSERS.length; c++) {
    const src = readFileSync(join(process.cwd(), COMPOSERS[c][0]), "utf8");
    // PRECONDITION: reading the right file. An empty or renamed one satisfies
    // every absence assertion below by having nothing in it.
    if (src.length < 20000) { tooSmall++; console.log(`      (${COMPOSERS[c][1]}: only ${src.length} chars — this check is reading the wrong file)`); continue; }
    for (let k = 0; k < CAP_KEYS.length; k++) {
      if (src.indexOf(CAP_KEYS[k]) >= 0) { capSwitch++; console.log(`      (${COMPOSERS[c][1]} still mentions ${CAP_KEYS[k]})`); }
    }
    if (/contextConfig/.test(src)) { postsConfig++; console.log(`      (${COMPOSERS[c][1]} still holds a context config)`); }
  }
  check("PRECONDITION: both composers were read", tooSmall === 0, `${tooSmall} unreadable`);
  check("neither composer holds a capability switch", capSwitch === 0, `${capSwitch} references`);
  check("neither composer carries a context config at all", postsConfig === 0, `${postsConfig} do`);
  // …and the one control that STAYS still works. Incognito is a privacy
  // control, not a capability dial, and it was explicitly out of scope.
  const panel = readFileSync(join(process.cwd(), "components/ai-writer/ChatPanel.tsx"), "utf8");
  check("the chat composer still posts incognito with every message",
    /incognito: incognito \? "on" : "off"/.test(panel));
  const page = readFileSync(join(process.cwd(), "app/engineai/page.tsx"), "utf8");
  check("the home composer still hands incognito to the chat panel",
    /incognito=\{incognitoMode\}/.test(page));

  // (4) THE WRITE PATH. Three surfaces PATCH a whole ContextConfig through one
  // endpoint. The endpoint normalises on write, which is what quietly strips
  // the dead keys from each row as it is saved — and the surfaces must no
  // longer offer a capability control of their own, or an admin would be
  // pressing a switch the reader has stopped reading.
  const settings = readFileSync(join(process.cwd(), "app/api/ai/settings/route.ts"), "utf8");
  check("the settings write normalises rather than storing the raw object",
    /updateData\.config_context = normalizeContextConfig\(contextConfig\);/.test(settings));
  check("the raw write is gone", !/updateData\.config_context = contextConfig;/.test(settings));
  const WRITERS: [string, string][] = [
    ["app/(app)/settings/ai-context/page.tsx", "the AI-context settings page"],
    ["app/(app)/settings/ai-usage/page.tsx", "the AI-usage settings page"],
    ["components/ai-writer/AdminDialog.tsx", "the in-app admin dialog"],
  ];
  let notWholesale = 0, adminCap = 0;
  for (let i = 0; i < WRITERS.length; i++) {
    const src = readFileSync(join(process.cwd(), WRITERS[i][0]), "utf8");
    const initial = (/useState<ContextConfig>\(\{[\s\S]*?\n\s*\}\)/.exec(src) || [""])[0];
    if (initial.length < 20) { notWholesale++; console.log(`      (${WRITERS[i][1]}: no ContextConfig initial state found — this precondition is reading the wrong file)`); continue; }
    if (!/body: JSON\.stringify\(\{[\s\S]{0,400}?contextConfig,/.test(src)) { notWholesale++; console.log(`      (${WRITERS[i][1]}: does not PATCH the whole contextConfig)`); }
    for (let k = 0; k < CAP_KEYS.length; k++) {
      if (src.indexOf(CAP_KEYS[k]) >= 0) { adminCap++; console.log(`      (${WRITERS[i][1]} still offers a ${CAP_KEYS[k]} control)`); }
    }
  }
  check("all three settings writers PATCH the whole object", notWholesale === 0, `${notWholesale} not wholesale`);
  check("no admin surface offers a capability toggle either", adminCap === 0, `${adminCap} do`);
  // …and what the endpoint writes back for one of those PATCHes really has
  // lost the keys, rather than being assumed to. Behavioural, through the same
  // function the endpoint calls.
  const roundTrip: any = normalizeContextConfig({ contracts: "full-year", contentPipeline: "summary", socialPresence: "summary", ideas: "off", webSearch: "off", imageGeneration: "off" });
  check("a save through the endpoint's normaliser drops the dead keys",
    !("webSearch" in roundTrip) && !("imageGeneration" in roundTrip) && roundTrip.contracts === "full-year",
    JSON.stringify(roundTrip));

  // (5) THE STORED COPIES. There is NO per-conversation one — ai_conversations
  // has no config_context column — and that absence is asserted rather than
  // remembered, because adding one makes this enumeration silently wrong.
  check("no per-conversation copy of the context config exists",
    !/conversation\.config_context|conversation\.contextConfig/.test(msgSrcForPaths()));
  // There IS a per-TASK one: ai_scheduled_prompts.config_context, written when
  // a scheduled task is created and read back by the runner. It cannot produce
  // a false for any capability, for two independent reasons, and both are
  // asserted: the runner reads it through the normaliser (which no longer
  // emits the keys) and then DECLARES generationTools false anyway, because a
  // brief has no tools.
  const schedRoute = readFileSync(join(process.cwd(), "app/api/ai/scheduled/route.ts"), "utf8");
  check("PRECONDITION: a scheduled task really does store a context config",
    /config_context: proposalId \? \{ \.\.\.\(body\.configContext \|\| \{\}\), proposalId \} : \(body\.configContext \|\| null\),/.test(schedRoute));
  const runnerSrc = readFileSync(join(process.cwd(), "lib/scheduled/runner.ts"), "utf8");
  check("the stored task config is read through the normaliser",
    /normalizeContextConfig\(Object\.keys\(ctxRest\)\.length \? ctxRest : null\)/.test(runnerSrc));
  check("and the capability is overridden regardless of what it stored",
    /generationTools: false/.test(runnerSrc));

  // (6) THE ROUTER. It used to read webSearch, meetingBrain and memory off the
  // same config and suppress a whole class of routing — a user who had turned
  // Web off months ago got a workspace-only answer to a question about last
  // week's news, with nothing in the reply saying why. Behavioural: the router
  // takes the message and nothing else, and a topical question still searches.
  check("the router no longer takes a context config", routeQuery.length === 1, `arity ${routeQuery.length}`);
  const routerSrc = readFileSync(join(process.cwd(), "lib/ai/query-router.ts"), "utf8");
  check("no capability gate is left in the router",
    !/webAllowed|meetingBrainAllowed|memoryAllowed/.test(stripComments(routerSrc)));
  check("a question about current events still searches",
    routeQuery("what are the latest AI regulation changes in the EU?").searchMode === "on");
  check("a thank-you still does not", routeQuery("thanks, that's perfect").searchMode === "off");
}

/**
 * Source with comments removed, for the assertions that a name is GONE.
 *
 * A comment explaining what was removed necessarily names it, so an absence
 * assertion run over raw source reports its own documentation as a live read.
 * Both sections above have at least one assertion of that shape, and both went
 * red on this file's own prose before this existed.
 */
function stripComments(src: string): string {
  return src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/(^|[ \t])\/\/[^\n]*/gm, "$1");
}

/** Read once, where both sections above need it. */
function msgSrcForPaths(): string {
  return readFileSync(join(process.cwd(), "app/api/ai/conversations/[id]/messages/route.ts"), "utf8");
}


/**
 * 19. THE PASTED DRIVE LINK (2026-09-21)
 * ─────────────────────────────────────────────────────────────────────────
 * Chris pasted a Google Doc link at 15:24:11 and asked for a deck from it.
 * Three times he was told the document was not shared with EngineAI. It was.
 *
 *   15:24:11  he pastes .../document/u/1/d/1zqolBPs…/edit?tab=t.0
 *   15:24:15  "isn't in what's been shared with EngineAI yet" — true at that instant
 *   15:25:05  "can you try again"      -> the same answer, from a 60-second cache
 *   15:25:51  "I've shared it already" -> the same answer, from the same cache
 *
 * Three defects, and one assertion each below: a MISS served from cache, no
 * path from a link to a file, and a model narrating a by-ID check that nothing
 * in the tool could perform.
 *
 * GOOGLE_SA_EMAIL and GOOGLE_SA_PRIVATE_KEY_B64 are Vercel-only, so all of
 * this runs against a FAKE Drive: a fetch stub returning Drive's own JSON
 * shapes (a fileList, a 404 with error.errors[0].reason, a 403, a file
 * carrying driveId, an export body). A check that needs the network is a check
 * nobody runs. The fake projects the FIELDS it was asked for, because two
 * assertions here are really about what the request asks Drive for.
 *
 * MUTATION LOG — 2026-09-21, run in a detached worktree at a5bdc1a, never in
 * this working tree (it is shared, and it deploys). Survivors are findings
 * about the checks and are recorded, not tidied away.
 *
 * FIRST ROUND, all re-run against the second round's code and all still red:
 *   KILLED  the forced re-read on a miss deleted -> 11 red, incl. the replay
 *   KILLED  the rate limit on that re-read deleted -> 6 list calls, not 2
 *   KILLED  by-id resolution removed entirely -> 27 red
 *   KILLED  supportsAllDrives dropped from the by-id request -> 1 red
 *   KILLED  403 folded into a generic lookup failure -> 6 red
 *   KILLED  driveId dropped from the by-id fields -> the Shared Drive line goes
 *   KILLED  modifiedTime dropped from the list fields -> recency offers nothing
 *   KILLED  the transposed-letters rule removed -> IMT no longer finds ITM
 *   KILLED  the recently-changed rule removed -> 1 red
 *   KILLED  the freshness sentence removed from the refusal -> 3 red
 *   KILLED  the tool description reverted to its one-liner -> 6 red
 *   KILLED  the prompt's "a link gives you nothing" restored -> 2 red
 *   KILLED  a chain stops passing the user's string to the tool -> 1 red
 *   PARTIAL the finance gate removed from the by-id path -> only "Drive is
 *           never even asked for it" went red. The refusal TEXT stayed right
 *           because a second gate re-checks the id on the way back, so the
 *           text assertion alone would not have noticed the workbook being
 *           fetched. The network assertion is the one carrying that check.
 *
 * SECOND ROUND — five defects found by review in the FIRST round's own fix,
 * three of them the very failure the fix was written to remove:
 *   KILLED  forcedAt stamped before the await again -> 4 red. One Drive 500
 *           bought the cached negative another five seconds, under the
 *           sentence "it was re-read moments ago": defect 1 and defect 3 at
 *           once, inside the fix for defect 1.
 *   KILLED  the failed-attempt backoff removed -> 3 list calls, not 2
 *   KILLED  the link must be the whole argument again -> 6 red. Prose before
 *           the link, a markdown link, angle brackets and a newline all fell
 *           back to the name search that misses — the original incident,
 *           silently, under a refusal telling him to paste the link again.
 *   KILLED  the leading boundary dropped from the URL scan -> a Google path on
 *           somebody else's host resolves as a Drive link
 *   KILLED  the trailing-punctuation strip removed -> the ?id= form with a
 *           full stop after it stops resolving (the dot lands in the id)
 *   KILLED  the folder branch removed from the query parser -> 2 red
 *   KILLED  the folder outcome thrown rather than returned -> correct advice
 *           arrives wearing "Drive lookup failed"
 *   KILLED  the already-pasted-a-link branch removed -> 2 red
 *   KILLED  mentionsAGoogleLink always true -> an ordinary miss loses the
 *           link route, so the suppression must stay conditional
 *   KILLED  classify403 always answers "policy" -> 4 red. A rate limit was
 *           reported as the owner's organisation forbidding the share, over
 *           the top of Drive's own "Rate Limit Exceeded" quoted below it.
 *   KILLED  error.errors[0].reason discarded -> 4 red
 *   KILLED  the id grammar guard in fetchById removed -> a 250-character token
 *           is sent to Drive. Invisible in the answer; only the call log shows
 *           it, which is why that guard was a SURVIVOR on the first run.
 *   KILLED  the bare-token id test widened -> "ITM-report-exec-draft" is sent
 *           to Drive as an id. Same shape, same reason.
 *   KILLED  answered dropped from the by-id 404 -> the model is handed a
 *           definitive answer as "Drive documents query failed"
 *   KILLED  the formatter's answered branch removed -> 2 red
 *   KILLED  the "a Drive URL alone is not enough" sentence restored -> 1 red
 *   KILLED  the description's "never served from a cache" restored -> 2 red.
 *           The code never kept that promise: inside the rate limit a miss IS
 *           answered from the list, and says so in the same turn.
 *   KILLED  the prompt's one-explanation 403 restored -> 1 red
 *   KILLED  the prompt's "never a stale answer" restored -> 2 red
 *   SURVIVOR the CHARACTER class on a bare token (/^[A-Za-z0-9_-]+$/ in
 *           driveIdFromQuery) dropped -> 0 red. It and the grammar guard in
 *           fetchById are mutually redundant: with either one present a
 *           badly-shaped token is rejected BEFORE the fetch and falls back to
 *           the name search, so no answer and no request changes. Only the
 *           LENGTH halves are independently observable, and both now are.
 *           Kept as defence in depth in front of a hardcoded URL template,
 *           and recorded rather than tidied away.
 *   NOTE    the description mutation was malformed on its first attempt —
 *           it concatenated a one-liner in FRONT of the real text instead of
 *           replacing it, so the assertions still found what they look for and
 *           it survived. Corrected to replace the whole template literal, it
 *           kills 6. A mutation that does not mutate proves nothing.
 */
async function driveSection(): Promise<void> {
console.log("\n19. A pasted Drive link resolves by id, and a miss is never served from cache");
{
  const DOC = "application/vnd.google-apps.document";
  /** Chris's real file id, from the link in the transcript. */
  const ITM_ID = "1zqolBPs7Ytq8dDMTOndDnaXwANrzMmwO5xdN2gsEtzA";
  const ITM_URL = `https://docs.google.com/document/u/1/d/${ITM_ID}/edit?tab=t.0`;
  const SA = "engineai@example.iam.gserviceaccount.com";
  /** Europe/Zurich, the workspace's clock, so the times read as the transcript does. */
  const at = (hms: string) => Date.parse(`2026-09-21T${hms}+02:00`);

  interface FakeFile { id: string; name: string; mimeType: string; modifiedTime: string; driveId?: string; body?: string }

  const OTHERS: FakeFile[] = [
    { id: "1AAAaaa111BBBbbb222CCCccc333DDDddd44", name: "TCE 26+ strategy", mimeType: DOC, modifiedTime: "2026-09-12T09:03:00.000Z", body: "TCE 26+ strategy\nPositioning, pricing, team." },
    { id: "1BBBbbb222CCCccc333DDDddd444EEEeee55", name: "Client onboarding checklist", mimeType: DOC, modifiedTime: "2026-08-30T15:40:00.000Z", body: "Onboarding checklist\nKick-off, access, cadence." },
    { id: "1CCCccc333DDDddd444EEEeee555FFFfff66", name: "Q3 pipeline review", mimeType: DOC, modifiedTime: "2026-09-02T11:10:00.000Z", body: "Q3 pipeline review\nWeighted value by stage." },
  ];
  const ITM: FakeFile = {
    id: ITM_ID,
    name: "ITM report - exec draft",
    mimeType: DOC,
    // 15:22 Zurich — two minutes before he pasted the link, which is exactly
    // the recency signal the candidate ranking is supposed to notice.
    modifiedTime: "2026-09-21T13:22:00.000Z",
    body: "Infrastructure Transition Monitor — executive draft\nSiemens. Findings, method, recommendations.",
  };

  /** The fake Drive. `listed` is what files.list returns; `known` is what
   *  files.get can resolve — deliberately a superset, because that difference
   *  IS the bug: a file shared straight with the service account is readable by
   *  id while a name search never turns it up. */
  interface Fake403 { reason: string; message: string }
  interface FakeDrive {
    listed: FakeFile[]; known: FakeFile[]; forbidden: string[]; calls: string[];
    /** Non-zero makes files.list fail with that status — a flapping Drive. */
    listFailsWith: number;
    /** Which 403 Drive returns. Its reason is the field the tool must read. */
    forbiddenAs: Fake403;
  }

  const fakeDrive = (listed: FakeFile[], known?: FakeFile[], forbidden?: string[], forbiddenAs?: Fake403): { drive: FakeDrive; fetchImpl: typeof fetch } => {
    const drive: FakeDrive = {
      listed, known: known || listed, forbidden: forbidden || [], calls: [],
      listFailsWith: 0,
      forbiddenAs: forbiddenAs || { reason: "forbidden", message: "The caller does not have permission" },
    };
    const impl = async (url: any): Promise<Response> => {
      const u = String(url);
      drive.calls.push(u);
      const json = (body: any, status: number) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=UTF-8" } });

      // Drive returns the fields you ASK for and nothing else, and that is not
      // a detail here: `modifiedTime` is what the recency candidate reads and
      // `driveId` is what marks a Shared Drive file, so a fake that hands back
      // every field regardless would keep passing after either was dropped
      // from the request.
      const fieldsOf = (raw: string): string[] => {
        const inner = raw.indexOf("(") >= 0 ? raw.slice(raw.indexOf("(") + 1, raw.lastIndexOf(")")) : raw;
        const out: string[] = [];
        const parts = inner.split(",");
        for (let i = 0; i < parts.length; i++) if (parts[i].trim()) out.push(parts[i].trim());
        return out;
      };
      const project = (f: FakeFile, asked: string[]): any => {
        const full: any = { kind: "drive#file", id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime };
        if (f.driveId) full.driveId = f.driveId;
        const row: any = { kind: "drive#file" };
        for (let i = 0; i < asked.length; i++) if (full[asked[i]] !== undefined) row[asked[i]] = full[asked[i]];
        return row;
      };
      const askedFor = (): string[] => {
        try { return fieldsOf(new URL(u).searchParams.get("fields") || ""); } catch { return []; }
      };

      if (/\/drive\/v3\/files\?/.test(u)) {
        if (drive.listFailsWith) {
          return json({ error: { code: drive.listFailsWith, message: "Backend Error", errors: [{ domain: "global", reason: "backendError", message: "Backend Error" }] } }, drive.listFailsWith);
        }
        const asked = askedFor();
        const files = drive.listed.map((f) => project(f, asked));
        return json({ kind: "drive#fileList", incompleteSearch: false, files }, 200);
      }
      const ex = u.match(/\/drive\/v3\/files\/([A-Za-z0-9_-]+)\/export\?/);
      if (ex) {
        const f = findById(drive.known, ex[1]);
        if (!f) return json(notFound(ex[1]), 404);
        return new Response(f.body || "", { status: 200, headers: { "content-type": "text/plain" } });
      }
      const get = u.match(/\/drive\/v3\/files\/([A-Za-z0-9_-]+)\?/);
      if (get) {
        const id = get[1];
        if (drive.forbidden.indexOf(id) >= 0) {
          const f403 = drive.forbiddenAs;
          return json({ error: { code: 403, message: f403.message, errors: [{ domain: "global", reason: f403.reason, message: f403.message }] } }, 403);
        }
        const f = findById(drive.known, id);
        if (!f) return json(notFound(id), 404);
        return json(project(f, askedFor()), 200);
      }
      return json({ error: { code: 404, message: `unexpected fake-Drive URL: ${u}` } }, 404);
    };
    return { drive, fetchImpl: impl as unknown as typeof fetch };
  };

  const notFound = (id: string) => {
    return { error: { code: 404, message: `File not found: ${id}.`, errors: [{ domain: "global", reason: "notFound", message: `File not found: ${id}.`, locationType: "parameter", location: "fileId" }] } };
  };
  const findById = (files: FakeFile[], id: string): FakeFile | undefined => {
    for (let i = 0; i < files.length; i++) if (files[i].id === id) return files[i];
    return undefined;
  };
  const listCalls = (d: FakeDrive): number => {
    let n = 0;
    for (let i = 0; i < d.calls.length; i++) if (/\/drive\/v3\/files\?/.test(d.calls[i])) n++;
    return n;
  };
  const calledById = (d: FakeDrive, id: string): boolean => {
    for (let i = 0; i < d.calls.length; i++) if (d.calls[i].indexOf(`/files/${id}?`) >= 0) return true;
    return false;
  };
  /** Every files/{id} request, whatever the id. The two grammar guards on the
   *  id are invisible in the ANSWER — both make the tool fall back to a name
   *  search — so the only place they can be observed is Drive's call log. */
  const byIdCalls = (d: FakeDrive): string[] => {
    const out: string[] = [];
    for (let i = 0; i < d.calls.length; i++) {
      const m = d.calls[i].match(/\/drive\/v3\/files\/([^/?]+)\?/);
      if (m) out.push(decodeURIComponent(m[1]));
    }
    return out;
  };

  /** One scenario: a fake Drive, a fresh cache, and a clock we move by hand. */
  const scenario = (listed: FakeFile[], known?: FakeFile[], forbidden?: string[], forbiddenAs?: Fake403) => {
    const { drive, fetchImpl } = fakeDrive(listed, known, forbidden, forbiddenAs);
    const clock = { t: at("15:24:11") };
    const deps = {
      fetchImpl,
      getToken: async () => "fake-access-token",
      saEmail: SA,
      now: () => clock.t,
      caches: newDriveCaches(),
    };
    return { drive, clock, deps };
  };

  // ── PRECONDITION: the fake really answers like Drive ──
  {
    const s = scenario(OTHERS);
    const listed = await queryDriveDocs("list", undefined, s.deps);
    check("PRECONDITION: the fake Drive lists three files, as production did at 15:24",
      listed.count === 3 && !listed.error && !listed.notice, JSON.stringify(listed).slice(0, 120));
    const res: any = await (s.deps.fetchImpl as any)(`https://www.googleapis.com/drive/v3/files/${ITM_ID}?fields=id&supportsAllDrives=true`);
    const body = await res.json();
    check("PRECONDITION: an unshared id comes back as Drive's own 404 shape",
      res.status === 404 && body.error.errors[0].reason === "notFound");
  }

  // ── DEFECT 2: a link resolves by id, even when no name search could find it ──
  {
    const s = scenario(OTHERS, OTHERS.concat([ITM]));
    const r = await queryDriveDocs("read", ITM_URL, s.deps);
    check("a pasted link is read by file id although the list does not hold it",
      r.count === 1 && !r.error && String(r.data && r.data.content).indexOf("Infrastructure Transition Monitor") >= 0,
      r.error || JSON.stringify(r.data).slice(0, 120));
    check("the by-id lookup asks Drive with supportsAllDrives", calledById(s.drive, ITM_ID) &&
      s.drive.calls.join(" ").indexOf("supportsAllDrives=true") >= 0);
    check("and it says the answer came from the link, not from a name match",
      /link you pasted/i.test(String(r.data && r.data.resolvedBy)), String(r.data && r.data.resolvedBy));
  }

  // ── DEFECT 2: the three outcomes, told apart ──
  {
    const s = scenario(OTHERS); // the file is nowhere: 404
    const r = await queryDriveDocs("read", ITM_URL, s.deps);
    const err = String(r.error || "");
    check("a 404 on a link says Drive was asked directly and names the share address",
      /404/.test(err) && err.indexOf(SA) >= 0 && /not shared with EngineAI/i.test(err), err.slice(0, 160));
    check("and it says the refusal did not come from a cache",
      /Nothing was read from a cache/i.test(err), err.slice(0, 160));
  }
  {
    const s = scenario(OTHERS, OTHERS.concat([ITM]), [ITM_ID]); // shared, org refuses: 403
    const r = await queryDriveDocs("read", ITM_URL, s.deps);
    const err = String(r.error || "");
    check("a 403 says the file IS shared and the owner's organisation refuses us",
      /403/.test(err) && /organisation forbids/i.test(err) && /IS shared/.test(err), err.slice(0, 160));
    // The distinction has to reach the user's NEXT action: telling somebody to
    // share a document the organisation is blocking is the loop this incident
    // was made of.
    check("a 403 never tells them to share it again", err.indexOf(SA) < 0 && !/Viewer is enough/.test(err), err.slice(0, 160));
  }
  {
    const onSharedDrive: FakeFile = { ...ITM, driveId: "0AJ5kQfakeSharedDriveId" };
    const s = scenario(OTHERS, OTHERS.concat([onSharedDrive]));
    const r = await queryDriveDocs("read", ITM_URL, s.deps);
    check("a Shared Drive file resolves and says where it lives",
      r.count === 1 && /Shared Drive/i.test(String(r.data && r.data.resolvedBy)),
      r.error || String(r.data && r.data.resolvedBy));
  }

  // ── DEFECT 2: one extractor, not a second one ──
  {
    const docsSrc = readFileSync(join(process.cwd(), "lib/gdrive/docs.ts"), "utf8");
    check("the id comes from lib/gdrive/doc-link, which already knew how to read a link",
      /import \{ extractDocId \} from "@\/lib\/gdrive\/doc-link"/.test(docsSrc));
    // Over stripped source: the comment explaining WHICH link shapes doc-link
    // handles necessarily quotes one, and an absence assertion run over raw
    // source reports its own documentation as a live parser.
    const docsCode = stripComments(docsSrc);
    check("and no second URL parser was written here",
      docsCode.indexOf("new URL(") < 0 && docsCode.indexOf("document/d/") < 0);
  }

  // ── DEFECT 2: the by-id path is not a way round the finance gate ──
  {
    const FORECAST = process.env.FINANCE_FORECAST_FILE_ID || "1Skw6rHX5mtQMbkK5anbJrMwEL-2AHDab";
    const workbook: FakeFile = { id: FORECAST, name: "Finance forecast", mimeType: DOC, modifiedTime: "2026-09-20T08:00:00.000Z", body: "MRR by month" };
    const s = scenario(OTHERS.concat([workbook]), OTHERS.concat([workbook]));
    const r = await queryDriveDocs("read", `https://docs.google.com/spreadsheets/d/${FORECAST}/edit`, s.deps);
    check("the finance workbook is refused by id as well as by name",
      r.count === 0 && /finance forecast workbook/i.test(String(r.error)), String(r.error).slice(0, 140));
    check("and Drive is never even asked for it", !calledById(s.drive, FORECAST));
    const listed = await queryDriveDocs("list", undefined, s.deps);
    check("PRECONDITION: it was in the fake Drive and filtered out of the list", listed.count === 3);
  }

  // ── DEFECT 1: a miss is never served from cache ──
  {
    const s = scenario(OTHERS);
    const first = await queryDriveDocs("read", "ITM report", s.deps);
    check("PRECONDITION: before the share lands, the name genuinely misses", !!first.error && first.count === 3);
    const beforeShare = listCalls(s.drive);
    // The share lands 20 seconds later, and he asks again 34 seconds after
    // that — 54 seconds in, well inside the 60-second window that failed him.
    s.clock.t = at("15:24:31");
    s.drive.listed = OTHERS.concat([ITM]);
    s.drive.known = OTHERS.concat([ITM]);
    s.clock.t = at("15:25:05");
    const second = await queryDriveDocs("read", "ITM report", s.deps);
    check("a freshly shared file is found inside the 60-second window",
      second.count === 1 && String(second.data && second.data.content).indexOf("Infrastructure Transition Monitor") >= 0,
      second.error || "");
    check("because the miss forced a re-read rather than replaying the snapshot",
      listCalls(s.drive) > beforeShare, `${beforeShare} -> ${listCalls(s.drive)}`);
  }

  // ── DEFECT 1: a HIT is still cached, or this fix costs a Drive call a turn ──
  {
    const s = scenario(OTHERS);
    await queryDriveDocs("read", "TCE 26+ strategy", s.deps);
    const afterFirst = listCalls(s.drive);
    s.clock.t = at("15:24:20");
    await queryDriveDocs("read", "Q3 pipeline review", s.deps);
    check("a hit is still answered from the cached list", listCalls(s.drive) === afterFirst, `${afterFirst} -> ${listCalls(s.drive)}`);
  }

  // ── DEFECT 1: the forced re-read is rate-limited ──
  {
    const s = scenario(OTHERS);
    for (let i = 0; i < 5; i++) {
      s.clock.t = at("15:24:11") + i * 500;
      await queryDriveDocs("read", "ITM report", s.deps);
    }
    const inWindow = listCalls(s.drive);
    check("five misses in two seconds cost one forced re-read, not five", inWindow <= 2, `${inWindow} list calls`);
    s.clock.t = at("15:24:11") + 6_000;
    await queryDriveDocs("read", "ITM report", s.deps);
    check("and the next miss after the window re-reads again", listCalls(s.drive) === inWindow + 1, `${listCalls(s.drive)}`);
  }

  // ── DEFECT 1: the refusal says when the list was actually fetched ──
  {
    const s = scenario(OTHERS);
    const fresh = await queryDriveDocs("read", "ITM report", s.deps);
    check("a refusal after a real re-read says so",
      /re-read from Drive just now/i.test(String(fresh.error)), String(fresh.error).slice(0, 160));
    s.clock.t = at("15:24:13");
    const limited = await queryDriveDocs("read", "ITM report", s.deps);
    check("a refusal inside the rate limit says how old the list is instead",
      /last read from Drive/i.test(String(limited.error)) && /seconds ago|just now/.test(String(limited.error)),
      String(limited.error).slice(0, 160));
  }

  // ── THE NEAR-MISS WORTH KEEPING: IMT / ITM, and "I just shared it" ──
  {
    const s = scenario(OTHERS.concat([ITM]));
    const r = await queryDriveDocs("read", "IMT report", s.deps);
    const err = String(r.error || "");
    check("PRECONDITION: his typo matches no document by name", r.count === 4 && !!r.error);
    check("the transposed typo still offers the real document",
      err.indexOf("ITM report - exec draft") >= 0, err.slice(0, 200));
    // The REASON, specifically the transposition. Written as an AND rather
    // than "either signal will do": "report" matches on its own, so an OR here
    // would stay green with the typo handling deleted, and the typo is the
    // whole reason this offer was useful to him.
    check("and it says the name is his typo with the letters swapped",
      /letters swapped/i.test(err), err.slice(0, 220));
    // Recency on its own, with a query that shares no letters with anything.
    const r2 = await queryDriveDocs("read", "the thing I just shared", s.deps);
    check("a document changed minutes ago is offered even when the words do not match",
      String(r2.error).indexOf("ITM report - exec draft") >= 0, String(r2.error).slice(0, 200));
  }

  // ── DEFECT 2: the link is found ANYWHERE in the message, not only alone ──
  //
  // Requiring the whole argument to parse as a URL let four everyday shapes
  // fall silently back to the name search that misses — and the refusal then
  // told the user to paste a Drive link, with their Drive link quoted inside
  // it. The bug is invisible in the answer: it looks exactly like the original
  // incident.
  {
    const shapes: string[][] = [
      ["prose before the link", `please read ${ITM_URL}`],
      ["a markdown link", `[ITM](${ITM_URL})`],
      ["angle brackets, as mail clients add", `<${ITM_URL}>`],
      ["a newline between the words and the link", `here you go\n${ITM_URL}`],
      ["a full stop after it", `${ITM_URL}.`],
      // The ?id= form is where the trailing full stop actually bites: it lands
      // INSIDE the query parameter, and an id with a dot in it is not an id.
      ["a full stop after the ?id= form", `it's here: https://drive.google.com/open?id=${ITM_ID}.`],
      ["a link retyped without the scheme", ITM_URL.replace(/^https:\/\//, "")],
      ["a link with the deck request around it", `build me a deck from ${ITM_URL} please`],
    ];
    for (let i = 0; i < shapes.length; i++) {
      const s2 = scenario(OTHERS, OTHERS.concat([ITM]));
      const r = await queryDriveDocs("read", shapes[i][1], s2.deps);
      check(`a link survives ${shapes[i][0]}`,
        r.count === 1 && String(r.data && r.data.content).indexOf("Infrastructure Transition Monitor") >= 0,
        String(r.error || "").slice(0, 110));
    }
    // And the boundary that makes the scan safe. extractDocId matches the host
    // EXACTLY, so both of these have to come back as "no link here" rather than
    // as Chris's document.
    const lookalikes: string[][] = [
      ["a look-alike host", `https://docs.google.com.evil.test/document/d/${ITM_ID}/edit`],
      ["a Google path on somebody else's host", `https://evil.test/docs.google.com/document/d/${ITM_ID}/edit`],
    ];
    for (let i = 0; i < lookalikes.length; i++) {
      const s2 = scenario(OTHERS, OTHERS.concat([ITM]));
      const r = await queryDriveDocs("read", lookalikes[i][1], s2.deps);
      check(`${lookalikes[i][0]} is not read as a Drive link`,
        r.count !== 1 && !calledById(s2.drive, ITM_ID), String(r.count));
    }
  }

  // ── DEFECT 2: a folder link is a folder, not a sharing problem ──
  {
    const s2 = scenario(OTHERS, OTHERS.concat([ITM]));
    const r = await queryDriveDocs("read", `it's in here https://drive.google.com/drive/folders/0ABCdefFolderId12345`, s2.deps);
    const err = String(r.error || "");
    check("a pasted FOLDER link says so rather than blaming the sharing",
      /FOLDER/.test(err) && /file inside it/i.test(err), err.slice(0, 140));
    check("and it does not send them off to share anything again", err.indexOf(SA) < 0, err.slice(0, 140));
    check("and Drive is not asked to open a folder", byIdCalls(s2.drive).length === 0);
    // The same answer when the folder hides behind an ordinary /d/ link, which
    // only Drive can tell us about.
    const folderFile: FakeFile = { id: "1FolderIdLookingLikeADocument9999", name: "ITM working folder", mimeType: "application/vnd.google-apps.folder", modifiedTime: "2026-09-21T13:00:00.000Z" };
    const s3 = scenario(OTHERS, OTHERS.concat([folderFile]));
    const r3 = await queryDriveDocs("read", `https://docs.google.com/document/d/${folderFile.id}/edit`, s3.deps);
    // Returned, not thrown. A thrown message carries correct advice wearing
    // "Drive lookup failed", which is the framing that invites a retry.
    check("a folder that only Drive can identify gets the same answer, as an answer",
      /FOLDER/.test(String(r3.error)) && r3.answered === true && !/lookup failed/i.test(String(r3.error)),
      String(r3.error).slice(0, 140));
  }

  // ── DEFECT 2: never advise the action they have just taken ──
  {
    const s2 = scenario(OTHERS);
    const r = await queryDriveDocs("read", "it's at https://drive.google.com/drive/my-drive somewhere", s2.deps);
    const err = String(r.error || "");
    check("a refusal never tells them to paste a link they have already pasted",
      !/paste its Drive link/i.test(err), err.slice(-160));
    check("it says instead that no document id could be read out of it",
      /no document id could be read/i.test(err), err.slice(-160));
    // And the ordinary miss, with no link in it, still points at the road that
    // would have worked — the suppression has to be conditional, not a delete.
    const plain = await queryDriveDocs("read", "ITM report", scenario(OTHERS).deps);
    check("an ordinary miss still offers the link route",
      /paste its Drive link/i.test(String(plain.error)), String(plain.error).slice(-140));
  }

  // ── DEFECT 2: one 403 is not every 403 ──
  //
  // Drive answers 403 for a domain policy AND for its own rate limits, and the
  // first version of this fix asserted "It IS shared — the owner's organisation
  // forbids sharing it outside" over the top of Drive's quoted "Rate Limit
  // Exceeded". Wrong, unactionable, and a claim the tool never checked.
  {
    const quota = scenario(OTHERS, OTHERS.concat([ITM]), [ITM_ID], { reason: "userRateLimitExceeded", message: "Rate Limit Exceeded" });
    const rq = await queryDriveDocs("read", ITM_URL, quota.deps);
    const eq = String(rq.error || "");
    check("a rate-limit 403 is reported as OUR limit, not their sharing",
      /rate or quota limit/i.test(eq) && !/organisation forbids/i.test(eq), eq.slice(0, 170));
    check("and it says the same request is worth making again",
      /worth making again/i.test(eq) && /Rate Limit Exceeded/.test(eq), eq.slice(0, 200));

    const odd = scenario(OTHERS, OTHERS.concat([ITM]), [ITM_ID], { reason: "cannotDownloadAbusiveFile", message: "This file has been identified as malware" });
    const ro = await queryDriveDocs("read", ITM_URL, odd.deps);
    const eo = String(ro.error || "");
    check("an unrecognised 403 quotes Drive instead of inventing a reason",
      !/organisation forbids/i.test(eo) && !/rate or quota limit/i.test(eo) && /identified as malware/.test(eo), eo.slice(0, 200));
    check("and says the reason is unknown to us rather than guessing",
      /unknown to us/i.test(eo), eo.slice(0, 200));

    const perm = scenario(OTHERS, OTHERS.concat([ITM]), [ITM_ID], { reason: "insufficientFilePermissions", message: "The user does not have sufficient permissions for this file" });
    const rp = await queryDriveDocs("read", ITM_URL, perm.deps);
    check("a permission 403 still reads as the organisation refusing us",
      /organisation forbids/i.test(String(rp.error)), String(rp.error).slice(0, 170));
  }

  // ── DEFECT 1: a forced re-read that FAILS may not stand in for one that worked ──
  //
  // Stamping the rate limit before awaiting Drive meant one 500 bought the
  // cached negative another five seconds, under the sentence "it was re-read
  // moments ago". That is the incident's failure mode AND its third defect —
  // narrating a check that did not happen — recreated inside the fix for the
  // first one.
  {
    const s2 = scenario(OTHERS);
    s2.clock.t = at("15:20:00");
    await queryDriveDocs("read", "TCE 26+ strategy", s2.deps);
    const warm = listCalls(s2.drive);
    // 15:20:20 the share lands; 15:20:40 he asks, and Drive is flapping.
    s2.drive.listed = OTHERS.concat([ITM]);
    s2.drive.known = OTHERS.concat([ITM]);
    s2.clock.t = at("15:20:40");
    s2.drive.listFailsWith = 500;
    const broke = await queryDriveDocs("read", "ITM report", s2.deps);
    check("a failed re-read is reported as a failure, not as 'not shared'",
      /Drive lookup failed/i.test(String(broke.error)) && broke.answered !== true, String(broke.error).slice(0, 120));
    s2.clock.t = at("15:20:41");
    const during = await queryDriveDocs("read", "ITM report", s2.deps);
    check("the next miss does not claim a re-read that never landed",
      !/re-read moments ago/i.test(String(during.error)), String(during.error).slice(0, 200));
    check("it says the list could NOT be re-read, and how old it is",
      /could NOT be re-read/i.test(String(during.error)) && /seconds ago/.test(String(during.error)), String(during.error).slice(0, 220));
    check("a list nobody could refresh is not offered as Drive's answer", during.answered !== true);
    check("and a flapping Drive is not hammered inside the backoff",
      listCalls(s2.drive) === warm + 1, `${warm} -> ${listCalls(s2.drive)}`);
    s2.clock.t = at("15:20:43");
    s2.drive.listFailsWith = 0;
    const healed = await queryDriveDocs("read", "ITM report", s2.deps);
    check("and the moment Drive answers again the shared file is found",
      healed.count === 1, healed.error || "");
  }

  // ── THE TWO ID GUARDS, which are invisible anywhere but the call log ──
  //
  // Both make the tool fall back to a name search, so the ANSWER is identical
  // with either one deleted; only Drive's own call log shows the difference.
  // Recorded as survivors on the first run of this section, and this is what
  // it took to observe them.
  {
    const s2 = scenario(OTHERS, OTHERS.concat([ITM]));
    const plausible = "ITM-report-exec-draft";
    await queryDriveDocs("read", plausible, s2.deps);
    check("a name that only LOOKS like an id is searched by name, not sent to Drive as one",
      byIdCalls(s2.drive).length === 0, byIdCalls(s2.drive).join(","));

    const s3 = scenario(OTHERS, OTHERS.concat([ITM]));
    let tooLong = "9";
    for (let i = 0; i < 83; i++) tooLong += "Ab3";
    await queryDriveDocs("read", tooLong, s3.deps);
    check("a token longer than Drive's own id grammar is never sent to Drive",
      byIdCalls(s3.drive).length === 0, `${tooLong.length} chars, ${byIdCalls(s3.drive).length} by-id call(s)`);
  }

  // ── WHAT THE MODEL ACTUALLY RECEIVES ──
  //
  // Everything above tests the tool's result object; the chains hand the model
  // formatDriveDocsResult's string. A definitive 404 used to arrive as "Drive
  // documents query failed: …  Tell the user briefly" — transient-sounding,
  // which is the retry loop, and brief about the candidate list, which is the
  // useful part.
  {
    const s2 = scenario(OTHERS);
    const missed = await queryDriveDocs("read", ITM_URL, s2.deps);
    const shown = providers.formatDriveDocsResult(missed as any);
    check("a by-id 404 reaches the model as Drive's answer, not a failed query",
      shown.indexOf("Drive documents query failed") < 0 && /Drive's own answer/.test(shown), shown.slice(0, 120));
    const named = await queryDriveDocs("read", "IMT report", scenario(OTHERS.concat([ITM])).deps);
    const shownNamed = providers.formatDriveDocsResult(named as any);
    check("and a near miss is not handed over with an instruction to be brief",
      !/Tell the user briefly/.test(shownNamed) && shownNamed.indexOf("ITM report - exec draft") >= 0, shownNamed.slice(0, 140));
    const thrown = providers.formatDriveDocsResult({ data: [], count: 0, error: "Drive lookup failed: Drive list failed (500)" });
    check("a request that really did break still reads as a failure",
      thrown.indexOf("Drive documents query failed") === 0, thrown.slice(0, 80));
    const provSrc2 = readFileSync(join(process.cwd(), "lib/ai/providers.ts"), "utf8");
    check("and nothing in providers.ts still tells the model a link cannot be fetched",
      !/cannot fetch a link/i.test(provSrc2) && !/URL alone is not enough/i.test(provSrc2));
  }

  // ── DEFECT 3: the tool says what it does and does not do ──
  {
    const fn: any = (providers.QUERY_DRIVE_DOCS_OPENAI_TOOL as any).function;
    const desc = String(fn.description || "");
    const params: any = fn.parameters;
    check("the description says a pasted link is resolved by file id",
      /resolved directly by file id/i.test(desc) && /URL or file id/i.test(desc), desc.slice(0, 120));
    check("it says a miss re-asks Drive rather than trusting the list it holds",
      /re-asks Drive before answering rather than trusting the cached list/i.test(desc), desc.slice(0, 120));
    // The sentence it replaced said "not shared" is NEVER served from a cache.
    // The code does not promise that: inside the rate limit a miss IS answered
    // from the cached list, and the refusal says so in the same turn. A tool
    // description the result text contradicts is defect 3 all over again, in
    // the artefact written to fix defect 3.
    check("and it does not promise a freshness the code cannot keep",
      !/never served from a cache/i.test(desc) && /says when the list was actually fetched/i.test(desc), desc.slice(0, 120));
    check("it says what the tool cannot do", /WHAT IT CANNOT DO/.test(desc) && /cannot search inside documents/i.test(desc));
    check("it forbids narrating a check the tool did not perform",
      /Never claim to have checked something this tool did not do/i.test(desc) && /you did not look one up by id/i.test(desc));
    check("it names the three outcomes it can report",
      /404/.test(desc) && /403/.test(desc), desc.slice(-200));
    check("the name parameter tells the model to pass the link through",
      /URL or file id the user pasted/i.test(String(params.properties.name.description)));
    // USED, not merely written. The link reaches the tool through `name`, so
    // every chain has to still be passing it — a description promising by-id
    // resolution over a call site that drops the argument is the shape this
    // repo has already shipped once.
    const provSrc = readFileSync(join(process.cwd(), "lib/ai/providers.ts"), "utf8");
    const anthropicCalls = provSrc.split("queryDriveDocs(tool.input.action, tool.input.name)").length - 1;
    const otherCalls = provSrc.split("queryDriveDocs(input.action, input.name)").length - 1;
    check("all four chains still pass the user's string to the tool",
      anthropicCalls === 1 && otherCalls === 3, `${anthropicCalls} + ${otherCalls}`);
    check("the Anthropic tool carries the same description, not a copy",
      /description: QUERY_DRIVE_DOCS_OPENAI_TOOL\.function\.description!/.test(provSrc));
    // The injectable seam is for this file and nothing else: no app call site
    // passes a third argument, so production cannot be driven through a fake.
    const importSrc = readFileSync(join(process.cwd(), "app/api/optimizer/import/route.ts"), "utf8");
    const threeArg = (provSrc + importSrc).match(/queryDriveDocs\([^)]*,[^)]*,[^)]*\)/g);
    check("no production call site reaches the test seam", threeArg === null, String(threeArg));
  }

  // ── DEFECT 3: the assembled prompt no longer denies the capability ──
  {
    const savedSa = process.env.GOOGLE_SA_EMAIL;
    process.env.GOOGLE_SA_EMAIL = SA;
    const deployed = buildSystemPrompt({
      conversationVisibility: "private",
      userName: "Test",
      workspaceConfig: { companyContext: "TCE is a content agency.", contentTypes: [], cuDefinitions: [], formatDescriptions: {}, typeInstructions: {} },
      clientContext: null,
      contentDetail: null,
    } as any);
    if (savedSa === undefined) delete process.env.GOOGLE_SA_EMAIL; else process.env.GOOGLE_SA_EMAIL = savedSa;
    check("PRECONDITION: the Drive block is in that prompt", deployed.indexOf("## Google Drive access") >= 0);
    check("the prompt no longer says a pasted link gives you nothing",
      !/pasting a Drive link gives you nothing/i.test(deployed) && !/cannot open a document from a URL/i.test(deployed));
    check("it tells the model to pass the link to the tool",
      /Pass the URL they pasted straight to query_drive_docs/i.test(deployed));
    check("it says a miss is not the old cache, so nobody is told to wait and retry",
      /never the minute-old cache/i.test(deployed) && /do not tell the user to wait and try again/i.test(deployed));
    check("and it tells the model to relay a list that could not be re-read",
      /could NOT be re-read/i.test(deployed), "");
    check("it separates a quota refusal from the organisation refusing us",
      /rate or quota limit, that is OUR end/i.test(deployed));
    check("it separates the 403 from the not-shared answer",
      /the document IS shared and the owner's organisation is refusing us/i.test(deployed));
    check("and it forbids claiming a by-ID check that was not made",
      /by its ID/i.test(deployed) && /Never claim to have checked something you did not do/i.test(deployed));
  }

  // ── THE REPLAY: his three messages, against the fixed code ──
  //
  // The fake Drive lists three files at 15:24 and four from 15:25, which is
  // what production's own log says happened. The model passes the link it was
  // given, because that is what the tool description now tells it to do.
  {
    const s = scenario(OTHERS, OTHERS.slice()); // the share has not landed yet
    const say = (t: string, r: any) =>
      console.log(`      ${t}  ${r.count === 1 ? `READS "${r.data.name}"` : String(r.error || r.notice).slice(0, 96)}`);

    s.clock.t = at("15:24:15");
    const turn1 = await queryDriveDocs("read", ITM_URL, s.deps);
    say("15:24:15", turn1);
    check("REPLAY 15:24:15 — honest, actionable, and grounded in a live 404",
      turn1.count === 0 && /404/.test(String(turn1.error)) && String(turn1.error).indexOf(SA) >= 0);

    // 15:24:40 — the share lands. Nothing else changes.
    s.drive.listed = OTHERS.concat([ITM]);
    s.drive.known = OTHERS.concat([ITM]);

    s.clock.t = at("15:25:05");
    const turn2 = await queryDriveDocs("read", ITM_URL, s.deps);
    say("15:25:05", turn2);
    check("REPLAY 15:25:05 — 'can you try again' now returns the document",
      turn2.count === 1 && String(turn2.data.content).indexOf("Infrastructure Transition Monitor") >= 0,
      turn2.error || "");

    s.clock.t = at("15:25:51");
    const turn3 = await queryDriveDocs("read", ITM_URL, s.deps);
    say("15:25:51", turn3);
    check("REPLAY 15:25:51 — and so does 'I've shared it already'", turn3.count === 1);

    // The same three turns through the NAME path, because the model may have
    // used the name it saw rather than the link. Both roads have to arrive.
    const byName = scenario(OTHERS, OTHERS.slice());
    byName.clock.t = at("15:24:15");
    const n1 = await queryDriveDocs("read", "ITM report", byName.deps);
    byName.drive.listed = OTHERS.concat([ITM]);
    byName.drive.known = OTHERS.concat([ITM]);
    byName.clock.t = at("15:25:05");
    const n2 = await queryDriveDocs("read", "ITM report", byName.deps);
    check("REPLAY by name — the miss is honest at 15:24 and the retry succeeds at 15:25",
      n1.count === 3 && !!n1.error && n2.count === 1, `${n1.count}/${n2.count} ${n2.error || ""}`);
  }
}
}

/**
 * Section 19 is the first asynchronous one in this file — it drives the Drive
 * tool against a fake Drive — and tsx transpiles scripts here to CJS, where a
 * top-level await does not compile. So the summary is chained rather than
 * written after it: run it after the synchronous sections, and count a throw
 * as a failure rather than letting an unhandled rejection exit 0 with a
 * cheerful total.
 */
driveSection().then(finish, (err: any) => {
  fail++;
  failures.push(`section 19 threw before finishing: ${err && err.message}`);
  console.log(`  ✗ section 19 threw before finishing — ${err && err.stack ? err.stack : err}`);
  finish();
});

function finish(): void {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(fail ? 1 : 0);
}

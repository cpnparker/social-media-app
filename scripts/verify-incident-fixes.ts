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
import { buildSystemPrompt, normalizeContextConfig, GENERATION_CONTROL_CHAT } from "../lib/ai/system-prompts";
import { GENERATION_CONTROL_DESIGN } from "../lib/ai/capability-control";
import { buildDeckContext, DECK_CONTEXT_HEADING } from "../lib/slides/deck-context";
import { unmadeDeckChangeNotice } from "../lib/slides/claim";

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
            label: `image=${FLAGS[a]} design=${FLAGS[b]} studio=${FLAGS[c]} resourcing=${FLAGS[d]}`,
            text: buildSystemPrompt({ ...base, contextConfig: { imageGeneration: FLAGS[a] ? "on" : "off" },
              designMode: FLAGS[b], studioMode: FLAGS[c], resourcingAccess: FLAGS[d] }),
          });
        }
      }
    }
  }
  // A role persona and a team thread are different assemblies of the same
  // block, and AuthorityOn adds a whole section of its own.
  variants.push({ label: "role persona", text: buildSystemPrompt({ ...base, contextConfig: { imageGeneration: "on" }, role: { name: "Editor", instructions: "You edit." } }) });
  variants.push({ label: "team thread", text: buildSystemPrompt({ ...base, contextConfig: { imageGeneration: "on" }, conversationVisibility: "team" }) });
  const savedKey = process.env.AUTHORITYON_MCP_KEY;
  process.env.AUTHORITYON_MCP_KEY = "verify-offline";
  variants.push({ label: "authorityon", text: buildSystemPrompt({ ...base, contextConfig: { imageGeneration: "on" } }) });
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
    contextConfig: { imageGeneration: "on" } as any,
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

/* ── A capability that is off SAYS so; one that is on is never called absent ──
 *
 * 2026-09-20, Prachi, conversation 925c922b. She asked for a roadmap graphic.
 * The reply ended "say so and I'll generate it now". She said so. The next
 * reply opened "I don't have an image/slide-generation tool available in this
 * environment", and twelve minutes later a request for a Google Slides deck
 * got the same answer. She built it in Figma and asked which setting to
 * change.
 *
 * There was no setting. Her refusal turn READ 42,677 cached tokens; the whole
 * image-OFF prefix for her configuration is about 23,927, and an Anthropic
 * cache is a prefix match that starts with the tool array — a toggle flip
 * moves the first tool, so a 42,677-token read off a 1,884-token write is only
 * possible if the tools were unchanged from the turn before, the turn that
 * promised to build the deck. No config_context row in any workspace has ever
 * contained the string "off". The tools were there. The absence was invented.
 *
 * So this section pins TWO different things, because the incident and the
 * feature are not the same problem:
 *
 *   (A) THE RULE THAT WOULD HAVE CAUGHT HER TURN — never report an absence —
 *       lives in FORMATTING_GUIDELINES and must be in EVERY assembly, on or
 *       off, the way the anti-preamble rule is. A rule that only fires when a
 *       capability is off would not have fired here.
 *   (B) THE OFF-BRANCH, for the turns where the limit is real. Before this
 *       there was no `off` branch anywhere in system-prompts.ts: the five
 *       tools simply vanished and the model was left to describe its own
 *       environment. It must be TRUE on every path that can produce a false,
 *       and there are three shapes of those — the chat switch, a headless turn
 *       with no switch at all, and Design Mode, which force-registers
 *       generate_image even with the switch off.
 *
 * Asserted on the ASSEMBLED prompt, never by grepping system-prompts.ts: a
 * rule only matters if it reaches the model, and this repo has already closed
 * a live hole on the strength of a line merely existing.
 *
 * "ASSEMBLED" now means the whole string the model is sent, INCLUDING the chat
 * route's own appends. The first version of this section said that and did not
 * do it: it ran buildSystemPrompt alone, and so could not see that the deck
 * block appended afterwards ordered a generate_slides call in the same prompt
 * that had just said generate_slides was not loaded. One click on the Image
 * switch in a thread already holding a deck reached that state. The deck block
 * is a function (lib/slides/deck-context.ts) rather than a template literal in
 * a route handler precisely so this can assemble it.
 *
 * MUTATION LOG — detached worktree at d167abc, 2026-09-21, restored after.
 * Sections 17 and 18 were driven together; each line is one mutation run
 * against the whole file, and the quoted text is the assertion that went red.
 *   KILLED  delete the whole own-the-limit rule from FORMATTING_GUIDELINES →
 *           "the own-the-limit rule is in every gate combination", 20
 *           variant/sentence pairs missing
 *   KILLED  move that rule inside `if (ctx.designMode)` — present in the
 *           source, absent from most assemblies → same assertion, 16 pairs
 *   KILLED  restore the bare `=== "on"` gate and drop the else → "every
 *           switched-off variant says it is switched off", 7 silent
 *   KILLED  rename the control to "the Settings page", which has no such
 *           switch → "the control name quotes the labels it means". Without
 *           the composer cross-check this SURVIVED: the prompt and the check
 *           read the same constant, so renaming both kept every other
 *           assertion green while the model sent users to the wrong screen.
 *   KILLED  drop `generationControl: null` from lib/scheduled/runner.ts → "the
 *           scheduled brief declares it has no switch to name"
 *   KILLED  drop the ctx.designMode narrowing, so the off-branch lists
 *           generate_image on the one surface that registers it anyway → "the
 *           off-branch never claims a tool that IS registered", 2 wrong
 *   KILLED  `generationOn` back to `=== "on"` → "a context config with the key
 *           missing is ON in the prompt" (this is the default-off that lived
 *           in the builder itself) plus 4 live variants reading as off
 *   KILLED  plant "If this is not available in this environment, say so" in
 *           generate_chart's description → "no tool description instructs an
 *           absence report", 2 hits
 *   KILLED  empty ABSENCE_PHRASES → self-test red, 4 unseen, and nothing is
 *           reported
 *   KILLED  restore the raw `config_context = contextConfig` write → "the raw
 *           write is gone"
 *   KILLED  restore `setContextConfig(data.contextConfig)` → "the composer page
 *           no longer assigns the fetched config raw"
 *   KILLED  restore `|| "on"` on the composer's capability switches → "the
 *           chat composer resolves the switch with the server's predicate"
 *   KILLED  duplicate `contextConfig.imageGeneration === "on"` in the chat
 *           route instead of reading the shared const → "the duplicated
 *           expression is gone", 2 occurrences
 *   KILLED  off-branch stops interpolating ${generationControl} → "names the
 *           switch the user can actually see", 6 unnamed
 *   SURVIVOR  rewording the off-branch's HEADING ("## Making things —
 *           SWITCHED OFF FOR THIS CONVERSATION" → "## Making things — a note")
 *           survives. Deliberate: the body still says "switched off for this
 *           conversation", and pinning heading text goes red on every honest
 *           edit. It does mean the heading is unpinned — a finding about this
 *           check, recorded rather than tidied away.
 *
 * SECOND ROUND — detached worktree at d167abc, 2026-09-21, same day, after a
 * review found two survivors in the round above and four live faults the round
 * above could not see. The two survivors are listed first, with what killed
 * them, because a survivor that later becomes a kill is the useful half of a
 * mutation log.
 *   WAS A SURVIVOR, NOW KILLED  rename the control to an existing but WRONG
 *           label ("the Memory switch under the message box"). The old check
 *           matched the quoted labels against the WHOLE of ChatPanel.tsx, and
 *           "Memory" is a real label in that file, so it passed 225/0 while
 *           the prompt sent every affected user to the wrong switch. Now
 *           matched against the <button> that WRITES imageGeneration, on both
 *           composers → "the label the prompt names is the label on that
 *           switch", 2 off-screen, plus the notice's own cross-check.
 *   WAS A SURVIVOR, NOW KILLED  add generate_video to the design-mode
 *           offFamily — a tool Design Mode registers unconditionally. The old
 *           assertion named generate_image literally, so it saw nothing. The
 *           list is now DERIVED from providers.ts's own design block →
 *           "the off-branch never claims a tool that IS registered", 2 wrong.
 *   KILLED  make the deck block order a generate_slides call whichever way the
 *           capability is set — the live bug → "no assembled prompt both
 *           denies generate_slides and orders it", 7 contradictions. This is
 *           the mutation that proves §17 now assembles the ROUTE'S appends
 *           and not just buildSystemPrompt.
 *   KILLED  drop the deck block entirely when the capability is off, the
 *           tempting cheap fix → "the deck spec survives the switch being
 *           off", 7 variants lost the spec. The off-branch tells the model to
 *           write the revised slide out in full; it cannot do that from a
 *           deck it was not shown.
 *   KILLED  the route inlines the heading again instead of reading
 *           DECK_CONTEXT_HEADING → "the route appends it under the shared
 *           heading".
 *   KILLED  unmadeDeckChangeNotice ignores `offered` → "asking again is not
 *           the whole of the advice when the switch is off", and five
 *           assertions in verify-slide-layouts 40c.
 *   KILLED  restore the two-limb disjunction ("either switched off and named
 *           below, or was never part of this product") → "the rule offers all
 *           three reasons a tool can be absent", 20 pairs, and "the promise is
 *           never made on the prompt's silence alone", 10 variants. That
 *           two-limb form told a user with no resourcing, finance, mailbox,
 *           calendar or Microsoft flag that they HAD a tool nobody had given
 *           them, while forbidding the one accurate sentence.
 *   KILLED  artlistTools defaults ON when omitted → "omitting the flag means
 *           absent, not present". Failing open here re-creates the fault it
 *           was added for.
 *   KILLED  restore the unconditional Artlist prose → "a design turn without
 *           the Artlist key is never told about Artlist", 3 leaks.
 *   KILLED  drop the run-time design re-pin → "a design turn is re-pinned to
 *           Anthropic when it runs".
 *   KILLED  name the chat composer's switch at design turns too →
 *           "the route picks the control from the surface, not a default".
 *   KILLED  AdminDialog stops PATCHing contextConfig → "all three settings
 *           writers PATCH the whole object", 1 not wholesale. The third writer
 *           was missing from the first enumeration entirely.
 *   KILLED  the scheduled runner reads the stored task config's capability
 *           instead of declaring false → "and the capability is overridden
 *           regardless of what it stored".
 *   KILLED  break the anchor the design tool list is derived from
 *           (`if (config.designMode) {`) → "the design surface's own tool list
 *           was read from providers.ts", none. The derivation refuses to
 *           report clean when it cannot find what it reads.
 *   SURVIVOR  rename DECK_CONTEXT_HEADING's text ("## The deck in this
 *           conversation" → "## Deck"). Survives, and deliberately: the route
 *           and the check both read the constant, so renaming it renames both
 *           sides — the same shape as the GENERATION_CONTROL rename that DID
 *           matter. It matters less here because the heading is an internal
 *           section label and not a pointer at something on the user's screen,
 *           which is why it is recorded rather than pinned.
 *   NOT A MUTATION, A LIMIT  the source assertions on the three callers are
 *           proxies. They see that the OLD shape is gone; they cannot see two
 *           new expressions that happen to agree today. Only the behavioural
 *           override checks above are real, and they test the builder, not the
 *           routes.
 */
console.log("\n17. A switched-off capability says so, and a live one is never reported absent");
{
  const base: any = {
    conversationVisibility: "private",
    userName: "Test",
    workspaceConfig: { companyContext: "TCE is a content agency.", contentTypes: [], cuDefinitions: [], formatDescriptions: {}, typeInstructions: {} },
    clientContext: null,
    contentDetail: null,
  };

  // Every shape of turn this rule has to survive. `generationTools` is the
  // boolean the TOOL ARRAY reads; contextConfig is deliberately left saying
  // "on" in the headless rows, because that is exactly the disagreement that
  // told a scheduled brief it had a generate_image tool it was never given.
  const V: { label: string; on: boolean; control: string | null | undefined; text: string }[] = [];
  const ROWS: [string, any][] = [
    ["chat on", { contextConfig: { imageGeneration: "on" }, generationTools: true }],
    ["chat off", { contextConfig: { imageGeneration: "off" }, generationTools: false }],
    ["chat, key missing", { contextConfig: {} }],
    ["chat, no config at all", {}],
    ["headless (scheduled brief)", { contextConfig: { imageGeneration: "on" }, generationTools: false, generationControl: null }],
    ["design mode, switch off", { contextConfig: { imageGeneration: "off" }, generationTools: false, designMode: true }],
    ["design+studio, switch off", { contextConfig: { imageGeneration: "off" }, generationTools: false, designMode: true, studioMode: true }],
    ["role persona, switch off", { contextConfig: { imageGeneration: "off" }, generationTools: false, role: { name: "Editor", instructions: "You edit." } }],
    ["team thread, switch off", { contextConfig: { imageGeneration: "off" }, generationTools: false, conversationVisibility: "team" }],
    ["resourcing, switch off", { contextConfig: { imageGeneration: "off" }, generationTools: false, resourcingAccess: true }],
  ];
  for (let i = 0; i < ROWS.length; i++) {
    const cfg = ROWS[i][1];
    V.push({
      label: ROWS[i][0],
      on: cfg.generationTools === undefined ? (cfg.contextConfig?.imageGeneration !== "off") : cfg.generationTools,
      control: cfg.generationControl,
      text: buildSystemPrompt({ ...base, ...cfg }),
    });
  }

  // PRECONDITIONS. A builder returning "" satisfies every assertion about what
  // is ABSENT and reports nothing about what is present.
  check("10 capability variants assembled", V.length === 10, String(V.length));
  let shortest = V[0];
  for (let i = 1; i < V.length; i++) if (V[i].text.length < shortest.text.length) shortest = V[i];
  check("the shortest capability variant is a real prompt", shortest.text.length > 4000, `${shortest.label} is ${shortest.text.length} chars`);
  const onRow = V[0], offRow = V[1];
  check("switching the capability really changes the prompt",
    Math.abs(onRow.text.length - offRow.text.length) > 2000,
    `${onRow.text.length} vs ${offRow.text.length}`);

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
  const LIMBS = [
    ["switched off and named below", "Someone may have turned that feature off"],
    ["granted by an admin", "a part of EngineAI this user's account has not been granted"],
    ["never part of the product", "never part of this product"],
  ];
  let missingLimb = 0;
  for (let i = 0; i < V.length; i++) {
    for (let j = 0; j < LIMBS.length; j++) {
      if (V[i].text.indexOf(LIMBS[j][1]) < 0) { missingLimb++; console.log(`      (${V[i].label} does not offer the limb: ${LIMBS[j][0]})`); }
    }
  }
  check("the rule offers all three reasons a tool can be absent", missingLimb === 0, `${missingLimb} variant/limb pairs missing`);
  let unconditional = 0;
  for (let i = 0; i < V.length; i++) if (/if nothing below says a feature is off/i.test(V[i].text)) unconditional++;
  check("the promise is never made on the prompt's silence alone", unconditional === 0, `${unconditional} variants`);
  // PRECONDITION: the silence being reasoned about is real. An access-gated
  // tool has to genuinely vanish from the prose, or the limb above is guarding
  // a gap that does not exist and this assertion is decoration.
  const gateBase: any = { ...base, contextConfig: { imageGeneration: "on" }, generationTools: true };
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
    withoutResourcing.indexOf(LIMBS[1][1]) >= 0);
  // And the part that is specifically about her turn: the reply contradicted
  // an offer made 80 seconds earlier in the same thread.
  let missingRecall = 0;
  for (let i = 0; i < V.length; i++) if (!/read back what you already said in this thread/i.test(V[i].text)) missingRecall++;
  check("every variant tells it to re-read its own offer before refusing", missingRecall === 0, `${missingRecall} variants`);

  // ── (B) THE OFF-BRANCH ──
  // It must say the capability is SWITCHED OFF (a setting), not missing.
  let offSilent = 0, offUnnamed = 0, headlessNamed = 0;
  for (let i = 0; i < V.length; i++) {
    const v = V[i];
    if (v.on) continue;
    if (!/switched off for this conversation|not what this kind of turn produces/i.test(v.text)) { offSilent++; console.log(`      (${v.label}: the off-branch is not in the prompt)`); }
    if (v.control === null) {
      // A brief has no composer. Naming one is the same class of lie as
      // naming an environment: it sends the reader somewhere that is not there.
      if (v.text.indexOf(GENERATION_CONTROL_CHAT) >= 0) { headlessNamed++; console.log(`      (${v.label}: names a composer switch it does not have)`); }
    } else if (v.text.indexOf(GENERATION_CONTROL_CHAT) < 0) {
      offUnnamed++; console.log(`      (${v.label}: does not name the switch)`);
    }
  }
  check("every switched-off variant says it is switched off", offSilent === 0, `${offSilent} silent`);
  check("names the switch the user can actually see", offUnnamed === 0, `${offUnnamed} unnamed`);
  check("a headless turn names no switch", headlessNamed === 0, `${headlessNamed} named one`);

  // …and the switch it names EXISTS. Asserting the prompt contains
  // GENERATION_CONTROL_CHAT only pins it against itself: renaming the constant
  // to "the Settings page" renames both sides and every check above stays
  // green while the model sends users to a page with no such control. The
  // labels it quotes are therefore matched against the composer's own source.
  // Read once: the tool-description scan below and the design-narrowing
  // assertion above both need it.
  const provSrc = readFileSync(join(process.cwd(), "lib/ai/providers.ts"), "utf8");
  const quoted = GENERATION_CONTROL_CHAT.match(/"([^"]+)"/g) || [];
  check("the control name quotes the label it means", quoted.length >= 1, `${quoted.length} quoted labels`);
  // Matched against the CONTROL'S OWN JSX, on BOTH composers — not against the
  // file. Two mutations survived the file-wide version. One renamed the string
  // to "the Memory switch in the Context menu": both are real labels in
  // ChatPanel, so every assertion stayed green while the prompt sent every
  // affected user to the wrong switch. The other was invisible by omission —
  // the check only ever read ChatPanel, so a control that exists on one
  // composer and not the other could not be seen at all, and the phrase it
  // used to carry ("in the Context menu") was true on exactly one of them.
  const COMPOSERS: [string, string][] = [
    ["components/ai-writer/ChatPanel.tsx", "the chat composer"],
    ["app/engineai/page.tsx", "the home composer"],
  ];
  // Every place either composer WRITES the capability into state. The control
  // the user presses is the <button> around it.
  const TOGGLE = /imageGeneration:\s*(?:prev\.imageGeneration|turningOn|initial)/g;
  let offScreen = 0, noControl = 0;
  for (let c = 0; c < COMPOSERS.length; c++) {
    const src = readFileSync(join(process.cwd(), COMPOSERS[c][0]), "utf8");
    TOGGLE.lastIndex = 0;
    const blocks: string[] = [];
    let tm: RegExpExecArray | null;
    while ((tm = TOGGLE.exec(src))) {
      const open = src.lastIndexOf("<button", tm.index);
      const close = src.indexOf("</button>", tm.index);
      if (open < 0 || close < 0) continue;
      blocks.push(src.slice(open, close + 9));
    }
    // PRECONDITION: a composer with no toggle at all would satisfy every
    // assertion below by having nothing to disagree with.
    if (blocks.length === 0) { noControl++; console.log(`      (${COMPOSERS[c][1]} has no button that writes imageGeneration)`); continue; }
    for (let i = 0; i < quoted.length; i++) {
      const label = quoted[i].slice(1, -1);
      let found = false;
      for (let b = 0; b < blocks.length; b++) if (new RegExp("[>\\s]" + label + "\\s*<").test(blocks[b])) found = true;
      if (!found) { offScreen++; console.log(`      (the prompt names "${label}", which is not the label on ${COMPOSERS[c][1]}'s own switch)`); }
    }
  }
  check("both composers have a switch that writes the capability", noControl === 0, `${noControl} without one`);
  check("the label the prompt names is the label on that switch", offScreen === 0, `${offScreen} off-screen`);

  // The design rail has no such control at all — no context menu, and it posts
  // no context config — so it is told what governs it instead of being sent to
  // a switch that is not on its screen.
  const designOff = buildSystemPrompt({ ...base, contextConfig: { imageGeneration: "off" }, generationTools: false, designMode: true, generationControl: GENERATION_CONTROL_DESIGN });
  check("a design turn is not sent to the chat composer's switch",
    designOff.indexOf(GENERATION_CONTROL_CHAT) < 0 && designOff.indexOf(GENERATION_CONTROL_DESIGN) >= 0);
  check("the design control names no label, because there is none to name",
    (GENERATION_CONTROL_DESIGN.match(/"([^"]+)"/g) || []).length === 0);
  check("the route picks the control from the surface, not a default",
    /generationControl: isDesignConversation \? GENERATION_CONTROL_DESIGN : GENERATION_CONTROL_CHAT,/.test(msgSrcForPaths()));
  // …and the narrowing that makes the design off-branch correct — dropping
  // generate_image, because that chain registers it anyway — is only true on
  // the Anthropic chain, which is the only one with the design tool layer. The
  // creation-time pin can be moved afterwards by body.model or a PATCH, so the
  // turn re-pins.
  check("a design turn is re-pinned to Anthropic when it runs",
    /if \(isDesignConversation && !model\.startsWith\("claude-"\)\) \{[\s\S]{0,240}?model = "claude-sonnet-5";/.test(msgSrcForPaths()));
  check("only the Anthropic chain force-registers the design image tool",
    (provSrc.match(/if \(!config\.imageGeneration\) tools\.push\(IMAGE_GEN_TOOL\);/g) || []).length === 1,
    `${(provSrc.match(/if \(!config\.imageGeneration\) tools\.push\(IMAGE_GEN_TOOL\);/g) || []).length} chains`);

  // The off-branch must never claim a tool that IS registered. Design Mode
  // force-registers generate_image with the switch off (providers.ts), so
  // listing it there would be a fresh lie written by the fix for a lie.
  //
  // DERIVED FROM providers.ts, not written out here. Naming generate_image
  // literally left a survivor: adding generate_video to the design off-branch
  // — a tool Design Mode registers unconditionally — passed every assertion,
  // because nothing tied the list of what the off-branch may claim to the list
  // of what that surface actually registers.
  const designBlock = (function () {
    const at = provSrc.indexOf("if (config.designMode) {");
    if (at < 0) return "";
    // Bound at the nested session-only block: the shot CRUD tools are gated on
    // designSessionId and are not what "registered anyway" means.
    const end = provSrc.indexOf("if (config.designSessionId) {", at);
    return provSrc.slice(at, end < 0 ? at + 1200 : end);
  })();
  const designRegistered: string[] = [];
  {
    const pushRe = /tools\.push\((\w+)\)/g;
    let pm: RegExpExecArray | null;
    while ((pm = pushRe.exec(designBlock))) {
      // Resolve the constant to the tool name the model actually sees.
      const nameAt = provSrc.indexOf("const " + pm[1]);
      if (nameAt < 0) continue;
      const nm = /name:\s*"([\w_]+)"/.exec(provSrc.slice(nameAt, nameAt + 400));
      if (nm && designRegistered.indexOf(nm[1]) < 0) designRegistered.push(nm[1]);
    }
  }
  // PRECONDITION: the derivation found something, and found the tool the
  // narrowing exists for. An empty list makes every assertion below vacuous.
  check("the design surface's own tool list was read from providers.ts",
    designRegistered.length >= 2 && designRegistered.indexOf("generate_image") >= 0,
    designRegistered.join(", ") || "none");
  let designLies = 0;
  for (let i = 0; i < V.length; i++) {
    const v = V[i];
    if (v.on) continue;
    const head = v.text.indexOf("## Making things");
    if (head < 0) continue;
    // Bound the block at its OWN end, not at a guessed length. Sliced 1800
    // chars this read into Design Mode's persona section, which lists
    // generate_image legitimately — and reported the off-branch as lying about
    // a tool it never mentions.
    const nextHead = v.text.indexOf("\n\n## ", head + 4);
    const block = v.text.slice(head, nextHead < 0 ? v.text.length : nextHead);
    const claimsImageOff = block.indexOf("generate_image") >= 0;
    const isDesign = v.label.indexOf("design") === 0;
    if (v.control === null) {
      // A headless turn has no tool array at all, so it names the DELIVERABLES
      // rather than the tools — a brief being told which function id is absent
      // is noise it can only repeat at the reader.
      if (/generate_(image|chart|slides|word_document|document)/.test(block)) { designLies++; console.log(`      (${v.label}: names tool ids to a turn that has no tools)`); }
      continue;
    }
    if (isDesign) {
      for (let k = 0; k < designRegistered.length; k++) {
        if (block.indexOf(designRegistered[k]) >= 0) { designLies++; console.log(`      (${v.label}: the off-branch lists ${designRegistered[k]}, which Design Mode registers anyway)`); }
      }
    }
    if (!isDesign && !claimsImageOff) { designLies++; console.log(`      (${v.label}: the off-branch does not name generate_image, which IS off here)`); }
  }
  check("the off-branch never claims a tool that IS registered", designLies === 0, `${designLies} wrong`);

  // …and it never tells the model the USER can flip a switch the user does not
  // have. The off-branch used to close "the user can put them back in one
  // click", which is true at the chat composer and false on the design rail,
  // where there is no control of any kind and a workspace setting governs it.
  // A fix that writes a second, smaller lie is not a fix.
  const SELF_SERVE = [/\bin one click\b/i, /\byou can (just )?(turn|switch) (it|them) (back )?on\b/i, /\btheir own switch\b/i];
  let overclaim = 0;
  for (let i = 0; i < V.length; i++) {
    const v = V[i];
    if (v.on) continue;
    // Only where the named control is one the user operates themselves.
    if (v.control === undefined || v.control === GENERATION_CONTROL_CHAT) continue;
    const head = v.text.indexOf("## Making things");
    if (head < 0) continue;
    const nextHead = v.text.indexOf("\n\n## ", head + 4);
    const block = v.text.slice(head, nextHead < 0 ? v.text.length : nextHead);
    for (let j = 0; j < SELF_SERVE.length; j++) {
      if (SELF_SERVE[j].test(block)) { overclaim++; console.log(`      (${v.label}: promises a switch the user does not have)`); }
    }
  }
  check("no off-branch hands the user a switch they do not have", overclaim === 0, `${overclaim} overclaims`);
  // PRECONDITION: a detector that cannot fire proves nothing. The sentence
  // that was actually there has to trip one of them.
  let selfServeDeaf = 0;
  const WAS_THERE = "they are switched off for this conversation, and the user can put them back in one click.";
  for (let j = 0; j < SELF_SERVE.length; j++) if (SELF_SERVE[j].test(WAS_THERE)) selfServeDeaf = 1;
  check("the self-serve detector sees the sentence that was there", selfServeDeaf === 1);

  // …and the ON variants must not carry it, or the model reads a live
  // capability as switched off — the incident, written into the prompt.
  let onContradicted = 0;
  for (let i = 0; i < V.length; i++) {
    if (!V[i].on) continue;
    if (/switched off for this conversation/i.test(V[i].text)) { onContradicted++; console.log(`      (${V[i].label}: says a live capability is off)`); }
    if (V[i].text.indexOf("You have a generate_image tool") < 0) { onContradicted++; console.log(`      (${V[i].label}: does not advertise the tool it was given)`); }
  }
  check("no live variant reads as switched off", onContradicted === 0, `${onContradicted} contradictions`);

  // ── (C) THE PHRASES SHE ACTUALLY GOT ──
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
    '"don\'t have"',
    "that a different session — or a person with a different setup — could do it instead",
    "another session could do it",
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

  // Tool descriptions are prompt text too — the same reason section 7b reads
  // them. Read from source: the constants are module-private, and the source
  // set is a superset of any assembled set.
  const descs = provSrc.match(/description:\s*(`[\s\S]*?`|"(?:[^"\\]|\\.)*")/g) || [];
  check("tool descriptions were found to scan (capability pass)", descs.length > 100, `${descs.length} found`);
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

  // ── (D) THE PROMPT AND THE TOOL ARRAY READ ONE BOOLEAN ──
  // Behavioural, not a grep: `generationTools` must OVERRIDE contextConfig, or
  // the two drift the way they had on three surfaces.
  const overrideOff = buildSystemPrompt({ ...base, contextConfig: { imageGeneration: "on" }, generationTools: false });
  const overrideOn = buildSystemPrompt({ ...base, contextConfig: { imageGeneration: "off" }, generationTools: true });
  check("a turn with no tools is not told it has them",
    overrideOff.indexOf("You have a generate_image tool") < 0 && /switched off/i.test(overrideOff));
  check("a turn with tools is not told they are off",
    overrideOn.indexOf("You have a generate_image tool") >= 0 && !/switched off for this conversation/i.test(overrideOn));

  // And the three production callers pass it. The chat route computes it ONCE;
  // the proxy assertion is that the duplicated expression is GONE, because two
  // copies that agree today are invisible to the behavioural checks above.
  const msgSrc = readFileSync(join(process.cwd(), "app/api/ai/conversations/[id]/messages/route.ts"), "utf8");
  check("the chat route derives the flag once",
    /const generationTools = contextConfig\.imageGeneration === "on";/.test(msgSrc));
  check("the chat route passes it to the prompt", /\n\s+generationTools,\n/.test(msgSrc));
  check("the chat route passes the SAME value to the tools", /imageGeneration: generationTools,/.test(msgSrc));
  check("the duplicated expression is gone",
    (msgSrc.match(/contextConfig\.imageGeneration === "on"/g) || []).length === 1,
    `${(msgSrc.match(/contextConfig\.imageGeneration === "on"/g) || []).length} occurrences`);
  const HEADLESS: [string, string][] = [
    ["lib/scheduled/runner.ts", "the scheduled brief"],
    ["app/api/engineai/meeting-prep/route.ts", "the meeting brief"],
  ];
  for (let i = 0; i < HEADLESS.length; i++) {
    const src = readFileSync(join(process.cwd(), HEADLESS[i][0]), "utf8");
    check(`${HEADLESS[i][1]} declares it has no generation tools`,
      /generationTools: false/.test(src) && /imageGeneration: false/.test(src));
    check(`${HEADLESS[i][1]} declares it has no switch to name`, /generationControl: null/.test(src));
  }

  // ── (E) THE ROUTE'S OWN APPENDS, WHICH ARE PART OF THE PROMPT ──
  // Everything above assembles buildSystemPrompt while calling the result "the
  // ASSEMBLED prompt". It is not: the chat route appends more to it, and one of
  // those appends was the contradiction. With a deck in the conversation and
  // the switch off, the same string said generate_slides was "not loaded this
  // turn" and then ordered a generate_slides call — reachable by one click on
  // the Image switch in any thread already holding a deck, which is the
  // reported scenario one turn later.
  const DRAFT = {
    title: "Infrastructure Transition Monitor",
    slides: [
      { layout: "title", title: "Where we are", preview: "<svg/>" },
      { layout: "two-column", title: "The two tracks", bullets: ["a", "b"], image: { query: "bridge" }, resolvedImage: "https://blob/x.png" },
    ],
    published: { presentationId: "pres-123" },
  };
  // PRECONDITION: the route still appends this, under this heading, from this
  // builder. The assembly below is only the route's if these hold.
  check("the route builds the deck block from the shared builder",
    /deckContext = buildDeckContext\(deckRows\?\.\[0\]\?\.slides_draft, \{ generationTools \}\);/.test(msgSrcForPaths()));
  check("the route appends it under the shared heading",
    /systemPrompt \+= `\\n\\n\$\{DECK_CONTEXT_HEADING\}\\n\$\{deckContext\}`;/.test(msgSrcForPaths()));
  check("the deck block is built for a deck that exists",
    buildDeckContext(DRAFT, { generationTools: true }) !== null && buildDeckContext(null, { generationTools: true }) === null);

  // Assemble it the way route.ts does, for every variant, and hold the
  // invariant on the WHOLE string.
  const ORDERS_A_CALL = /call generate_slides with the\s+COMPLETE slides array/i;
  let contradictions = 0, deckLost = 0, liveDeckMute = 0;
  for (let i = 0; i < V.length; i++) {
    const v = V[i];
    const deck = buildDeckContext(DRAFT, { generationTools: v.on });
    const assembled = v.text + "\n\n" + DECK_CONTEXT_HEADING + "\n" + deck;
    const saysOff = /not loaded this turn|switched off for this conversation|not what this kind of turn produces/i.test(assembled);
    if (saysOff && ORDERS_A_CALL.test(assembled)) {
      contradictions++;
      console.log(`      (${v.label}: the same prompt says generate_slides is off AND orders a generate_slides call)`);
    }
    // The SPEC must survive the switch being off, or the off-branch's own
    // instruction — write the revised slide out in full — has nothing to write
    // it from, and gating the append would look like a fix while removing the
    // one thing the turn can still deliver.
    if (String(deck).indexOf("Infrastructure Transition Monitor") < 0 || String(deck).indexOf("two-column") < 0) deckLost++;
    if (v.on && !ORDERS_A_CALL.test(assembled)) { liveDeckMute++; console.log(`      (${v.label}: a live turn is not told how to edit the deck it holds)`); }
  }
  check("no assembled prompt both denies generate_slides and orders it", contradictions === 0, `${contradictions} contradictions`);
  check("the deck spec survives the switch being off", deckLost === 0, `${deckLost} variants lost the spec`);
  check("a live turn still gets the edit instruction", liveDeckMute === 0, `${liveDeckMute} mute`);
  // The preview is still stripped and the Drive id still passed, on both
  // framings — the block's original job, which the second framing must not
  // quietly drop.
  const onDeck = String(buildDeckContext(DRAFT, { generationTools: true }));
  const offDeck = String(buildDeckContext(DRAFT, { generationTools: false }));
  check("the rendered preview is never sent to the model",
    onDeck.indexOf("<svg/>") < 0 && offDeck.indexOf("<svg/>") < 0);
  check("the resolved image survives both framings",
    onDeck.indexOf("https://blob/x.png") >= 0 && offDeck.indexOf("https://blob/x.png") >= 0);
  check("only the live framing passes the Drive id to edit in place",
    onDeck.indexOf("pres-123") >= 0 && !ORDERS_A_CALL.test(offDeck));

  // ── (F) THE LAST MEMBER OF THE SAME FAMILY ──
  // Design Mode's prose introduced search_artlist and license_artlist_asset in
  // every turn, while providers.ts registers them only when ARTLIST_API_KEY is
  // set — and the registration's own comment says why unregistered tools must
  // not be described. The key is not in .env.local, so locally that prompt was
  // describing two tools that were not there, every run. Same one-line pattern
  // as generationTools, asserted the same way: behaviourally, off the prompt.
  const designBase: any = { ...base, contextConfig: { imageGeneration: "on" }, generationTools: true, designMode: true };
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

  // And the user-facing end of the same fault: the notice a turn ends on when
  // it claimed a change and made none. Both original notices close "Ask again",
  // which is true when asking again can work and false when the switch is off.
  const claimText = "I've replaced slide 9 with two clearer slides — the deck is now 12 slides.";
  const noticeOff = unmadeDeckChangeNotice(claimText, {}, { asked: true, deckInConversation: true, alreadySaid: false, offered: false, toolsUsed: null });
  const noticeOn = unmadeDeckChangeNotice(claimText, {}, { asked: true, deckInConversation: true, alreadySaid: false, offered: true, toolsUsed: null });
  check("PRECONDITION: the claim fires a notice at all", noticeOn.length > 0 && noticeOff.length > 0);
  // The fault is not the words "ask again" — it is asking again being the WHOLE
  // of the advice, which sends the user round the same loop. The switched-off
  // notice may say it, and does, but only after naming what to change first.
  check("asking again is not the whole of the advice when the switch is off",
    noticeOff.indexOf("Ask again to make the change.") < 0 && noticeOff.indexOf("Ask again to make it.") < 0,
    noticeOff.slice(-70));
  check("an offered turn is still told simply to ask again",
    noticeOn.indexOf("Ask again to make the change.") >= 0);
  let unnamedInNotice = 0;
  for (let i = 0; i < quoted.length; i++) if (noticeOff.indexOf(quoted[i].slice(1, -1)) < 0) unnamedInNotice++;
  check("the notice names the same switch the prompt names", unnamedInNotice === 0, `${unnamedInNotice} labels missing`);
}

/* ── FIX 2: every path that resolves this setting fails ON ─────────────────
 * Chris's instruction after the incident was that it should be on by default,
 * everywhere. The paths that can produce a false are enumerated here rather
 * than described, because the diagnosis was guessed twice before it was
 * measured: the workspace row, the browser's body, the normaliser's own
 * defaulting, the two client initial states, and the prompt builder's own
 * gate. There is no per-conversation copy — ai_conversations has no
 * config_context column — and the only surviving way to produce a false is a
 * click on the composer switch, which lives in page state and does not
 * survive a reload.
 */
console.log("\n18. The generation capability defaults ON down every path");
{
  // (1) THE NORMALISER. Both the no-config default and the per-key default.
  // The legacy shape is the real one: three of the four rows in
  // intelligence.ai_settings are `{contracts, socialPresence, contentPipeline}`
  // written in February and never touched since.
  const ON_INPUTS: [string, any][] = [
    ["no config at all", undefined],
    ["null", null],
    ["an empty object", {}],
    ["the real legacy row", { contracts: true, socialPresence: true, contentPipeline: true }],
    ["the key present but garbage", { imageGeneration: "yes-please" }],
    ["a legacy boolean true", { imageGeneration: true }],
    ["a legacy boolean false", { imageGeneration: false }],
    ["the TCE row", { ideas: "summary", memory: "on", contracts: "full-year", incognito: "off", webSearch: "on", meetingBrain: "on", socialPresence: "summary", contentPipeline: "full-month", imageGeneration: "on" }],
  ];
  for (let i = 0; i < ON_INPUTS.length; i++) {
    check(`${ON_INPUTS[i][0]} resolves to ON`,
      normalizeContextConfig(ON_INPUTS[i][1]).imageGeneration === "on",
      normalizeContextConfig(ON_INPUTS[i][1]).imageGeneration);
  }
  // A legacy boolean `false` resolving to ON is deliberate and worth stating:
  // the only thing that may switch a capability off is the literal "off",
  // which is the only value either composer can write.
  check("only the literal \"off\" switches it off",
    normalizeContextConfig({ imageGeneration: "off" }).imageGeneration === "off");

  // (2) THE PROMPT BUILDER'S OWN GATE. It read `=== "on"`, which made every
  // pre-March row — and the shape both settings pages still POST — a silent
  // off in the prose while the tools were registered anyway.
  const keyMissing: any = { conversationVisibility: "private", userName: "Test", contextConfig: {},
    workspaceConfig: { companyContext: "TCE.", contentTypes: [], cuDefinitions: [], formatDescriptions: {}, typeInstructions: {} } };
  check("a context config with the key missing is ON in the prompt",
    buildSystemPrompt(keyMissing).indexOf("You have a generate_image tool") >= 0);
  check("no context config at all is ON in the prompt",
    buildSystemPrompt({ ...keyMissing, contextConfig: undefined }).indexOf("You have a generate_image tool") >= 0);

  // (3) THE TWO CLIENT INITIAL STATES, and the predicate they resolve with.
  // `|| "on"` agrees with the server for undefined and for "off" and
  // disagrees for a legacy boolean `true`, which it passes straight through —
  // every switch then renders OFF while the server registers the tools.
  const panel = readFileSync(join(process.cwd(), "components/ai-writer/ChatPanel.tsx"), "utf8");
  check("the chat composer resolves the switch with the server's predicate",
    /imageGeneration: initialContextConfig\?\.imageGeneration !== "off" \? "on" : "off"/.test(panel));
  check("the chat composer no longer uses || \"on\" for a capability switch",
    !/(webSearch|memory|meetingBrain|imageGeneration): initialContextConfig\?\.\w+ \|\| "on"/.test(panel));
  const page = readFileSync(join(process.cwd(), "app/engineai/page.tsx"), "utf8");
  check("the composer page still starts the switch ON", /imageGeneration: "on" as string/.test(page));
  check("the composer page no longer assigns the fetched config raw",
    !/setContextConfig\(data\.contextConfig\)/.test(page));
  check("the composer page folds it in through the fail-on merge",
    (page.match(/mergeContextConfig\(prev, data\.contextConfig\)/g) || []).length === 2,
    `${(page.match(/mergeContextConfig\(prev, data\.contextConfig\)/g) || []).length} of 2 call sites`);

  // (4) THE WRITE PATH. THREE surfaces hold a ContextConfig that omits
  // imageGeneration, memory, meetingBrain and incognito, and PATCH the whole
  // object — so an admin pressing Save dropped four keys from the row. Safe
  // only because the normaliser defaults them on; one edit from a stored false.
  //
  // The third one was missed the first time this was enumerated, and it is the
  // one most likely to be used: AdminDialog is the admin surface INSIDE
  // EngineAI, not a settings page someone has to navigate to. All three go
  // through the same endpoint, which is why normalising on write is the fix
  // rather than patching each caller — but the enumeration has to name them,
  // or the next surface added is invisible the same way.
  const settings = readFileSync(join(process.cwd(), "app/api/ai/settings/route.ts"), "utf8");
  check("the settings write normalises rather than storing the raw object",
    /updateData\.config_context = normalizeContextConfig\(contextConfig\);/.test(settings));
  check("the raw write is gone", !/updateData\.config_context = contextConfig;/.test(settings));
  // PRECONDITION for the claim above: the surfaces really do omit the keys and
  // really do PATCH the whole object, so this stops being a guess about why it
  // mattered — and a fourth surface appearing without the keys is seen.
  const WRITERS: [string, string][] = [
    ["app/(app)/settings/ai-context/page.tsx", "the AI-context settings page"],
    ["app/(app)/settings/ai-usage/page.tsx", "the AI-usage settings page"],
    ["components/ai-writer/AdminDialog.tsx", "the in-app admin dialog"],
  ];
  let notWholesale = 0, keyPresent = 0;
  for (let i = 0; i < WRITERS.length; i++) {
    const src = readFileSync(join(process.cwd(), WRITERS[i][0]), "utf8");
    const initial = (/useState<ContextConfig>\(\{[\s\S]*?\n\s*\}\)/.exec(src) || [""])[0];
    if (initial.length < 20) { notWholesale++; console.log(`      (${WRITERS[i][1]}: no ContextConfig initial state found — this precondition is reading the wrong file)`); continue; }
    if (initial.indexOf("imageGeneration") >= 0) { keyPresent++; console.log(`      (${WRITERS[i][1]}: now carries imageGeneration — the dropped-key hazard has changed shape)`); }
    if (!/body: JSON\.stringify\(\{[\s\S]{0,400}?contextConfig,/.test(src)) { notWholesale++; console.log(`      (${WRITERS[i][1]}: does not PATCH the whole contextConfig)`); }
  }
  check("all three settings writers PATCH the whole object", notWholesale === 0, `${notWholesale} not wholesale`);
  check("all three really do omit imageGeneration", keyPresent === 0, `${keyPresent} carry it`);

  // (5) THE STORED COPIES. There is NO per-conversation one — ai_conversations
  // has no config_context column — and that absence is asserted rather than
  // remembered, because adding one makes this enumeration silently wrong.
  check("no per-conversation copy of the context config exists",
    !/conversation\.config_context|conversation\.contextConfig/.test(msgSrcForPaths()));
  // There IS a per-TASK one: ai_scheduled_prompts.config_context, written when
  // a scheduled task is created and read back by the runner. Claiming "no
  // stored copy exists" was not quite true. It cannot produce a false for this
  // capability, and the reason is worth pinning rather than trusting: the
  // runner resolves it through the same normaliser and then DECLARES
  // generationTools false regardless, because a brief has no tools and no
  // switch. Both halves are asserted — a stored row that reached the prompt
  // ungated would be a sixth path.
  const schedRoute = readFileSync(join(process.cwd(), "app/api/ai/scheduled/route.ts"), "utf8");
  check("PRECONDITION: a scheduled task really does store a context config",
    /config_context: proposalId \? \{ \.\.\.\(body\.configContext \|\| \{\}\), proposalId \} : \(body\.configContext \|\| null\),/.test(schedRoute));
  const runnerSrc = readFileSync(join(process.cwd(), "lib/scheduled/runner.ts"), "utf8");
  check("the stored task config is read through the normaliser",
    /normalizeContextConfig\(Object\.keys\(ctxRest\)\.length \? ctxRest : null\)/.test(runnerSrc));
  check("and the capability is overridden regardless of what it stored",
    /generationTools: false/.test(runnerSrc) && /generationControl: null/.test(runnerSrc));
}

/** Read once, where both sections above need it. */
function msgSrcForPaths(): string {
  return readFileSync(join(process.cwd(), "app/api/ai/conversations/[id]/messages/route.ts"), "utf8");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  - ${f}`); }
process.exit(fail ? 1 : 0);

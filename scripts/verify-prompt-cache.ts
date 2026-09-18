/**
 * The cached prefix must not contain anything that changes faster than the
 * cache TTL — and appending to the prompt must not silently un-cache it.
 *
 * TWO BUGS, and the second is why this file was rewritten.
 *
 * 1. A minute-resolution clock sat ~6,100 characters into a prompt wrapped
 *    entirely in one cache_control block. A cached prefix is matched byte for
 *    byte, so nothing was ever reused: ~52,000 characters re-read at full price
 *    on every turn of every conversation.
 *
 * 2. The first fix put a marker at the END of buildSystemPrompt's output and
 *    split on it. But the messages route appends FIVE more blocks after that
 *    call — deck spec, required-tools hint, LiveSearch rules, scheduled-task
 *    context — so all of them landed behind the marker and went uncached. The
 *    deck spec is a 23-slide specification that does not change between turns.
 *
 * The first version of this script tested buildSystemPrompt()'s return value
 * and passed while bug 2 was live in production. That is the assert-the-USE
 * lesson exactly: it proved the marker EXISTED instead of proving the assembled
 * prompt was actually cacheable. Every check below now runs against a prompt
 * with route-style appends on it.
 *
 * ── CHECKS 8-12 (2026-09-16, plan item E1) ──────────────────────────────
 *
 * The system block and the last tool definition were cached; the MESSAGES were
 * not. A turn runs up to eight rounds and each one re-sent the whole
 * conversation plus every tool result so far at full price — 93% of the Claude
 * chat bill was input. streamAnthropic now moves a breakpoint onto the last
 * block of the newest message before each in-loop request.
 *
 * These checks drive the REAL exported seam — anthropicCacheLayout,
 * rollingCacheBreakpoints, countCacheBreakpoints, straight out of
 * lib/ai/providers.ts — and not a copy of it. A check that rebuilds the shape
 * it is checking proves its own copy correct, which is how the post-taint tool
 * narrowing was reported closed while it was open.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────
 * Every entry below was run in a DETACHED WORKTREE, never in this working
 * tree, which is shared with other sessions and also deploys. Survivors are
 * recorded as findings about the checks, not tidied away.
 *
 *  - KILLED  rollingCacheBreakpoints returns its input untouched → 8a red on
 *            every round (0 markers where 1 is required).
 *  - KILLED  mark out[0] instead of the newest message → 8b and 8c red.
 *  - KILLED  mark the FIRST cacheable block of the last message → 8b red.
 *  - KILLED  mutate the caller's array instead of mapping to a new one →
 *            markers accumulate, 8a red from round 1 and 9 red by round 3.
 *  - KILLED  delete the backwards walk, mark blocks[length-1] blindly → 10 red
 *            on the thinking fixture.
 *  - SURVIVED, NOW KILLED — see the second pass below. budget =
 *            MAX_CACHE_BREAKPOINTS, ignoring what system and tools already
 *            spent. It survived only because the placer spent at most ONE slot
 *            however much budget it was handed, which is the same fact that
 *            made the whole design wrong on the search path.
 *  - KILLED  place a rolling marker even when toolChoiceSet is true → 11 red.
 *
 *  ── 2026-09-16, second pass: the lookback ─────────────────────────────
 *  The entry above recording "budget = MAX_CACHE_BREAKPOINTS survives" is
 *  obsolete, and so is the reasoning that produced it. It rested on the claim
 *  that one round appends "about four positions" — measured true with web
 *  search OFF and wrong by a factor of five with it ON, which is where
 *  route.ts sends most unclassified Claude turns. A breakpoint walks back at
 *  most twenty positions; a web-search round appends 18 with a single-block
 *  answer and 23 when the answer is split across text blocks, so ONE marker
 *  misses the previous entry on the dominant path and the miss is a 200 with
 *  no cache read and the whole message side rewritten at 1.25x. The placer now
 *  places a TRAILING marker CACHE_MARKER_STRIDE positions behind the newest
 *  one, which is Anthropic's documented mitigation and costs nothing (a write
 *  bills only the delta past the highest hit).
 *
 *  - KILLED  cap the placer at one marker (the shipped design before this
 *            pass) → 8 red on the cited-answer fixture at 23 positions and on
 *            the 33-position one, plus 9 on both the total and the budget
 *            ladder. NOT red on the single-block-answer fixture, which sits at
 *            18 of 20: that shape is the one the old reasoning was tested
 *            against, and it is why the fixture set has three shapes.
 *  - KILLED  CACHE_MARKER_STRIDE 25, and 0 → 8 red both ways, for opposite
 *            reasons (too far to chain; every marker on the same position).
 *  - KILLED  treat text / server_tool_use / web_search_tool_result runs as
 *            collapsing, which UNDERCOUNTS positions and widens the real gap →
 *            8 red at 22 and 32 positions.
 *  - KILLED  budget = literal MAX_CACHE_BREAKPOINTS → 9 red: "a long request
 *            spends 6 markers with 4 on messages". This is the survivor
 *            recorded above, and it died as soon as the placer could spend
 *            more than one slot. The subtraction was never headroom; it was
 *            untested.
 *  - KILLED  strip only TOP-LEVEL cache_control, leaving one nested inside a
 *            tool_result's content → 10 red. countCacheBreakpoints counts
 *            nested markers against the four and the placer did not know they
 *            existed, so the budget was being spent over the wrong number.
 *            Unreachable on today's inputs — every tool_result here carries a
 *            string — which is exactly how the two halves drifted.
 *  - KILLED  add "thinking" to CACHEABLE_BLOCK_TYPES → 10 red three ways,
 *            including against the INSTALLED messages.d.ts. Fourteen of the
 *            SDK's 29 *BlockParam types declare no cache_control, not the two
 *            the old comment named, and one of them (WebSearchResultBlockParam)
 *            sits inside every web_search_tool_result this chain receives.
 *  - KILLED  the retry re-sends `units_rounds` → 12 red. A one-token edit that
 *            guarantees the whole ledger row is lost until the migration runs,
 *            and it SURVIVED the first version of check 12, which counted the
 *            inserts and grepped for the column name. Both inserts are now
 *            read with balancedBody/fieldExpr.
 *  - KILLED  `units_rounds: rounds` instead of `rounds || null` → 12 red.
 *  - KILLED  reword the "[Usage] units_rounds is not in the schema yet"
 *            warning → 12 red. The migration's sanity check 2 tells the owner
 *            to grep for that exact string.
 *  - KILLED  send `cacheableTools(tools)` from the in-loop request instead of
 *            `layout.tools` → 11 red. It was NOT red before this pass: check
 *            11 tested `body.indexOf(name + ".tools")`, which the spread guard
 *            `...(layout.tools.length > 0` satisfies on its own. Re-run with
 *            the old substring test restored and the mutation passes the whole
 *            file — presence where the point is use, the failure this repo
 *            keeps a memory note on.
 *  - KILLED  drop `rounds: roundsUsed` from the Anthropic return, leaving the
 *            field required → `tsc --noEmit -p .` red with TS2741 at the return
 *            itself, and 12 red ("only 3 chains return rounds"). This is the
 *            pair that proves "required" is doing work.
 *  - KILLED  make StreamResult.rounds OPTIONAL and drop it from the Anthropic
 *            return → tsc is GREEN (predicted red, and the prediction was
 *            wrong: an optional field is exactly what stops the compiler
 *            caring). Caught by 12 on all three of its source assertions. Worth
 *            knowing, because it says the compiler guards this only while the
 *            `?` stays off, and nothing but check 12 guards the `?`.
 *  - KILLED  delete the missing-column retry in messages/route.ts → 12 red.
 *  - KILLED  drop the column-name test from isMissingColumnError → 12 red on
 *            the two negative cases, and self-test 13h red.
 *  - KILLED  normalise only the message being marked, not every string → red
 *            on the NOTICE fixture ("diverges at character 1261"), and only
 *            there. The plain four-round fixture never has a string in the
 *            marked position, so it stayed green: the round-notice fixture was
 *            added because this mutation survived without it, which is the
 *            check finding its own blind spot rather than the code's.
 *  - KILLED  countCacheBreakpoints stops recursing into `content` → 9 red; it
 *            would otherwise report 0 message breakpoints and satisfy the
 *            budget arithmetic vacuously.
 *
 *  - KILLED  deleting the `m.content !== ""` guard in the normaliser →
 *            check 10 red, reporting the empty string turned into
 *            `[{"type":"text","text":"","cache_control":…}]`. Predicted to
 *            survive; it does not, because check 10 carries the empty-string
 *            fixture on purpose. Remove that fixture and this mutation goes
 *            silent, so the fixture IS the assertion.
 *  - SURVIVED  changing `{ type: "ephemeral" }` to
 *            `{ type: "ephemeral", ttl: "5m" }`. Nothing here asserts the
 *            literal shape of the marker, so a TTL change is invisible to
 *            every check in this file. That is deliberate for now — E2 is the
 *            TTL decision and it needs a week of data — but E2 must add an
 *            assertion here, and must put the longer TTL on the SYSTEM block:
 *            Anthropic requires longer-TTL entries to appear before shorter
 *            ones.
 *  - KNOWN GAP, not a mutation: on Haiku 4.5 the messages breakpoint may be a
 *            silent no-op. CACHE_MIN_CHARS gates the SYSTEM block at ~1.5k
 *            tokens while Haiku 4.5's minimum cacheable prefix is 4,096, and a
 *            marker under the minimum returns 200 with zero cache creation and
 *            no error. Pre-existing (cacheableSystem has the same hole) and out
 *            of scope for E1; the production chat path is Sonnet 5.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { buildSystemPrompt, normalizeContextConfig } from "../lib/ai/system-prompts";
import { splitVolatile, appendVolatile, VOLATILE_OPEN, VOLATILE_CLOSE } from "../lib/ai/prompt-cache";
// The REAL seam, not a copy of it. Checks 8-11 drive the same functions
// streamAnthropic hands to the API; a check that rebuilds the shape it is
// checking only ever proves its own copy correct.
import { anthropicCacheLayout, rollingCacheBreakpoints, countCacheBreakpoints, MAX_CACHE_BREAKPOINTS, CACHE_LOOKBACK_POSITIONS } from "../lib/ai/providers";
import { isMissingColumnError } from "../lib/ai/usage-columns";

const SCRIPT_ROOT = join(__dirname, "..");

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

// UNTRUSTED CONTEXT IS PART OF THE FIXTURE, and has to be.
//
// The previous fixture set neither meetingBrainContext nor clientBackground, so
// fenceUntrusted never ran and its per-call Math.random() nonce never appeared
// in the prompt under test. Every check below passed while the cached block was
// being discarded on every turn of any conversation that had MeetingBrain or
// client context loaded — which is most of them. A fixture that omits the
// expensive path tests the cheap one and reports on the expensive one.
const MEETINGBRAIN_CTX = "Meeting: Q3 review with Acme. Summary: discussed the renewal timeline.";
const CLIENT_CONTEXT = {
  id: 1, name: "Acme", industry: "Insurance", description: "A client.",
  contracts: [], contentSummary: { total: 0, byType: {}, byStatus: {} },
  recentContent: [], socialPlatforms: {}, socialPresence: {}, ideas: [],
};

const CLIENT_BACKGROUND = {
  document_context: "Brand guidelines: sentence case headings, no exclamation marks.",
  meeting_context: "Kickoff call: agreed monthly cadence.",
  units_asset_count: 2,
  date_last_processed: "2026-08-01",
};

const base = () => buildSystemPrompt({
  workspaceConfig: { contentTypes: [], cuDefinitions: [], formatDescriptions: null, typeInstructions: null, companyContext: null },
  clientContext: CLIENT_CONTEXT as any, contentDetail: null,
  contextConfig: normalizeContextConfig({}), resourcingAccess: false,
  meetingBrainContext: MEETINGBRAIN_CTX,
  clientBackground: CLIENT_BACKGROUND,
} as any);

// What the messages route actually does after buildSystemPrompt returns —
// and the two kinds are NOT the same kind.
//
// PER-CONVERSATION appends stay stable and cached: the deck spec is a 23-slide
// specification that does not change between turns, and caching it is why this
// region is wrapped rather than trailing.
//
// PER-TURN appends must go INSIDE the region. The required-tools hint is built
// from the current message and the LiveSearch block flips with searchMode, so
// filing them as stable rewrote the cached prefix on nearly every turn.
const DECK_SPEC = "\n\n## The deck in this conversation\n" + "SLIDE SPEC ".repeat(400);
const routeAppends = (p: string, hint = "query_engine", search: "on" | "off" = "on") =>
  appendVolatile(
    p + DECK_SPEC + "\n\n## Scheduled task thread\nThis thread belongs to a recurring prompt.",
    `\n\n## Required tool calls for this turn\nYou MUST call these tools.\n- ${hint}`
      + (search === "on" ? "\n\n**LIVESEARCH ACTIVE:** rules follow." : "\n\n**No live web this turn**")
  );

const assembled = routeAppends(base());
const { stable, volatile } = splitVolatile(assembled);

console.log("\n1. The assembled prompt still declares a volatile region");
volatile ? pass(`volatile region found, ${volatile.length} chars`) : fail("no volatile region — the whole prompt is one cache unit again");

console.log("\n2. Route appends land on the correct side of the boundary");
// Per-conversation: cached. This is the original bug-2 assertion and still holds.
for (const frag of ["## The deck in this conversation", "Scheduled task thread"]) {
  stable.includes(frag) ? pass(`"${frag}" is cached`) : fail(`"${frag}" landed uncached — re-read at full price every turn`);
}
// Per-turn: NOT cached. Asserting these were cached is what the previous
// version of this file did, and it is why the required-tools hint sat in the
// prefix rewriting it on every turn while this script reported success.
for (const frag of ["Required tool calls", "LIVESEARCH ACTIVE"]) {
  !stable.includes(frag) && volatile.includes(frag)
    ? pass(`"${frag}" is volatile`)
    : fail(`"${frag}" is in the CACHED block — it changes per turn, so the whole prefix is discarded`);
}

console.log("\n3. The volatile region stays small relative to the cached block");
// NOT an absolute 400 any more. That threshold encoded "only the clock is
// uncached", which stopped being the goal once the untrusted context blocks
// moved here: they carry a fresh fence nonce per call and cannot be cached at
// any size. What matters is the RATIO — the prefix has to be worth caching.
volatile.length < stable.length * 0.2
  ? pass(`volatile is ${volatile.length.toLocaleString()} chars against ${stable.length.toLocaleString()} stable (${((volatile.length / stable.length) * 100).toFixed(1)}%)`)
  : fail(`volatile is ${volatile.length.toLocaleString()} chars against ${stable.length.toLocaleString()} stable — over 20%, the prefix is no longer worth caching`);
// The actual defect: a per-call nonce inside the cached block.
/<<<UNTRUSTED:[a-z0-9]+>>>/.test(stable)
  ? fail("an UNTRUSTED fence nonce is inside the cached block — it is fresh per call, so the whole prefix is discarded every turn")
  : pass("no per-call fence nonce inside the cached block");
/\d{2}:\d{2}/.test(volatile) ? pass("the clock is in the volatile part") : fail("the clock is not in the volatile part");
/\b\d{2}:\d{2}\b/.test(stable)
  ? fail("a clock survives inside the cached block — everything after it stops caching")
  : pass("no HH:MM inside the cached block");

console.log("\n4. Nothing is lost or duplicated by the split");
(stable + volatile).includes("## The deck in this conversation")
  ? pass("content survives the split")
  : fail("content was dropped");
!stable.includes(VOLATILE_OPEN) && !stable.includes(VOLATILE_CLOSE) && !volatile.includes(VOLATILE_OPEN)
  ? pass("markers never reach the model")
  : fail("a raw marker would be shown to the model");

console.log("\n5. Per-turn content does not sit in the cached block");
// The failure this catches: volatileTail (memories + keyword-selected category
// instructions) used to be appended INSIDE the cached region, at the very end.
// A prefix cache matches exactly, so writing one memory changed the block at
// char 53,437 of 54,168 — 99% through — and discarded all of it. The background
// extractor writes memories on ordinary turns, so it happened constantly.
const withMem = (n: number, msg: string) => splitVolatile(routeAppends(buildSystemPrompt({
  workspaceConfig: { contentTypes: [], cuDefinitions: [], formatDescriptions: null, typeInstructions: null, companyContext: null },
  clientContext: null, contentDetail: null, contextConfig: normalizeContextConfig({}), resourcingAccess: false,
  memories: Array.from({ length: n }, (_, i) => ({ content: `Memory item ${i}`, category: "preference", strength: 80 })),
  latestUserMessage: msg,
} as any)));
const m6 = withMem(6, "write a blog post");
const m7 = withMem(7, "now make a graphic for it");
m6.stable === m7.stable
  ? pass("an extra memory and a topic change leave the cached block byte-identical")
  : fail("a memory write changes the cached block — the whole prefix is discarded on any turn that writes one");
m7.volatile.includes("Memory item 6")
  ? pass("memories still reach the model, in the volatile block")
  : fail("memories were dropped entirely — worse than the bug being fixed");

console.log("\n5b. Per-TURN route appends do not disturb the cached block");
// The measured failure: swapping one tool hint moved the first differing byte
// to char 53,084 of 53,090 — 100% of the way through — discarding all of it.
const t1 = splitVolatile(routeAppends(base(), "query_engine", "on"));
const t2 = splitVolatile(routeAppends(base(), "query_meetingbrain", "off"));
t1.stable === t2.stable
  ? pass("a different tool hint and a flipped searchMode leave the cached block byte-identical")
  : fail(`a per-turn append changes the cached block at char ${(() => { for (let i = 0; i < t1.stable.length; i++) if (t1.stable[i] !== t2.stable[i]) return i; return -1; })()} of ${t1.stable.length} — the whole prefix is discarded`);
t2.volatile.includes("query_meetingbrain")
  ? pass("the hint still reaches the model, in the volatile block")
  : fail("the tool hint was dropped entirely — worse than the bug being fixed");

console.log("\n6. Two builds a moment apart are byte-identical up to the clock");
splitVolatile(routeAppends(base())).stable === splitVolatile(routeAppends(base())).stable
  ? pass("the cached block is stable across builds")
  : fail("the cached block differs between builds — something volatile is still in it");

console.log("\n7. The runtime uses the split, on every chain");
const providers = readFileSync("lib/ai/providers.ts", "utf8");
/const \{ stable, volatile \} = splitVolatile\(systemText\)/.test(providers)
  ? pass("cacheableSystem lifts the region out")
  : fail("cacheableSystem no longer splits");
(providers.match(/flattenSystem\(systemText\)/g) || []).length >= 3
  ? pass("the other three chains reorder and strip too")
  : fail("a chain would show a raw marker or leave the clock mid-prompt");

/* ══════════════════════════════════════════════════════════════════════
   E1 — the rolling breakpoint inside the Anthropic tool loop.

   Everything below drives the exported seam in lib/ai/providers.ts. If a
   future edit moves the placement out of those functions, these checks stop
   seeing it — which is the trade every "assert the use" check makes, and why
   check 11 also asserts that BOTH request sites go through the seam.
   ══════════════════════════════════════════════════════════════════════ */

// ── Shared fixtures and detectors ──────────────────────────────────────

/** Twenty-five tool definitions — roughly what the real chain registers once
 *  image generation, slides, Drive, Gmail and AuthorityOn are all on. */
const TOOLS25: any[] = [];
for (let i = 0; i < 25; i++) {
  TOOLS25.push({ name: `tool_${i}`, description: `Tool number ${i}`, input_schema: { type: "object", properties: {} } });
}

/** Deep copy with every cache_control removed, so two payloads can be compared
 *  on their CONTENT. The markers are metadata: Anthropic matches a prefix by
 *  its bytes and finds the hit by looking back over previous boundaries, which
 *  is exactly what lets one marker move forward each round. */
export function stripCC(v: any): any {
  if (Array.isArray(v)) {
    const out: any[] = [];
    for (let i = 0; i < v.length; i++) out.push(stripCC(v[i]));
    return out;
  }
  if (v && typeof v === "object") {
    const out: any = {};
    const keys = Object.keys(v);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === "cache_control") continue;
      out[keys[i]] = stripCC(v[keys[i]]);
    }
    return out;
  }
  return v;
}

/** One message per record, separated by a character that cannot occur inside
 *  JSON output, so round n's serialisation is literally a string
 *  prefix-extension of round n-1's when nothing earlier moved. */
export function serialiseMessages(ms: any[]): string {
  const parts: string[] = [];
  for (let i = 0; i < ms.length; i++) parts.push(JSON.stringify(stripCC(ms[i])));
  return parts.join("");
}

/** Every top-level block carrying a marker, with where it sits. */
export function markerPositions(ms: any[]): { msg: number; block: number; type: string }[] {
  const out: { msg: number; block: number; type: string }[] = [];
  for (let i = 0; i < ms.length; i++) {
    const c = (ms[i] as any).content;
    if (!Array.isArray(c)) continue;
    for (let j = 0; j < c.length; j++) {
      const b = c[j];
      if (b && typeof b === "object" && b.cache_control) out.push({ msg: i, block: j, type: b.type });
    }
  }
  return out;
}

/**
 * The tool loop as streamAnthropic actually grows it: two turns of history, the
 * current user message, then per round an assistant message (thinking, text,
 * two tool_use blocks) followed by a user message of tool results.
 *
 * `place` is applied to the SAME array every round and must not touch it —
 * which is how a marker-placer that mutates in place is caught.
 */
export function toolLoopRounds(
  place: (ms: any[]) => any[],
  rounds: number,
  perRound?: (ms: any[], n: number) => void
): any[][] {
  const msgs: any[] = [
    { role: "user", content: "What did the Siemens audit find?" },
    { role: "assistant", content: "Let me pull the report." },
    { role: "user", content: [{ type: "text", text: "And build me a deck from it." }] },
  ];
  const sent: any[][] = [];
  for (let n = 0; n < rounds; n++) {
    if (perRound) perRound(msgs, n);
    sent.push(place(msgs));
    msgs.push({
      role: "assistant",
      content: [
        { type: "thinking", thinking: `round ${n} reasoning`, signature: `sig_${n}` },
        { type: "text", text: `Round ${n}: reading the audit.` },
        { type: "tool_use", id: `tu_${n}_a`, name: "query_authorityon", input: { brand: "Siemens" } },
        { type: "tool_use", id: `tu_${n}_b`, name: "query_engine", input: { q: "siemens" } },
      ],
    });
    msgs.push({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: `tu_${n}_a`, content: `report body for round ${n}` },
        { type: "tool_result", tool_use_id: `tu_${n}_b`, content: `engine rows for round ${n}` },
      ],
    });
  }
  return sent;
}

/**
 * The SAME loop with Anthropic's server-side web search on, which is not a
 * variation — providers.ts registers `web_search_20250305` with `max_uses: 5`
 * whenever config.webSearch is set, and the chat route sets it for every turn
 * the query router leaves unclassified.
 *
 * The assistant turn is echoed back WHOLE, so a round appends
 * `text, server_tool_use, web_search_tool_result` once per search, then the
 * answer, then the tool call. `answerBlocks` is the knob that matters: a cited
 * answer comes back split across several text blocks, and every one of them is
 * another position between this round's breakpoint and the last one's.
 */
export function webSearchRounds(
  place: (ms: any[]) => any[],
  rounds: number,
  searches: number,
  answerBlocks: number
): any[][] {
  const msgs: any[] = [
    { role: "user", content: [{ type: "text", text: "What has Siemens published on grid resilience this year?" }] },
  ];
  const sent: any[][] = [];
  for (let n = 0; n < rounds; n++) {
    sent.push(place(msgs));
    const blocks: any[] = [];
    for (let s = 0; s < searches; s++) {
      blocks.push({ type: "text", text: `Searching for grid resilience ${n}.${s}.` });
      blocks.push({ type: "server_tool_use", id: `st_${n}_${s}`, name: "web_search", input: { query: `grid ${s}` } });
      blocks.push({
        type: "web_search_tool_result",
        tool_use_id: `st_${n}_${s}`,
        content: [{ type: "web_search_result", url: "https://example.com/a", title: "A", encrypted_content: "enc" }],
      });
    }
    for (let a = 0; a < answerBlocks; a++) blocks.push({ type: "text", text: `Answer sentence ${a} with a citation.` });
    blocks.push({ type: "tool_use", id: `tu_${n}`, name: "query_engine", input: { q: "siemens" } });
    msgs.push({ role: "assistant", content: blocks });
    msgs.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `tu_${n}`, content: `rows for round ${n}` }] });
  }
  return sent;
}

/** Between one and `budget` markers a round, never none and never more. */
export function everyRoundIsInsideBudget(rs: any[][], budget: number): boolean {
  for (let n = 0; n < rs.length; n++) {
    const c = countCacheBreakpoints(rs[n]);
    if (c < 1 || c > budget) return false;
  }
  return true;
}

/** The NEWEST marker — the one the next round reads back — must sit on the last
 *  block of the last message. Earlier markers are the trailing ones, which are
 *  deliberately somewhere else. */
export function markerAlwaysOnLastBlockOfLastMessage(rs: any[][]): boolean {
  for (let n = 0; n < rs.length; n++) {
    const pos = markerPositions(rs[n]);
    if (pos.length < 1) return false;
    const newest = pos[pos.length - 1];
    const lastMsg = rs[n].length - 1;
    const content = (rs[n][lastMsg] as any).content;
    if (!Array.isArray(content)) return false;
    if (newest.msg !== lastMsg || newest.block !== content.length - 1) return false;
  }
  return true;
}

/** From round 1 the newest marker must sit on a tool_result — i.e. AFTER the
 *  previous round's results, which is the whole point of the change. */
export function marksToolResultsAfterRoundZero(rs: any[][]): boolean {
  for (let n = 1; n < rs.length; n++) {
    const pos = markerPositions(rs[n]);
    if (pos.length < 1 || pos[pos.length - 1].type !== "tool_result") return false;
  }
  return true;
}

/**
 * THE LOOKBACK, which is the assertion this file was missing.
 *
 * A breakpoint does not scan the conversation for a hit: it walks back at most
 * twenty POSITIONS looking for an entry a previous request wrote. Miss it and
 * the request is a 200 with no cache read and the whole message side rewritten
 * at 1.25x — E1 making the bill worse, on the turns it exists to make cheaper,
 * with nothing on screen and nothing in an exception to say so.
 *
 * Positions are counted Anthropic's way, and CONSERVATIVELY: a run of
 * consecutive tool_use blocks is one position and so is a run of consecutive
 * tool_result blocks, and nothing else is assumed to collapse. Counting more
 * positions than the API does can only make this check stricter.
 */
const COLLAPSING = ["tool_use", "tool_result"];
export function markerPositionNumbers(ms: any[]): number[] {
  const out: number[] = [];
  let pos = 0;
  let prev = "";
  for (let i = 0; i < ms.length; i++) {
    const c = (ms[i] as any).content;
    if (!Array.isArray(c)) { pos++; prev = ""; continue; }
    for (let j = 0; j < c.length; j++) {
      const b = c[j];
      const t = b && typeof b === "object" ? String(b.type) : "";
      let collapses = false;
      for (let k = 0; k < COLLAPSING.length; k++) if (COLLAPSING[k] === t) collapses = true;
      if (!(collapses && t === prev)) pos++;
      prev = t;
      if (b && typeof b === "object" && b.cache_control) out.push(pos);
    }
  }
  return out;
}

/**
 * The longest hop any breakpoint has to make to reach an entry that already
 * exists, across a whole sequence of requests.
 *
 * Entries available to request n are the markers request n-1 wrote, plus
 * position 0 — the boundary the system and tools markers sit on, which is
 * always present. Earlier requests' entries are deliberately NOT counted: they
 * are still in the cache and would make this kinder, and a check that grades
 * on the kindest reading is how a silent miss survives.
 */
export function worstLookbackHop(rs: any[][]): { hop: number; round: number; at: number } {
  let worst = { hop: 0, round: -1, at: -1 };
  let entries: number[] = [0];
  for (let n = 0; n < rs.length; n++) {
    const marks = markerPositionNumbers(rs[n]);
    const available = entries.slice();
    for (let i = 0; i < marks.length; i++) {
      let nearest = -1;
      for (let k = 0; k < available.length; k++) {
        if (available[k] <= marks[i] && available[k] > nearest) nearest = available[k];
      }
      const hop = nearest < 0 ? marks[i] : marks[i] - nearest;
      if (hop > worst.hop) worst = { hop, round: n, at: marks[i] };
      available.push(marks[i]);
    }
    entries = marks.length ? [0].concat(marks) : entries;
  }
  return worst;
}

/** round -1 when every payload extends the one before it; otherwise the round
 *  that diverged and the character index it diverged at. */
export function prefixDivergence(rs: any[][]): { round: number; at: number } {
  for (let n = 1; n < rs.length; n++) {
    const prev = serialiseMessages(rs[n - 1]);
    const cur = serialiseMessages(rs[n]);
    if (cur.indexOf(prev) === 0) continue;
    let at = 0;
    while (at < prev.length && at < cur.length && prev[at] === cur[at]) at++;
    return { round: n, at };
  }
  return { round: -1, at: -1 };
}

export function withinBudget(system: any, tools: any, messages: any): boolean {
  return countCacheBreakpoints(system) + countCacheBreakpoints(tools) + countCacheBreakpoints(messages)
    <= MAX_CACHE_BREAKPOINTS;
}

/** No marker may land on a thinking or redacted_thinking block: neither param
 *  declares cache_control (messages.d.ts:945 and :783), so the API rejects the
 *  request outright rather than ignoring the field. */
export function noMarkerOnThinking(ms: any[]): boolean {
  const pos = markerPositions(ms);
  for (let i = 0; i < pos.length; i++) {
    if (pos[i].type === "thinking" || pos[i].type === "redacted_thinking") return false;
  }
  return true;
}

/**
 * The five shapes the missing-column predicate has to get right. The two
 * FALSES are the ones that matter: a predicate that swallows every error turns
 * a real insert failure into a silent retry that drops the column, and reports
 * "the migration has not run" on a day it has.
 */
export const MISSING_COLUMN_CASES: { label: string; err: unknown; want: boolean }[] = [
  { label: "PostgREST schema cache, our column", want: true,
    err: { code: "PGRST204", message: "Could not find the 'units_rounds' column of 'ai_usage' in the schema cache" } },
  { label: "Postgres 42703, our column", want: true,
    err: { code: "42703", message: 'column "units_rounds" of relation "ai_usage" does not exist' } },
  { label: "PostgREST schema cache, a DIFFERENT column", want: false,
    err: { code: "PGRST204", message: "Could not find the 'units_cache_read' column of 'ai_usage' in the schema cache" } },
  { label: "a unique-constraint violation", want: false,
    err: { code: "23505", message: "duplicate key value violates unique constraint" } },
  { label: "null", want: false, err: null },
];

export function missingColumnPredicateSound(fn: (e: unknown, c: string) => boolean): boolean {
  for (let i = 0; i < MISSING_COLUMN_CASES.length; i++) {
    const c = MISSING_COLUMN_CASES[i];
    if (fn(c.err, "units_rounds") !== c.want) return false;
  }
  return true;
}

/**
 * Comments blanked to spaces, so offsets and brace balance survive.
 *
 * Needed because "cache_control" appears in PROSE in providers.ts as well as in
 * code, and a detector that reads prose as code reports the documentation of a
 * fix as the bug — the fault verify-usage-logging.ts records against its own
 * `result.model` detector.
 */
export function blankComments(src: string): string {
  const out = src.split("");
  let i = 0;
  let state = "code";
  while (i < src.length) {
    const c = src[i];
    const n = i + 1 < src.length ? src[i + 1] : "";
    if (state === "code") {
      if (c === "/" && n === "/") { out[i] = " "; out[i + 1] = " "; state = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { out[i] = " "; out[i + 1] = " "; state = "block"; i += 2; continue; }
      if (c === '"') state = "d";
      else if (c === "'") state = "s";
      else if (c === "`") state = "t";
      i++; continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; i++; continue; }
      out[i] = " "; i++; continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") { out[i] = " "; out[i + 1] = " "; state = "code"; i += 2; continue; }
      if (c !== "\n") out[i] = " ";
      i++; continue;
    }
    if (c === "\\") { i += 2; continue; }
    if ((state === "d" && c === '"') || (state === "s" && c === "'") || (state === "t" && c === "`")) state = "code";
    i++;
  }
  return out.join("");
}

/** The balanced `{...}` body starting at the first `{` at or after `from`. */
export function balancedBody(src: string, from: number): string {
  if (from < 0) return "";
  const open = src.indexOf("{", from);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return "";
}

/** One object field's expression, read by BALANCING brackets rather than by
 *  looking for a newline — the same lesson verify-usage-logging.ts records
 *  against its own first parser. */
export function fieldExpr(body: string, field: string): string {
  const idx = body.indexOf(field + ":");
  if (idx < 0) return "";
  let depth = 0;
  let out = "";
  for (let i = idx + field.length + 1; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") { if (depth === 0) break; depth--; }
    else if (ch === "," && depth === 0) break;
    out += ch;
  }
  return out.trim();
}

/** The name of the function a source offset sits inside. */
export function enclosingFunction(blank: string, at: number): string {
  const re = /(?:export\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
  let m: RegExpExecArray | null;
  let name = "";
  while ((m = re.exec(blank)) !== null) {
    if (m.index > at) break;
    name = m[1];
  }
  return name;
}

const PROVIDERS_SRC = readFileSync(join(SCRIPT_ROOT, "lib", "ai", "providers.ts"), "utf8");
const PROVIDERS_CODE = blankComments(PROVIDERS_SRC);
const ROUTE_SRC = readFileSync(join(SCRIPT_ROOT, "app", "api", "ai", "conversations", "[id]", "messages", "route.ts"), "utf8");
const ROUTE_CODE = blankComments(ROUTE_SRC);

// ─────────────────────────────────────────────────────────────────────────
console.log("\n8. The tool loop carries a MOVING breakpoint");
// Round n must read rounds 0…n-1 at 0.1x. Before this, every round after the
// first re-sent the whole conversation plus every tool result so far at full
// price, and input is 93% of the Claude chat bill.

const layoutPlace = (ms: any[]) =>
  anthropicCacheLayout({ systemText: assembled, tools: TOOLS25, messages: ms as any, toolChoiceSet: false }).messages as any[];
const sentRounds = toolLoopRounds(layoutPlace, 4);

// MESSAGE_MARKER_BUDGET is what is left after the system block and the tools
// array have taken theirs; check 9 asserts that arithmetic rather than assuming
// it, and this is the number of markers those two leave for the conversation.
const MESSAGE_MARKER_BUDGET = 2;
everyRoundIsInsideBudget(sentRounds, MESSAGE_MARKER_BUDGET)
  ? pass(`every round carries between 1 and ${MESSAGE_MARKER_BUDGET} message breakpoints`)
  : fail(`rounds carry ${sentRounds.map((r) => countCacheBreakpoints(r)).join("/")} message breakpoints — outside the budget the layout computed`);

markerAlwaysOnLastBlockOfLastMessage(sentRounds)
  ? pass("the marker is on the last block of the newest message, every round")
  : fail(`the marker does not move with the conversation: ${JSON.stringify(markerPositions(sentRounds[sentRounds.length - 1]))}`);

marksToolResultsAfterRoundZero(sentRounds)
  ? pass("from round 1 the marker sits on a tool_result — after the previous round's results")
  : fail(`a round after the first does not mark a tool_result: ${sentRounds.map((r) => (markerPositions(r)[0] || { type: "none" }).type).join("/")}`);

// The assertion that catches a normalisation moving UNDER the cache: round n's
// payload, markers stripped, has to be round n-1's payload with more on the end.
const div = prefixDivergence(sentRounds);
div.round < 0
  ? pass("each round's payload is a byte prefix-extension of the round before it")
  : fail(`round ${div.round} diverges from round ${div.round - 1} at character ${div.at} — the cache is discarded from there on`);

// THE SAME LOOP WITH A ROUND NOTICE IN IT, which is not a variation — it is what
// the code does. TIME_BUDGET_NOTICE and LAST_ROUND_NOTICE are pushed as PLAIN
// STRINGS (providers.ts, top of the round), so on those rounds the newest
// message cannot carry a marker until it has been normalised into a text block.
// Normalise only that one message and round n sends it as a block while round
// n+1 sends it as a string — a single byte of difference inside the overlap,
// which is the entire bug class this file exists for. Without this fixture the
// four assertions above never see a string in the marked position.
const noticeRounds = toolLoopRounds(layoutPlace, 4, (ms, n) => {
  if (n === 2) ms.push({ role: "user", content: "ONE ROUND LEFT. Build the artefact now rather than reading again." });
});
const noticeDiv = prefixDivergence(noticeRounds);
markerAlwaysOnLastBlockOfLastMessage(noticeRounds) && noticeDiv.round < 0
  ? pass("a round whose newest message is a plain-string notice still extends the previous payload")
  : fail(noticeDiv.round < 0
      ? `the marker is misplaced on the notice round: ${JSON.stringify(markerPositions(noticeRounds[2]))}`
      : `the notice round diverges from round ${noticeDiv.round - 1} at character ${noticeDiv.at} — only the marked message was normalised`);
const noticeNewest = markerPositions(noticeRounds[2]);
(noticeNewest[noticeNewest.length - 1] || { type: "none" }).type === "text"
  ? pass("the string notice is normalised into a text block and marked there")
  : fail(`the notice round marked a ${(noticeNewest[noticeNewest.length - 1] || { type: "none" }).type} block — the string was not normalised`);

// ── THE LOOKBACK ────────────────────────────────────────────────────────
// A marker that exists, moves and sits in the right place can still be USELESS:
// the breakpoint walks back at most twenty positions looking for an entry a
// previous request wrote, and past that it finds nothing and the request
// rewrites the whole message side at 1.25x. Nothing here measured that
// distance, and the comment that justified a single marker put a round at
// "about four positions" — true with web search off, and wrong by a factor of
// five with it on, which is most Claude chat turns.
const plainHop = worstLookbackHop(sentRounds);
plainHop.hop <= CACHE_LOOKBACK_POSITIONS
  ? pass(`plain tool loop: every breakpoint is within ${plainHop.hop} positions of an existing entry`)
  : fail(`plain tool loop: a breakpoint in round ${plainHop.round} is ${plainHop.hop} positions past the nearest entry — outside the ${CACHE_LOOKBACK_POSITIONS}-position lookback, so it reads nothing and writes everything`);

// max_uses is 5 and the answer of a cited search comes back split across text
// blocks. One marker per round puts these at 18 and 23 positions apart.
const searchShapes: { label: string; searches: number; answerBlocks: number }[] = [
  { label: "5 searches, single-block answer", searches: 5, answerBlocks: 1 },
  { label: "5 searches, cited answer over 6 text blocks", searches: 5, answerBlocks: 6 },
  { label: "5 searches, 16-block answer (33 positions a round)", searches: 5, answerBlocks: 16 },
];
for (let i = 0; i < searchShapes.length; i++) {
  const s = searchShapes[i];
  const rs = webSearchRounds(layoutPlace, 5, s.searches, s.answerBlocks);
  const hop = worstLookbackHop(rs);
  const div = prefixDivergence(rs);
  hop.hop <= CACHE_LOOKBACK_POSITIONS && div.round < 0 && markerAlwaysOnLastBlockOfLastMessage(rs)
    ? pass(`web search — ${s.label}: worst hop ${hop.hop} of ${CACHE_LOOKBACK_POSITIONS}`)
    : fail(div.round >= 0
        ? `web search — ${s.label}: round ${div.round} stopped extending the previous payload at character ${div.at}`
        : `web search — ${s.label}: a breakpoint in round ${hop.round} is ${hop.hop} positions past the nearest entry (limit ${CACHE_LOOKBACK_POSITIONS}) — 200 OK, no cache read, the whole conversation written at 1.25x`);
}

// The precondition for the three above: the fixture has to be long enough that
// ONE marker would actually miss. If it is not, they pass on a shape the bug
// cannot occur in — the silent-no-op failure this repo keeps a memory note on.
const oneMarkerOnly = (ms: any[]) => rollingCacheBreakpoints(ms as any, 1) as any[];
const singleHop = worstLookbackHop(webSearchRounds(oneMarkerOnly, 5, 5, 6));
singleHop.hop > CACHE_LOOKBACK_POSITIONS
  ? pass(`the search fixture does defeat a single marker (${singleHop.hop} positions) — the assertions above are not vacuous`)
  : fail(`a single marker survives the search fixture at ${singleHop.hop} positions, so the trailing marker is untested — lengthen the fixture`);

// ─────────────────────────────────────────────────────────────────────────
console.log("\n9. The whole request stays inside Anthropic's four breakpoints");

const layout = anthropicCacheLayout({ systemText: assembled, tools: TOOLS25, messages: sentRounds[0] as any, toolChoiceSet: false });
// Asserted BEFORE the total, so the budget arithmetic is over real numbers. If
// system or tools ever stopped placing a marker, "3 breakpoints" would still
// read as healthy while meaning something else entirely.
countCacheBreakpoints(layout.system) === 1
  ? pass("the system block spends exactly one breakpoint")
  : fail(`the system block spends ${countCacheBreakpoints(layout.system)} breakpoints, not 1`);
countCacheBreakpoints(layout.tools) === 1
  ? pass("the tools array spends exactly one breakpoint")
  : fail(`the tools array spends ${countCacheBreakpoints(layout.tools)} breakpoints, not 1`);
layout.breakpoints === 3
  ? pass("a short request spends 3 of the 4 markers — there is nothing yet for a trailing one to sit on")
  : fail(`a short request spends ${layout.breakpoints} markers, not 3`);

// THE ONE THAT MATTERS. Once the conversation is long enough to want a trailing
// marker the request sits on ALL FOUR of Anthropic's slots, and the fifth is a
// 400 rather than a degradation. That is only safe because the budget is
// subtracted from what system and tools really spent: assert the total here,
// and check 11 asserts that nothing writes a cache_control outside the four
// functions this arithmetic can see.
const longMessages = webSearchRounds((ms) => ms.slice(), 4, 5, 6)[3];
const longLayout = anthropicCacheLayout({ systemText: assembled, tools: TOOLS25, messages: longMessages as any, toolChoiceSet: false });
countCacheBreakpoints(longLayout.messages) === 2 && longLayout.breakpoints === MAX_CACHE_BREAKPOINTS
  ? pass(`a long request spends all ${MAX_CACHE_BREAKPOINTS} markers — 1 system, 1 tools, 2 messages`)
  : fail(`a long request spends ${longLayout.breakpoints} markers with ${countCacheBreakpoints(longLayout.messages)} on messages — expected ${MAX_CACHE_BREAKPOINTS} and 2`);
withinBudget(layout.system, layout.tools, layout.messages) && withinBudget(longLayout.system, longLayout.tools, longLayout.messages)
  ? pass(`both totals are inside Anthropic's limit of ${MAX_CACHE_BREAKPOINTS}`)
  : fail(`the total is ${longLayout.breakpoints} — a fifth cache_control is a 400, not a degradation`);

// THE BUDGET PARAMETER IS LOAD-BEARING, asserted at the function rather than
// through the layout. Both boundaries are pinned: 0 is what the forced-final
// pass rides on, and the 2/4 pair is what says the subtraction happened —
// handing the placer a bare MAX_CACHE_BREAKPOINTS instead of MAX minus what
// system and tools already spent puts four markers on the messages and six on
// the request.
const budgets = [0, 1, 2, 4].map((b) => countCacheBreakpoints(rollingCacheBreakpoints(longMessages as any, b)));
budgets[0] === 0 && budgets[1] === 1 && budgets[2] === 2 && budgets[3] === 4
  ? pass("budget 0/1/2/4 places 0/1/2/4 markers — the parameter is read, not decorative")
  : fail(`the budget parameter is not honoured: 0/1/2/4 gave ${budgets.join("/")} markers`);

// A system prompt with no volatile region: cacheableSystem returns ONE block.
const noVolatile = "STABLE PROMPT TEXT. ".repeat(600);
const layoutNV = anthropicCacheLayout({ systemText: noVolatile, tools: TOOLS25, messages: sentRounds[1] as any, toolChoiceSet: false });
countCacheBreakpoints(layoutNV.system) === 1 && countCacheBreakpoints(layoutNV.messages) === 1 && withinBudget(layoutNV.system, layoutNV.tools, layoutNV.messages)
  ? pass("a prompt with no volatile region still spends one system marker and still gets the rolling one")
  : fail(`no-volatile prompt spends ${layoutNV.breakpoints} markers, ${countCacheBreakpoints(layoutNV.messages)} of them on messages`);

// No tools at all: cacheableTools returns the empty array and spends nothing.
const layoutNT = anthropicCacheLayout({ systemText: assembled, tools: [], messages: sentRounds[1] as any, toolChoiceSet: false });
countCacheBreakpoints(layoutNT.tools) === 0 && countCacheBreakpoints(layoutNT.messages) === 1 && withinBudget(layoutNT.system, layoutNT.tools, layoutNT.messages)
  ? pass("with no tools the messages marker is still placed, and the total is still legal")
  : fail(`no-tools request: tools=${countCacheBreakpoints(layoutNT.tools)} messages=${countCacheBreakpoints(layoutNT.messages)} total=${layoutNT.breakpoints}`);

// ─────────────────────────────────────────────────────────────────────────
console.log("\n10. The marker is never placed where the API rejects it");
// A marker on a block type that does not declare cache_control is not ignored —
// it is a 400, and it takes the whole turn. Fourteen of the SDK's 29
// *BlockParam types are in that state, not the two thinking ones a first read
// suggests, so the list in providers.ts is POSITIVE and is checked below
// against the installed messages.d.ts rather than against anyone's memory.

const thinkingOnly = rollingCacheBreakpoints([
  { role: "user", content: [{ type: "text", text: "go on" }] },
  { role: "assistant", content: [{ type: "thinking", thinking: "…", signature: "s" }] },
] as any, 2) as any[];
countCacheBreakpoints(thinkingOnly) === 0 && noMarkerOnThinking(thinkingOnly)
  ? pass("a message whose only block is `thinking` gets no marker at all")
  : fail("a marker was placed on a thinking-only message — the API rejects that request");

const endsThinking = rollingCacheBreakpoints([
  { role: "user", content: [{ type: "text", text: "go on" }] },
  { role: "assistant", content: [
    { type: "text", text: "Reading it now." },
    { type: "tool_use", id: "tu_1", name: "query_engine", input: {} },
    { type: "thinking", thinking: "…", signature: "s" },
  ] },
] as any, 2) as any[];
const endsPos = markerPositions(endsThinking);
noMarkerOnThinking(endsThinking) && endsPos.length === 1 && endsPos[0].block === 1 && endsPos[0].type === "tool_use"
  ? pass("a trailing thinking block is stepped over and the tool_use before it is marked")
  : fail(`the backwards walk did not step over the trailing thinking block: ${JSON.stringify(endsPos)}`);

let emptyThrew = false;
let emptyOut: any[] = [];
try {
  emptyOut = rollingCacheBreakpoints([{ role: "assistant", content: [] }] as any, 2) as any[];
} catch { emptyThrew = true; }
!emptyThrew && Array.isArray((emptyOut[0] as any).content) && (emptyOut[0] as any).content.length === 0 && countCacheBreakpoints(emptyOut) === 0
  ? pass("an empty content array comes back unchanged, without throwing")
  : fail("an empty content array was mangled or threw");

// An empty STRING stays an empty string. An empty text block is a different API
// rejection from an empty string content, and swapping one failure for another
// is not a fix.
const emptyStr = rollingCacheBreakpoints([
  { role: "user", content: [{ type: "text", text: "hi" }] },
  { role: "assistant", content: "" },
] as any, 2) as any[];
(emptyStr[1] as any).content === ""
  ? pass("an empty-string content is left exactly as it is")
  : fail(`an empty string was normalised into ${JSON.stringify((emptyStr[1] as any).content)} — a different rejection, not a fix`);

// A NESTED marker — one inside a tool_result's own content blocks — is counted
// against the four by countCacheBreakpoints, so the placer has to strip it
// there as well. It cannot happen on today's inputs (every tool_result on this
// path carries a string), which is exactly why the two halves of the mechanism
// were free to drift apart: the counter enforced a rule the placer had never
// heard of, and the budget would have been spent over the wrong number.
const nested = rollingCacheBreakpoints([
  { role: "user", content: [{ type: "text", text: "go on" }] },
  { role: "user", content: [
    { type: "tool_result", tool_use_id: "tu_1", content: [
      { type: "text", text: "body", cache_control: { type: "ephemeral" } },
    ] },
  ] },
] as any, 2) as any[];
countCacheBreakpoints(nested) === 1
  ? pass("a cache_control nested inside a tool_result's content is stripped, so the budget is spent over the real number")
  : fail(`a nested marker survived placement: countCacheBreakpoints is ${countCacheBreakpoints(nested)}, not 1 — the placer and the counter disagree about what a marker is`);

// THE LIST ITSELF, read back out of the installed SDK. A type that stops
// declaring cache_control in a later SDK is a 400 on a request that looks fine
// in review, and the six names below are the whole reason the list is positive.
const BLOCK_PARAM_FOR: { type: string; iface: string }[] = [
  { type: "text", iface: "TextBlockParam" },
  { type: "image", iface: "ImageBlockParam" },
  { type: "document", iface: "DocumentBlockParam" },
  { type: "tool_use", iface: "ToolUseBlockParam" },
  { type: "tool_result", iface: "ToolResultBlockParam" },
  { type: "search_result", iface: "SearchResultBlockParam" },
];
const SDK_DTS = join(SCRIPT_ROOT, "node_modules", "@anthropic-ai", "sdk", "resources", "messages", "messages.d.ts");
let sdkSrc = "";
try { sdkSrc = readFileSync(SDK_DTS, "utf8"); } catch { sdkSrc = ""; }
/** Whether `export interface <name> ` declares cache_control in its own body. */
const declaresCacheControl = (iface: string): boolean => {
  const lines = sdkSrc.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("export interface " + iface + " ") !== 0) continue;
    let body = "";
    for (let j = i + 1; j < lines.length && lines[j] !== "}"; j++) body += lines[j] + "\n";
    return body.indexOf("cache_control") >= 0;
  }
  return false;
};
if (!sdkSrc) {
  fail(`the installed SDK's messages.d.ts was not readable at ${SDK_DTS} — the block-type list is unverified`);
} else {
  // The source list, not a copy of it: a check that keeps its own copy of the
  // six names would agree with itself after someone edited providers.ts.
  const setBody = balancedBody(PROVIDERS_CODE, PROVIDERS_CODE.indexOf("CACHEABLE_BLOCK_TYPES = new Set(["));
  const declared: string[] = [];
  {
    const re = /"([a-z_]+)"/g;
    let m: RegExpExecArray | null;
    const from = PROVIDERS_CODE.indexOf("CACHEABLE_BLOCK_TYPES = new Set([");
    const to = PROVIDERS_CODE.indexOf("])", from);
    const slice = from >= 0 && to > from ? PROVIDERS_CODE.slice(from, to) : setBody;
    while ((m = re.exec(slice)) !== null) declared.push(m[1]);
  }
  declared.length === BLOCK_PARAM_FOR.length
    ? pass(`CACHEABLE_BLOCK_TYPES still holds the ${declared.length} types this check knows the SDK interface for`)
    : fail(`CACHEABLE_BLOCK_TYPES holds [${declared.join(", ")}] — a type was added or removed without checking it against the SDK`);
  const undeclared: string[] = [];
  for (let i = 0; i < BLOCK_PARAM_FOR.length; i++) {
    let listed = false;
    for (let k = 0; k < declared.length; k++) if (declared[k] === BLOCK_PARAM_FOR[i].type) listed = true;
    if (listed && !declaresCacheControl(BLOCK_PARAM_FOR[i].iface)) undeclared.push(BLOCK_PARAM_FOR[i].iface);
  }
  undeclared.length === 0
    ? pass("every type in CACHEABLE_BLOCK_TYPES maps to a *BlockParam that declares cache_control in the installed SDK")
    : fail(`these are marked but the SDK does not declare cache_control on them: ${undeclared.join(", ")} — the request is a 400`);
  // And the check's own precondition: the reader has to be able to find a type
  // that does NOT declare the field, or "all six are fine" means nothing.
  !declaresCacheControl("ThinkingBlockParam") && !declaresCacheControl("WebSearchResultBlockParam")
    ? pass("the SDK reader still finds types WITHOUT cache_control (ThinkingBlockParam, WebSearchResultBlockParam) — it is not answering true to everything")
    : fail("the SDK reader reports cache_control on ThinkingBlockParam or WebSearchResultBlockParam — it is not reading interface bodies");
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\n11. The forced-final pass carries no rolling breakpoint");
// It sets tool_choice where every round before it did not, and a tool_choice
// change invalidates the MESSAGES cache. A marker there is a 1.25x write on the
// last request of the turn that nothing ever reads.

const forcedLayout = anthropicCacheLayout({ systemText: assembled, tools: TOOLS25, messages: sentRounds[2] as any, toolChoiceSet: true });
countCacheBreakpoints(forcedLayout.messages) === 0
  ? pass("toolChoiceSet: true places no message marker")
  : fail(`the forced-final layout placed ${countCacheBreakpoints(forcedLayout.messages)} message markers — written at 1.25x, read by nobody`);
countCacheBreakpoints(layout.messages) === 1
  ? pass("toolChoiceSet: false still places one")
  : fail("the in-loop layout stopped placing a marker — E1 is doing nothing");

// The USE half: both request sites must go through the seam, or this file is
// checking a function the API never sees.
const streamSites: number[] = [];
{
  const re = /anthropic\.messages\.stream\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(PROVIDERS_CODE)) !== null) streamSites.push(m.index);
}
streamSites.length === 2
  ? pass("providers.ts has exactly the two Anthropic request sites this check knows about")
  : fail(`providers.ts has ${streamSites.length} anthropic.messages.stream( sites — a new one would not be covered here`);

let wiredSites = 0;
const layoutVars: { name: string; at: number }[] = [];
for (let i = 0; i < streamSites.length; i++) {
  const body = balancedBody(PROVIDERS_CODE, streamSites[i]);
  const sysExpr = fieldExpr(body, "system");
  const msgExpr = fieldExpr(body, "messages");
  // `tools` is READ, not searched for. A substring test is satisfied by the
  // spread guard `...(layout.tools.length > 0` that sits beside it, so the
  // request could send a different tools expression entirely while this stayed
  // green — presence where the point is use, which is the failure this repo
  // keeps a memory note on. verify-post-taint-policy.ts performs the same read
  // one level further down, to the array the layout was built from.
  const toolsExpr = fieldExpr(body, "tools");
  const sm = /^([A-Za-z0-9_$]+)\.system$/.exec(sysExpr);
  const mm = /^([A-Za-z0-9_$]+)\.messages$/.exec(msgExpr);
  if (sm && mm && sm[1] === mm[1] && toolsExpr === sm[1] + ".tools") {
    wiredSites++;
    layoutVars.push({ name: sm[1], at: streamSites[i] });
  } else {
    fail(`an Anthropic request site takes system=${sysExpr || "?"} messages=${msgExpr || "?"} tools=${toolsExpr || "?"} — not all three from one anthropicCacheLayout result`);
  }
}
if (wiredSites === 2) pass("both Anthropic request sites take system, messages AND tools from a layout result");

// WHICH site is the forced-final one is read from the REQUEST, not from a
// comment or a log string: the forced-final body sets tool_choice
// unconditionally and never mentions suppressTools, while the in-loop body does
// the opposite. Keying off the variable name or the console.log beside it would
// make a rename look like a regression and a reworded log look like a fix.
const choiceExprs: { name: string; expr: string; body: string }[] = [];
for (let i = 0; i < layoutVars.length; i++) {
  const declRe = new RegExp("const\\s+" + layoutVars[i].name + "\\s*=\\s*anthropicCacheLayout\\(", "g");
  let d: RegExpExecArray | null;
  let declAt = -1;
  while ((d = declRe.exec(PROVIDERS_CODE)) !== null) { if (d.index < layoutVars[i].at) declAt = d.index; }
  if (declAt < 0) { fail(`${layoutVars[i].name} is not declared from anthropicCacheLayout`); continue; }
  choiceExprs.push({
    name: layoutVars[i].name,
    expr: fieldExpr(balancedBody(PROVIDERS_CODE, declAt), "toolChoiceSet"),
    body: balancedBody(PROVIDERS_CODE, layoutVars[i].at),
  });
}
const suppressing = choiceExprs.filter((c) => c.expr === "true");
const guarded = choiceExprs.filter((c) => c.expr === "suppressTools");
suppressing.length === 1 && guarded.length === 1
  ? pass("one request site passes toolChoiceSet: true and the other passes suppressTools")
  : fail(`toolChoiceSet is passed as [${choiceExprs.map((c) => `${c.name}=${c.expr || "nothing"}`).join(", ")}] — expected exactly one true and one suppressTools`);
suppressing.length === 1 && suppressing[0].body.indexOf("tool_choice") >= 0 && suppressing[0].body.indexOf("suppressTools") < 0
  ? pass("the site that suppresses the rolling marker is the one that sets tool_choice unconditionally")
  : fail("the request passing toolChoiceSet: true is not the forced-final pass — the marker is being withheld from the wrong request");
guarded.length === 1 && guarded[0].body.indexOf("suppressTools") >= 0
  ? pass("the in-loop site is the one whose tool_choice is conditional on the taint")
  : fail("the request passing toolChoiceSet: suppressTools is not the in-loop pass");

// cache_control must not be written anywhere the budget arithmetic cannot see it.
const MARKER_HOMES = ["cacheableSystem", "cacheableTools", "rollingCacheBreakpoints", "countCacheBreakpoints", "stripBlockMarkers"];
const strays: string[] = [];
{
  const re = /cache_control/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(PROVIDERS_CODE)) !== null) {
    const fn = enclosingFunction(PROVIDERS_CODE, m.index);
    let known = false;
    for (let i = 0; i < MARKER_HOMES.length; i++) if (MARKER_HOMES[i] === fn) known = true;
    if (!known) strays.push(`${fn || "top level"} @${m.index}`);
  }
}
strays.length === 0
  ? pass(`cache_control is written only inside ${MARKER_HOMES.join(", ")}`)
  : fail(`cache_control appears outside the budget arithmetic: ${strays.join(", ")}`);
// The check's own precondition. A blanker that ate the code would report every
// scan above as clean — the silent-no-op failure, not the false-positive one.
PROVIDERS_CODE.length === PROVIDERS_SRC.length && (PROVIDERS_CODE.match(/cache_control/g) || []).length >= 6
  ? pass("the comment blanker preserved offsets and left the real markers readable")
  : fail("the comment blanker mangled providers.ts — every scan above is unreliable");

// ─────────────────────────────────────────────────────────────────────────
console.log("\n12. The round count reaches the ledger");
// The compiler carries most of this: StreamResult.rounds is REQUIRED, so a
// chain that forgets it fails `tsc --noEmit -p .`, which type-checks scripts/
// too. What is asserted here is the plumbing tsc cannot see — that the count is
// carried out of every chain, summed on a fallback, and survives a deploy that
// lands before the migration does.

const srInterface = balancedBody(PROVIDERS_CODE, PROVIDERS_CODE.indexOf("export interface StreamResult"));
srInterface.length > 0
  ? pass("StreamResult was found and parsed")
  : fail("StreamResult could not be parsed — the three assertions below are testing nothing");
/\brounds\s*:\s*number\s*;/.test(srInterface)
  ? pass("StreamResult declares `rounds: number` — required, so a new chain that forgets it will not compile")
  : fail("StreamResult has no required `rounds: number` — a chain could return no count and still build");
/\brounds\s*\?\s*:/.test(srInterface)
  ? fail("StreamResult.rounds is OPTIONAL — the compiler stops enforcing it and a silent 0 reaches the ledger")
  : pass("rounds is not optional");

const roundsUsedReturns = (PROVIDERS_CODE.match(/rounds:\s*roundsUsed/g) || []).length;
roundsUsedReturns >= 4
  ? pass(`${roundsUsedReturns} tool-loop chains return their measured round count`)
  : fail(`only ${roundsUsedReturns} chains return rounds: roundsUsed — all four tool loops must`);
const literalOne = (PROVIDERS_CODE.match(/rounds:\s*1\b/g) || []).length;
literalOne >= 2
  ? pass(`${literalOne} loop-free chains return a literal 1`)
  : fail(`${literalOne} loop-free chains return rounds: 1 — the Responses and Perplexity chains each make one request`);
/rounds:\s*\(prev\.rounds\s*\|\|\s*0\)\s*\+\s*\(next\.rounds\s*\|\|\s*0\)/.test(PROVIDERS_CODE)
  ? pass("adoptFallback sums rounds the way it sums tokens")
  : fail("adoptFallback does not sum rounds — a fallback turn would under-report its requests");
const turnLines = (PROVIDERS_CODE.match(/Turn: rounds=\$\{roundsUsed\}/g) || []).length;
turnLines === 4
  ? pass("all four tool-loop chains print one greppable per-turn summary")
  : fail(`${turnLines} chains print a per-turn summary — one log query has to reach all four`);
const roundIncrements = (PROVIDERS_CODE.match(/roundsUsed\+\+/g) || []).length;
roundIncrements === 8
  ? pass("all eight request sites count themselves (four in-loop, four forced-final)")
  : fail(`${roundIncrements} request sites increment roundsUsed — a request that does not count itself is a round the ledger never sees`);

/async \(\{[^}]*\brounds\b[^}]*\}\) =>/.test(ROUTE_CODE)
  ? pass("the chat route destructures rounds from the completion callback")
  : fail("the chat route never reads rounds — the count stops at the provider");
/isMissingColumnError\(\s*usageErr\s*,\s*"units_rounds"\s*\)/.test(ROUTE_CODE)
  ? pass("the insert retries BY NAME when the column is not deployed yet")
  : fail("there is no missing-column retry — a deploy before the migration would lose the whole ledger row");

// THE TWO INSERTS ARE READ, not counted.
//
// Counting them, and grepping the file for the string "units_rounds", is what
// the first version of this check did — and it is satisfied by a retry that
// re-sends the very column it exists to drop. That retry is the single point of
// failure for the whole of Part 1: it is what keeps the ledger row alive on a
// deploy that lands before the migration, and corrupting it is a one-token edit
// that leaves every other assertion here green while guaranteeing the row is
// lost. Deleting the retry was caught; breaking it was not.
const insertSites: number[] = [];
{
  const re = /from\("ai_usage"\)\s*\.insert\(\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ROUTE_CODE)) !== null) insertSites.push(m.index);
}
insertSites.length === 2
  ? pass("there are exactly the two ai_usage inserts this check knows about, both object literals")
  : fail(`there are ${insertSites.length} ai_usage insert( { } ) sites — expected 2 (with the column, and the retry without it); verify-usage-logging.ts parses these the same way`);
if (insertSites.length === 2) {
  const firstBody = balancedBody(ROUTE_CODE, ROUTE_CODE.indexOf(".insert(", insertSites[0]));
  const retryBody = balancedBody(ROUTE_CODE, ROUTE_CODE.indexOf(".insert(", insertSites[1]));
  // `rounds || null`, not `rounds`. Zero rounds cannot happen, so a 0 arriving
  // from a leg that threw before its first request has to read NULL — "not
  // measured" — and never 0, which would say "measured, and it was none". Every
  // query in the migration keys off that distinction.
  fieldExpr(firstBody, "units_rounds") === "rounds || null"
    ? pass("the first insert writes `units_rounds: rounds || null` — a zero reads as NULL, not as a measured none")
    : fail(`the first insert writes units_rounds: ${fieldExpr(firstBody, "units_rounds") || "nothing"} — expected \`rounds || null\``);
  fieldExpr(retryBody, "units_rounds") === ""
    ? pass("the retry does NOT name units_rounds — which is the only reason it can succeed where the first insert failed")
    : fail(`the retry re-sends units_rounds: ${fieldExpr(retryBody, "units_rounds")} — it will fail for the same reason the first insert did, and the whole ledger row is lost`);
  retryBody.indexOf("usageRow") >= 0
    ? pass("the retry still writes the rest of the row rather than a reduced one")
    : fail("the retry does not spread usageRow — a pre-migration deploy would log a row missing the columns it always had");
}

// The string the migration tells the owner to grep for. Sanity check 2 says
// 'look for "[Usage] units_rounds is not in the schema yet" in the logs before
// touching anything else' — an instruction that is worthless if the wording
// drifts, and nothing else here pins it.
ROUTE_CODE.indexOf("[Usage] units_rounds is not in the schema yet") >= 0
  ? pass("the retry logs the exact line the migration's sanity check tells the owner to search for")
  : fail("the '[Usage] units_rounds is not in the schema yet' warning is gone or reworded — the migration's own troubleshooting step no longer works");

let predicateFails = 0;
for (let i = 0; i < MISSING_COLUMN_CASES.length; i++) {
  const c = MISSING_COLUMN_CASES[i];
  const got = isMissingColumnError(c.err, "units_rounds");
  if (got === c.want) pass(`isMissingColumnError: ${c.label} → ${c.want}`);
  else { predicateFails++; fail(`isMissingColumnError: ${c.label} → ${got}, expected ${c.want}`); }
}
MISSING_COLUMN_CASES.length === 5
  ? pass("the predicate fixture still carries all five shapes, including the two that must be FALSE")
  : fail("the predicate fixture lost a case — the two FALSES are the ones that matter");

// ── Self-test: prove the detectors fire ─────────────────────────────────
// Every check above passes right now, which is exactly when a check is least
// trustworthy — the previous version of this file also passed, for two years,
// while both bugs it was written to catch were live. So the two shapes are
// rebuilt here deliberately and asserted to be caught.
//
// Fixture-only. Nothing in lib/ is mutated: this working tree is shared with
// other sessions and also deploys, and a break-test-restore has already sent a
// deliberate break to production from here once.
console.log("\n13. Self-test — the detectors catch the shapes they exist for");
let selfFails = 0;
const detects = (name: string, caught: boolean) => {
  if (caught) console.log(`  ok    detects ${name}`);
  else { selfFails++; console.log(`  FAIL  does NOT detect ${name}`); }
};

// (a) Per-turn appends filed as STABLE — a plain `+` after the region, which is
//     what the route did until the append went through appendVolatile.
const oldStyle = (p: string, hint: string) =>
  p + DECK_SPEC + `\n\n## Required tool calls for this turn\n- ${hint}`;
const o1 = splitVolatile(oldStyle(base(), "query_engine")).stable;
const o2 = splitVolatile(oldStyle(base(), "query_meetingbrain")).stable;
detects("a per-turn append filed as stable", o1 !== o2);

// (b) A per-call fence nonce inside the cached block. Built by hand rather than
//     by reverting system-prompts.ts.
const withNonce = base() + `\n<<<UNTRUSTED:${Math.random().toString(36).slice(2, 10)}>>>payload<<<END_UNTRUSTED>>>`;
detects("a fence nonce in the cached block", /<<<UNTRUSTED:[a-z0-9]+>>>/.test(splitVolatile(withNonce).stable));

// (c) The fixture must actually exercise the untrusted path. If this ever goes
//     false the checks above are testing a prompt the app never builds — the
//     precise reason this file passed while the cache was being discarded.
const assembledVolatile = splitVolatile(routeAppends(base())).volatile;
detects("the fixture exercising fenceUntrusted at all", /<<<UNTRUSTED:[a-z0-9]+>>>/.test(assembledVolatile));


// (d) A STATIC breakpoint — marked once on messages[0] and left there, which is
//     what "cache the messages" looks like when nobody thinks about the loop.
//     Round n then re-sends rounds 1…n-1 at full price, silently, at 200 OK.
const staticPlace = (ms: any[]) => {
  const out = rollingCacheBreakpoints(ms as any, 0) as any[];
  const first: any = out[0];
  if (Array.isArray(first.content) && first.content.length > 0) {
    first.content = first.content.slice();
    first.content[0] = { ...first.content[0], cache_control: { type: "ephemeral" } };
  }
  return out;
};
const staticRounds = toolLoopRounds(staticPlace, 4);
detects("a breakpoint pinned to the first message",
  !markerAlwaysOnLastBlockOfLastMessage(staticRounds) || !marksToolResultsAfterRoundZero(staticRounds));

// (e) The array REBUILT each round with something fresh in it — the shape of
//     all four cache bugs this repo has shipped. Here a nonce is rewritten into
//     the oldest message, which is invisible to every counting check and
//     discards the entire prefix.
const nonceRounds = toolLoopRounds(layoutPlace, 4, (ms) => {
  ms[0] = { role: "user", content: `What did the Siemens audit find? <<<${Math.random()}>>>` };
});
const nonceDiv = prefixDivergence(nonceRounds);
detects(`a per-round rebuild of the history (diverges at character ${nonceDiv.at})`, nonceDiv.round > 0);

// (f) A FIFTH marker. Anthropic's limit is four and the fifth is a 400, not a
//     degradation, so this has to be caught by arithmetic and never by a test
//     call. Hand-built rather than derived from layout.messages: a detector
//     whose input depends on what the code under test produced stops being a
//     fixed target the moment that code changes.
const overBudget: any[] = [
  { role: "user", content: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }] },
  { role: "assistant", content: [{ type: "text", text: "b", cache_control: { type: "ephemeral" } }] },
  { role: "user", content: [{ type: "text", text: "c", cache_control: { type: "ephemeral" } }] },
];
detects(`a request carrying ${1 + 1 + countCacheBreakpoints(overBudget)} markers`,
  !withinBudget(layout.system, layout.tools, overBudget) && countCacheBreakpoints(overBudget) === 3);

// (g) A marker on a thinking block — the request the API rejects outright.
const blindMark = (ms: any[]) => {
  const out = rollingCacheBreakpoints(ms as any, 0) as any[];
  const last: any = out[out.length - 1];
  if (Array.isArray(last.content) && last.content.length > 0) {
    last.content = last.content.slice();
    last.content[last.content.length - 1] = { ...last.content[last.content.length - 1], cache_control: { type: "ephemeral" } };
  }
  return out;
};
detects("a marker on a trailing thinking block", !noMarkerOnThinking(blindMark([
  { role: "user", content: [{ type: "text", text: "go on" }] },
  { role: "assistant", content: [
    { type: "text", text: "Reading it now." },
    { type: "thinking", thinking: "…", signature: "s" },
  ] },
])));

// (h) A missing-column predicate WIDENED to ignore the column name. It would
//     turn a unique-constraint failure into "the migration has not run" and
//     drop units_rounds forever, quietly, on a healthy schema.
const widened = (e: unknown) => {
  const err = e as { code?: string } | null;
  return !!err && typeof err === "object" && (err.code === "PGRST204" || err.code === "42703");
};
detects("a missing-column predicate that ignores the column name", !missingColumnPredicateSound(widened));

// (i) A retry that RE-SENDS the column it exists to drop. One token, and the
//     insert then fails for exactly the reason the first one did — losing the
//     whole ledger row on every turn until the migration runs, silently, while
//     counting the inserts and grepping for "units_rounds" both stay green.
const brokenRetry = `
  let { error: usageErr } = await intelligenceDb
    .from("ai_usage")
    .insert({ ...usageRow, units_rounds: rounds || null });
  if (usageErr && isMissingColumnError(usageErr, "units_rounds")) {
    ({ error: usageErr } = await intelligenceDb.from("ai_usage").insert({ ...usageRow, units_rounds: rounds || null }));
  }`;
const brokenSites: number[] = [];
{
  const re = /from\("ai_usage"\)\s*\.insert\(\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(brokenRetry)) !== null) brokenSites.push(m.index);
}
detects("a retry that re-sends units_rounds",
  brokenSites.length === 2
  && (brokenRetry.match(/units_rounds/g) || []).length === 3
  && fieldExpr(balancedBody(brokenRetry, brokenRetry.indexOf(".insert(", brokenSites[1])), "units_rounds") !== "");

// (j) MARKERS TOO FAR APART — the shape that made this whole change necessary
//     and that nothing in this file measured until now. Hand-built at a fixed
//     25 positions so the detector is a fixed target rather than a reading of
//     whatever the code under test currently emits.
const farApart: any[][] = [];
{
  const blocks: any[] = [];
  for (let i = 0; i < 25; i++) blocks.push({ type: "text", text: `block ${i}` });
  const first = [{ role: "user", content: [{ type: "text", text: "start", cache_control: { type: "ephemeral" } }] }];
  const second = [
    { role: "user", content: [{ type: "text", text: "start" }] },
    { role: "assistant", content: blocks },
    { role: "user", content: [{ type: "text", text: "next", cache_control: { type: "ephemeral" } }] },
  ];
  farApart.push(first, second);
}
const farHop = worstLookbackHop(farApart);
detects(`breakpoints ${farHop.hop} positions apart, past the ${CACHE_LOOKBACK_POSITIONS}-position lookback`,
  farHop.hop > CACHE_LOOKBACK_POSITIONS);
// …and the same reader must NOT cry wolf on a chain that is fine, or check 8
// would be red on every healthy build and get deleted.
detects("that a chain inside the lookback is reported as fine",
  worstLookbackHop([
    [{ role: "user", content: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }] }],
    [
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "user", content: [{ type: "text", text: "b", cache_control: { type: "ephemeral" } }] },
    ],
  ]).hop <= CACHE_LOOKBACK_POSITIONS);

// (k) A stripper that only reaches the top level, leaving a nested marker in
//     place under the new one. Hand-built as the OUTPUT such a stripper would
//     produce, so the detector does not depend on the placer being broken.
const nestedSurvivor: any[] = [
  { role: "user", content: [
    { type: "tool_result", tool_use_id: "tu_1", cache_control: { type: "ephemeral" }, content: [
      { type: "text", text: "body", cache_control: { type: "ephemeral" } },
    ] },
  ] },
];
detects("a cache_control left nested inside a tool_result", countCacheBreakpoints(nestedSurvivor) === 2);

// (l) A request whose `tools` is a different expression from its system and
//     messages — the taint narrowing sent to the API from somewhere the layout
//     never saw. The old substring test passed on this, because the spread
//     guard beside it contains the very string it looked for.
const divergentSite = `anthropic.messages.stream({
      model: apiModel,
      system: layout.system,
      messages: layout.messages,
      ...(layout.tools.length > 0 ? { tools: cacheableTools(tools) } : {}),
    })`;
const divergentBody = balancedBody(divergentSite, divergentSite.indexOf("("));
detects("a request whose tools expression is not the layout's",
  divergentBody.indexOf("layout.tools") >= 0 && fieldExpr(divergentBody, "tools") !== "layout.tools");

if (selfFails) { console.log(`\n  ${selfFails} detector(s) do not work — nothing above can be trusted.\n`); process.exit(2); }

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

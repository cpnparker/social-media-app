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
 */
import { readFileSync } from "fs";
import { buildSystemPrompt, normalizeContextConfig } from "../lib/ai/system-prompts";
import { splitVolatile, appendVolatile, VOLATILE_OPEN, VOLATILE_CLOSE } from "../lib/ai/prompt-cache";

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

// ── Self-test: prove the detectors fire ─────────────────────────────────
// Every check above passes right now, which is exactly when a check is least
// trustworthy — the previous version of this file also passed, for two years,
// while both bugs it was written to catch were live. So the two shapes are
// rebuilt here deliberately and asserted to be caught.
//
// Fixture-only. Nothing in lib/ is mutated: this working tree is shared with
// other sessions and also deploys, and a break-test-restore has already sent a
// deliberate break to production from here once.
console.log("\n8. Self-test — the detectors catch the shapes they exist for");
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

if (selfFails) { console.log(`\n  ${selfFails} detector(s) do not work — nothing above can be trusted.\n`); process.exit(2); }

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

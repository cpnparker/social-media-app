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
import { splitVolatile, VOLATILE_OPEN, VOLATILE_CLOSE } from "../lib/ai/prompt-cache";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

const base = () => buildSystemPrompt({
  workspaceConfig: { contentTypes: [], cuDefinitions: [], formatDescriptions: null, typeInstructions: null, companyContext: null },
  clientContext: null, contentDetail: null,
  contextConfig: normalizeContextConfig({}), resourcingAccess: false,
} as any);

// What the messages route actually does after buildSystemPrompt returns.
const DECK_SPEC = "\n\n## The deck in this conversation\n" + "SLIDE SPEC ".repeat(400);
const routeAppends = (p: string) =>
  p + DECK_SPEC
    + "\n\n## Required tool calls for this turn\nYou MUST call these tools."
    + "\n\n**LIVESEARCH ACTIVE:** rules follow."
    + "\n\n## Scheduled task thread\nThis thread belongs to a recurring prompt.";

const assembled = routeAppends(base());
const { stable, volatile } = splitVolatile(assembled);

console.log("\n1. The assembled prompt still declares a volatile region");
volatile ? pass(`volatile region found, ${volatile.length} chars`) : fail("no volatile region — the whole prompt is one cache unit again");

console.log("\n2. Route appends are CACHED, not stranded in the tail");
stable.includes("## The deck in this conversation")
  ? pass("deck spec is in the cached block")
  : fail("deck spec landed in the uncached tail — a 23-slide spec re-read every turn");
for (const frag of ["Required tool calls", "LIVESEARCH ACTIVE", "Scheduled task thread"]) {
  stable.includes(frag) ? pass(`"${frag}" is cached`) : fail(`"${frag}" landed uncached`);
}

console.log("\n3. Only the clock is uncached, and it is tiny");
volatile.length < 400
  ? pass(`volatile is ${volatile.length} chars against ${stable.length.toLocaleString()} stable`)
  : fail(`volatile tail is ${volatile.length} chars — too much is uncached`);
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

console.log("\n5. Two builds a moment apart are byte-identical up to the clock");
splitVolatile(routeAppends(base())).stable === splitVolatile(routeAppends(base())).stable
  ? pass("the cached block is stable across builds")
  : fail("the cached block differs between builds — something volatile is still in it");

console.log("\n6. The runtime uses the split, on every chain");
const providers = readFileSync("lib/ai/providers.ts", "utf8");
/const \{ stable, volatile \} = splitVolatile\(systemText\)/.test(providers)
  ? pass("cacheableSystem lifts the region out")
  : fail("cacheableSystem no longer splits");
(providers.match(/flattenSystem\(systemText\)/g) || []).length >= 3
  ? pass("the other three chains reorder and strip too")
  : fail("a chain would show a raw marker or leave the clock mid-prompt");

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

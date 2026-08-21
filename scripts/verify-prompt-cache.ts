/**
 * The cached prefix must not contain anything that changes faster than the
 * cache TTL.
 *
 * THE BUG THIS EXISTS FOR. The whole system string was wrapped in one
 * cache_control block, and a MINUTE-RESOLUTION clock was interpolated about six
 * thousand characters into it. A cached prefix is matched byte for byte, so a
 * prefix that changes every minute is never reused — and since the breakpoint
 * covers everything BEFORE it, what was lost was not the timestamp but the
 * ~100KB of instructions behind it, on every turn of every conversation.
 *
 * It was invisible because nothing failed: answers were correct, latency was
 * merely unremarkable, and intelligence.ai_usage records units_input and cost
 * but has no cache-read/write columns, so the miss never showed up in the one
 * place anyone would look.
 */
import { readFileSync } from "fs";
import { buildSystemPrompt, normalizeContextConfig } from "../lib/ai/system-prompts";
import { VOLATILE_MARKER } from "../lib/ai/prompt-cache";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

const build = () => buildSystemPrompt({
  workspaceConfig: { contentTypes: [], cuDefinitions: [], formatDescriptions: null, typeInstructions: null, companyContext: null },
  clientContext: null, contentDetail: null,
  contextConfig: normalizeContextConfig({}), resourcingAccess: false,
} as any);

const prompt = build();
const idx = prompt.indexOf(VOLATILE_MARKER);

console.log("\n1. The prompt declares a volatile boundary");
idx !== -1 ? pass(`marker present at char ${idx.toLocaleString()}`) : fail("no VOLATILE_MARKER — the whole prompt is one cache unit again");

console.log("\n2. The volatile tail is TINY and the stable part is the bulk");
if (idx !== -1) {
  const stable = prompt.slice(0, idx);
  const tail = prompt.slice(idx + VOLATILE_MARKER.length);
  stable.length > tail.length * 20
    ? pass(`stable ${stable.length.toLocaleString()} chars vs volatile ${tail.length} chars`)
    : fail(`volatile tail is ${tail.length} chars against ${stable.length} stable — too much is uncached`);
  // The marker must be LAST. Anything after the volatile block is uncacheable too.
  prompt.lastIndexOf(VOLATILE_MARKER) === idx
    ? pass("exactly one boundary")
    : fail("more than one marker — only the last one splits, the rest leak into the model");
}

console.log("\n3. The clock is BEHIND the boundary, not in front of it");
if (idx !== -1) {
  const stable = prompt.slice(0, idx);
  // A bare HH:MM anywhere in the cached part is the exact bug.
  const clockInStable = /\b\d{2}:\d{2}\b/.exec(stable);
  clockInStable
    ? fail(`a clock ("${clockInStable[0]}") is inside the cached prefix at char ${clockInStable.index.toLocaleString()} — everything after it stops caching`)
    : pass("no HH:MM inside the cached prefix");
  /\d{2}:\d{2}/.test(prompt.slice(idx))
    ? pass("the clock is still present, in the volatile tail")
    : fail("the clock vanished entirely — the model can no longer answer 'what is left today'");
}

console.log("\n4. Two builds a moment apart differ ONLY after the boundary");
const a = build(), b = build();
if (idx !== -1) {
  a.slice(0, a.indexOf(VOLATILE_MARKER)) === b.slice(0, b.indexOf(VOLATILE_MARKER))
    ? pass("the cached prefix is byte-identical across builds")
    : fail("the cached prefix differs between two builds — something volatile is still in front of the marker");
}

console.log("\n5. The runtime actually splits it, and hides the marker");
const providers = readFileSync("lib/ai/providers.ts", "utf8");
/const stable = systemText\.slice\(0, i\)/.test(providers) && /cache_control: \{ type: "ephemeral" \} \},\s*\n\s*\{ type: "text", text: volatilePart \}/.test(providers)
  ? pass("Anthropic chain emits [cached stable][uncached volatile]")
  : fail("cacheableSystem no longer splits the tail");
(providers.match(/flattenSystem\(systemText\)/g) || []).length >= 3
  ? pass("the other three chains strip the marker before sending")
  : fail("a chain would show the raw marker to the model");

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

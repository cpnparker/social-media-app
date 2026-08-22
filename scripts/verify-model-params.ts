/**
 * Assertion script for lib/ai/anthropic-params.ts — run with `npx tsx`.
 *
 * There is no test runner in this repo (precedent: scripts/verify-engine-scoping.ts).
 * This exists because the failure mode is silent until it isn't: the two regexes
 * are hand-maintained, and getting one wrong doesn't fail a typecheck — it sends
 * `temperature` to a model that rejects it and 400s EVERY request for that model.
 * Adding a Claude model without touching this file is the easy mistake.
 */
import { anthropicCallParams, anthropicMaxTokens, ANTHROPIC_ADAPTIVE_ONLY } from "../lib/ai/anthropic-params";
import { getAvailableModels, getModelInfo } from "../lib/ai/providers";
import { AI_MODELS, getModelLabel } from "../lib/ai/models";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`);
  }
}

// Every id offered in AI_MODELS / MODEL_REGISTRY, plus the legacy remap targets.
// 4.7+ models reject temperature/top_p/top_k with a 400; older ones need it.
console.log("\nanthropicCallParams — sampling vs thinking");
check("opus-5     → thinking on, no sampling", anthropicCallParams("claude-opus-5", 0.4), {});
check("fable-5    → thinking on, no sampling", anthropicCallParams("claude-fable-5", 0.4), {});
check("mythos-5   → thinking on, no sampling", anthropicCallParams("claude-mythos-5", 0.4), {});
check("sonnet-5   → thinking disabled", anthropicCallParams("claude-sonnet-5", 0.4), { thinking: { type: "disabled" } });
check("opus-4-8   → thinking disabled", anthropicCallParams("claude-opus-4-8", 0.4), { thinking: { type: "disabled" } });
check("opus-4-7   → thinking disabled", anthropicCallParams("claude-opus-4-7", 0.4), { thinking: { type: "disabled" } });
check("sonnet-4-6 → keeps temperature", anthropicCallParams("claude-sonnet-4-6", 0.4), { temperature: 0.4 });
check("haiku-4-5  → keeps temperature", anthropicCallParams("claude-haiku-4-5", 0.4), { temperature: 0.4 });

// The chat streamer always passes a concrete number (config.temperature ?? 0.4),
// so "no temperature was requested" is NOT a path that protects a 4.7+ model.
console.log("\nanthropicCallParams — no temperature requested");
check("opus-5     → still no sampling", anthropicCallParams("claude-opus-5"), {});
check("sonnet-4-6 → omits temperature", anthropicCallParams("claude-sonnet-4-6"), {});

// max_tokens caps thinking AND text together, so thinking-on models need a floor.
console.log("\nanthropicMaxTokens — floor for thinking models");
check("opus-5   4096 → 16000", anthropicMaxTokens("claude-opus-5", 4096), 16000);
check("fable-5  4096 → 16000", anthropicMaxTokens("claude-fable-5", 4096), 16000);
check("opus-5  32000 → 32000 (higher setting wins)", anthropicMaxTokens("claude-opus-5", 32000), 32000);
check("opus-5  undef → 16000", anthropicMaxTokens("claude-opus-5"), 16000);
check("sonnet-5 4096 → 4096 (thinking off, no floor)", anthropicMaxTokens("claude-sonnet-5", 4096), 4096);
check("haiku    4096 → 4096", anthropicMaxTokens("claude-haiku-4-5", 4096), 4096);
check("grok     4096 → 4096 (non-Anthropic unaffected)", anthropicMaxTokens("grok-4-1-fast", 4096), 4096);

// Guard the regex against over-matching: opus-4-0/4-1 are pre-4.7 and DO take
// temperature, so an `opus-[45]`-style shortcut would silently break them.
console.log("\nANTHROPIC_ADAPTIVE_ONLY — no over-matching");
check("opus-4-0 not adaptive-only", ANTHROPIC_ADAPTIVE_ONLY.test("claude-opus-4-0"), false);
check("opus-4-1 not adaptive-only", ANTHROPIC_ADAPTIVE_ONLY.test("claude-opus-4-1"), false);
check("opus-4-5 not adaptive-only", ANTHROPIC_ADAPTIVE_ONLY.test("claude-opus-4-5"), false);
check("opus-4-6 not adaptive-only", ANTHROPIC_ADAPTIVE_ONLY.test("claude-opus-4-6"), false);
check("opus-5 IS adaptive-only", ANTHROPIC_ADAPTIVE_ONLY.test("claude-opus-5"), true);

// Retiring a model means "not selectable", NOT "deleted". Deleting the registry
// entry would send existing threads through getModelInfo's silent Sonnet 5
// fallback — the picker would say one thing and another model would answer.
console.log("\nRetired models — unofferable, still resolvable");
const offered = getAvailableModels().map((m) => m.id);
const clientIds = AI_MODELS.map((m) => m.id as string);
check("opus-4-8 gone from settings dropdowns", offered.includes("claude-opus-4-8"), false);
check("opus-4-8 gone from chat pickers", clientIds.includes("claude-opus-4-8"), false);
check("opus-4-8 still routes to itself, not Sonnet 5", getModelInfo("claude-opus-4-8").apiModel, "claude-opus-4-8");
check("opus-5 IS offered", offered.includes("claude-opus-5"), true);
check("opus-5 IS in chat pickers", clientIds.includes("claude-opus-5"), true);

// Attribution on past work stays truthful: an Opus 4.8 answer is not relabelled
// as its successor just because the id was retired.
console.log("\ngetModelLabel — retired ids keep honest labels");
check("opus-4-8", getModelLabel("claude-opus-4-8"), "Claude Opus 4.8");
check("sonnet-4-6", getModelLabel("claude-sonnet-4-6"), "Claude Sonnet 4.6");
check("sonnet-4-20250514", getModelLabel("claude-sonnet-4-20250514"), "Claude Sonnet 4");
check("opus-5 (current)", getModelLabel("claude-opus-5"), "Claude Opus 5");
check("genuinely unknown id falls through to raw", getModelLabel("claude-made-up-9"), "claude-made-up-9");

console.log(failures === 0 ? "\nAll assertions passed.\n" : `\n${failures} FAILURE(S).\n`);
process.exit(failures === 0 ? 0 : 1);

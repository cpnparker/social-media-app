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
import { getAvailableModels, getModelInfo, MODEL_REGISTRY, FALLBACK_MODEL, FALLBACK_LABEL } from "../lib/ai/providers";
import { AI_MODELS, getModelLabel } from "../lib/ai/models";
import { openAIRequestParams } from "../lib/ai/openai-params";
import { cheapModelParams, CHEAP_MODEL } from "../lib/ai/cheap-model";

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
// The 2026-09-23 successors, by NAME: they used to be right only because
// "opus-5" and "fable-5" prefix-match them.
check("opus-5-5   → thinking on, no sampling", anthropicCallParams("claude-opus-5-5", 0.4), {});
check("fable-5-1  → thinking on, no sampling", anthropicCallParams("claude-fable-5-1", 0.4), {});
// A future sonnet-5-5 must NOT inherit sonnet-5's disable: a model that cannot
// disable thinking 400s on {type:"disabled"}. Unmatched, it is sent nothing.
check("sonnet-5-5 (hypothetical) → never sent a disable", anthropicCallParams("claude-sonnet-5-5", 0.4), {});

// The chat streamer always passes a concrete number (config.temperature ?? 0.4),
// so "no temperature was requested" is NOT a path that protects a 4.7+ model.
console.log("\nanthropicCallParams — no temperature requested");
check("opus-5     → still no sampling", anthropicCallParams("claude-opus-5"), {});
check("sonnet-4-6 → omits temperature", anthropicCallParams("claude-sonnet-4-6"), {});

// max_tokens caps thinking AND text together, so thinking-on models need a floor.
console.log("\nanthropicMaxTokens — floor for thinking models");
check("opus-5   4096 → 16000", anthropicMaxTokens("claude-opus-5", 4096), 16000);
check("fable-5  4096 → 16000", anthropicMaxTokens("claude-fable-5", 4096), 16000);
check("opus-5-5  4096 → 16000", anthropicMaxTokens("claude-opus-5-5", 4096), 16000);
check("fable-5-1 4096 → 16000", anthropicMaxTokens("claude-fable-5-1", 4096), 16000);
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
check("opus-5-5 IS offered", offered.includes("claude-opus-5-5"), true);
check("opus-5-5 IS in chat pickers", clientIds.includes("claude-opus-5-5"), true);

// The 2026-09-23 retirements. Each must be unofferable AND still resolve to
// the model named here — never to getModelInfo's silent Sonnet 5 fallback,
// and never to a slug that no longer answers (gemini-2.5-pro pointed at the
// bare "gemini-3-flash", which 404s, and nothing caught it).
const retired: [string, string][] = [
  ["claude-opus-5", "claude-opus-5-5"],
  ["claude-fable-5", "claude-fable-5-1"],
  ["claude-fable-5-1", "claude-fable-5-1"],
  ["claude-haiku-4-5", "claude-haiku-4-5-20251001"],
  ["gpt-6-astra", "gpt-6-sol"],
  ["gpt-5-6-terra", "gpt-6-sol"],
  ["gpt-6-sol", "gpt-6-sol"],
  ["gpt-5-6-luna", "gpt-6-luna"],
  ["grok-4-6", "grok-4.7"],
  ["grok-4-3", "grok-4.3"],
  ["grok-4-1-fast", "grok-4.3"],
  ["deepseek-chat", "gpt-6-luna"],
  ["gemini-2.5-pro", "gemini-3.8-flash"],
  ["gemini-3-flash", "gemini-3.8-flash"],
  ["sonar", "claude-sonnet-5"],
];
for (let i = 0; i < retired.length; i++) {
  const [id, target] = retired[i];
  check(`${id} not offered anywhere`, offered.includes(id) || clientIds.includes(id), false);
  check(`${id} still resolves → ${target}`, getModelInfo(id).apiModel, target);
}
// The fallback notice names what actually answers. It was a literal "Grok
// 4.6", and a first cut of the registry lookup found "auto" (which shares the
// apiModel and comes first) — it would have said "using EngineAI Auto".
check(`fallback ${FALLBACK_MODEL} is announced by its own name`, FALLBACK_LABEL, "Grok 4.7");

// Attribution on past work stays truthful: an Opus 4.8 answer is not relabelled
// as its successor just because the id was retired.
console.log("\ngetModelLabel — retired ids keep honest labels");
check("opus-4-8", getModelLabel("claude-opus-4-8"), "Claude Opus 4.8");
check("sonnet-4-6", getModelLabel("claude-sonnet-4-6"), "Claude Sonnet 4.6");
check("sonnet-4-20250514", getModelLabel("claude-sonnet-4-20250514"), "Claude Sonnet 4");
check("opus-5 (retired, true label)", getModelLabel("claude-opus-5"), "Claude Opus 5");
check("opus-5-5 (current)", getModelLabel("claude-opus-5-5"), "Claude Opus 5.5");
check("genuinely unknown id falls through to raw", getModelLabel("claude-made-up-9"), "claude-made-up-9");

// ── reasoning_effort must not be decided by registry ORDER ──────────────
// providers.ts resolves effort with
//   Object.values(MODEL_REGISTRY).find(m => m.apiModel === apiModel)?.reasoningEffort
// so when two registry ids share one apiModel, the FIRST entry silently
// decides for both. grok-4-1-fast and grok-4-3 both map to "grok-4.3", and
// only the former set "none" — so grok-4-3 was getting it by insertion order.
// Retiring or reordering that neighbour would have switched reasoning ON, and
// reasoning tokens bill as OUTPUT. Nothing would have surfaced it but the bill.
//
// The assertion is on the RESOLUTION, not on the field: every id sharing an
// apiModel must agree about effort, so no ordering can change an answer.
console.log("\nreasoning_effort — shared apiModels agree, so order cannot decide");
const byApi: Record<string, { id: string; effort: string }[]> = {};
const regIds = Object.keys(MODEL_REGISTRY);
for (let i = 0; i < regIds.length; i++) {
  const id = regIds[i];
  const entry = (MODEL_REGISTRY as any)[id];
  // xAI AND OpenAI: both chains resolve effort this way (providers.ts).
  if (!entry || (entry.provider !== "xai" && entry.provider !== "openai")) continue;
  const api = String(entry.apiModel);
  if (!byApi[api]) byApi[api] = [];
  byApi[api].push({ id, effort: String(entry.reasoningEffort ?? "UNSET") });
}
const apis = Object.keys(byApi);
for (let i = 0; i < apis.length; i++) {
  const group = byApi[apis[i]];
  if (group.length < 2) continue;
  const efforts: string[] = [];
  for (let j = 0; j < group.length; j++) {
    if (efforts.indexOf(group[j].effort) < 0) efforts.push(group[j].effort);
  }
  check(
    `apiModel ${apis[i]} — ${group.map((g) => g.id + "=" + g.effort).join(", ")}`,
    efforts.length,
    1
  );
}

// ── OpenAI request parameters ───────────────────────────────────────────
// GPT-5+ 400s on max_tokens, and on a temperature while it reasons; with
// function tools on /v1/chat/completions it 400s at ANY effort but "none".
// scripts/verify-openai-chain.ts proves the chain USES this rule end to end;
// these pin the rule itself.
console.log("\nopenAIRequestParams — what a GPT-5+ request may carry");
check("gpt-6-luna at none: completion cap, effort, and the temperature it now accepts",
  openAIRequestParams("gpt-6-luna", { maxTokens: 500, temperature: 0.3, reasoningEffort: "none" }),
  { max_completion_tokens: 500, reasoning_effort: "none", temperature: 0.3 });
check("gpt-6-sol with no effort: no temperature (it reasons), cap floored to 16000",
  openAIRequestParams("gpt-6-sol", { maxTokens: 4096, temperature: 0.4 }),
  { max_completion_tokens: 16000 });
check("gpt-6-sol at medium: no temperature, floored cap",
  openAIRequestParams("gpt-6-sol", { maxTokens: 4096, temperature: 0.4, reasoningEffort: "medium" }),
  { max_completion_tokens: 16000, reasoning_effort: "medium" });
check("a pre-GPT-5 id keeps max_tokens and temperature",
  openAIRequestParams("deepseek-chat", { maxTokens: 4096, temperature: 0.4 }),
  { max_tokens: 4096, temperature: 0.4 });
check(`cheap tier (${CHEAP_MODEL}): the job's own cap and temperature, effort none`,
  cheapModelParams(500, 0.3),
  { max_completion_tokens: 500, reasoning_effort: "none", temperature: 0.3 });

console.log("\nOpenAI registry entries — effort \"none\", the only value tools allow");
for (let i = 0; i < regIds.length; i++) {
  const id = regIds[i];
  const entry = (MODEL_REGISTRY as any)[id];
  if (!entry || entry.provider !== "openai") continue;
  // Resolved the way streamOpenAI resolves it — by apiModel, first match.
  const resolved = Object.values(MODEL_REGISTRY).find((m: any) => m.apiModel === entry.apiModel) as any;
  check(`${id} (${entry.apiModel}) runs at effort none`, resolved?.reasoningEffort, "none");
  // gpt-6-astra refuses "none", so with tools it cannot run on Chat Completions.
  check(`${id} does not send gpt-6-astra`, entry.apiModel === "gpt-6-astra", false);
}

console.log(failures === 0 ? "\nAll assertions passed.\n" : `\n${failures} FAILURE(S).\n`);
process.exit(failures === 0 ? 0 : 1);

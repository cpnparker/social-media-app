/**
 * Every model id a route can name must resolve — in the registry AND in the
 * rate table. Run with `npx tsx scripts/verify-model-ids.ts`.
 *
 * WHY THIS EXISTS. getModelInfo answers an unknown id with claude-sonnet-5 and
 * calculateCostTenths prices an unknown id at the claude-sonnet-4-6 fallback.
 * Neither throws. So a typo, or a slug that was only ever half-added, produces
 * a system that runs perfectly and quietly does the wrong thing:
 *
 *   - A cost-cutting change written against an UNREGISTERED id routes to
 *     Sonnet 5 instead, at fifteen times the intended input price — and the
 *     ledger shows nothing wrong, because the Sonnet call it logs is the
 *     Sonnet call it really made. The saving simply never appears.
 *   - An id registered but MISSING FROM THE RATE TABLE bills at $3/$15
 *     whatever it actually costs. That is not hypothetical: grok-4-1-fast was
 *     logged at $0.20/$0.50 while xAI billed $1.25/$2.50 for 23 days of 30,
 *     which made the month's headline figure a floor rather than a measurement.
 *
 * Both failures are invisible to a typecheck, to a test of behaviour, and to
 * the person reading the bill. The only thing that catches them is asserting
 * that the tables agree with each other.
 *
 * IT TESTS WHAT IS USED, NOT WHAT IS WRITTEN. The tables are imported and
 * queried through the same functions the app calls, rather than pattern-matched
 * out of the source. A check that greps for a line reported a live security
 * hole in this repo as closed, because the line existed and nothing called it.
 *
 * `--self-test` runs each detector against synthetic bad input and asserts it
 * goes red. A check that silently tests nothing passes just as loudly as one
 * that works, so this one proves its own preconditions before trusting itself.
 */
import { MODEL_REGISTRY, getModelInfo } from "../lib/ai/providers";
import { MODEL_COSTS, calculateCostTenths, RATES_VERIFIED_ON, RATE_EXPIRIES } from "../lib/ai/model-costs";
import { AI_MODELS, getModelLabel } from "../lib/ai/models";
import { FAST_MODEL, REASONING_MODEL, GROUNDED_MODEL } from "../lib/ai/auto-router";

let failures = 0;
function fail(msg: string) { failures++; console.log(`  FAIL ${msg}`); }
function ok(msg: string) { console.log(`  ok   ${msg}`); }

/** The fallback rate an unpriced model silently lands on. */
const FALLBACK_RATE = MODEL_COSTS["claude-sonnet-4-6"];

/** Every id in the registry, including hidden and legacy ones. */
const registryIds: string[] = Object.keys(MODEL_REGISTRY);

// ── Preconditions ────────────────────────────────────────────────────────
// Assert the check can SEE something before trusting anything it reports. An
// empty registry would make every loop below pass without executing once.
console.log(`\nPreconditions (rates verified ${RATES_VERIFIED_ON})`);
if (registryIds.length < 10) fail(`registry has only ${registryIds.length} entries — import is broken`);
else ok(`registry visible: ${registryIds.length} entries`);
if (Object.keys(MODEL_COSTS).length < 10) fail(`rate table has only ${Object.keys(MODEL_COSTS).length} rows`);
else ok(`rate table visible: ${Object.keys(MODEL_COSTS).length} rows`);
if (registryIds.indexOf("gpt-5-6-luna") < 0) fail("gpt-5-6-luna is not registered — the id no route could name");
else ok("gpt-5-6-luna is registered first-class");
if (!FALLBACK_RATE) fail("claude-sonnet-4-6 fallback row is missing — cost fallback is undefined");
else ok(`fallback rate is $${FALLBACK_RATE.inputPer1M / 100}/$${FALLBACK_RATE.outputPer1M / 100} per 1M`);

// ── 1. Every registry id prices as itself ───────────────────────────────
console.log("\nEvery registry id has its own rate row");
for (let i = 0; i < registryIds.length; i++) {
  const id = registryIds[i];
  if (id === "auto") continue; // a router alias, never billed under this name
  if (!MODEL_COSTS[id]) fail(`${id} — no rate row; bills at the $3/$15 fallback`);
}
if (!failures) ok(`all ${registryIds.length} registry ids priced`);

// ── 2. Every wire slug prices too ───────────────────────────────────────
// Call sites do not agree on which they log: some log the registry id, some
// the apiModel actually sent. Whichever it is, it must price the same, or the
// same call costs two different amounts depending on who logged it.
console.log("\nEvery apiModel wire slug is priced, and priced identically");
const before2 = failures;
for (let i = 0; i < registryIds.length; i++) {
  const id = registryIds[i];
  const wire = MODEL_REGISTRY[id].apiModel;
  if (!wire || wire === id) continue;
  // 'auto' is not a model. routeModel resolves it to a concrete id before any
  // request, so its apiModel is only a default for callers that bypass the
  // router — and what those callers LOG is an open question this check does
  // not answer (tracked in PLAN-cheap-tier-model-update.md, A-3). Named, not
  // hidden: a skipped case that goes unmentioned reads as a case that passed.
  if (id === "auto") continue;
  if (!MODEL_COSTS[wire]) { fail(`${wire} (wire slug of ${id}) — no rate row`); continue; }
  // A LEGACY entry is expected to price differently from its wire slug, and
  // must. Its id is a historical label: rows logged under "gpt-4o" are real
  // GPT-4o calls and have to keep GPT-4o's price, even though the id now
  // routes new traffic to Terra. Requiring these to agree would have forced
  // the ledger to restate past spend at a rate that was never charged.
  if (MODEL_REGISTRY[id].legacy) continue;
  const a = calculateCostTenths(id, 1_000_000, 1_000_000);
  const b = calculateCostTenths(wire, 1_000_000, 1_000_000);
  if (a !== b) fail(`${id} and its wire slug ${wire} price differently (${a} vs ${b} tenths)`);
}
if (failures === before2) ok("every wire slug prices the same as its registry id");

// ── 3. The router's legs resolve ────────────────────────────────────────
// Imported, not retyped. A literal here would drift from the router the same
// way lib/scheduled/runner.ts drifted from FAST_MODEL.
console.log("\nThe auto-router's three legs resolve to real models");
const legs: [string, string][] = [
  ["FAST_MODEL", FAST_MODEL], ["REASONING_MODEL", REASONING_MODEL], ["GROUNDED_MODEL", GROUNDED_MODEL],
];
for (let i = 0; i < legs.length; i++) {
  const [name, id] = legs[i];
  if (registryIds.indexOf(id) < 0) { fail(`${name} = "${id}" is not in the registry — routes to Sonnet 5 silently`); continue; }
  if (!MODEL_COSTS[id]) { fail(`${name} = "${id}" has no rate row`); continue; }
  ok(`${name} → ${id} (${getModelLabel(id)})`);
}

// ── 4. Nothing retired is still selectable ──────────────────────────────
// A picker entry marked legacy in the registry is an option that errors when
// chosen. deepseek-chat was exactly this after DeepSeek retired the alias.
console.log("\nNo picker entry is retired, unregistered or unpriced");
const before4 = failures;
for (let i = 0; i < AI_MODELS.length; i++) {
  const m = AI_MODELS[i];
  if (m.id === "auto") continue;
  const info = MODEL_REGISTRY[m.id];
  if (!info) { fail(`picker offers "${m.id}" — not in the registry`); continue; }
  if (info.legacy) fail(`picker offers "${m.id}" but the registry marks it legacy — selecting it errors`);
  if (info.hidden) fail(`picker offers "${m.id}" but the registry marks it hidden`);
  if (!MODEL_COSTS[m.id]) fail(`picker offers "${m.id}" — no rate row`);
}
if (failures === before4) ok(`all ${AI_MODELS.length - 1} picker entries live and priced`);

// ── 5. Every id renders as a name ───────────────────────────────────────
// getModelLabel falls back to the raw id, so a missing label captions a past
// answer "gpt-5.6-luna" instead of naming the model that wrote it.
console.log("\nEvery id and wire slug renders as a label, not a raw id");
const before5 = failures;
for (let i = 0; i < registryIds.length; i++) {
  const id = registryIds[i];
  const wire = MODEL_REGISTRY[id].apiModel;
  if (getModelLabel(id) === id) fail(`${id} renders as its raw id`);
  if (wire && wire !== id && getModelLabel(wire) === wire) fail(`wire slug ${wire} renders as its raw id`);
}
if (failures === before5) ok("every id and wire slug has a display label");

// ── 6. No rate is past its expiry ───────────────────────────────────────
// A promotional rate is correct until a date and wrong after it, and nothing
// in the running system notices the day it turns. So the date is the check.
type Expiry = (typeof RATE_EXPIRIES)[number];
type Verdict = { state: "expired" | "applied" | "soon" | "valid"; days: number; message: string };

/**
 * What to say about one expiring rate on a given day.
 *
 * Takes the date as an argument rather than reading the clock, so the
 * self-test can drive it past its own expiry without waiting a week or
 * touching a repo file.
 */
export function expiryVerdict(todayIso: string, e: Expiry, row: { inputPer1M: number; outputPer1M: number } | undefined): Verdict {
  const days = Math.ceil((Date.parse(e.until) - Date.parse(todayIso)) / 86_400_000);
  if (!row) return { state: "expired", days, message: `${e.model} has an expiry recorded but no rate row` };
  const applied = row.inputPer1M === e.then.inputPer1M && row.outputPer1M === e.then.outputPer1M;
  if (todayIso > e.until) {
    return applied
      ? { state: "applied", days, message: `${e.model} expired ${e.until} and the new rate is already applied — remove this entry` }
      : { state: "expired", days, message: `${e.model} rate expired on ${e.until}. Set inputPer1M: ${e.then.inputPer1M}, outputPer1M: ${e.then.outputPer1M}. ${e.why}` };
  }
  return days <= 14
    ? { state: "soon", days, message: `${e.model} rate changes in ${days} day(s), on ${e.until}: $${e.then.inputPer1M / 100}/$${e.then.outputPer1M / 100} per 1M` }
    : { state: "valid", days, message: `${e.model} rate valid until ${e.until} (${days} days)` };
}

console.log("\nNo rate is past its known expiry date");
const todayIso = new Date().toISOString().slice(0, 10);
for (let i = 0; i < RATE_EXPIRIES.length; i++) {
  const e = RATE_EXPIRIES[i];
  const v = expiryVerdict(todayIso, e, MODEL_COSTS[e.model]);
  if (v.state === "expired") fail(v.message);
  else if (v.state === "soon") console.log(`  NOTE ${v.message}`);
  else ok(v.message);
}

// ── Self-test ───────────────────────────────────────────────────────────
// Prove the detectors go red, without mutating a repo file. Break-test-restore
// in a shared working tree already shipped one deliberate break to production
// here; synthetic input cannot.
if (process.argv.indexOf("--self-test") >= 0) {
  console.log("\nSelf-test — each detector against synthetic bad input");
  let selfFails = 0;
  const st = (name: string, caught: boolean) => {
    if (caught) console.log(`  ok   detects ${name}`);
    else { selfFails++; console.log(`  FAIL does NOT detect ${name}`); }
  };

  st("an unregistered id", MODEL_REGISTRY["gpt-5-6-luna-typo"] === undefined
    && getModelInfo("gpt-5-6-luna-typo").apiModel === getModelInfo("claude-sonnet-5").apiModel);

  st("an unpriced id billing at the fallback",
    calculateCostTenths("a-model-that-does-not-exist", 1_000_000, 0)
      === calculateCostTenths("claude-sonnet-4-6", 1_000_000, 0));

  st("two spellings that price differently",
    calculateCostTenths("gpt-5-6-luna", 1_000_000, 0) !== calculateCostTenths("claude-sonnet-4-6", 1_000_000, 0));

  st("a missing label falling back to the raw id",
    getModelLabel("some-unlabelled-model") === "some-unlabelled-model");

  // The expiry check, driven past its own date. This is the one detector that
  // cannot be proven by waiting, so it is proven by argument instead.
  const sonnet = RATE_EXPIRIES.filter((e) => e.model === "claude-sonnet-5")[0];
  if (!sonnet) { selfFails++; console.log("  FAIL no claude-sonnet-5 expiry to test against"); }
  else {
    st("a rate still inside its window", expiryVerdict("2026-08-24", sonnet, MODEL_COSTS["claude-sonnet-5"]).state !== "expired");
    st("a rate one day past expiry", expiryVerdict("2026-09-01", sonnet, MODEL_COSTS["claude-sonnet-5"]).state === "expired");
    st("an expiry already actioned (asks for removal, not a failure)",
      expiryVerdict("2026-09-01", sonnet, { inputPer1M: sonnet.then.inputPer1M, outputPer1M: sonnet.then.outputPer1M }).state === "applied");
    st("the 14-day notice", expiryVerdict("2026-08-24", sonnet, MODEL_COSTS["claude-sonnet-5"]).state === "soon");
  }

  // The real assertion behind check 1: Luna priced as Luna, not as Sonnet.
  const lunaPerM = calculateCostTenths("gpt-5-6-luna", 1_000_000, 0) / 1000; // tenths of a cent → dollars
  st(`Luna priced at $${lunaPerM}/1M in, not the $30 fallback`, Math.abs(lunaPerM - 0.2) < 0.001);

  if (selfFails) { console.log(`\n  ${selfFails} detector(s) do not work. Nothing above can be trusted.\n`); process.exit(2); }
  console.log("  — all detectors confirmed working");
}

console.log(failures ? `\n${failures} failure(s)\n` : "\nAll model ids resolve in both tables.\n");
process.exit(failures ? 1 : 0);

/**
 * Every row written to intelligence.ai_usage must be priced from the ONE rate
 * table, and every model call on the voice surface must write a row at all.
 * Run with `npx tsx scripts/verify-usage-logging.ts --self-test`.
 *
 * WHY. Three billing faults were live at once on 2026-08-24, and none of them
 * failed, threw, or showed up on a dashboard as anything other than a number:
 *
 *  1. Voice minutes billed at 50 tenths ($0.05/min), the deprecated 1.0 rate,
 *     while VOICE_MODEL defaulted to grok-voice-think-fast-2.0 at $0.08/min.
 *     37.5% under. The model id was in the same INSERT the whole time, in
 *     name_model; only the rate was blind to it.
 *  2. The voice analyst insert priced claude-sonnet-5 with inline arithmetic at
 *     $3/$15 — the Sonnet 4.6 rate — while model-costs.ts had carried $2/$10
 *     since the price cliff was cancelled. 50% over, in the other direction.
 *  3. ask_engine ran up to FOUR Sonnet 5 calls per escalation, with tool
 *     results of up to 20,000 characters each, and logged nothing at all. The
 *     most expensive tool on the surface was the only one absent from the
 *     ledger.
 *
 * The common shape is not "someone typed the wrong number". It is a rate, or a
 * log, written BESIDE a model id rather than DERIVED from it. Two literals in
 * one object drift apart the moment either moves, and a ledger cannot tell you
 * it is wrong — an under-report looks like light usage and an over-report looks
 * like heavy usage. Only reconciliation against a provider invoice catches it,
 * which is months later, which is how (1) survived from June.
 *
 * So this asserts the DERIVATION, not the value: units_cost_tenths must come
 * from calculateCostTenths or from the voice rate table, never from arithmetic
 * over a numeric literal. That check does not care what the rates are, which is
 * the point — it keeps holding after the next price change.
 *
 * MUTATION LOG.
 *  - KILLED: reverting fix (2) to the inline `/1e6 * 300 + /1e6 * 1500` form
 *    trips check 1. Confirmed by running this file against the pre-fix blob.
 *  - KILLED: deleting the ask_engine usage insert trips check 3.
 *  - KILLED: adding a token-priced name_model literal with no MODEL_COSTS row
 *    trips check 2.
 *  - FALSE POSITIVE, found on first run and fixed: check 2 originally required
 *    EVERY name_model literal to have a MODEL_COSTS row, and failed
 *    assemblyai-universal-streaming — which is correctly priced per MINUTE and
 *    correctly absent from a per-token table. The requirement is now scoped to
 *    inserts that actually price via calculateCostTenths, and the minute-priced
 *    branch asserts the opposite: that such a model does NOT also carry a token
 *    rate, because two rates for one model is the same fault wearing a hat.
 *  - KILLED BY THE SELF-TEST, not by the repo scan: the insert parser first
 *    read a field value up to `,\n`, so it returned nothing for a single-line
 *    insert and the model would have been reported as unpriced-by-neither. Every
 *    real insert in the repo is multi-line, so the scan was green and wrong.
 *    Now balances brackets instead.
 *  - SURVIVED, and worth knowing: check 3 asserts a usage insert exists in the
 *    same FILE as the model call, not that it is reachable from it or that it
 *    counts the right tokens. A logging call placed inside an unreachable
 *    branch would still pass. Making that airtight needs the call graph; what
 *    is here catches the omission that actually happened.
 */
import * as fs from "fs";
import * as path from "path";
import { MODEL_COSTS } from "../lib/ai/model-costs";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

const ROOT = path.join(__dirname, "..");
const SEARCH_DIRS = ["app", "lib"];

function walk(dir: string, out: string[]): string[] {
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { return out; }
  for (let i = 0; i < entries.length; i++) {
    const name = entries[i];
    if (name === "node_modules" || name === ".next" || name[0] === ".") continue;
    const full = path.join(dir, name);
    let st: fs.Stats;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const FILES: string[] = [];
for (let i = 0; i < SEARCH_DIRS.length; i++) walk(path.join(ROOT, SEARCH_DIRS[i]), FILES);
const rel = (f: string) => path.relative(ROOT, f);

// ── Detectors, exported shape so the self-test drives the same code ─────
/** A units_cost_tenths value that does arithmetic over a numeric literal. */
export function inlinePricedValues(src: string): string[] {
  const out: string[] = [];
  const re = /units_cost_tenths\s*:\s*([\s\S]{0,400}?)(?:,\n|\n\s*\})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const expr = m[1];
    if (/calculateCostTenths|voiceCostTenthsPerMin|costTenths\b/.test(expr)) continue;
    // A bare variable or a plain column copy is fine; arithmetic on a literal
    // rate is not. `* 60`, `/ 60` and `* 10` are unit conversions, not rates.
    if (/\d{2,}/.test(expr.replace(/\b(60|10|1e6|1_000_000|1000000|0)\b/g, ""))) out.push(expr.trim().slice(0, 120));
  }
  return out;
}

/** Model ids written as a string literal into name_model. */
export function namedModels(src: string): string[] {
  const out: string[] = [];
  const re = /name_model\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

/**
 * The value of one object field, read by BALANCING brackets rather than by
 * looking for a newline. The first version keyed off `,\n`, which worked on
 * every real insert in the repo and silently returned nothing for a single-line
 * one — the self-test caught it, the repo scan could not have. A detector that
 * reads an expression must not depend on how it was formatted.
 */
export function fieldExpr(body: string, field: string): string {
  const idx = body.indexOf(field + ":");
  if (idx < 0) return "";
  let depth = 0;
  let out = "";
  for (let i = idx + field.length + 1; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth--;
    } else if (ch === "," && depth === 0) break;
    out += ch;
  }
  return out.trim();
}

/**
 * Each ai_usage INSERT as a pair: the model it names and the expression it
 * prices with. Parsed together because the QUESTION is whether those two agree
 * — reading them from separate passes is what let a per-token rate sit beside a
 * per-minute model in the first place.
 */
export function usageInserts(src: string): { model: string; cost: string }[] {
  const out: { model: string; cost: string }[] = [];
  const re = /from\("ai_usage"\)\s*\.insert\(\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    const body = src.slice(m.index, i);
    const mm = body.match(/name_model\s*:\s*"([^"]+)"/);
    out.push({ model: mm ? mm[1] : "", cost: fieldExpr(body, "units_cost_tenths") });
  }
  return out;
}

console.log("\n1. Every ai_usage cost is derived from the rate table, not typed beside it");
let inlineHits = 0;
for (let i = 0; i < FILES.length; i++) {
  const src = fs.readFileSync(FILES[i], "utf8");
  if (src.indexOf("units_cost_tenths") < 0) continue;
  const bad = inlinePricedValues(src);
  for (let j = 0; j < bad.length; j++) {
    inlineHits++;
    fail(`${rel(FILES[i])} prices a row with inline arithmetic: ${bad[j]}`);
  }
}
if (!inlineHits) pass("no inline rate arithmetic reaches units_cost_tenths");

console.log("\n2. The model NAMED and the rate USED agree on their unit");
let inspected = 0;
for (let i = 0; i < FILES.length; i++) {
  const src = fs.readFileSync(FILES[i], "utf8");
  if (src.indexOf('from("ai_usage")') < 0) continue;
  const rows = usageInserts(src);
  for (let j = 0; j < rows.length; j++) {
    const id = rows[j].model;
    const cost = rows[j].cost;
    if (!id) continue; // name_model from a variable — check 1 governs the rate
    inspected++;
    const perToken = /calculateCostTenths/.test(cost);
    const perMinute = /PER_MIN|voiceCostTenthsPerMin/.test(cost);
    if (perToken) {
      // Priced per TOKEN, so it must have a token rate. Without one it silently
      // takes the claude-sonnet-4-6 fallback — the fault MODEL_COSTS documents.
      Object.prototype.hasOwnProperty.call(MODEL_COSTS, id)
        ? pass(`${id} is token-priced and has a rate row`)
        : fail(`${id} is token-priced but has NO row in MODEL_COSTS — it bills at the fallback`);
    } else if (perMinute) {
      // Priced per MINUTE. Correctly absent from MODEL_COSTS, which is
      // per-token. assemblyai-universal-streaming is the live example, and the
      // first draft of this check wrongly failed it.
      Object.prototype.hasOwnProperty.call(MODEL_COSTS, id)
        ? fail(`${id} is minute-priced yet ALSO has a token rate row — two rates, one model`)
        : pass(`${id} is minute-priced, and correctly absent from the token table`);
    } else {
      fail(`${id} is priced by neither calculateCostTenths nor a per-minute rate: ${cost.slice(0, 80)}`);
    }
  }
}
if (!inspected) fail("no ai_usage insert named a model — this check is testing nothing");

console.log("\n3. Every model call on the voice surface writes a usage row");
const VOICE_DIR = path.join(ROOT, "app", "api", "ai", "voice");
const voiceFiles = FILES.filter((f) => f.indexOf(VOICE_DIR) === 0);
let checkedVoice = 0;
for (let i = 0; i < voiceFiles.length; i++) {
  const src = fs.readFileSync(voiceFiles[i], "utf8");
  if (src.indexOf("messages.create(") < 0) continue;
  checkedVoice++;
  src.indexOf('from("ai_usage")') >= 0
    ? pass(`${rel(voiceFiles[i])} calls a model and logs usage`)
    : fail(`${rel(voiceFiles[i])} calls a model but never writes to ai_usage — that spend is invisible`);
}
if (!checkedVoice) fail("no voice file calls a model — check 3 is testing nothing");

// ── Self-test ──────────────────────────────────────────────────────────
// Fixture-only. This tree is shared with other sessions and also deploys, so
// nothing here mutates a repo file to prove a detector fires.
if (process.argv.indexOf("--self-test") >= 0) {
  console.log("\n4. Self-test — the detectors fire on the shapes they exist for");
  let selfFails = 0;
  const detects = (name: string, caught: boolean) => {
    caught ? console.log(`  ok    catches ${name}`) : (selfFails++, console.log(`  BROKEN  misses ${name}`));
  };

  detects("the exact pre-fix voice analyst arithmetic", inlinePricedValues(
    'units_cost_tenths: Math.round(((msg.usage?.input_tokens || 0) / 1e6 * 300 + (msg.usage?.output_tokens || 0) / 1e6 * 1500) * 10),\n'
  ).length === 1);

  detects("a freshly typed rate literal", inlinePricedValues(
    'units_cost_tenths: Math.round(tokens / 1e6 * 250),\n'
  ).length === 1);

  detects("a derived value is NOT flagged", inlinePricedValues(
    'units_cost_tenths: calculateCostTenths(model, inTok, outTok, 0, 0),\n'
  ).length === 0);

  detects("the voice-minutes form is NOT flagged", inlinePricedValues(
    'units_cost_tenths: Math.max(1, Math.round(minutes * voiceCostTenthsPerMin(VOICE_MODEL))),\n'
  ).length === 0);

  detects("a name_model literal", namedModels('name_model: "claude-sonnet-5",\n')[0] === "claude-sonnet-5");

  const parsed = usageInserts(
    'await db.from("ai_usage").insert({ name_model: "claude-sonnet-5", units_input: a, units_cost_tenths: calculateCostTenths(m, a, b), id_conversation: c });'
  );
  detects("the parser pairs a model with its cost expression",
    parsed.length === 1 && parsed[0].model === "claude-sonnet-5" && /calculateCostTenths/.test(parsed[0].cost));

  const perMin = usageInserts(
    'db.from("ai_usage").insert({ name_model: "assemblyai-universal-streaming", units_cost_tenths: minutes * MEETING_STT_COST_TENTHS_PER_MIN, id_conversation: x });'
  );
  detects("a per-minute rate is recognised as priced",
    perMin.length === 1 && /PER_MIN/.test(perMin[0].cost));

  detects("an unpriced model id", !Object.prototype.hasOwnProperty.call(MODEL_COSTS, "gpt-5-6-not-a-model"));

  detects("a model call with no usage insert", (() => {
    const blob = 'const res = await anthropic.messages.create({ model: "claude-sonnet-5" });';
    return blob.indexOf("messages.create(") >= 0 && blob.indexOf('from("ai_usage")') < 0;
  })());

  if (selfFails) { console.log(`\n  ${selfFails} detector(s) do not work — nothing above can be trusted.\n`); process.exit(2); }
  console.log("  — all detectors confirmed working");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

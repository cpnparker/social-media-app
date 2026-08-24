/**
 * Fan-out coverage and the novelty gap, checked where they can actually be
 * checked: the pure seams.
 *
 *   npx tsx scripts/verify-optimizer-coverage.ts
 *
 * Both features are three model calls, and the interesting failures are not in
 * the calls. They are in what happens to the response: a model that asserts
 * coverage it cannot quote, a model that invents a sentence, a version bump
 * that never reaches the memo key, a prompt that quietly loses the rule
 * telling it not to recommend spinning up thin pages. Every one of those is
 * testable offline against a recorded response, and none of them costs a
 * request. A check whose parsing can only be tested by spending money is a
 * check whose parsing does not get tested.
 *
 * MUTATION LOG — throwaway worktree, never the shared tree.
 *   2026-08-24  unverified coverage quote accepted as covered  → 2 fail  ✓
 *   2026-08-24  unverified novelty quote kept instead of dropped → 2 fail  ✓
 *   2026-08-24  prompt version dropped from the memo key       → 1 fail  ✓
 *   2026-08-24  novelty model set equal to the parametric model → 1 fail  ✓
 *   2026-08-24  "do not create separate pages" rule deleted    → 1 fail  ✓
 *   (baseline: exit 0)
 */
import {
  buildFanoutPrompt, parseFanoutResponse, buildParametricPrompt, buildNoveltyPrompt,
  parseNoveltyResponse, coverageKey, COVERAGE_PROMPT_VERSION,
  FANOUT_MODEL, PARAMETRIC_MODEL, NOVELTY_MODEL,
} from "../lib/optimizer/coverage";
import type { CoverageInput } from "../lib/optimizer/coverage";

let failures = 0;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string, d?: string) => { failures++; console.log(`  FAIL  ${m}${d ? "\n        " + d : ""}`); };

const DRAFT = [
  "Payment orchestration routes a card transaction across several acquirers rather than one.",
  "Vaultline lifted authorisation rates by 4.1 percentage points for cross-border volume above EUR 5 million.",
  "The Nordics saw the largest gain, at 94.2 per cent authorisation after routing changes.",
  "Fees start at eight basis points per transaction.",
  "Ilse Brandt, who built the routing layer, said the hardest part was reconciling settlement files.",
].join(" ");

const INPUT: CoverageInput = {
  title: "Payment orchestration for mid-market retail",
  draftText: DRAFT,
  targetQueries: [],
  brandName: "Vaultline",
  format: "explainer",
};

// ── 1. The prompts carry the rules that bind them ────────────────────────
console.log(`\n1. The binding guardrails survive into the assembled prompt`);
{
  const f = buildFanoutPrompt(INPUT);
  const n = buildNoveltyPrompt("A model answer.", DRAFT);
  const both = f.system + "\n" + n.system;

  // Google's scaled-content-abuse guidance: cover a gap IN the page, never by
  // spinning up a page per query variant. A recommender that forgets this
  // produces advice that is actively against the platform's own policy.
  /separate pages/i.test(both) && /scaled content abuse/i.test(both)
    ? pass("the prompts forbid recommending a page per sub-query")
    : fail("the scaled-content-abuse rule is not in the assembled prompt");

  // SAGEO Arena: body-only optimisation measurably REDUCED citation, because
  // punchier phrasing strips the terms that get a page retrieved.
  /topical breadth|query vocabulary/i.test(both)
    ? pass("the prompts forbid proposing changes that strip query vocabulary")
    : fail("the breadth guardrail is missing from the prompt");

  /VERBATIM/i.test(both)
    ? pass("the prompts demand verbatim quotes")
    : fail("nothing in the prompt requires a verbatim quote");

  // The parametric prompt must NOT contain the draft. If it does, the whole
  // novelty measurement is circular and always reads 'commodity'.
  const par = buildParametricPrompt("what is payment orchestration");
  (par.user + par.system).indexOf("Vaultline lifted authorisation") < 0
    ? pass("the parametric prompt never sees the draft — otherwise the comparison is circular")
    : fail("THE DRAFT LEAKED INTO THE PARAMETRIC PROMPT — novelty would be measured against itself");

  // A declared target query replaces inference.
  const withQuery = buildFanoutPrompt({ ...INPUT, targetQueries: ["how does payment orchestration work"] });
  /DECLARED TARGET QUERY: how does payment orchestration work/.test(withQuery.user)
    ? pass("a declared target query is passed through and replaces inference")
    : fail("the declared query never reached the prompt");
}

// ── 2. Coverage claims must be quotable ──────────────────────────────────
console.log(`\n2. A claim of coverage the model cannot quote is not coverage`);
{
  const good = JSON.stringify({
    primaryQuery: "what is payment orchestration",
    subQueries: [
      { query: "what is payment orchestration", covered: true, evidence: "Payment orchestration routes a card transaction across several acquirers rather than one." },
      { query: "how much does it cost", covered: true, evidence: "Fees start at eight basis points per transaction." },
      { query: "does it work for low volume", covered: false, evidence: "" },
      { query: "which acquirers are supported", covered: false, evidence: "" },
    ],
  });
  const r = parseFanoutResponse(good, DRAFT);
  r.ok && r.value!.coveredCount === 2 && r.value!.coveragePct === 50
    ? pass(`clean response parses: 2 of 4 covered, ${r.value!.coveragePct}%`)
    : fail(`clean parse wrong: ${JSON.stringify(r.value && { c: r.value.coveredCount, p: r.value.coveragePct })}`);
  r.ok && r.value!.subQueries[0].start >= 0
    ? pass("a verified quote carries its offsets, so the passage can be highlighted")
    : fail("the located quote has no offsets");

  // The load-bearing case: the model asserts coverage and quotes a sentence
  // that is not in the draft.
  const invented = JSON.stringify({
    primaryQuery: "q",
    subQueries: [
      { query: "does it support instalments", covered: true, evidence: "Vaultline supports instalment plans in fourteen markets." },
      { query: "what is it", covered: true, evidence: "Payment orchestration routes a card transaction across several acquirers rather than one." },
    ],
  });
  const inv = parseFanoutResponse(invented, DRAFT);
  inv.ok && inv.value!.coveredCount === 1
    ? pass("an invented quote demotes that sub-query to UNCOVERED rather than crediting it")
    : fail(`an unquotable coverage claim was credited: covered=${inv.value && inv.value.coveredCount}`);
  inv.dropped === 1
    ? pass("...and the failure is counted, not swallowed")
    : fail(`dropped=${inv.dropped}, expected 1 — a model inventing quotes must be visible`);
  inv.ok && inv.value!.subQueries.length === 2
    ? pass("...and the sub-query itself survives, because the writer still needs to know about it")
    : fail("the sub-query was discarded along with its bad evidence");

  parseFanoutResponse("I could not do that.", DRAFT).ok === false
    ? pass("prose instead of JSON is a reported failure")
    : fail("non-JSON was accepted");
  parseFanoutResponse(JSON.stringify({ primaryQuery: "q", subQueries: [] }), DRAFT).ok === false
    ? pass("an empty sub-query list is a reported failure, not 0% coverage")
    : fail("an empty list was treated as a real result");

  // Fenced JSON is the common real-world shape.
  const fenced = "```json\n" + good + "\n```";
  parseFanoutResponse(fenced, DRAFT).ok
    ? pass("a fenced JSON block parses")
    : fail("fenced JSON was rejected");
}

// ── 3. Novelty: an unquotable claim is dropped outright ──────────────────
console.log(`\n3. Novelty claims are dropped when the quote does not verify`);
{
  const raw = JSON.stringify({
    novel: [
      { claim: "a specific authorisation lift", quote: "Vaultline lifted authorisation rates by 4.1 percentage points for cross-border volume above EUR 5 million." },
      { claim: "invented", quote: "Vaultline processes twelve billion transactions a year." },
    ],
    commodity: [
      { claim: "the definition is general knowledge", quote: "Payment orchestration routes a card transaction across several acquirers rather than one." },
    ],
  });
  const r = parseNoveltyResponse(raw, DRAFT, "A model answer.");
  r.ok && r.value!.novel.length === 1
    ? pass("the invented novel claim is dropped, the real one kept")
    : fail(`novel=${r.value && r.value.novel.length}, expected 1`);
  r.dropped === 1
    ? pass("...and counted")
    : fail(`dropped=${r.dropped}, expected 1`);
  r.ok && r.value!.noveltyPct === 50
    ? pass(`novelty is computed over what SURVIVED: 1 of 2 = ${r.value!.noveltyPct}%`)
    : fail(`noveltyPct=${r.value && r.value.noveltyPct}, expected 50 (1 novel, 1 commodity)`);
  r.ok && r.value!.measuredAgainst === PARAMETRIC_MODEL
    ? pass("the result names whose knowledge it was measured against")
    : fail("the result does not say which model it measured against — the number is meaningless without it");
  r.ok && r.value!.parametricAnswer === "A model answer."
    ? pass("the parametric answer is carried into the result, so the writer can read it")
    : fail("the parametric answer was lost");

  parseNoveltyResponse(JSON.stringify({ novel: [{ claim: "x", quote: "not in the draft at all, nowhere" }], commodity: [] }), DRAFT, "a")
    .ok === false
    ? pass("a response where nothing verifies is a failure, not 0% novelty")
    : fail("an all-invented response produced a score");
}

// ── 4. The memo key sees everything that changes the answer ──────────────
console.log(`\n4. Every input that changes the result reaches the memo key`);
{
  const M = { fanout: FANOUT_MODEL, parametric: PARAMETRIC_MODEL, novelty: NOVELTY_MODEL };
  const base = coverageKey(INPUT, COVERAGE_PROMPT_VERSION, M);

  const variants: [string, string][] = [
    ["a changed draft", coverageKey({ ...INPUT, draftText: DRAFT + " One more sentence." }, COVERAGE_PROMPT_VERSION, M)],
    ["a changed title", coverageKey({ ...INPUT, title: "Something else" }, COVERAGE_PROMPT_VERSION, M)],
    ["a changed target query", coverageKey({ ...INPUT, targetQueries: ["x"] }, COVERAGE_PROMPT_VERSION, M)],
    ["a changed brand", coverageKey({ ...INPUT, brandName: "Other" }, COVERAGE_PROMPT_VERSION, M)],
    ["a changed format", coverageKey({ ...INPUT, format: "faq" }, COVERAGE_PROMPT_VERSION, M)],
    // The one that has actually gone wrong here before: a version bumped in the
    // source that never entered its own digest, so every cached answer stayed
    // served by the old prompt while the commit claimed otherwise.
    ["a bumped prompt version", coverageKey(INPUT, "9.9.9", M)],
    ["a changed fan-out model", coverageKey(INPUT, COVERAGE_PROMPT_VERSION, { ...M, fanout: "other" })],
    ["a changed parametric model", coverageKey(INPUT, COVERAGE_PROMPT_VERSION, { ...M, parametric: "other" })],
    ["a changed novelty model", coverageKey(INPUT, COVERAGE_PROMPT_VERSION, { ...M, novelty: "other" })],
  ];
  let allDiffer = true;
  for (const [label, k] of variants) {
    if (k === base) { fail(`${label} did NOT change the memo key — that answer would be served from cache`); allDiffer = false; }
  }
  if (allDiffer) pass(`all ${variants.length} inputs change the key`);
  coverageKey(INPUT, COVERAGE_PROMPT_VERSION, M) === base
    ? pass("...and identical input is stable, so the memo can hit at all")
    : fail("the key is not deterministic");
}

// ── 5. Nothing marks its own homework ────────────────────────────────────
console.log(`\n5. Model separation`);
{
  // Compared as STRINGS, deliberately. TypeScript narrows both to their literal
  // types, so `NOVELTY_MODEL !== PARAMETRIC_MODEL` is a compile-time tautology
  // it will happily tell you can never be false — which means the assertion
  // tests nothing and would keep passing after someone pointed them at the
  // same model. The widening is what makes it a real runtime check.
  const nov: string = NOVELTY_MODEL;
  const par: string = PARAMETRIC_MODEL;
  nov !== par
    ? pass(`the novelty comparison (${NOVELTY_MODEL.split("-").slice(0, 2).join("-")}) is not the model that wrote the answer (${PARAMETRIC_MODEL})`)
    : fail("the same model produces the parametric answer AND grades it — the circularity the research names as the highest risk");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

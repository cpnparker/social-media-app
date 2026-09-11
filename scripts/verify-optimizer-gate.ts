/**
 * The suggestion gate, checked on the case that matters most.
 *
 * The rubric rewards statistics with sources. A judge that has internalised
 * that will eventually "improve" a sentence by adding a plausible number the
 * draft never contained. If that reaches the Apply button, a fabricated figure
 * goes into a client's published content over their byline, and nothing
 * flagged it — the deepest possible failure of a tool whose whole purpose is
 * stopping clients publishing unsourced claims.
 *
 * Section 2 is therefore the point of this file. The rest is supporting.
 *
 *   npx tsx scripts/verify-optimizer-gate.ts
 *
 * MUTATION LOG — every entry actually run, in a throwaway git worktree and
 * never the shared tree (vercel deploy --prod uploads the working directory):
 *   2026-08-21  drop the fabricated-figure check      → 1 failure, exit 1  ✓
 *   2026-08-21  case-normalise the no-op comparison   → 1 failure, exit 1  ✓
 *   2026-08-21  parseGateResponse reads by position   → 1 failure, exit 1  ✓
 *   (baseline, unmutated: 0 failures, exit 0)
 *
 * The first is the one to re-run on any change here. It goes red on exactly one
 * assertion, which is worth knowing: the fabrication guard has a single point
 * of failure and no redundancy behind it.
 */
import { preGate, parseGateResponse, gateLooksBroken, buildGatePrompt } from "../lib/optimizer/suggest-gate";
import type { JudgeFinding } from "../lib/optimizer/judge";

let failures = 0;
const fail = (m: string, detail?: string) => {
  failures++;
  console.log(`  FAIL  ${m}`);
  if (detail) console.log(`        ${detail}`);
};
const pass = (m: string) => console.log(`  ok    ${m}`);

const DRAFT =
  "Authorisation rates improve once a fallback route is live. The Nordvale Treasury Benchmark surveyed 900 merchants. Below EUR 5 million the fees outweigh the gains.";

function f(over: Partial<JudgeFinding>): JudgeFinding {
  return {
    criterion: "unsourced-absolute-claims", severity: "medium",
    quote: "Authorisation rates improve once a fallback route is live",
    prefix: "", suffix: "",
    explanation: "an absolute claim with nothing behind it",
    suggestedEdit: null,
    ...over,
  } as JudgeFinding;
}

console.log("\nverify-optimizer-gate\n");

// ── 1. It lets good suggestions through ──────────────────────────────────
console.log("1. Specific, grounded suggestions pass");
{
  const outcomes = preGate({
    findings: [f({ suggestedEdit: "Authorisation rates improve once a fallback route is live, according to the Nordvale Treasury Benchmark" })],
    draftText: DRAFT,
    passingCriteria: [],
  });
  outcomes[0].verdict === "APPROVED"
    ? pass("a rewrite citing a source already in the draft is approved")
    : fail(`a good suggestion was rejected: ${outcomes[0].reason}`, outcomes[0].detail);

  const noEdit = preGate({ findings: [f({ suggestedEdit: null })], draftText: DRAFT, passingCriteria: [] });
  noEdit[0].verdict === "APPROVED" && noEdit[0].reason === "no_rewrite_offered"
    ? pass("a finding with no clean rewrite is approved as explanation-only, not rejected")
    : fail("an explanation-only finding was rejected", "Plenty of real findings have no single-span fix.");
}

// ── 2. Fabrication ───────────────────────────────────────────────────────
console.log("\n2. Fabrication — the check this file exists for");
{
  const invented = preGate({
    findings: [f({ suggestedEdit: "Authorisation rates improve by 4.2% once a fallback route is live" })],
    draftText: DRAFT,
    passingCriteria: [],
  });
  invented[0].verdict === "REJECTED" && invented[0].reason === "fabricated_figure"
    ? pass("a rewrite inventing '4.2%' is rejected — the draft contains no such number")
    : fail(
        "A FABRICATED STATISTIC REACHED THE WRITER",
        "This is the worst outcome the product has. One click puts an invented figure into a client's published content under their byline."
      );

  const reuse = preGate({
    findings: [f({ suggestedEdit: "The Nordvale Treasury Benchmark surveyed 900 merchants and found rates improve" })],
    draftText: DRAFT,
    passingCriteria: [],
  });
  reuse[0].verdict === "APPROVED"
    ? pass("reusing a number ALREADY in the draft is fine (900 appears in the source text)")
    : fail("a rewrite reusing an existing number was rejected", "The check must catch invention, not arithmetic.");

  const fakeSource = preGate({
    findings: [f({ suggestedEdit: "Authorisation rates improve, according to Forrester Research" })],
    draftText: DRAFT,
    passingCriteria: [],
  });
  fakeSource[0].verdict === "REJECTED" && fakeSource[0].reason === "fabricated_attribution"
    ? pass("a rewrite attributing to a source not in the draft is rejected")
    : fail("a fabricated attribution passed", "A citation nobody can check is the same failure as an invented number.");

  const realSource = preGate({
    findings: [f({ suggestedEdit: "Rates improve, according to Nordvale Treasury Benchmark data" })],
    draftText: DRAFT,
    passingCriteria: [],
  });
  realSource[0].verdict === "APPROVED"
    ? pass("attributing to a source the draft already names is fine")
    : fail("a real attribution was rejected as fabricated", outcomes0(realSource));
}
function outcomes0(o: any[]): string { return o[0] ? `${o[0].reason}: ${o[0].detail}` : ""; }

// ── 3. No-ops and duplicates ─────────────────────────────────────────────
console.log("\n3. No-ops and duplicates");
{
  const noop = preGate({
    findings: [f({ suggestedEdit: "Authorisation rates improve once a fallback route is live" })],
    draftText: DRAFT, passingCriteria: [],
  });
  noop[0].verdict === "REJECTED" && noop[0].reason === "no_op_edit"
    ? pass("a rewrite identical to the text it replaces is rejected")
    : fail("a no-op rewrite was offered to the writer", "Apply would change nothing and cost trust.");

  const whitespace = preGate({
    findings: [f({ suggestedEdit: "Authorisation  rates improve   once a fallback route is live" })],
    draftText: DRAFT, passingCriteria: [],
  });
  whitespace[0].reason === "no_op_edit"
    ? pass("whitespace-only differences count as a no-op")
    : fail("a whitespace-only rewrite passed as a real edit");

  // Case IS a real edit — sentence-start capitalisation is a legitimate fix.
  const caseEdit = preGate({
    findings: [f({ suggestedEdit: "authorisation rates improve once a fallback route is live" })],
    draftText: DRAFT, passingCriteria: [],
  });
  caseEdit[0].verdict === "APPROVED"
    ? pass("a case-only change is a real edit, not a no-op")
    : fail("a case change was dismissed as a no-op", "Sentence-start capitalisation is a legitimate correction.");

  const dupes = preGate({
    findings: [
      f({ suggestedEdit: "Rates improve once a fallback route is live" }),
      f({ criterion: "experience-substantiation", suggestedEdit: "Rates rise once a fallback route is live" }),
    ],
    draftText: DRAFT, passingCriteria: [],
  });
  dupes[1].verdict === "DUPLICATE_OF" && dupes[1].duplicateOf === 0
    ? pass("a second finding on the same span is marked duplicate, pointing at the first")
    : fail("two findings claimed the same span", "Two highlights over one sentence means one Apply edits what the other described.");
}

// ── 4. Arguing with a passing check ──────────────────────────────────────
console.log("\n4. Findings against criteria that already pass");
{
  const arguing = preGate({
    findings: [f({ criterion: "opening-quotability" })],
    draftText: DRAFT,
    passingCriteria: ["opening-quotability"],
  });
  arguing[0].verdict === "REJECTED" && arguing[0].reason === "already_passing"
    ? pass("a finding against a criterion scoring full marks is withheld")
    : fail("a finding contradicted its own criterion's score", "The panel would show a fix for something the score says is fine.");
}

// ── 5. Classifier parsing ────────────────────────────────────────────────
console.log("\n5. Classifier parsing — one bad object costs one finding, not the batch");
{
  const good = parseGateResponse('[{"index":0,"verdict":"APPROVED"},{"index":1,"verdict":"REJECTED","reason":"generic"}]', 2);
  good[0].verdict === "APPROVED" && good[1].verdict === "REJECTED" && good[1].decidedBy === "classifier"
    ? pass("a well-formed batch is read by index")
    : fail("a well-formed classifier reply was misread");

  // Deliberately out of order and missing index 1 entirely.
  const partial = parseGateResponse('[{"index":2,"verdict":"REJECTED","reason":"generic"},{"index":0,"verdict":"APPROVED"}]', 3);
  partial[1].verdict === "APPROVED" && partial[1].decidedBy === "fallback" && partial[2].verdict === "REJECTED"
    ? pass("out-of-order replies map by index, and a missing one falls back to APPROVED")
    : fail("indices were read by position", "A reordered reply would apply verdicts to the wrong findings.");

  const junk = parseGateResponse("the model decided to explain itself instead", 3);
  junk.length === 3 && junk.filter((o) => o.decidedBy === "fallback").length === 3
    ? pass("an unparseable reply approves everything as fallback rather than emptying the panel")
    : fail("an unparseable classifier reply lost findings", "Fail-open is the policy: they already cleared the pre-gate.");

  const allRejected: any[] = [];
  for (let i = 0; i < 8; i++) allRejected.push({ index: i, verdict: "REJECTED", reason: "generic", detail: "", duplicateOf: null, decidedBy: "classifier" });
  gateLooksBroken(allRejected)
    ? pass("a classifier rejecting 100% of a batch is treated as broken, not as a result")
    : fail("a gate that rejected everything was believed", "An empty panel reads to the writer as a clean draft.");

  gateLooksBroken(allRejected.slice(0, 3))
    ? fail("a tiny batch was judged broken", "Three rejections out of three is ordinary.")
    : pass("a small batch is not judged broken on rejection rate alone");
}

// ── 6. The prompt ────────────────────────────────────────────────────────
console.log("\n6. The classifier prompt");
{
  const p = buildGatePrompt([f({ suggestedEdit: "something" })], { brandName: "Vaultline", format: "explainer" });
  p.indexOf("When uncertain, APPROVE") >= 0
    ? pass("the prompt biases toward approval when uncertain")
    : fail("the prompt does not state the uncertainty bias",
           "A gate that withholds when unsure makes good suggestions invisible; a weak one costs a second to dismiss.");
  p.indexOf("[0]") >= 0 && p.indexOf("Every index must appear exactly once") >= 0
    ? pass("findings are indexed and the reply contract is stated")
    : fail("the prompt does not index findings or state the reply contract");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

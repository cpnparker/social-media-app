/**
 * The judge's pure pipeline, checked by feeding it bad responses.
 *
 * The judge's value depends on two properties that no amount of prompt quality
 * can guarantee, because they are properties of the code that receives the
 * response:
 *
 *   1. DISJOINTNESS. The judge scores its own seven criteria and never the
 *      engine's 29. If those key spaces ever overlap, one construct gets two
 *      numbers and a writer cannot tell which to believe — which is precisely
 *      the AuthorityOn design this rubric deliberately does not port. Section 1
 *      asserts it, and it is the cheapest check in the file to keep green and
 *      the most expensive to discover broken.
 *
 *   2. HONEST INTAKE. A model WILL paraphrase a quote, elide with an ellipsis,
 *      invent a criterion name and return fenced JSON. Every one of those must
 *      be dropped and COUNTED, never silently tolerated and never guessed at.
 *      "The judge found nothing" and "the judge found eight things and all
 *      eight quotes were unmatchable" look identical in the UI and mean
 *      opposite things.
 *
 * Nothing here calls the network. The parse/anchor/score path is pure by
 * design, so it can be exercised for free and offline — a judge whose parsing
 * can only be tested by spending money is a judge whose parsing is not tested.
 *
 *   npx tsx scripts/verify-optimizer-judge.ts
 *
 * MUTATION LOG — every entry actually run, in a throwaway git worktree and
 * never the shared tree (vercel deploy --prod uploads the working directory):
 *   2026-08-21  accept unknown criterion keys        → 3 failures, exit 1  ✓
 *   2026-08-21  skip the quote-in-draft check        → 3 failures, exit 1  ✓
 *   2026-08-21  score an unreported query as zero    → 1 failure,  exit 1  ✓
 *   2026-08-21  count orphaned findings in guards    → 1 failure,  exit 1  ✓
 *   (baseline, unmutated: 0 failures, exit 0)
 *
 * The last one is the anti-drift clause and the one to re-run whenever scoring
 * changes: counting a violation the judge asserted but could not point at means
 * charging a writer points for something they cannot see, find or fix.
 *
 * deriveVerdictFindings mutations (2026-08-21, throwaway worktree):
 *   dependent-chunk derivation removed        → 1 fail  ✓
 *   dedupe against model findings removed     → 1 fail  ✓
 *   derived offsets shifted by +3             → 2 fail  ✓ (2nd try — a shifted
 *     slice is still a verbatim substring, so the substring check passed over
 *     the wrong words; the quotes are now pinned to their targets)
 */
import { CRITERIA } from "../lib/optimizer/rubric";
import { JUDGE_CRITERIA, JUDGE_CRITERION_KEYS } from "../lib/optimizer/judge-rubric";
import {
  parseJudgeResponse, scoreJudgeResponse, anchorJudgeFindings,
  assessmentKey, assessmentKeyWith, buildJudgePrompt, deriveVerdictFindings,
} from "../lib/optimizer/judge";
import type { JudgeInput } from "../lib/optimizer/judge";
import { parseDraft } from "../lib/optimizer/parse";

let failures = 0;
const fail = (m: string, detail?: string) => {
  failures++;
  console.log(`  FAIL  ${m}`);
  if (detail) console.log(`        ${detail}`);
};
const pass = (m: string) => console.log(`  ok    ${m}`);

const DRAFT_BODY = `By Dr. Ilse Brandt

Published 21 August 2026.

Vaultline is a payment orchestration platform that routes card transactions across several acquirers.

## What is payment orchestration?

Payment orchestration routes each transaction to the acquirer most likely to authorise it. In our experience this is the part finance teams underestimate.

## Does it always work?

Vaultline is the only platform that never drops a transaction. As mentioned above, the routing layer decides.`;

const parsed = parseDraft({ body: DRAFT_BODY, title: "Payment orchestration explained" });
const INPUT: JudgeInput = {
  parsed,
  title: "Payment orchestration explained",
  targetQueries: ["what is payment orchestration", "payment orchestration pricing"],
  brandName: "Vaultline",
  brandAliases: ["Vaultline", "VL"],
  format: "explainer",
};

console.log(`\nverify-optimizer-judge   ${JUDGE_CRITERIA.length} judge criteria\n`);

// ── 1. Disjointness ──────────────────────────────────────────────────────

console.log("1. The judge's criteria are disjoint from the engine's");
{
  const engineKeys: { [k: string]: boolean } = {};
  for (let i = 0; i < CRITERIA.length; i++) engineKeys[CRITERIA[i].key] = true;

  const overlap: string[] = [];
  for (let i = 0; i < JUDGE_CRITERION_KEYS.length; i++) {
    if (engineKeys[JUDGE_CRITERION_KEYS[i]]) overlap.push(JUDGE_CRITERION_KEYS[i]);
  }
  overlap.length === 0
    ? pass(`${JUDGE_CRITERION_KEYS.length} judge keys, none shared with the engine's ${CRITERIA.length}`)
    : fail(`${overlap.length} key(s) scored by BOTH engine and judge: ${overlap.join(", ")}`,
           "One construct with two numbers. The writer cannot tell which to believe, and the waterfall double-counts it.");

  let ungraded = 0;
  for (let i = 0; i < JUDGE_CRITERIA.length; i++) {
    const c = JUDGE_CRITERIA[i];
    const ok = ["A", "A-", "B", "B/C", "C", "D"].indexOf(c.evidence) >= 0
      && ["retrievability", "citability", "both"].indexOf(c.rollUp) >= 0
      && c.whyJudge.length > 40;
    if (!ok) { ungraded++; fail(`${c.key} is missing an evidence grade, a roll-up, or its whyJudge rationale`); }
  }
  if (!ungraded) pass("every judge criterion carries evidence, roll-up, and why the engine cannot do it");
}

// ── 2. Intake refuses what it cannot verify ──────────────────────────────

console.log("\n2. Intake drops what it cannot verify — and counts what it dropped");
{
  const bad = JSON.stringify({
    queryCoverage: [{ queryId: "q1", verdict: "covered", gap: "" }],
    openingQuotability: { verdict: "quotable_alone", reason: "opens with a definition of the entity" },
    chunkSelfContainment: [{ chunkId: "c1", verdict: "self_contained", dependency: "" }],
    quoteAttribution: [],
    findings: [
      // 1. an ENGINE criterion — the disjointness failure, at runtime
      { criterion: "statistic-density", severity: "high", quote: "Payment orchestration routes each transaction", prefix: "", suffix: "", explanation: "not enough statistics in this draft" },
      // 2. a paraphrase — the single most likely real failure
      { criterion: "unsourced-absolute-claims", severity: "high", quote: "Vaultline is the only platform that never loses a transaction", prefix: "", suffix: "", explanation: "an absolute claim with no source behind it at all" },
      // 3. elided
      { criterion: "chunk-self-containment", severity: "medium", quote: "As mentioned above … the routing layer decides", prefix: "", suffix: "", explanation: "this section depends on an earlier one to make sense" },
      // 4. over-length
      { criterion: "opening-quotability", severity: "low", quote: "x".repeat(240), prefix: "", suffix: "", explanation: "the opening runs on well past any quotable length" },
      // 5. no explanation
      { criterion: "experience-substantiation", severity: "low", quote: "In our experience", prefix: "", suffix: "", explanation: "no" },
      // 6. genuinely good — must survive
      { criterion: "unsourced-absolute-claims", severity: "high", quote: "Vaultline is the only platform that never drops a transaction", prefix: "", suffix: "", explanation: "an absolute claim carrying no source whatsoever" },
    ],
    summary: "assessed",
  });

  const outcome = parseJudgeResponse(bad, parsed.text);
  if (!outcome.ok || !outcome.response) {
    fail("a well-formed response failed to parse", outcome.error || "");
  } else {
    const kept = outcome.response.findings;
    kept.length === 1 && kept[0].quote.indexOf("never drops") >= 0
      ? pass("1 of 6 findings survived — the good one")
      : fail(`${kept.length} findings survived, expected exactly 1`, kept.map((k) => k.criterion + ":" + k.quote.slice(0, 30)).join(" | "));

    const reasons: { [k: string]: number } = {};
    for (let i = 0; i < outcome.dropped.length; i++) {
      reasons[outcome.dropped[i].reason] = (reasons[outcome.dropped[i].reason] || 0) + 1;
    }
    const want = ["unknown_criterion", "quote_not_in_draft", "malformed_anchor", "no_explanation"];
    let missing: string[] = [];
    for (let i = 0; i < want.length; i++) if (!reasons[want[i]]) missing.push(want[i]);
    missing.length === 0
      ? pass(`every rejection recorded by reason (${Object.keys(reasons).map((r) => r + "=" + reasons[r]).join(", ")})`)
      : fail(`rejections not recorded: ${missing.join(", ")}`,
             "A silent drop makes 'the judge found nothing' indistinguishable from 'every quote was unmatchable'.");

    reasons["unknown_criterion"] >= 1
      ? pass("a finding naming an ENGINE criterion is refused at runtime, not just by design")
      : fail("an engine criterion key passed intake", "The disjointness guarantee is design-only and the judge can double-score.");

    reasons["quote_not_in_draft"] >= 1
      ? pass("a paraphrased quote is refused (it would anchor to nothing, or worse, to something)")
      : fail("a paraphrase passed intake");
  }
}

// ── 3. Malformed transport ───────────────────────────────────────────────

console.log("\n3. Malformed transport");
{
  const fenced = "```json\n" + JSON.stringify({
    queryCoverage: [], openingQuotability: { verdict: "no_answer", reason: "the draft never answers it" },
    chunkSelfContainment: [], quoteAttribution: [], findings: [], summary: "s",
  }) + "\n```";
  parseJudgeResponse(fenced, parsed.text).ok
    ? pass("a markdown-fenced response is tolerated (models do this despite instructions)")
    : fail("fenced JSON was rejected", "Discarding a good response over a formatting habit costs a paid judge pass.");

  const prose = parseJudgeResponse("I had a look at the draft and here are my thoughts.", parsed.text);
  !prose.ok && !!prose.error
    ? pass("a prose response fails with a reason rather than throwing")
    : fail("a non-JSON response did not fail cleanly");

  const truncated = parseJudgeResponse('{"findings": [{"criterion": "opening-quota', parsed.text);
  !truncated.ok
    ? pass("truncated JSON fails cleanly (max_tokens exhaustion is a real case)")
    : fail("truncated JSON was accepted");

  let threw = false;
  try { parseJudgeResponse("", ""); } catch { threw = true; }
  !threw ? pass("an empty response does not throw") : fail("empty input threw");
}

// ── 4. Scoring honours the anti-drift rules ──────────────────────────────

console.log("\n4. Scoring honours the anti-drift rules");
{
  const response = {
    queryCoverage: [{ queryId: "q1", verdict: "covered", gap: "" }],
    openingQuotability: { verdict: "quotable_alone", reason: "defines the entity in the first line" },
    chunkSelfContainment: [
      { chunkId: "c1", verdict: "self_contained", dependency: "" },
      { chunkId: "c2", verdict: "dependent", dependency: "opens with 'As mentioned above'" },
    ],
    quoteAttribution: [],
    findings: [
      { criterion: "unsourced-absolute-claims", severity: "high" as const,
        quote: "Vaultline is the only platform that never drops a transaction",
        prefix: "", suffix: "", explanation: "absolute claim, no source", suggestedEdit: null },
      { criterion: "unsourced-absolute-claims", severity: "high" as const,
        quote: "a claim that is nowhere in this draft at all",
        prefix: "", suffix: "", explanation: "absolute claim, no source", suggestedEdit: null },
    ],
    summary: "",
  };

  // Anti-drift clause 2: only ANCHORED findings count against a guard.
  const anchored = anchorJudgeFindings(parsed.text, response.findings);
  const live = anchored.filter((a) => !a.orphaned).map((a) => a.finding);
  live.length === 1
    ? pass("an unanchorable finding is excluded from the guard count")
    : fail(`${live.length} findings anchored, expected 1`);

  const scored = scoreJudgeResponse(response as any, INPUT, live);
  const guard = scored.filter((c) => c.key === "unsourced-absolute-claims")[0];
  guard && guard.earned === 6
    ? pass("the guard is charged for 1 real violation, not the 2 the judge asserted")
    : fail(`guard earned ${guard ? guard.earned : "?"}, expected 6 (one anchored violation)`,
           "A violation the writer cannot see, find or fix must not cost them points.");

  // The second target query was never reported on. It must drop out of the
  // denominator, not score zero.
  const cov = scored.filter((c) => c.key === "semantic-query-coverage")[0];
  cov && !cov.skipped && cov.earned === 20
    ? pass("a query the judge did not report on leaves the denominator (not scored 0)")
    : fail(`coverage earned ${cov ? cov.earned : "?"} of 20`,
           "Scoring an unreported query as zero punishes the draft for the judge's omission.");

  const noQueries = scoreJudgeResponse(response as any, { ...INPUT, targetQueries: [] }, live);
  const skipped = noQueries.filter((c) => c.key === "semantic-query-coverage")[0];
  skipped && skipped.skipped && skipped.maxPoints === 0
    ? pass("with no target queries the criterion skips out of the pillar entirely")
    : fail("no-queries did not skip semantic-query-coverage");

  // A verdict the judge never gave must never become a number. This defaulted
  // to 5/10 — worth about a point of the headline, enough to cross a grade
  // boundary — for an assessment the model did not make.
  const noOpening = parseJudgeResponse(JSON.stringify({
    queryCoverage: [], openingQuotability: { reason: "the field is missing entirely" },
    chunkSelfContainment: [], quoteAttribution: [], findings: [], summary: "",
  }), parsed.text);
  const noOpeningScored = noOpening.response
    ? scoreJudgeResponse(noOpening.response, INPUT, [])
    : [];
  const opening = noOpeningScored.filter((c) => c.key === "opening-quotability")[0];
  opening && opening.skipped && opening.maxPoints === 0
    ? pass("an omitted opening verdict SKIPS rather than defaulting to a middling score")
    : fail(`opening-quotability scored ${opening ? opening.earned + "/" + opening.maxPoints : "?"} with no verdict given`,
           "A number the judge never produced is on the board, and it moves the writer's grade.");

  const miscased = parseJudgeResponse(JSON.stringify({
    queryCoverage: [], openingQuotability: { verdict: "Quotable_Alone", reason: "wrong case" },
    chunkSelfContainment: [], quoteAttribution: [], findings: [], summary: "",
  }), parsed.text);
  const miscasedOpening = (miscased.response ? scoreJudgeResponse(miscased.response, INPUT, []) : [])
    .filter((c) => c.key === "opening-quotability")[0];
  miscasedOpening && miscasedOpening.skipped
    ? pass("a mis-cased verdict skips too, rather than silently scoring")
    : fail("a mis-cased verdict produced a score");

  const noBrand = scoreJudgeResponse(response as any, { ...INPUT, brandName: undefined, brandAliases: [] }, live);
  const drift = noBrand.filter((c) => c.key === "entity-variant-drift")[0];
  drift && drift.skipped
    ? pass("with no registered brand, entity drift skips rather than scoring")
    : fail("no-brand did not skip entity-variant-drift");
}

// ── 5. The memo key ──────────────────────────────────────────────────────

console.log("\n5. The memo key — what makes 're-assess does not move the score' true");
{
  const k1 = assessmentKey(INPUT, "1.0.0");
  const k2 = assessmentKey(INPUT, "1.0.0");
  k1 === k2 ? pass("identical input yields an identical key") : fail("the key is not stable for identical input");

  const edited = { ...INPUT, parsed: parseDraft({ body: DRAFT_BODY + "\n\nOne more sentence.", title: INPUT.title }) };
  assessmentKey(edited, "1.0.0") !== k1
    ? pass("an edited draft yields a different key")
    : fail("editing the draft did not change the key", "A stale assessment would be served for changed text.");

  assessmentKey(INPUT, "1.1.0") !== k1
    ? pass("a rubric version bump invalidates the memo")
    : fail("the rubric version is not in the key", "A re-tuned rubric would serve scores computed under the old one.");

  assessmentKey({ ...INPUT, targetQueries: ["something else"] }, "1.0.0") !== k1
    ? pass("changing the target queries invalidates the memo")
    : fail("the queries are not in the key");
}

// ── 6. The prompt states the contract it depends on ──────────────────────

console.log("\n6. The prompt states the anchoring contract");
{
  const { system, sessionBlock, user } = buildJudgePrompt(INPUT);
  const required: [string, string][] = [
    ["CHARACTER FOR CHARACTER", "the verbatim rule"],
    ["200 characters", "the length cap anchors.ts enforces"],
    ["ellipsis", "the elision ban"],
    ["paragraph boundary", "the paragraph rule"],
    ["prefix and suffix", "the disambiguation context"],
  ];
  let missing: string[] = [];
  for (let i = 0; i < required.length; i++) {
    if (system.indexOf(required[i][0]) < 0) missing.push(required[i][1]);
  }
  missing.length === 0
    ? pass("every rule anchors.ts enforces is stated in the prompt")
    : fail(`the prompt does not state: ${missing.join(", ")}`,
           "anchors.ts would reject findings for a rule the judge was never given. The drop rate would look like model failure.");

  sessionBlock.indexOf("Vaultline") >= 0 && sessionBlock.indexOf("q1:") >= 0
    ? pass("the session block carries the registered names and numbered queries")
    : fail("the session block is missing brand names or query ids");

  user.indexOf("---- DRAFT ----") >= 0 && user.indexOf("c0:") >= 0
    ? pass("the draft block carries stable, document-ordered unit ids")
    : fail("the draft block is missing unit ids", "Verdicts could not be compared across runs.");

  // The prompt must forbid commenting on engine territory, or the judge will
  // helpfully volunteer opinions the UI has nowhere to put.
  system.indexOf("never comment on anything it measures") >= 0
    ? pass("the prompt forbids the judge from re-litigating engine criteria")
    : fail("the prompt does not tell the judge to stay off engine territory");
}


// ── Derived findings: verdicts become marks without model cooperation ────
console.log(`\n8. deriveVerdictFindings`);
{
  const draft =
    "<p>The opening paragraph sets a scene without answering anything at all.</p>" +
    "<h2>What routing solves</h2><p>As mentioned above, the second option wins. \"We just work harder than everyone else in the market,\" said a spokesperson.</p>";
  const parsed = parseDraft({ body: draft, title: "t" });

  // Preconditions: the fixture must give the derivation something to point at.
  parsed.chunks.filter((c) => !c.isEmpty).length >= 2
    ? pass("fixture has 2+ chunks, so a dependent-chunk verdict has a target")
    : fail("fixture has fewer than 2 chunks — chunk derivation is untested");
  parsed.quotes.length >= 1
    ? pass("fixture has a quotation, so a weak-quote verdict has a target")
    : fail("fixture has no quotation — quote derivation is untested");

  const chunkIdx = parsed.chunks.findIndex((c) => !c.isEmpty && c.heading !== null);
  const response = {
    queryCoverage: [],
    openingQuotability: { verdict: "no_answer", reason: "The opening defers the answer." },
    chunkSelfContainment: [{ chunkId: "c" + chunkIdx, verdict: "dependent", dependency: "refers to an earlier option" }],
    quoteAttribution: [{ quoteId: "qt0", verdict: "decorative" }],
    findings: [],
    summary: "",
  } as any;

  const derived = deriveVerdictFindings(response, parsed);
  derived.length === 3
    ? pass("three imperfect verdicts yield three findings")
    : fail(`expected 3 derived findings, got ${derived.length}`);

  // Every derived quote must be a verbatim slice — that is the entire point.
  let sliced = 0;
  for (let i = 0; i < derived.length; i++) if (parsed.text.indexOf(derived[i].quote) >= 0) sliced++;
  sliced === derived.length
    ? pass("every derived quote is a verbatim slice of the parsed text")
    : fail(`${derived.length - sliced} derived quote(s) are not in the text`);

  // ...and the RIGHT slice. A mutation shifting every offset by +3 survived
  // the substring check — a shifted slice is still a verbatim slice, just of
  // the wrong words. Pin each derived quote to the text it claims to be about.
  const opening = derived.filter((f) => f.criterion === "opening-quotability")[0];
  opening && opening.quote.indexOf("The opening paragraph") === 0
    ? pass("the opening finding quotes the opening sentence from its first word")
    : fail(`the opening finding starts ${JSON.stringify((opening ? opening.quote : "").slice(0, 30))} — offsets are shifted`);
  const qf = derived.filter((f) => f.criterion === "quote-attribution-quality")[0];
  qf && qf.quote.indexOf("We just work harder") >= 0 && parsed.text.indexOf(qf.prefix + qf.quote) >= 0
    ? pass("the quote finding lands on the quotation, prefix contiguous")
    : fail(`the quote finding is misplaced: ${JSON.stringify((qf ? qf.quote : "").slice(0, 40))}`);

  // And they must anchor through the same pipeline as model findings.
  const anchoredDerived = anchorJudgeFindings(parsed.text, derived);
  anchoredDerived.filter((a) => !a.orphaned).length === derived.length
    ? pass("all derived findings anchor — none orphan")
    : fail("a derived finding failed to anchor through the standard pipeline");

  // Model findings win dedupe: if the model DID supply an opening finding, the
  // derivation must not double it.
  const withModel = { ...response, findings: [{ criterion: "opening-quotability", severity: "high", quote: "x", prefix: "", suffix: "", explanation: "model's own", suggestedEdit: "better opening" }] };
  const dd = deriveVerdictFindings(withModel as any, parsed);
  dd.filter((f) => f.criterion === "opening-quotability").length === 0
    ? pass("a model-supplied finding suppresses the derived one for that criterion")
    : fail("derivation duplicated a criterion the model already covered");

  // Perfect verdicts derive nothing.
  const clean = { ...response, openingQuotability: { verdict: "quotable_alone", reason: "" }, chunkSelfContainment: [], quoteAttribution: [{ quoteId: "qt0", verdict: "substantive" }] };
  deriveVerdictFindings(clean as any, parsed).length === 0
    ? pass("perfect verdicts derive no findings")
    : fail("a clean verdict produced a finding — marks would appear on good text");
}


// ── The memo key varies with every version that changes behaviour ────────
console.log(`\n9. assessmentKey versioning`);
{
  const parsed = parseDraft({ body: "<p>Same draft text for every variant.</p>", title: "t" });
  const input = { parsed, title: "t", targetQueries: [], format: "explainer" } as any;
  const a = assessmentKeyWith(input, "1.0.0", "p1", "v1");
  const b = assessmentKeyWith(input, "1.0.0", "p1", "v2");
  const c = assessmentKeyWith(input, "1.0.0", "p2", "v1");
  const d = assessmentKeyWith(input, "1.1.0", "p1", "v1");
  a !== b
    ? pass("a pipeline version bump changes the key")
    : fail("PIPELINE VERSION DOES NOT REACH THE HASH — a cached result survives every behaviour change, which is the exact bug this section exists to prevent (it shipped once already)");
  a !== c ? pass("a prompt version bump changes the key") : fail("prompt version does not reach the hash");
  a !== d ? pass("a rubric version bump changes the key") : fail("rubric version does not reach the hash");
  a === assessmentKeyWith(input, "1.0.0", "p1", "v1")
    ? pass("identical inputs produce an identical key")
    : fail("the key is not deterministic");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

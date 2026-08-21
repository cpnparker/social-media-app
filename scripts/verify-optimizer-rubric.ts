/**
 * The Content Optimizer rubric, checked by making it fail.
 *
 * The house rule from CLAUDE.md, applied literally: "When you add a check,
 * prove it fails: reintroduce the bug, watch it go red, then restore." So this
 * script does not assert that criteria EXIST — it mutates one clean draft into
 * 30-odd deliberately defective ones and asserts each defect drives its own
 * criterion down. A check that asserts a constant is present while the thing it
 * guards is wide open is the documented failure mode in this repo, and a
 * scoring rubric is the easiest possible place to repeat it: every criterion
 * here returns a number whether or not it is measuring anything at all.
 *
 * The section that matters most is 4. If a criterion cannot be driven down by
 * a draft that obviously violates it, that criterion is decoration and the
 * score it feeds is a lie told to a client.
 *
 * EVERYTHING IN THE FIXTURES IS FICTIONAL. Vaultline, Nordvale, Kessler and
 * every .example host are invented, deliberately: the corpus is full of strings
 * like "according to X, 38% of…", and attributing a fabricated statistic to a
 * real institution would be a small lie that outlives this file.
 *
 *   npx tsx scripts/verify-optimizer-rubric.ts
 *
 * MUTATION LOG — proof this script has teeth. Every entry was actually run, in
 * a throwaway git worktree (never the shared tree: `vercel deploy --prod`
 * uploads the working directory, so a deliberate break sitting in it can ship).
 * Re-run these whenever a criterion is added; a fixture nobody has watched go
 * red is a fixture nobody should trust.
 *
 *   2026-08-21  tieredScore() always returns max     → 16 failures, exit 1  ✓
 *   2026-08-21  keyword-stuffing guard inverted      →  2 failures, exit 1  ✓
 *   2026-08-21  Math.min(100, sum) capping restored  → 13 failures, exit 1  ✓
 *   2026-08-21  a criterion deleted from CRITERIA    →  diagnostic, exit 1  ✓
 *   2026-08-21  injected clock → new Date()          →  1 failure,  exit 1  ✓
 *   2026-08-21  word-boundary guard removed          →  2 failures, exit 1  ✓
 *   2026-08-21  skip() marks criteria skipped:false  →  §6b red,   exit 1  ✓
 *   2026-08-21  coverage counted per criterion       →  §6b red,   exit 1  ✓
 *   2026-08-21  superlative guard always passes      →  1 failure, exit 1  ✓
 *   2026-08-21  anon-fact guard skips first person   →  1 failure, exit 1  ✓
 *   2026-08-21  experience exemption removed         →  1 failure, exit 1  ✓
 *   2026-08-21  Updated-date preference removed      →  §3b red,   exit 1  ✓ (2nd try — no fixture carried both dates)
 *   2026-08-21  tldr quality cap removed             →  1 failure, exit 1  ✓ (2nd try — no fixture had fragment bullets)
 *   (baseline, unmutated: exit 0)
 *
 * The tldr fixture round also caught the CRITERION being wrong, not just the
 * fixture: the first bullet-quality rule demanded a figure or brand name in
 * every bullet and flagged a perfectly liftable definitional bullet on the
 * clean draft — the number-sprinkling nudge the anti-checklist bans. The rule
 * shrank to sentence-shaped-only; substance already has its own criteria.
 *
 * One mutation on §6b was SURVIVED and is recorded because the survival is the
 * finding: replacing `if (queries.length === 0)` in pillar1 with `if (false)`
 * changed nothing, because the code below it skips again on "no usable terms in
 * the target queries". The engine has two independent paths to the same skip,
 * so that is redundancy rather than a hole — but it is exactly the shape of
 * mutation that would otherwise be logged as proof and prove nothing.
 *
 * Two of those mutations were survived by an earlier version of this script and
 * the fixtures had to be fixed, not the engine: the boundary trap asserted on a
 * criterion that never calls countTerm, and a deleted criterion crashed at
 * module scope with no output at all, which reads as a broken script rather
 * than a broken rubric. Both are the same lesson — a check you have not watched
 * fail is a check you do not have.
 */
import { computeDraftScores } from "../lib/optimizer/engine";
import type { DraftInput } from "../lib/optimizer/engine";
import { CRITERIA, PILLARS, DROPPED_FROM_AUTHORITYON, RUBRIC_VERSION } from "../lib/optimizer/rubric";
import { countTerm } from "../lib/optimizer/parse";
import type { CriterionResult } from "../lib/optimizer/types";

let failures = 0;
const fail = (m: string, detail?: string) => {
  failures++;
  console.log(`  FAIL  ${m}`);
  if (detail) console.log(`        ${detail}`);
};
const pass = (m: string) => console.log(`  ok    ${m}`);

const NOW = new Date("2026-08-21T09:00:00Z");

// ── The clean draft ──────────────────────────────────────────────────────
// A plausible 1,200-word B2B explainer that should satisfy every criterion.

const CLEAN_BODY = `By Dr. Ilse Brandt

Dr. Brandt is a certified payments architect and the author of two books on transaction routing.

Published 21 August 2026.

Vaultline is a payment orchestration platform that routes card transactions across multiple acquirers from a single integration.

**Key takeaways**

- Orchestration routes each payment to the acquirer most likely to authorise it.
- Authorisation rates rise around 4% with a fallback route configured, according to the Nordvale Treasury Benchmark.
- Any useful comparison starts with volume: below EUR 5 million a year, Kessler Institute modelling shows the fees outweigh the gains.

## What is a payment orchestration platform?

A payment orchestration platform sits between a merchant checkout and several acquiring banks, choosing a route for every transaction. Vaultline and its competitors all work this way. The merchant maintains one integration rather than one per acquirer, and the routing logic decides which path a given card takes.

Orchestration is not an acquirer. No orchestration vendor holds merchant funds or carries the settlement risk, which is the distinction finance teams most often get wrong in the first conversation. In our experience that single point causes more confusion than pricing does.

## How much does orchestration improve authorisation rates?

Authorisation rates improve by roughly 4% once a fallback route is live, according to the [2026 Nordvale Treasury Benchmark](https://nordvale.example/benchmark) of 900 European merchants. The gain concentrates in cross-border volume, where a domestic acquirer declines transactions a regional one would take.

"The uplift is real but it is not uniform," says Marta Lindqvist, CFO at Ferrovia Retail. "We measured six points on cross-border and almost nothing domestically."

Smaller merchants see less. Our own analysis of three mid-market retailers found a blended uplift closer to 1.5%, because their volume was almost entirely domestic. We worked with one of those retailers for a full year, and the case study is instructive: for example, its cross-border share never rose above a tenth of total volume.

## Which merchants should not buy orchestration?

Merchants below EUR 5 million in annual card volume rarely recover the cost, according to [Kessler Institute](https://kessler.example/thresholds) modelling of platform fees against authorisation gains. Below that line the fee outruns the benefit before integration effort is counted. We tell merchants below that threshold to wait, which costs us deals and remains the correct advice.

Single-market merchants with one strong acquirer are the second group. Orchestration earns its fee on route diversity, and a merchant with no diversity to exploit is buying an abstraction layer for its own sake.

## How do the two arrangements compare?

| Dimension | Single provider | Orchestration layer |
| --- | --- | --- |
| Integrations to maintain | One | One plus an adapter per route |
| Behaviour on provider outage | Volume stops | Volume reroutes |
| Retry across acquirers | Not available | Available |
| Reconciliation | One provider report | One normalised feed |
| Commercial leverage | One rate card | Competing rate cards |

The table understates the reconciliation difference. A normalised feed across five providers is the single most valuable operational output, and finance teams consistently underestimate it when they build the business case.

## What does a migration involve?

Migration runs in three stages, and the sequencing matters more than the tooling.

1. Shadow routing, where the platform observes live traffic and scores decisions without taking any.
2. Partial cutover, moving a single low-risk corridor onto real routing.
3. Full cutover, once the corridor has run clean for a full settlement cycle.

Shadow routing is the stage merchants try to skip. In every migration recorded since 2024, the shadow period surfaced at least one routing rule that would have declined good traffic. [Kessler Institute](https://kessler.example/migrations) research on 140 migrations found the same pattern.

A fair comparison of vendors therefore has to include migration support, not just routing features and platform fees.

## The bottom line

Payment orchestration is a control layer rather than a payment provider, and it pays for itself on route diversity rather than on fees. A merchant with cross-border volume above EUR 5 million should model it seriously. A single-market merchant below that line should not.`;

const CLEAN: DraftInput = {
  body: CLEAN_BODY,
  title: "Payment orchestration platform comparison: how to choose",
  targetQueries: ["payment orchestration platform comparison"],
  format: "explainer",
  brandName: "Vaultline",
  brandAliases: ["Vaultline"],
  authorName: "Ilse Brandt",
  now: NOW,
};

function withBody(body: string, over?: Partial<DraftInput>): DraftInput {
  const base: DraftInput = {
    body: body, title: CLEAN.title, targetQueries: CLEAN.targetQueries,
    format: CLEAN.format, brandName: CLEAN.brandName, brandAliases: CLEAN.brandAliases,
    authorName: CLEAN.authorName, now: NOW,
  };
  if (over) {
    const keys = Object.keys(over);
    for (let i = 0; i < keys.length; i++) (base as any)[keys[i]] = (over as any)[keys[i]];
  }
  return base;
}

/** Replace once, and fail loudly if the anchor is missing — a mutation that
 *  silently no-ops turns a red fixture green and nobody notices. */
function mutate(body: string, from: string, to: string): string {
  if (body.indexOf(from) < 0) throw new Error("Fixture anchor not found: " + from.slice(0, 60));
  return body.replace(from, to);
}

function criterionOf(scores: ReturnType<typeof computeDraftScores>, key: string): CriterionResult | null {
  for (let i = 0; i < scores.pillars.length; i++) {
    const cs = scores.pillars[i].criteria;
    for (let c = 0; c < cs.length; c++) if (cs[c].key === key) return cs[c];
  }
  return null;
}

// Wrapped because the engine throws on an unknown criterion key — which is the
// right behaviour there, but at module scope it would abort this script before
// a single line of output, and "no output" reads like a broken script rather
// than a broken rubric. Deleting a criterion from CRITERIA is exactly the
// mutation that lands here.
let cleanScores: ReturnType<typeof computeDraftScores>;
try {
  cleanScores = computeDraftScores(CLEAN);
} catch (e) {
  console.log(`\nverify-optimizer-rubric\n\n  FAIL  the engine threw on the clean draft: ${String(e)}`);
  console.log(`        A criterion is referenced by the engine but missing from CRITERIA in rubric.ts.\n`);
  process.exit(1);
}

// ── 1. Rubric shape ──────────────────────────────────────────────────────

console.log(`\nverify-optimizer-rubric   rubric v${RUBRIC_VERSION} · ${CRITERIA.length} criteria`);
console.log(`\n1. Rubric shape`);

let weightSum = 0;
for (let i = 0; i < PILLARS.length; i++) weightSum += PILLARS[i].weightBp;
weightSum === 10000
  ? pass(`weights sum to exactly 10000bp (${PILLARS.map((p) => p.weightBp).join("/")})`)
  : fail(`weights sum to ${weightSum}bp, not 10000`);

const seenKeys: { [k: string]: boolean } = {};
let dupKey = "";
for (let i = 0; i < CRITERIA.length; i++) {
  if (seenKeys[CRITERIA[i].key]) dupKey = CRITERIA[i].key;
  seenKeys[CRITERIA[i].key] = true;
}
dupKey ? fail(`duplicate criterion key: ${dupKey}`) : pass(`${CRITERIA.length} unique criterion keys`);

let ungraded = 0;
for (let i = 0; i < CRITERIA.length; i++) {
  const c = CRITERIA[i];
  const gradeOk = ["A", "A-", "B", "B/C", "C", "D"].indexOf(c.evidence) >= 0;
  const rollOk = ["retrievability", "citability", "both"].indexOf(c.rollUp) >= 0;
  if (!gradeOk || !rollOk) { ungraded++; fail(`${c.key} is missing an evidence grade or roll-up`); }
}
if (!ungraded) pass("every criterion carries an evidence grade and a roll-up");

let reintroduced = "";
for (let i = 0; i < CRITERIA.length; i++) {
  if (DROPPED_FROM_AUTHORITYON.indexOf(CRITERIA[i].key) >= 0) reintroduced = CRITERIA[i].key;
}
reintroduced
  ? fail(`${reintroduced} is a page-only AuthorityOn criterion and cannot fire on a draft`)
  : pass(`none of the ${DROPPED_FROM_AUTHORITYON.length} dropped AuthorityOn criteria reappeared`);

// ── 2. The clean draft ───────────────────────────────────────────────────

console.log(`\n2. The clean draft scores well across every pillar`);
{
  let weak = 0;
  for (let i = 0; i < cleanScores.pillars.length; i++) {
    const p = cleanScores.pillars[i];
    if (p.score < 85) { weak++; fail(`${p.name} scores ${p.score} on the clean draft`, p.criteria.filter((c) => !c.skipped && !c.passed).map((c) => c.key).join(", ") || "(all criteria passed)"); }
  }
  if (!weak) pass(`all six pillars >= 85 (overall ${cleanScores.overall}, ${cleanScores.grade})`);
  pass(`retrievability ${cleanScores.retrievability} · citability ${cleanScores.citability}`);
}

// ── 3. Every criterion fires on a real defect ────────────────────────────

interface Defect { key: string; label: string; input: DraftInput }

const D: Defect[] = [];

// Pillar 1
D.push({ key: "title-query-alignment", label: "title shares nothing with the query", input: withBody(CLEAN_BODY, { title: "Some thoughts on modern finance" }) });
D.push({ key: "query-terms-in-headings", label: "query terms stripped from every heading", input: withBody(
  CLEAN_BODY
    .replace("## What is a payment orchestration platform?", "## What is it?")
    .replace("## How much does orchestration improve authorisation rates?", "## How much does it help?")
    .replace("## Which merchants should not buy orchestration?", "## Who should not buy?")
    .replace("## How do the two arrangements compare?", "## How do they differ?")
    .replace("## What does a migration involve?", "## What is involved?")) });
D.push({ key: "query-terms-in-body", label: "query vocabulary absent from the body", input: withBody(CLEAN_BODY, { targetQueries: ["chargeback dispute automation software"] }) });

// Pillar 2
D.push({ key: "statistic-density", label: "every statistic removed", input: withBody(
  CLEAN_BODY
    .replace(/\b4%/g, "a little").replace(/6%/g, "more").replace(/1\.5%/g, "less")
    .replace(/EUR 5 million/g, "a modest amount").replace(/8 basis points/g, "a small fee")
    .replace(/4 million EUR/g, "that volume").replace(/3200 EUR/g, "real money")
    .replace(/900 European merchants/g, "many European merchants")
    .replace(/140 migrations/g, "many migrations")) });
// mutate() throws when its anchor is missing. These three used a plain
// .replace() first time round and silently no-op'd after the clean draft was
// edited — the fixtures went green while testing nothing at all.
D.push({ key: "stat-source-adjacency", label: "attributions moved out of the statistic's sentence", input: withBody(
  mutate(mutate(mutate(CLEAN_BODY,
    "Authorisation rates improve by roughly 4% once a fallback route is live, according to the [2026 Nordvale Treasury Benchmark](https://nordvale.example/benchmark) of 900 European merchants.",
    "Authorisation rates improve by roughly 4% once a fallback route is live. That number comes from a benchmark of 900 European merchants."),
    "Authorisation rates rise around 4% with a fallback route configured, according to the Nordvale Treasury Benchmark.",
    "Authorisation rates rise around 4% with a fallback route configured."),
    "Merchants below EUR 5 million in annual card volume rarely recover the cost, according to [Kessler Institute](https://kessler.example/thresholds) modelling of platform fees against authorisation gains.",
    "Merchants below EUR 5 million in annual card volume rarely recover the cost.")) });
D.push({ key: "attributed-quotes", label: "the attributed quotation removed", input: withBody(
  mutate(CLEAN_BODY,
    `"The uplift is real but it is not uniform," says Marta Lindqvist, CFO at Ferrovia Retail. "We measured six points on cross-border and almost nothing domestically."`,
    "The uplift is real but it is not uniform, and cross-border volume is where it concentrates.")) });
D.push({ key: "external-reference-links", label: "every external citation link removed", input: withBody(
  CLEAN_BODY.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")) });

D.push({
  key: "unverifiable-superlatives",
  label: "puffery inserted with nothing behind it",
  input: withBody(CLEAN_BODY.replace(
    "Vaultline is a payment orchestration platform that routes",
    "Vaultline is a world-class, industry-leading payment orchestration platform with unparalleled reach that routes"
  )),
});
// The brand carries the facts in CLEAN_BODY; rewriting them to "we/our" with
// no brand in the sentence is exactly the Amrize failure this guard exists
// for. Sentences keep their statistics so the stat→sentence join still fires.
D.push({
  key: "anonymous-first-person-facts",
  label: "fact sentences rewritten to anonymous we/our",
  input: withBody(CLEAN_BODY
    .replace(
      "Smaller merchants see less.",
      "We processed 2 billion transactions across our network last year. Smaller merchants see less."
    )
    .replace(
      "Migration runs in three stages,",
      "We migrated 400 clients to the platform in 2025, and migration runs in three stages,"
    )),
});

// Pillar 3
D.push({
  key: "tldr-block",
  label: "takeaway bullets reduced to fragments nothing could quote",
  input: withBody(CLEAN_BODY
    .replace("- Orchestration routes each payment to the acquirer most likely to authorise it.", "- Faster routing")
    .replace("- Authorisation rates rise around 4% with a fallback route configured, according to the Nordvale Treasury Benchmark.", "- Better authorisation")
    .replace("- Any useful comparison starts with volume: below EUR 5 million a year, Kessler Institute modelling shows the fees outweigh the gains.", "- Lower total fees")),
});

D.push({ key: "answer-first-position", label: "the answer buried past the 30% mark", input: withBody(
  mutate(CLEAN_BODY,
    "Vaultline is a payment orchestration platform that routes card transactions across multiple acquirers from a single integration.\n\n",
    "There is a lot of noise in this category, and most of it comes from vendors with something to sell. Before getting to the substance it is worth setting out how this piece is organised and who it is for. Readers who have been through a migration will recognise the pattern and may prefer to skip ahead to the later sections, which go into more operational detail than the opening does.\n\n")) });
D.push({ key: "tldr-block", label: "key-takeaways block removed", input: withBody(
  CLEAN_BODY.replace("**Key takeaways**\n\n", "").replace(
    "- Orchestration routes each payment to the acquirer most likely to authorise it.\n- Authorisation rates rise around 4% with a fallback route configured, according to the Nordvale Treasury Benchmark.\n- Below EUR 5 million in annual volume the fees usually outweigh the gains.\n\n", "")) });
D.push({ key: "question-headings", label: "question headings turned into statements", input: withBody(
  CLEAN_BODY
    .replace("## What is a payment orchestration platform?", "## Payment orchestration platform basics")
    .replace("## How much does orchestration improve authorisation rates?", "## Orchestration authorisation rate uplift")
    .replace("## Which merchants should not buy orchestration?", "## Merchants who should avoid orchestration")
    .replace("## How do the two arrangements compare?", "## Arrangement comparison")
    .replace("## What does a migration involve?", "## Migration stages")) });
D.push({ key: "heading-answer-adjacency", label: "question headings followed by throat-clearing", input: withBody(
  CLEAN_BODY
    .replace("A payment orchestration platform sits between", "Finance teams ask this in most vendor conversations, and the honest answer starts with a caveat. Much depends on where a merchant is starting from. A system of this kind sits between")
    .replace("Authorisation rates improve by roughly 4%", "Vendors quote a wide range here and most of the numbers are marketing. Setting those aside for a moment, rates improve by roughly 4%")
    .replace("Merchants below EUR 5 million in annual card volume rarely recover", "That depends on more than one variable, and anyone claiming otherwise is selling something. Businesses below EUR 5 million in annual card volume rarely recover")) });
D.push({ key: "extractable-definition", label: "the definition sentence made non-copular", input: withBody(
  mutate(CLEAN_BODY,
    "Vaultline is a payment orchestration platform that routes card transactions across multiple acquirers from a single integration.",
    "When merchants outgrow a single acquirer, the thing they usually reach for is the sort of routing layer that Vaultline and a handful of competitors now sell.")
    .replace("A payment orchestration platform sits between a merchant checkout and several acquiring banks, choosing a route for every transaction.",
             "Such a routing layer sits between a merchant checkout and several acquiring banks, choosing a route for every transaction.")) });

// Pillar 4
D.push({ key: "pronoun-opening-chunks", label: "sections opening on bare pronouns", input: withBody(
  CLEAN_BODY
    .replace("A payment orchestration platform sits between", "It sits between")
    .replace("Authorisation rates improve by roughly 4%", "They improve by roughly 4%")
    .replace("Merchants below EUR 5 million in annual card volume rarely recover", "These rarely recover")
    .replace("Migration runs in three stages", "This is done in three stages")) });
D.push({ key: "canonical-name-consistency", label: "four surface forms of one brand", input: withBody(
  CLEAN_BODY.replace("Vaultline and its competitors all work this way.", "VaultLine, Vault Line and VL all work this way."),
  { brandAliases: ["Vaultline", "VaultLine", "Vault Line", "VL"] }) });
D.push({ key: "chunk-entity-naming", label: "sections stop naming their subject", input: withBody(
  CLEAN_BODY
    .replace("A payment orchestration platform sits between a merchant checkout", "The arrangement sits between a merchant checkout")
    .replace("Vaultline and its competitors all work this way.", "Most vendors work this way.")
    .replace("Authorisation rates improve by roughly 4%", "Rates improve by roughly 4%")
    .replace("Merchants below EUR 5 million", "Businesses below EUR 5 million")
    .replace("Migration runs in three stages", "Rollout runs in three stages")
    .replace("The table understates the reconciliation difference.", "The table understates one difference.")
    .replace("Payment orchestration is a control layer rather than a payment provider", "The category is a control layer rather than a provider")) });
D.push({ key: "entity-defined-once", label: "three competing definitions of the same entity", input: withBody(
  CLEAN_BODY.replace("Vaultline and its competitors all work this way.",
    "Vaultline is a fraud-scoring service used by mid-market retailers everywhere. Vaultline is a treasury reporting tool that finance teams rely on daily.")) });

// Pillar 5
D.push({ key: "byline-present", label: "byline removed", input: withBody(
  CLEAN_BODY.replace("By Dr. Ilse Brandt\n\n", ""), { authorName: undefined }) });
D.push({ key: "credential-line", label: "credential line removed", input: withBody(
  CLEAN_BODY.replace("Dr. Brandt is a certified payments architect and the author of two books on transaction routing.\n\n", "")) });
D.push({ key: "experience-markers", label: "first-hand markers removed", input: withBody(
  mutate(mutate(mutate(CLEAN_BODY,
    "In our experience that single point causes", "That single point causes"),
    "Our own analysis of three mid-market retailers found", "Published figures for three mid-market retailers show"),
    "We worked with one of those retailers for a full year, and the case study is instructive: for example,",
    "One of those retailers ran for a full year, and the case study is instructive: for example,")) });
D.push({ key: "worked-example", label: "worked example removed", input: withBody(
  mutate(CLEAN_BODY,
    "We worked with one of those retailers for a full year, and the case study is instructive: for example, its cross-border share never rose above a tenth of total volume.",
    "None of them saw cross-border rise above a tenth of total volume.")) });

// Pillar 6
D.push({ key: "dateline-recency", label: "dateline removed", input: withBody(
  CLEAN_BODY.replace("Published 21 August 2026.\n\n", "")) });
D.push({ key: "stale-year-guard", label: "stale 'as of' claims added", input: withBody(
  CLEAN_BODY
    .replace("The gain concentrates in cross-border volume", "As of 2023, the gain concentrates in cross-border volume")
    .replace("The table understates the reconciliation difference.", "The latest 2022 data shows the table understates the reconciliation difference.")) });
D.push({ key: "current-year-stats", label: "every statistic re-dated to 2020", input: withBody(
  CLEAN_BODY
    .replace("2026 Nordvale Treasury Benchmark", "2020 Nordvale Treasury Benchmark")
    .replace("Published 21 August 2026.", "Published 21 August 2026. Figures below are from 2020.")
    .replace("In every migration recorded since 2024", "In every migration recorded since 2018")) });
D.push({ key: "sentence-length-norm", label: "sentences fused into 30+ word runs", input: withBody(
  CLEAN_BODY.replace(/\. ([A-Z])/g, (_m, c) => "; " + String(c).toLowerCase())) });
D.push({ key: "comparative-format-match", label: "comparison table replaced with prose", input: withBody(
  CLEAN_BODY.replace(
    `| Dimension | Single provider | Orchestration layer |
| --- | --- | --- |
| Integrations to maintain | One | One plus an adapter per route |
| Behaviour on provider outage | Volume stops | Volume reroutes |
| Retry across acquirers | Not available | Available |
| Reconciliation | One provider report | One normalised feed |
| Commercial leverage | One rate card | Competing rate cards |`,
    "A single provider means one set of integrations to maintain, and an orchestration layer means the same integration plus an adapter for each additional route. On a provider outage the single-provider merchant stops taking volume, while the orchestrated merchant reroutes it.")
    .replace("1. Shadow routing, where the platform observes live traffic and scores decisions without taking any.\n2. Partial cutover, moving a single low-risk corridor onto real routing.\n3. Full cutover, once the corridor has run clean for a full settlement cycle.",
             "Shadow routing comes first, where the platform observes live traffic and scores decisions without taking any. Partial cutover follows, moving a single low-risk corridor onto real routing. Full cutover comes last, once the corridor has run clean for a full settlement cycle."),
  { targetQueries: ["best payment orchestration platform comparison"] }) });
D.push({ key: "heading-hierarchy", label: "a level skip and a competing H1", input: withBody(
  CLEAN_BODY
    .replace("## What does a migration involve?", "#### What does a migration involve?")
    .replace("## The bottom line", "# Payment orchestration in summary\n\n## The bottom line")) });
D.push({ key: "heading-density", label: "every subheading removed", input: withBody(
  CLEAN_BODY.replace(/^## .*$/gm, "").replace(/\n{3,}/g, "\n\n")) });
D.push({ key: "keyword-stuffing-guard", label: "one term stuffed to ~5% of all words", input: withBody(
  CLEAN_BODY + "\n\n" + new Array(46).join("Orchestration orchestration orchestration decisions matter. ")) });
D.push({ key: "ai-tell-guard", label: "AI-tell vocabulary added", input: withBody(
  CLEAN_BODY
    .replace("Orchestration is not an acquirer.", "It is worth taking a moment to delve into this. Orchestration is not just an acquirer, it is a control plane. Merchants can leverage that seamlessly.")) });

console.log(`\n3. Every criterion goes red on a draft that violates it   [${D.length} defect fixtures]`);
{
  const covered: { [k: string]: boolean } = {};
  for (let i = 0; i < D.length; i++) {
    const d = D[i];
    covered[d.key] = true;
    let after;
    try { after = computeDraftScores(d.input); }
    catch (e) { fail(`${d.key}: fixture threw`, String(e)); continue; }
    const before = criterionOf(cleanScores, d.key);
    const now = criterionOf(after, d.key);
    if (!before || !now) { fail(`${d.key}: criterion missing from results`); continue; }
    if (before.skipped) { fail(`${d.key}: skipped on the CLEAN draft — the fixture never exercises it`, before.skipReason || ""); continue; }
    if (now.skipped) { pass(`${d.key.padEnd(28)} ${before.earned} → skipped  (${d.label})`); continue; }
    if (now.earned < before.earned) {
      pass(`${d.key.padEnd(28)} ${before.earned} → ${now.earned}  (${d.label})`);
    } else {
      fail(`${d.key.padEnd(28)} ${before.earned} → ${now.earned} — the defect did not move it`,
           `fixture: ${d.label}. Either the detector is not reading what the mutation changed, or the mutation missed.`);
    }
  }
  let uncovered: string[] = [];
  for (let i = 0; i < CRITERIA.length; i++) if (!covered[CRITERIA[i].key]) uncovered.push(CRITERIA[i].key);
  uncovered.length === 0
    ? pass(`all ${CRITERIA.length} criteria have a defect fixture`)
    : fail(`${uncovered.length} criteria have NO defect fixture: ${uncovered.join(", ")}`,
           "An unfixtured criterion is untested — the house rule exists because one of those was reported closed while wide open.");
}

// ── 3b. The Updated date wins ────────────────────────────────────────────
console.log(`\n3b. Dateline prefers the Updated date`);
{
  const both = withBody(CLEAN_BODY.replace(
    "Published 21 August 2026.",
    "Published 3 January 2025.\n\nUpdated 20 August 2026."
  ));
  const r = computeDraftScores(both);
  let dPts = -1;
  for (let i = 0; i < r.pillars.length; i++)
    for (let c = 0; c < r.pillars[i].criteria.length; c++)
      if (r.pillars[i].criteria[c].key === "dateline-recency") dPts = r.pillars[i].criteria[c].earned;
  // Precondition: the fixture must genuinely carry two dates where the choice
  // changes the outcome — January 2025 is >365 days from NOW, August 2026 is
  // <90. If both dates fell in the same band this would prove nothing.
  dPts === 10
    ? pass("a page with Published Jan-2025 and Updated Aug-2026 scores on the Updated date")
    : fail(`dateline-recency earned ${dPts} — the first date won, so refreshing a page is invisible to the one grade-A signal in the rubric`);
}

// ── 4. Renormalisation ───────────────────────────────────────────────────

console.log(`\n4. Pillars renormalise (fix (c)) — a perfect pillar reaches 100, not its point total`);
{
  // Pillar point totals are deliberately unequal (40/50/60/40/40/75). Under
  // AuthorityOn's Math.min(100, sum) that made a perfect pillar cap below 100.
  let bad = 0;
  for (let i = 0; i < cleanScores.pillars.length; i++) {
    const p = cleanScores.pillars[i];
    let earned = 0, max = 0;
    for (let c = 0; c < p.criteria.length; c++) {
      if (p.criteria[c].skipped) continue;
      earned += p.criteria[c].earned; max += p.criteria[c].maxPoints;
    }
    const expected = max > 0 ? Math.round((earned / max) * 10000) / 100 : 0;
    if (Math.abs(p.score - expected) > 0.011) { bad++; fail(`${p.name}: score ${p.score} != earned/max*100 (${expected})`); }
    if (p.score > 100.01) { bad++; fail(`${p.name}: score ${p.score} exceeds 100`); }
  }
  if (!bad) pass("every pillar score equals earned/applicableMax*100");

  const recomputed = (() => {
    let tot = 0, wbp = 0;
    for (let i = 0; i < cleanScores.pillars.length; i++) {
      let max = 0;
      for (let c = 0; c < cleanScores.pillars[i].criteria.length; c++) if (!cleanScores.pillars[i].criteria[c].skipped) max += cleanScores.pillars[i].criteria[c].maxPoints;
      if (max === 0) continue;
      tot += cleanScores.pillars[i].score * PILLARS[i].weightBp; wbp += PILLARS[i].weightBp;
    }
    return wbp > 0 ? Math.round((tot / wbp) * 100) / 100 : 0;
  })();
  Math.abs(recomputed - cleanScores.overall) < 0.02
    ? pass(`overall (${cleanScores.overall}) is the weighted sum of pillar scores`)
    : fail(`overall ${cleanScores.overall} != independently recomputed ${recomputed}`);
}

// ── 5. Length is never rewarded ──────────────────────────────────────────

console.log(`\n5. Length is not a virtue (measured correlation with citation: 0.04)`);
{
  const doubled = withBody(CLEAN_BODY + "\n\n" + CLEAN_BODY.replace(/^By Dr\. Ilse Brandt\n\n/, "").replace(/^#/gm, "##"));
  const dScore = computeDraftScores(doubled);
  dScore.overall <= cleanScores.overall + 0.5
    ? pass(`doubling the draft does not raise the score (${cleanScores.overall} → ${dScore.overall})`)
    : fail(`doubling the draft RAISED the score ${cleanScores.overall} → ${dScore.overall}`,
           "Some criterion is counting raw volume instead of density.");

  const filler = " Merchants evaluating this category should weigh operational effort against commercial gain, and the right answer depends on the shape of the volume rather than on any vendor claim.";
  const padded = withBody(CLEAN_BODY + "\n\n" + new Array(40).join(filler));
  const pScore = computeDraftScores(padded);
  pScore.overall < cleanScores.overall
    ? pass(`padding with contentless prose lowers the score (${cleanScores.overall} → ${pScore.overall})`)
    : fail(`padding did not lower the score (${cleanScores.overall} → ${pScore.overall})`);
}

// ── 6. Missing context skips, it does not punish ─────────────────────────

console.log(`\n6. Missing context is skipped, not punished`);
{
  const noQueries = withBody(CLEAN_BODY, { targetQueries: [] });
  const nq = computeDraftScores(noQueries);
  const p1 = nq.pillars[0];
  let allSkipped = true;
  for (let i = 0; i < p1.criteria.length; i++) if (!p1.criteria[i].skipped) allSkipped = false;
  allSkipped ? pass("no target query → every Relevance criterion skips with a reason")
             : fail("no target query → Relevance criteria did not all skip");
  // The pillar must leave the WEIGHTING, not score zero. Scoring an
  // unaskable pillar as 0 would cost this draft 22 points of overall for a
  // question nobody asked it — the single most likely wrong implementation
  // of "skip", and the one that makes a score nobody trusts.
  const p1Max = (() => { let m = 0; for (let i = 0; i < p1.criteria.length; i++) m += p1.criteria[i].maxPoints; return m; })();
  p1Max === 0 && nq.overall > 70
    ? pass(`Relevance leaves the weighting entirely (overall ${cleanScores.overall} → ${nq.overall}, not ${(cleanScores.overall * 0.78).toFixed(1)})`)
    : fail(`overall ${nq.overall} — the skipped pillar is being scored as zero rather than excluded`);

  // Declared-unattributed vs the SAME body undeclared. Identical text, two
  // correct answers — which proves skipping is driven by the caller's
  // declaration and not merely by textual absence.
  const strippedBody = CLEAN_BODY
    .replace("By Dr. Ilse Brandt\n\n", "")
    .replace("Dr. Brandt is a certified payments architect and the author of two books on transaction routing.\n\n", "");
  const declared = computeDraftScores(withBody(strippedBody, { unattributed: true, authorName: undefined }));
  const undeclared = computeDraftScores(withBody(strippedBody, { authorName: undefined }));
  let declaredSkipped = true;
  for (let i = 0; i < declared.pillars[4].criteria.length; i++) if (!declared.pillars[4].criteria[i].skipped) declaredSkipped = false;
  declaredSkipped ? pass("declared-unattributed → Authority criteria skip rather than fail")
                  : fail("declared-unattributed → Authority criteria still scored");
  undeclared.overall < declared.overall
    ? pass(`the same body costs points when NOT declared unattributed (${declared.overall} declared vs ${undeclared.overall} undeclared)`)
    : fail(`identical bodies scored ${declared.overall} / ${undeclared.overall} — skip is driven by absence, not declaration`);
}

// ── 6b. Pillar coverage is countable, and the count changes ──────────────
//
// ScorePanel prints "N of 6 pillars scored" over any draft where a pillar
// dropped out, because the headline is a percentage of what COULD be scored
// and a draft with no target query shows a healthy number computed without the
// heaviest pillar in the rubric. Two ways that banner fails silently: it never
// fires (the honesty guarantee is gone and nobody notices, because a missing
// warning looks exactly like nothing being wrong), or it always fires (people
// learn to ignore it and it stops being information). Assert both directions
// against the same count the panel derives.

console.log(`\n6b. Pillar coverage`);
{
  const countScored = (s: ReturnType<typeof computeDraftScores>) => {
    let n = 0;
    for (let i = 0; i < s.pillars.length; i++) {
      let applicable = 0;
      const cs = s.pillars[i].criteria;
      for (let j = 0; j < cs.length; j++) if (!cs[j].skipped) applicable++;
      if (applicable > 0) n++;
    }
    return n;
  };

  const total = cleanScores.pillars.length;
  // The fixture must actually exercise the thing under test: a rubric of one
  // pillar would pass both assertions below while proving nothing.
  total >= 2
    ? pass(`${total} pillars in the rubric`)
    : fail(`only ${total} pillar(s) — this check cannot distinguish full from partial coverage`);

  const cleanCovered = countScored(cleanScores);
  cleanCovered === total
    ? pass(`a fully-briefed draft scores all ${total} pillars — the banner stays silent`)
    : fail(`a fully-briefed draft scored only ${cleanCovered} of ${total} pillars, so the coverage banner would fire on every well-formed piece and be ignored`);

  const imported = computeDraftScores(withBody(CLEAN_BODY, { targetQueries: [] }));
  const importedCovered = countScored(imported);
  importedCovered === total - 1
    ? pass(`imported content with no target query scores ${importedCovered} of ${total} — the banner fires and names the right number`)
    : fail(`no target query scored ${importedCovered} of ${total} pillars, expected ${total - 1}: the panel would print a coverage figure that does not match the pillar list beneath it`);

  // And the number it is printed OVER must genuinely be a partial view, not a
  // whole one that happens to have a pillar missing from the list.
  imported.overall !== cleanScores.overall
    ? pass(`the headline moves when a pillar drops out (${cleanScores.overall} → ${imported.overall})`)
    : fail(`overall is ${imported.overall} either way — a dropped pillar is not reaching the headline at all`);
}

// ── 7. Robustness ────────────────────────────────────────────────────────

console.log(`\n7. Robustness`);
{
  const twice = computeDraftScores(CLEAN);
  JSON.stringify(twice) === JSON.stringify(cleanScores)
    ? pass("scoring the same draft twice is byte-identical")
    : fail("scoring is not deterministic");

  const later = computeDraftScores(withBody(CLEAN_BODY, { now: new Date("2027-10-01T09:00:00Z") }));
  const beforeD = criterionOf(cleanScores, "dateline-recency");
  const afterD = criterionOf(later, "dateline-recency");
  beforeD && afterD && afterD.earned < beforeD.earned
    ? pass(`the clock is injected, not read (dateline ${beforeD.earned} → ${afterD.earned} at +13 months)`)
    : fail("moving `now` forward 13 months did not age the dateline — the engine is reading the real clock somewhere");

  // Word-boundary guard, tested two ways. The first version of this check
  // asserted on keyword-stuffing-guard, which tokenises on whitespace and
  // never calls countTerm — so it passed with the guard deleted. A trap aimed
  // at the wrong criterion is not a trap.
  countTerm("the repayment schedule was prepaid", "payment") === 0 && countTerm("payment terms", "payment") === 1
    ? pass("countTerm: 'repayment'/'prepaid' do not match 'payment'")
    : fail("countTerm is substring-matching — 'repayment' counts as 'payment'");

  // ...and through a criterion that actually calls it: "deleveraged" contains
  // the AI tell "leveraged", so an unguarded match flags legitimate finance prose.
  const trap = withBody(mutate(CLEAN_BODY,
    "The gain concentrates in cross-border volume",
    "Merchants who have deleveraged still see the gain concentrate in cross-border volume"));
  const trapAiTell = criterionOf(computeDraftScores(trap), "ai-tell-guard");
  const cleanAiTell = criterionOf(cleanScores, "ai-tell-guard");
  cleanAiTell && trapAiTell && trapAiTell.earned === cleanAiTell.earned
    ? pass("'deleveraged' is not flagged as the AI tell 'leveraged' (guard holds through the engine)")
    : fail(`substring matching reaches the rubric — ai-tell went ${cleanAiTell ? cleanAiTell.earned : "?"} → ${trapAiTell ? trapAiTell.earned : "?"} on a legitimate word`);

  const degenerate = ["", "Payment orchestration.", "## Only a heading", "word ".repeat(900)];
  let broke = 0;
  for (let i = 0; i < degenerate.length; i++) {
    try {
      const s = computeDraftScores(withBody(degenerate[i]));
      if (isNaN(s.overall) || s.overall < 0 || s.overall > 100) { broke++; fail(`degenerate input ${i} produced overall=${s.overall}`); }
    } catch (e) { broke++; fail(`degenerate input ${i} threw`, String(e)); }
  }
  if (!broke) pass("empty / tiny / heading-only / unpunctuated drafts score without throwing");

  // The live scorer runs on every debounced keystroke.
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) computeDraftScores(CLEAN);
  const ms = (Date.now() - t0) / 50;
  ms < 40 ? pass(`${ms.toFixed(1)}ms per scoring pass (live-typing budget)`) : fail(`${ms.toFixed(1)}ms per pass is too slow for keystroke scoring`);
}

// ── 8. HTML / markdown parity ────────────────────────────────────────────

console.log(`\n8. The same draft scores the same as HTML and as markdown`);
{
  // Drafts arrive as Tiptap HTML from the editor and as markdown from imports.
  // If the two disagree, a writer's score changes when nothing about the words did.
  const html = markdownToHtml(CLEAN_BODY);
  const hScore = computeDraftScores(withBody(html));
  const diff = Math.abs(hScore.overall - cleanScores.overall);
  diff <= 2
    ? pass(`markdown ${cleanScores.overall} vs HTML ${hScore.overall} (within tolerance)`)
    : fail(`markdown ${cleanScores.overall} vs HTML ${hScore.overall} — the two parsers disagree`,
           divergentCriteria(cleanScores, hScore).join(", "));
}

function divergentCriteria(a: ReturnType<typeof computeDraftScores>, b: ReturnType<typeof computeDraftScores>): string[] {
  const out: string[] = [];
  for (let i = 0; i < CRITERIA.length; i++) {
    const ca = criterionOf(a, CRITERIA[i].key), cb = criterionOf(b, CRITERIA[i].key);
    if (ca && cb && ca.earned !== cb.earned) out.push(`${CRITERIA[i].key} ${ca.earned}!=${cb.earned}`);
  }
  return out;
}

/** Markdown inline → HTML. Links MUST become real anchors: without them the
 *  HTML fixture has no citations and the parity check compares two different
 *  drafts while claiming to compare two notations of one. */
function inlineToHtml(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inTable = false, inList = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { if (inList) { out.push("</ul>"); inList = false; } if (inTable) { out.push("</table>"); inTable = false; } continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${h[2]}</h${h[1].length}>`); continue; }
    if (/^\s*\|/.test(line)) {
      if (/^[\s|:-]+$/.test(line)) continue;
      if (!inTable) { out.push("<table>"); inTable = true; }
      const cells = line.split("|").filter((c) => c.trim());
      out.push("<tr>" + cells.map((c) => `<td><p>${c.trim()}</p></td>`).join("") + "</tr>");
      continue;
    }
    // NESTED, because that is what Tiptap actually emits: <li><p>text</p></li>,
    // never a bare <li>. The first version of this helper emitted bare tags,
    // which is why this parity check passed while every list item and table
    // cell written in the real editor was being parsed as plain prose.
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) { if (!inList) { out.push("<ol>"); inList = true; } out.push(`<li><p>${inlineToHtml(ol[1])}</p></li>`); continue; }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li><p>${inlineToHtml(ul[1])}</p></li>`); continue; }
    out.push(`<p>${inlineToHtml(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  if (inTable) out.push("</table>");
  return out.join("\n");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

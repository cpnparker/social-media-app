/**
 * Guards the ship checklist — the twelve pre-publish checks.
 *
 * Run: npx tsx scripts/verify-optimizer-ship-checklist.ts --self-test
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 *
 * Nine of the twelve were already computed somewhere in the product and shown
 * nowhere as a list. Three could not be answered at all. The reason this exists
 * is those three: on a suggestions list an unanswerable item simply does not
 * appear, and an absent row reads as a pass. Here it says what was not looked
 * at and what would be needed to look.
 *
 * So the assertions that matter most are the NEGATIVE ones — that a row nothing
 * can answer never renders as done, and that the surface never totals itself.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * KILLED  a skipped criterion rendering as done                       → check 2
 * KILLED  a skipped criterion showing its own NAME as the verdict     → check 2
 * KILLED  the FAQ row passing on question headings alone              → check 3
 * KILLED  shipCounts collapsing to a single fraction                  → check 5
 * KILLED  a not-checked row omitted rather than shown                 → check 4
 */
import { computeDraftScores } from "../lib/optimizer/engine";
import { parseDraft } from "../lib/optimizer/parse";
import { buildShipChecklist, shipCounts, detectFaqBlock, type ShipRow } from "../lib/optimizer/ship-checklist";

let failures = 0;
const pass = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

const BODY = Array.from({ length: 10 }, (_, i) =>
  `<p>Body paragraph ${i} about the Rosemount project with enough words to read as real prose.</p>`).join("");

const build = (body: string, title: string, hasLivePage = false, brand?: string, auditChecks?: any): ShipRow[] => {
  const scores = computeDraftScores({ body, title, targetQueries: [], format: "article", brandName: brand } as any);
  const p = parseDraft({ body, title });
  return buildShipChecklist({
    scores, text: p.text,
    headings: p.headings.map((h: any) => ({ text: h.text, level: h.level })),
    title, hasLivePage, auditChecks: auditChecks || null,
  });
};
const row = (rows: ShipRow[], n: number) => rows.filter((r) => r.n === n)[0];

// ── 1. Every item is present, always ───────────────────────────────────────
console.log("\n1. The list is complete");
{
  const rows = build(BODY, "A title");
  assert(rows.length === 12, "all twelve rows render");
  const ns = rows.map((r) => r.n).sort((a, b) => a - b).join(",");
  assert(ns === "1,2,3,4,5,6,7,8,9,10,11,12", "numbered 1 to 12, none dropped");
  let missingFrom = 0;
  for (let i = 0; i < rows.length; i++) if (!rows[i].from) missingFrom++;
  assert(missingFrom === 0, "every row names where its answer came from");
}

// ── 2. A skipped criterion is NOT a pass ───────────────────────────────────
console.log("\n2. Skipped is not done");
{
  // No brand configured: anonymous-first-person-facts cannot run.
  const noBrand = row(build(BODY, "T"), 6);
  assert(noBrand.state === "not-checked", "a criterion that could not run renders as NOT CHECKED, never done");
  assert(/not checked/i.test(noBrand.detail) && /brand/i.test(noBrand.detail),
    "and gives the REASON, not the criterion's own name — a title beside a not-checked marker reads as a verdict");

  // WITH A STATISTIC. The criterion also skips on "No statistics to attribute",
  // and a fixture carrying no figure cannot tell a working check from a broken
  // one — it just skips for a different reason and looks identical.
  // The most important row on the list, and the one most likely to say nothing.
  // Counting first-person needs no brand, so a row that cannot SCORE still
  // reports what it can SEE — otherwise the single most valuable recommendation
  // in the source method renders as "not checked" with no signal at all.
  const weHeavy = row(build(
    `<p>We supplied the concrete and our team designed the mix. We did it fast. Our engineers say we can do more. We believe our approach is best. We know our customers agree. We are proud of our work. We think our results speak. We say our mix is good. We claim our carbon is lower. We assert our cost is similar.</p>${BODY}`,
    "T"), 6);
  assert(/\b24\b|\b2[0-9]\b|\btimes\b/.test(weHeavy.detail),
    "with no client attached it still COUNTS the first-person uses rather than reporting nothing");
  assert(weHeavy.state === "attention",
    "and a piece leaning heavily on \"we\" is flagged for attention, not left silent");
  assert(/Attach a client/i.test(weHeavy.detail),
    "and names the one action that makes the real check possible");

  const withBrand = row(build(
    `<p>Amrize supplied the concrete for the Rosemount data center, cutting carbon intensity by 35% at similar cost.</p>${BODY}`,
    "T", false, "Amrize"), 6);
  assert(withBrand.state !== "not-checked", "and it DOES run once a brand exists — the skip is a real condition, not a permanent hole");
}

// ── 3. The FAQ row, which nothing else in the product answers ──────────────
console.log("\n3. FAQ block");
{
  const heads = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `Is this question ${i}?`, index: i }));
  assert(detectFaqBlock([], 0, true).present, "an explicit FAQ label is enough");
  assert(detectFaqBlock([], 0, true).certain, "and it is CERTAIN");

  // Three question headings clustered at the end: an inference, reported as one.
  const late = detectFaqBlock(heads(9).slice(6), 9, false);
  assert(late.present && !late.certain,
    "a late cluster of question headings is present but NOT certain — an article ending on questions is not an FAQ");

  const spread = detectFaqBlock(heads(9).slice(0, 3), 9, false);
  assert(!spread.present, "question headings early in the piece are not an FAQ block");

  const article = build(
    `${BODY}<h3>What is the role of concrete?</h3><p>It is structural.</p>`, "T");
  assert(row(article, 10).state === "missing",
    "an article with no FAQ says MISSING — the one row the rubric never had a criterion for");
  assert(/40-60 word answers|FAQPage/.test(row(article, 10).detail),
    "and says what good looks like, not just that it is absent");
}

// ── 4. What cannot be answered says so ─────────────────────────────────────
console.log("\n4. Not looking, versus looking and finding nothing");
{
  const draft = build(BODY, "T", false);
  for (const n of [2, 11, 12]) {
    const r = row(draft, n);
    assert(r.state === "not-checked", `row ${n} (${r.check}) is NOT CHECKED on a draft, never a pass`);
    assert(/not checked/i.test(r.detail), `row ${n} says so in words`);
  }
  assert(/CMS field/i.test(row(draft, 2).detail) && /Import the published URL/i.test(row(draft, 2).detail),
    "the meta description row names the reason AND the way to answer it");
  assert(/stripped from the draft/i.test(row(draft, 11).detail),
    "the internal-links row names ITS reason: links are discarded before scoring");

  const live = build(BODY, "T", true);
  assert(/Page audit/.test(row(live, 11).detail) && /Page audit/.test(row(live, 12).detail),
    "and on a URL-imported piece they point at the audit that CAN answer them");

  // ── AND ONCE THE AUDIT HAS RUN, THEY READ ITS ANSWER ───────────────────
  //
  // These said "not checked" even on a piece where the audit panel was holding
  // the result — a row claiming not to have looked, beside a panel that had.
  const audited = build(BODY, "T", true, undefined, [
    { id: "meta-description", status: "fail", detail: "no meta description on the page" },
    { id: "internal-link-density", status: "warn", detail: "2 internal links in 1,326 words of article" },
    { id: "schema-present", status: "warn", detail: "no JSON-LD on the page" },
  ]);
  assert(row(audited, 2).state === "missing" && /no meta description/.test(row(audited, 2).detail),
    "the meta description row reports what the audit FOUND, not that it did not look");
  assert(row(audited, 11).state === "attention" && /2 internal links/.test(row(audited, 11).detail),
    "so does the internal-links row");
  assert(row(audited, 12).state === "attention" && /no JSON-LD/.test(row(audited, 12).detail),
    "and the schema row");
  assert(row(audited, 2).from === "live page" && row(audited, 2).via === "meta-description",
    "each cites the audit check it came from, so a row and its source cannot disagree");

  // `info` from the audit means the audit itself did not look. It must NOT
  // become a pass on the way through — that is this file's whole subject.
  const informational = build(BODY, "T", true, undefined, [
    { id: "schema-present", status: "info", detail: "Not checked — could not be read." },
  ]);
  assert(row(informational, 12).state === "not-checked",
    "an audit `info` stays NOT CHECKED — it never launders into done");
}

// ── 5. No total, ever ──────────────────────────────────────────────────────
console.log("\n5. Four numbers, not a fraction");
{
  const rows = build(BODY, "T");
  const c = shipCounts(rows);
  assert(typeof c.done === "number" && typeof c.attention === "number" &&
         typeof c.missing === "number" && typeof c.open === "number",
    "counts come back as four separate states");
  assert(c.done + c.attention + c.missing + c.open === 12, "and they account for every row");
  assert(!("score" in (c as any)) && !("total" in (c as any)) && !("percent" in (c as any)),
    "with NO composite — a missing FAQ and a missing byline are not two of the same unit");
}

// ── 6. The title row reports what it can, and admits what it cannot ────────
console.log("\n6. Title");
{
  const shouty = row(build(BODY, "HOW AI IS CUTTING CARBON FROM CONCRETE AT META"), 1);
  assert(shouty.state === "attention", "a title with no brand name gets attention");
  assert(/no brand name/i.test(shouty.detail), "and says which property failed");
  assert(/working title/i.test(shouty.detail) && /CMS field/i.test(shouty.detail),
    "and states that the PUBLISHED title tag is a field this tool cannot see — the row does not overclaim");

  const long = row(build(BODY, "A".repeat(80) + " Amrize"), 1);
  assert(/over the 60 limit/.test(long.detail), "an over-length title says so");
}

// ── Self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  console.log("\n── self-test: each detector against input it must reject ──");
  let broken = 0;
  const detects = (what: string, fired: boolean) => {
    if (fired) console.log(`  ✓ fires on ${what}`);
    else { broken++; console.log(`  ✗ SILENT on ${what}`); }
  };
  detects("a skipped criterion rendering as done", row(build(BODY, "T"), 6).state === "not-checked");
  detects("a skipped row showing its criterion name", !/Fact-bearing/.test(row(build(BODY, "T"), 6).detail));
  detects("the FAQ row passing on scattered question headings",
    !detectFaqBlock([{ text: "Is it?", index: 0 }], 9, false).present);
  detects("a not-checked row omitted", build(BODY, "T").length === 12);
  detects("a composite creeping into the counts",
    Object.keys(shipCounts(build(BODY, "T"))).join(",") === "done,attention,missing,open");

  if (broken > 0) { console.log(`\n✗ ${broken} detector(s) failed to fire — reporting nothing.`); process.exit(1); }
  console.log("  all detectors fire.");
}

if (process.argv.indexOf("--self-test") >= 0) selfTest();

console.log(failures === 0 ? "\n✓ ship-checklist checks pass\n" : `\n✗ ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);

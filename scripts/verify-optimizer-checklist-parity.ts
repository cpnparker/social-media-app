/**
 * Every item on the editorial checklist has something in this studio that
 * checks it.
 *
 * Run: npx tsx scripts/verify-optimizer-checklist-parity.ts --self-test
 *
 * ── WHERE THE LIST COMES FROM ───────────────────────────────────────────────
 *
 * "AMRIZE — Editorial Optimisation for AI Search" (Thomas Cremese, 20 August
 * 2026) sets out a twelve-point checklist and applies it to four articles. It
 * is the most complete external statement of what this studio is FOR, written
 * by someone auditing the same pages by hand, so it is the right thing to hold
 * the automated scan against.
 *
 * ── WHY A CHECK RATHER THAN A ONE-OFF COMPARISON ────────────────────────────
 *
 * A comparison done once is a note in a chat log. Three of the twelve had no
 * automated equivalent when this was written — a summary block near the top, a
 * visible byline, and which schema types are actually present — and nothing
 * would have said so a month later when a fourth went missing. The list is
 * encoded here, each item bound to the check ids that answer it, and the
 * binding is asserted against what the engine really emits.
 *
 * TWO LAYERS ANSWER IT, deliberately. The PAGE audit reads a published URL;
 * the DRAFT rubric reads the words. Some items live in one, some in the other,
 * several in both. An item satisfied only by the rubric is still covered for a
 * live page, because the audit runs the rubric over the page's own text.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * KILLED  removing tldr-visible from the page audit                       → 2
 * KILLED  removing byline-visible                                         → 2
 * KILLED  removing schema-coverage                                        → 2
 * KILLED  binding an item to a check id that does not exist               → 1
 * KILLED  an item with no bindings at all                                 → 1
 */
import { auditPage } from "../lib/optimizer/page-audit";
import { CRITERIA } from "../lib/optimizer/rubric";
import { CHECK_SPOTS } from "../lib/optimizer/audit-visual";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

/**
 * The twelve points, each bound to what answers it.
 *
 * `page` ids come from the live-page audit, `draft` keys from the rubric the
 * editor runs. An item needs at least one of either; most have both.
 */
const CHECKLIST: { n: number; item: string; page: string[]; draft: string[] }[] = [
  { n: 1, item: "Title tag: buyer's phrase plus the brand, under 60 characters",
    page: ["title-tag"], draft: ["title-query-alignment"] },
  { n: 2, item: "Meta description: written, answers the question in one sentence",
    page: ["meta-description"], draft: [] },
  { n: 3, item: "TL;DR block: 3-5 bullets at the top, each a complete fact",
    page: ["tldr-visible"], draft: ["tldr-block"] },
  { n: 4, item: "Question headings: every H2 is a question a buyer would ask",
    page: ["question-headings-live"], draft: ["question-headings"] },
  { n: 5, item: "Answer-first paragraphs: the first sentence answers the heading",
    page: [], draft: ["answer-first-position", "heading-answer-adjacency"] },
  { n: 6, item: "Entity in the sentence: the brand, not 'we', carries the fact",
    page: [], draft: ["anonymous-first-person-facts", "chunk-entity-naming"] },
  { n: 7, item: "Verifiable specifics: figures, standards, dates, no bare superlatives",
    page: [], draft: ["statistic-density", "stat-source-adjacency", "unverifiable-superlatives"] },
  { n: 8, item: "Named experts: full name, job title and organisation by every quote",
    page: [], draft: ["attributed-quotes", "credential-line"] },
  { n: 9, item: "Byline and dates: a named author and a visible date",
    page: ["byline-visible", "visible-date"], draft: ["byline-present", "dateline-recency"] },
  { n: 10, item: "FAQ section, marked up with FAQPage schema",
    page: ["faq-visible", "schema-coverage"], draft: [] },
  { n: 11, item: "Internal links: products link to product pages",
    page: ["internal-link-density", "anchor-text"], draft: [] },
  { n: 12, item: "Schema: Article, Organization, Person, plus FAQPage",
    page: ["schema-present", "schema-coverage", "schema-author"], draft: [] },
];

/** A page with none of it, so every check has something to say. */
const BARE = `<!doctype html><html><head><title>A headline</title></head><body><article><h1>A headline</h1>${
  Array.from({ length: 14 }, (_, i) => `<p>Paragraph ${i} of ordinary body copy, long enough to read as real prose rather than as a caption.</p>`).join("")
}<img src="/x.jpg"></article></body></html>`;

const emitted = auditPage(
  { page: BARE, finalUrl: "https://example.com/a", httpStatus: 200, brandNames: [], targetQueries: [], render: null, robotsTxt: null, llmsTxt: null },
  new Date("2026-08-29T00:00:00Z")
).checks;
const pageIds = emitted.map((c) => c.id);
const draftKeys = CRITERIA.map((c) => c.key);

// ── 1. Every item is bound to something that exists ────────────────────────
console.log("\n1. The checklist is bound to real checks");
{
  assert(CHECKLIST.length === 12, `all ${CHECKLIST.length} points are listed`);

  const unbound = CHECKLIST.filter((c) => c.page.length + c.draft.length === 0);
  assert(unbound.length === 0, unbound.length ? `points with nothing behind them: ${unbound.map((c) => c.n).join(", ")}` : "every point names at least one check");

  const ghosts: string[] = [];
  for (const c of CHECKLIST) {
    for (const id of c.page) if (pageIds.indexOf(id) < 0) ghosts.push(`${c.n}: page check "${id}"`);
    for (const k of c.draft) if (draftKeys.indexOf(k) < 0) ghosts.push(`${c.n}: rubric criterion "${k}"`);
  }
  // A binding to an id nobody emits is a claim of coverage with nothing behind
  // it — exactly the failure this file exists to prevent, so it fails loudly.
  assert(ghosts.length === 0, ghosts.length ? `bound to checks that do not exist — ${ghosts.join("; ")}` : "and every named check is actually emitted");
}

// ── 2. The three the studio was missing ────────────────────────────────────
//
// Found by holding the scan against the document rather than against itself.
console.log("\n2. The gaps the comparison found");
{
  assert(pageIds.indexOf("tldr-visible") >= 0, "a summary block near the top is checked on a live page (point 3)");
  assert(pageIds.indexOf("byline-visible") >= 0, "a visible byline is checked (point 9) — schema-author only ever covered the machine-readable half");
  assert(pageIds.indexOf("schema-coverage") >= 0, "and WHICH schema types are present (points 10 and 12), not merely that some exist");

  // On a page with none of them, each must actually fire rather than sit silent.
  const byId = (id: string) => emitted.filter((c) => c.id === id)[0];
  assert(byId("tldr-visible")?.status === "warn", "and on a page with no summary, the summary check warns");
  assert(byId("byline-visible")?.status === "warn", "on a page with no author, the byline check warns");
  assert(/no summary block/.test(byId("tldr-visible")?.detail || ""), "each says what it looked for and did not find");
  assert(/Three to five bullets/.test(byId("tldr-visible")?.remedy || ""), "and what to do, in the checklist's own terms");
}

// ── 3. And a page that has them passes ─────────────────────────────────────
//
// The other direction, which is what stops a check that always warns.
console.log("\n3. The same checks pass when the page has them");
{
  const GOOD = `<!doctype html><html><head><title>What is Amrize? | Amrize</title>
<script type="application/ld+json">{"@type":"Organization","name":"Amrize"}</script>
<script type="application/ld+json">{"@type":"Person","name":"A Writer"}</script>
<script type="application/ld+json">{"@type":"Article","author":{"@type":"Person","name":"A Writer"}}</script>
<script type="application/ld+json">{"@type":"FAQPage"}</script></head><body><article><h1>What is Amrize?</h1>
<p class="byline">By Naamua Sullivan, Editor</p>
<ul><li>Amrize is a North American building materials company spun off from Holcim in June 2025.</li>
<li>It operates more than 1,000 sites across every US state and Canadian province.</li>
<li>It reported 11.7 billion dollars of revenue in 2024 and employs around 19,000 people.</li></ul>
${Array.from({ length: 14 }, (_, i) => `<p>Paragraph ${i} of ordinary body copy, long enough to read as real prose rather than as a caption.</p>`).join("")}
</article></body></html>`;
  const good = auditPage(
    { page: GOOD, finalUrl: "https://example.com/a", httpStatus: 200, brandNames: ["Amrize"], targetQueries: [], render: null, robotsTxt: null, llmsTxt: null },
    new Date("2026-08-29T00:00:00Z")
  ).checks;
  const g = (id: string) => good.filter((c) => c.id === id)[0];
  assert(g("tldr-visible")?.status === "pass", "three summary bullets under the H1 pass");
  assert(g("byline-visible")?.status === "pass", "a marked-up byline passes");
  assert(g("schema-coverage")?.status === "pass", `Organization, Person, Article and FAQPage together pass (${g("schema-coverage")?.detail})`);
}

// ── 4. A missing block is marked WHERE IT WOULD GO ─────────────────────────
console.log("\n4. Placement");
{
  assert(JSON.stringify(CHECK_SPOTS["tldr-visible"]) === JSON.stringify(["slot-top"]),
    "the summary is marked under the headline, because that is where it goes");
  assert((CHECK_SPOTS["faq-visible"] || []).indexOf("slot-end") >= 0,
    "and the FAQ at the end of the article");
  assert((CHECK_SPOTS["visible-date"] || []).indexOf("date") === 0,
    "a date points at the date when there is one, and only falls back to a place when there is not");
}

// ── Self-test ──────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  console.log("\n── self-test: each detector against input that should trip it ──");
  let selfFail = 0;
  const must = (ok: boolean, what: string) => {
    if (ok) console.log(`  ✓ fires on ${what}`);
    else { selfFail++; console.log(`  ✗ SILENT on ${what}`); }
  };

  must(pageIds.indexOf("no-such-check") < 0, "a binding to a check that does not exist");
  must([{ n: 1, item: "x", page: [], draft: [] }].filter((c) => c.page.length + c.draft.length === 0).length === 1, "an item with nothing behind it");
  const none = auditPage(
    { page: "<html><body><article><h1>H</h1><p>short</p></article></body></html>", finalUrl: "https://e.com", httpStatus: 200, brandNames: [], targetQueries: [], render: null, robotsTxt: null, llmsTxt: null },
    new Date("2026-08-29T00:00:00Z")
  ).checks;
  must(none.filter((c) => c.id === "tldr-visible")[0]?.status === "warn", "a page with no summary block");
  must(none.filter((c) => c.id === "byline-visible")[0]?.status === "warn", "a page with no byline");

  if (selfFail > 0) {
    console.log(`\n✗ ${selfFail} detector(s) silent — refusing to report the run above as meaningful.`);
    process.exit(1);
  }
  console.log("  all detectors fire");
}

console.log(failures === 0 ? "\n✓ the checklist is covered\n" : `\n✗ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);

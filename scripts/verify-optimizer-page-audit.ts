/**
 * The live-page audit, checked by making it fail.
 *
 * Every check in page-audit.ts is a regex over third-party HTML, and regexes
 * over third-party HTML have a track record in this repo: the failure is never
 * an exception, it is a WRONG VERDICT delivered confidently — "no schema"
 * on a page that has it, "passing" on a page that is noindexed. A wrong audit
 * verdict goes straight to a client conversation, so each check here proves
 * both directions: the defect is caught, and its absence is not.
 *
 * The fixture is ONE good page plus per-check defect variants, mirroring
 * verify-optimizer-rubric's clean-draft-plus-defects shape — because that
 * shape has caught real bugs every time it has been used in this repo.
 *
 *   npx tsx scripts/verify-optimizer-page-audit.ts
 *
 * MUTATION LOG — every entry run in a throwaway git worktree, never the
 * shared tree (`vercel deploy --prod` uploads the working directory).
 *
 *   2026-08-21  noindex detection inverted                 → 1 fail  ✓
 *   2026-08-21  JSON-LD never parsed (schema always absent)→ 1 fail  ✓
 *   2026-08-21  H1 count reads ALL heading levels          → 2 fail  ✓
 *   2026-08-21  filename-as-alt detection removed          → 1 fail  ✓
 *   2026-08-21  brand-in-title check disabled              → 1 fail  ✓
 *   2026-08-21  decorative empty alt counted as a defect   → 1 fail  ✓
 *   (baseline, unmutated: exit 0)
 *
 * The first fixture round also caught the TEST being wrong, not the code:
 * the single-image fixture made a bad alt 100% of images, which is over the
 * proportional fail threshold — expecting "warn" there was the test
 * mis-modelling the rule. The warn band now has its own 1-bad-of-3 case.
 */
import { auditPage } from "../lib/optimizer/page-audit";
import type { PageAuditInput } from "../lib/optimizer/page-audit";

let failures = 0;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };

const NOW = new Date("2026-08-21T12:00:00Z");

/** A page that should pass everything. Everything fictional, as always. */
const GOOD_PAGE = `<!doctype html><html lang="en-US"><head>
<title>Payment Orchestration for Mid-Market Retail | Vaultline</title>
<meta name="description" content="Vaultline routes card transactions across multiple acquirers, lifting authorisation rates around 4% for cross-border retail volume above EUR 5 million.">
<meta property="og:title" content="Payment Orchestration for Mid-Market Retail">
<meta property="og:description" content="How orchestration lifts authorisation rates.">
<meta property="og:image" content="https://vaultline.example/og.png">
<link rel="canonical" href="https://vaultline.example/orchestration">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Payment Orchestration","author":{"@type":"Person","name":"Ilse Brandt"}}</script>
</head><body>
<h1>Payment orchestration for mid-market retail</h1>
<p>Published 20 August 2026 by Dr. Ilse Brandt.</p>
<h2>What is a payment orchestration platform?</h2>
<p>Vaultline is a payment orchestration platform that routes transactions across acquirers.</p>
<img src="/diagram.png" alt="Routing decision flow across three acquirers">
<h3>How the routing decision works</h3>
<p>Each transaction is scored against acquirer performance.</p>
<h2>Frequently asked questions</h2>
<p>How much does orchestration cost? Fees start at eight basis points.</p>
<a href="/pricing">Vaultline pricing by volume tier</a>
</body></html>`;

const BASE: PageAuditInput = {
  page: GOOD_PAGE,
  finalUrl: "https://vaultline.example/orchestration",
  httpStatus: 200,
  brandNames: ["Vaultline"],
};

function statusOf(input: PageAuditInput, id: string): string {
  const r = auditPage(input, NOW);
  const c = r.checks.filter((x) => x.id === id)[0];
  return c ? c.status : "(missing)";
}

// ── 1. The good page passes ──────────────────────────────────────────────
console.log(`\n1. The good page passes everything it should`);
{
  const r = auditPage(BASE, NOW);
  r.counts.fail === 0
    ? pass(`no failing checks on the good page (${r.counts.pass} pass, ${r.counts.warn} warn)`)
    : fail(`${r.counts.fail} check(s) FAIL on a page built to pass: ${r.checks.filter((c) => c.status === "fail").map((c) => c.id).join(", ")}`);
  // The fixture must exercise the checks: schema present, image present, date present.
  GOOD_PAGE.indexOf("ld+json") >= 0 && GOOD_PAGE.indexOf("<img") >= 0 && GOOD_PAGE.indexOf("Published") >= 0
    ? pass("the fixture carries schema, an image and a visible date — the passes are earned, not vacuous")
    : fail("the fixture is missing furniture — its passes prove nothing");
  const counted = r.counts.pass + r.counts.warn + r.counts.fail;
  const nonInfo = r.checks.filter((c) => c.status !== "info").length;
  counted === nonInfo
    ? pass("the tallies add up to the non-info checks")
    : fail(`tallies ${counted} != non-info checks ${nonInfo}`);
}

// ── 2. Each defect flips its check, and only its check ───────────────────
console.log(`\n2. Defects are caught`);
{
  const cases: { id: string; expect: string; label: string; mutate: (p: string) => string }[] = [
    { id: "robots-meta", expect: "fail", label: "a noindex robots meta",
      mutate: (p) => p.replace("<head>", '<head><meta name="robots" content="noindex, nofollow">') },
    { id: "title-tag", expect: "fail", label: "the title tag removed",
      mutate: (p) => p.replace(/<title>[\s\S]*?<\/title>/, "") },
    { id: "title-tag", expect: "warn", label: "the brand stripped from the title",
      mutate: (p) => p.replace("Payment Orchestration for Mid-Market Retail | Vaultline", "Payment Orchestration for Mid-Market Retail") },
    { id: "meta-description", expect: "fail", label: "the meta description removed",
      mutate: (p) => p.replace(/<meta name="description"[^>]*>/, "") },
    { id: "canonical", expect: "warn", label: "the canonical pointing elsewhere",
      mutate: (p) => p.replace('href="https://vaultline.example/orchestration"', 'href="https://vaultline.example/other-page"') },
    { id: "one-h1", expect: "fail", label: "a second H1 added",
      mutate: (p) => p.replace("</body>", "<h1>Another subject entirely</h1></body>") },
    { id: "one-h1", expect: "fail", label: "the H1 removed",
      mutate: (p) => p.replace(/<h1>[\s\S]*?<\/h1>/, "") },
    { id: "heading-hierarchy", expect: "warn", label: "an H2 jumping to an H4",
      mutate: (p) => p.replace("<h3>How the routing decision works</h3>", "<h4>How the routing decision works</h4>") },
    // The page has ONE image, so a bad alt is 100% of images — over the
    // half threshold, and "fail" is the proportional rule working, not
    // harshness. The warn band is tested separately below with 1 bad of 3.
    { id: "image-alt", expect: "fail", label: "the alt text removed from the only image",
      mutate: (p) => p.replace(' alt="Routing decision flow across three acquirers"', "") },
    { id: "image-alt", expect: "fail", label: "a filename as alt on the only image",
      mutate: (p) => p.replace('alt="Routing decision flow across three acquirers"', 'alt="DSC_4031.jpg"') },
    { id: "image-alt", expect: "warn", label: "one bad alt among three images",
      mutate: (p) => p.replace("</body>",
        '<img src="/a.png" alt="Acquirer performance chart, August 2026"><img src="/b.png"></body>') },
    { id: "schema-present", expect: "warn", label: "the JSON-LD removed",
      mutate: (p) => p.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "") },
    { id: "schema-present", expect: "warn", label: "the JSON-LD made unparseable",
      mutate: (p) => p.replace('{"@context"', '{{"@context"') },
    { id: "visible-date", expect: "warn", label: "the visible date removed",
      mutate: (p) => p.replace("Published 20 August 2026 by", "By") },
    { id: "anchor-text", expect: "warn", label: "a click-here anchor",
      mutate: (p) => p.replace(">Vaultline pricing by volume tier<", ">Click here<") },
    { id: "lang", expect: "warn", label: "the lang attribute removed",
      mutate: (p) => p.replace(' lang="en-US"', "") },
  ];
  for (const c of cases) {
    const mutated = c.mutate(GOOD_PAGE);
    if (mutated === GOOD_PAGE) { fail(`${c.label}: the mutation did not change the fixture — nothing was tested`); continue; }
    const got = statusOf({ ...BASE, page: mutated }, c.id);
    got === c.expect
      ? pass(`${c.label} → ${c.id} ${c.expect}`)
      : fail(`${c.label} → ${c.id} expected ${c.expect}, got ${got}`);
  }

  // And a non-200 fetch.
  statusOf({ ...BASE, httpStatus: 404 }, "http-status") === "fail"
    ? pass("a 404 fails the status check")
    : fail("a 404 did not fail the status check");
  statusOf({ ...BASE, finalUrl: "http://vaultline.example/orchestration" }, "http-status") === "fail"
    ? pass("plain http fails the status check")
    : fail("plain http passed");
}

// ── 3. The other direction: absence of the defect is not reported ────────
console.log(`\n3. No false alarms`);
{
  for (const id of ["robots-meta", "title-tag", "meta-description", "one-h1", "schema-present", "visible-date", "image-alt"]) {
    const got = statusOf(BASE, id);
    got === "pass"
      ? pass(`${id} passes on the good page`)
      : fail(`${id} reports ${got} on a page with nothing wrong — a false alarm a client would be told about`);
  }
  // An image with a DELIBERATELY empty alt is decoration, not a defect.
  const decorative = GOOD_PAGE.replace("</body>", '<img src="/spacer.png" alt=""></body>');
  statusOf({ ...BASE, page: decorative }, "image-alt") === "pass"
    ? pass("an empty-alt decorative image is not flagged")
    : fail("a decorative image (empty alt) was flagged — the correct accessibility pattern reads as a defect");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

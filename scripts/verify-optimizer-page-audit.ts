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
 * The 2026-08-24 render and article-scoping layer, mutated the same way:
 *
 *   2026-08-24  no-render branch reports "pass" not "info"  → 2 fail  ✓
 *   2026-08-24  failed render stops reporting its reason    → 1 fail  ✓
 *   2026-08-24  blocked-subrequest guard removed            → 1 fail  ✓
 *   2026-08-24  image checks read the whole page again      → 3 fail  ✓
 *   2026-08-24  broken-image check counts zero-box images   → 1 fail  ✓
 *   2026-08-24  upscaling threshold disabled                → 1 fail  ✓
 *   2026-08-24  render-ran promoted from info to pass       → 3 fail  ✓
 *
 * A NOTE ON THE HARNESS, which produced a false survivor. Forcing
 * renderTrustworthy to a constant makes auditPage THROW on the first fixture
 * (r! is null), so the run exits 1 with no named FAIL line. A harness counting
 * FAIL lines reads that as "the mutation survived" — the exact opposite of the
 * truth. Mutation results are read from the EXIT CODE; the line count is only
 * ever a detail alongside it.
 *
 * A 14-agent adversarial review then confirmed ELEVEN wrong-verdict cases the
 * first fixture could not see, §4 now holds them all: robots content="none"
 * passing (the documented noindex equivalent), a permissive-then-noindex tag
 * pair (first-match read vs most-restrictive-wins), minified unquoted
 * attributes inverting verdicts in both directions at once, a relative
 * self-canonical reported as "points elsewhere", og: via name=, phantom H1s
 * from script templates and comments, the GTM noscript pixel as a standing
 * false alt warning, and data-alt counting as alt. Every one is a wrong
 * verdict delivered confidently — the exact failure an audit must never have,
 * found only by agents told to assume the fixture was blind.
 *
 * The first fixture round also caught the TEST being wrong, not the code:
 * the single-image fixture made a bad alt 100% of images, which is over the
 * proportional fail threshold — expecting "warn" there was the test
 * mis-modelling the rule. The warn band now has its own 1-bad-of-3 case.
 */
import { auditPage } from "../lib/optimizer/page-audit";
import type { PageAuditInput } from "../lib/optimizer/page-audit";
import type { RenderOutcome } from "../lib/optimizer/render";
import { fenceDecision } from "../lib/optimizer/render";

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

// ── 4. The review round: false verdicts the first fixture could not see ──
console.log(`\n4. Adversarial-review cases`);
{
  // content="none" is documented as equivalent to noindex,nofollow.
  statusOf({ ...BASE, page: GOOD_PAGE.replace("<head>", '<head><meta name="robots" content="none">') }, "robots-meta") === "fail"
    ? pass('robots content="none" fails — it deindexes just like noindex')
    : fail('robots content="none" PASSED — a fully deindexed page sails through the audit');

  // A permissive theme tag followed by a plugin-injected noindex: crawlers
  // honour the most restrictive tag; a first-match read honours the first.
  const twoRobots = GOOD_PAGE.replace("<head>", '<head><meta name="robots" content="index, follow"><meta name="robots" content="noindex">');
  statusOf({ ...BASE, page: twoRobots }, "robots-meta") === "fail"
    ? pass("the most restrictive of two robots tags wins")
    : fail("a permissive first robots tag hid a noindex second one — the WordPress-plugin pattern passes");

  // Minified, unquoted attributes: one malformation, verdicts inverted in
  // BOTH directions at once under the quoted-only parser.
  const minified = GOOD_PAGE
    .replace('<html lang="en-US">', "<html lang=en-US>")
    .replace("<head>", "<head><meta name=robots content=noindex>");
  statusOf({ ...BASE, page: minified }, "robots-meta") === "fail"
    ? pass("an unquoted noindex is still seen")
    : fail("an unquoted robots meta was invisible — minified pages pass while deindexed");
  statusOf({ ...BASE, page: minified }, "lang") === "pass"
    ? pass("an unquoted lang attribute is still read")
    : fail("an unquoted lang attribute reads as missing");

  // A relative self-canonical is correct and must not alarm.
  const relCanonical = GOOD_PAGE.replace('href="https://vaultline.example/orchestration"', 'href="/orchestration"');
  statusOf({ ...BASE, page: relCanonical }, "canonical") === "pass"
    ? pass("a relative self-canonical resolves and passes")
    : fail('a relative self-canonical was reported as "points elsewhere" — an alarming claim about a correct page');

  // og: declared via name= is a malformation every OG consumer accepts.
  const ogName = GOOD_PAGE.replace(/property="og:/g, 'name="og:');
  statusOf({ ...BASE, page: ogName }, "og-tags") === "pass"
    ? pass("og tags declared with name= are recognised")
    : fail("working og tags via name= reported missing — the developer is steered to add duplicates");

  // Dead content must not produce phantom structure.
  const scriptH1 = GOOD_PAGE.replace("</body>", '<script>document.write("<h1>phantom</h1>")</script></body>');
  statusOf({ ...BASE, page: scriptH1 }, "one-h1") === "pass"
    ? pass("an <h1> inside a script template is not a second H1")
    : fail("a script-template <h1> counted as a second H1 — client-rendered pages fail falsely");
  const gtmPixel = GOOD_PAGE.replace("</body>", '<noscript><img src="https://tracker.example/px"></noscript></body>');
  statusOf({ ...BASE, page: gtmPixel }, "image-alt") === "pass"
    ? pass("the alt-less GTM noscript pixel is not an image defect")
    : fail("the near-universal GTM noscript pixel raises a standing false alt warning");
  const commentH1 = GOOD_PAGE.replace("</body>", "<!-- <h1>old headline</h1> --></body>");
  statusOf({ ...BASE, page: commentH1 }, "one-h1") === "pass"
    ? pass("a commented-out <h1> is not a second H1")
    : fail("a commented-out <h1> counted as real");

  // data-alt is not alt.
  const dataAlt = GOOD_PAGE.replace('alt="Routing decision flow across three acquirers"', 'data-alt="x"');
  statusOf({ ...BASE, page: dataAlt }, "image-alt") === "fail"
    ? pass("data-alt does not count as alt text")
    : fail("an image with only data-alt passed the alt check");

  // FAQ presence never feeds the pass tally.
  const withFaq = auditPage(BASE, NOW);
  const faqCheck = withFaq.checks.filter((c) => c.id === "faq-visible")[0];
  faqCheck && faqCheck.status === "info"
    ? pass("faq-visible is info in every state — FAQ scoring stays out, as the draft rubric decided")
    : fail(`faq-visible is "${faqCheck ? faqCheck.status : "missing"}" — FAQ presence is leaking into the pass tally`);
}

// ── 5. The render layer, and the honesty rules around it ─────────────────
//
// Every assertion here is about a WRONG VERDICT rather than a crash. The two
// failure modes are opposite and both are worse than saying nothing: claiming
// "no JavaScript gap" when no render ran, and reporting a healthy page's
// hidden navigation as broken images.
console.log(`\n5. Rendering — and never claiming to have looked when it did not`);
{
  // The rendered word count is now derived from the rendered HTML by the SAME
  // function that measures the served page, so a fixture must supply real
  // markup: passing a contentWords number alone no longer influences anything,
  // which is the entire point of the parity fix.
  const renderedHtml = (words: number) =>
    `<!doctype html><html><body><main><h1>R</h1><p>${"word ".repeat(words)}</p></main></body></html>`;
  const renderOk = (over: Partial<RenderOutcome> & { words?: number }): RenderOutcome => ({
    ok: true, html: renderedHtml(over.words ?? 68), finalUrl: BASE.finalUrl, reason: null,
    // 68 is MEASURED, not chosen: it is the word count of GOOD_PAGE's own
    // content region. A default that disagreed with the fixture page made the
    // audit report a huge JavaScript gap — correctly — and the test that
    // caught it was the one asserting render plumbing changes no tally.
    blockedRequests: 0, images: [], renderedWords: 68, contentWords: 68,
    headings: { h1: 1, h2: 2, h3: 3 }, jsonLdBlocks: 1, renderMs: 3000,
    shot: null, spots: [], ...over,
  });
  const statusWith = (render: RenderOutcome | null, id: string) =>
    statusOf({ ...BASE, render }, id);

  // (a) No render at all — the load-bearing honesty case.
  statusWith(null, "js-dependency") === "info"
    ? pass("with no render, the JavaScript check reports INFO, not a pass")
    : fail("a page with NO render was given a verdict on JavaScript dependency — that is a claim nobody checked");

  // (b) A failed render must carry its reason, not a shrug.
  const failed = auditPage({ ...BASE, render: { ...renderOk({}), ok: false, reason: "browser launch failed" } }, NOW);
  const ran = failed.checks.filter((c) => c.id === "render-ran")[0];
  ran && ran.status === "info" && ran.detail.indexOf("browser launch failed") >= 0
    ? pass("a failed render reports WHY it failed")
    : fail("a failed render did not surface its reason");

  // (c) Audit-infrastructure status must never move the reader's to-do tally.
  const noRender = auditPage({ ...BASE, render: null }, NOW);
  const withRender = auditPage({ ...BASE, render: renderOk({}) }, NOW);
  noRender.counts.fail === withRender.counts.fail
    ? pass("render availability does not change the number of blocking findings")
    : fail("the presence of a render changed the fail tally — audit plumbing is leaking into page findings");

  // (d) A real JavaScript gap fails; a page that ships its content passes.
  //     GOOD_PAGE's article region is short, so the rendered figure is what
  //     makes the ratio — a huge rendered body means the HTML carries little.
  statusWith(renderOk({ words: 4000 }), "js-dependency") === "fail"
    ? pass("a page whose content is mostly JavaScript-injected FAILS")
    : fail("a large JavaScript gap was not reported");
  statusWith(renderOk({ words: 80 }), "js-dependency") === "pass"
    ? pass("a page that ships its content in the HTML passes")
    : fail("a server-rendered page was wrongly flagged as JavaScript-dependent");

  // (e) A partly-fenced render must WITHHOLD the measurement rather than
  //     report a comfortable number from an incomplete page.
  statusWith(renderOk({ words: 4000, blockedRequests: 3 }), "js-dependency") === "info"
    ? pass("a render with refused subrequests withholds the JavaScript verdict")
    : fail("a verdict was issued from an incomplete render");

  // (f) THE nav-chrome case. This is the regression that motivated scoping:
  //     hidden menu images that never load are not broken images.
  const img = (o: Partial<RenderOutcome["images"][0]>) => ({
    src: "/x.png", alt: "a thing", width: 100, height: 80,
    naturalWidth: 100, naturalHeight: 80, loaded: true, lazy: false, inContent: true, ...o,
  });
  const hiddenNav = renderOk({
    images: [img({}), img({ inContent: false, width: 0, height: 0, loaded: false })],
  });
  statusWith(hiddenNav, "images-resolve") === "pass"
    ? pass("a hidden, never-loaded navigation image is not counted as broken")
    : fail("hidden nav images were reported as broken — the verdict that would have said 33 broken images on a healthy page");

  // ...and a genuinely broken ARTICLE image still fails.
  statusWith(renderOk({ images: [img({ loaded: false }), img({ loaded: false }), img({})] }), "images-resolve") === "fail"
    ? pass("article images that genuinely fail to load are reported")
    : fail("broken article images were missed");

  // (g) Upscaling is render-only knowledge.
  statusWith(renderOk({ images: [img({ naturalWidth: 400, width: 1200 })] }), "image-resolution") === "warn"
    ? pass("an image displayed far larger than its file is flagged")
    : fail("an upscaled image was not flagged");
  statusWith(renderOk({ images: [img({})] }), "image-resolution") === "(missing)"
    ? pass("...and a correctly-sized image raises nothing")
    : fail("a correctly-sized image produced a resolution warning");
}

// ── 6. Image checks measure the ARTICLE, not the site chrome ─────────────
console.log(`\n6. Article scoping — nav images must not dilute the verdict`);
{
  // The measured shape of the page this was built against: a large captioned
  // navigation wrapped around an article whose own images have no alt text.
  // Unscoped, the nav's alt text drags the proportion under the fail
  // threshold and the page passes while every article image is unlabelled.
  const navImgs = Array.from({ length: 20 }, (_, i) => `<img src="/nav${i}.png" alt="Menu item ${i}">`).join("");
  const page = `<!doctype html><html lang="en"><head><title>Scoped | Vaultline</title>
<meta name="description" content="A page whose navigation is larger than its article, which is the normal case.">
<link rel="canonical" href="https://vaultline.example/scoped"></head><body>
<nav>${navImgs}</nav>
<main><h1>The article</h1><p>${"word ".repeat(120)}</p>
<img src="/a.png"><img src="/b.png"><img src="/c.png"></main>
<footer><img src="/f.png" alt="Footer logo"></footer></body></html>`;

  const r = auditPage({ ...BASE, page, finalUrl: "https://vaultline.example/scoped" }, NOW);
  const alt = r.checks.filter((c) => c.id === "image-alt")[0];
  alt && alt.status === "fail"
    ? pass("three unlabelled article images FAIL even behind twenty captioned nav images")
    : fail(`image-alt was "${alt ? alt.status : "missing"}" — site chrome is still diluting the article's verdict`);
  alt && /3 article image/.test(alt.detail)
    ? pass("the detail counts the article's images, not the page's")
    : fail(`the detail did not report 3 article images: "${alt ? alt.detail : ""}"`);
  alt && /21 nav\/footer images excluded/.test(alt.detail)
    ? pass("and it SAYS what it excluded, so the number can be checked")
    : fail(`the exclusion was silent: "${alt ? alt.detail : ""}"`);

  // The guard on the guard: without a <main>, there is nothing to scope to and
  // the check must fall back rather than silently measure an empty region.
  const noMain = page.replace(/<\/?main>/g, "");
  const r2 = auditPage({ ...BASE, page: noMain, finalUrl: "https://vaultline.example/scoped" }, NOW);
  const alt2 = r2.checks.filter((c) => c.id === "image-alt")[0];
  alt2 && alt2.status !== "info"
    ? pass("a page with no <main> still gets an image verdict rather than silence")
    : fail("removing <main> made the image check evaporate");
}

// ── 7. Wrong verdicts found by a 14-agent adversarial review, 2026-08-24 ──
//
// Every one of these was live in production. None was caught by a check, a
// build or a typecheck, because in each case the CODE was doing what it said —
// it was reading the wrong string, or comparing two numbers that came from
// different definitions.
console.log(`\n7. Regressions from the adversarial review`);
{
  // (a) Commenting a tag out is how a developer disables it. The head was read
  //     from the raw string, so a disabled noindex was reported as live — the
  //     most alarming verdict this file can produce, about a healthy page.
  const commentedNoindex = GOOD_PAGE.replace("<head>", '<head><!-- <meta name="robots" content="noindex"> -->');
  statusOf({ ...BASE, page: commentedNoindex }, "robots-meta") === "pass"
    ? pass("a commented-out noindex is not a live noindex")
    : fail("a DISABLED robots tag was reported as blocking the page from every index");

  // ...and the real one still fails, so the fix did not just blind the check.
  const realNoindex = GOOD_PAGE.replace("<head>", '<head><meta name="robots" content="noindex">');
  statusOf({ ...BASE, page: realNoindex }, "robots-meta") === "fail"
    ? pass("...and a real noindex still fails")
    : fail("the comment fix blinded the noindex check entirely");

  // (b) Same bug, other tag: commented-out JSON-LD counted as schema present.
  const noSchema = GOOD_PAGE.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "");
  const commentedSchema = noSchema.replace("</head>", '<!-- <script type="application/ld+json">{"@type":"Article"}</script> --></head>');
  const sc = auditPage({ ...BASE, page: commentedSchema }, NOW).checks.filter((c) => c.id === "schema-present")[0];
  sc && sc.status !== "pass"
    ? pass("commented-out JSON-LD is not counted as schema")
    : fail("a disabled JSON-LD block was reported as structured data the page has");

  // (c) The two sides of the JavaScript ratio must come from ONE definition.
  //     They did not: this file's regex on one side, render.ts's querySelector
  //     on the other. A page whose <main> the regex accepts but the selector
  //     misses reported a server-rendered page as JavaScript-dependent.
  const article = `<main><h1>T</h1><p>${"word ".repeat(300)}</p></main>`;
  const served = `<!doctype html><html lang="en"><head><title>Parity | Vaultline</title>
<meta name="description" content="A description long enough for the audit to treat it as a real one, naming Vaultline.">
<link rel="canonical" href="https://vaultline.example/parity"></head><body>${article}</body></html>`;
  const renderedSame: RenderOutcome = {
    ok: true, html: served, finalUrl: "https://vaultline.example/parity", reason: null,
    blockedRequests: 0, images: [], renderedWords: 9999,
    // Deliberately a LIE, and the point of the case: the browser-side number
    // disagrees wildly with the served page. If the ratio still uses it, this
    // identical page is reported as JavaScript-dependent.
    contentWords: 9999,
    headings: { h1: 1, h2: 0, h3: 0 }, jsonLdBlocks: 0, renderMs: 1000,
      shot: null, spots: [],
  };
  const parity = auditPage({ ...BASE, page: served, finalUrl: "https://vaultline.example/parity", render: renderedSame }, NOW)
    .checks.filter((c) => c.id === "js-dependency")[0];
  parity && parity.status === "pass"
    ? pass("an identical served and rendered page passes — both sides measured the same way")
    : fail(`identical HTML reported as JavaScript-dependent (${parity ? parity.detail : "missing"}) — the ratio is comparing two different regions`);

  // (d) The address fence must ignore schemes that fetch nothing. Counting a
  //     data: URI as a refusal makes js-dependency withhold its verdict, which
  //     silently disabled the headline check on any page with an inline SVG.
  const cases: [string, string][] = [
    ["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "inert"],
    ["blob:https://x.example/abc", "inert"],
    ["about:blank", "inert"],
    ["https://cdn.example/app.js", "check"],
    ["http://cdn.example/app.js", "check"],
    ["file:///etc/passwd", "refuse"],
    ["chrome-extension://abc/x.js", "refuse"],
    ["not a url at all", "refuse"],
  ];
  let fenceOk = true;
  for (const [url, want] of cases) {
    const got = fenceDecision(url);
    if (got !== want) { fail(`fenceDecision("${url.slice(0, 34)}") = ${got}, expected ${want}`); fenceOk = false; }
  }
  if (fenceOk) pass(`the fence classifies all ${cases.length} scheme cases correctly — data: is inert, file: is refused`);
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

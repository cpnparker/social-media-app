/**
 * Guards the AI-crawler access check, and the page-audit rows added with it.
 *
 * Run: npx tsx scripts/verify-optimizer-crawlers.ts --self-test
 *
 * ── WHY THIS ONE MATTERS MORE THAN ITS SIZE ─────────────────────────────────
 *
 * It is the loudest thing the audit can say. A page can pass every other check
 * — schema, headings, answer position, freshness — and be worth nothing on
 * ChatGPT because robots.txt turns GPTBot away. Until this shipped the audit
 * read the robots META tag, which governs Google's index, and never the robots
 * FILE, which is where AI crawlers are actually refused.
 *
 * Which means a WRONG answer here is expensive in both directions. Telling
 * someone they are blocked when they are not sends them to their
 * infrastructure team for nothing. Telling them they are open when they are
 * blocked is the exact failure the check exists to prevent. Hence the fixture
 * list below: every one is a real robots.txt shape that a naive parser reads
 * backwards.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * KILLED  treating an empty `Disallow:` as a block                    → check 1
 * KILLED  letting `User-agent: *` beat an agent's own group           → check 2
 * KILLED  first-match-wins instead of longest-match                   → check 3
 * KILLED  case-sensitive agent matching                               → check 4
 * KILLED  returning "allowed" when the file was not read              → check 5
 * KILLED  ai-crawler-access reporting `pass` on a null robots.txt     → check 6
 * SURVIVED  removing the `#` comment strip — no fixture depends on a comment
 *           sharing a line with a rule, and real files put them on their own
 *           line. Recorded rather than tidied: it is a finding about the
 *           check's coverage, not a defect in the parser. (Still true of
 *           parseGroups. The SECOND comment strip, in contentLines, is now
 *           covered — §10 has a robots.txt whose comment mentions <html>.)
 *
 * 2026-09-17 — THE NON-ROBOTS BODY (§10, §11, §12). Every mutation applied in a
 * detached worktree, never the shared tree, which deploys.
 *
 * KILLED  crawlerAccess parsing a body that is not a robots file   → §4, §10, §11
 * KILLED  bodyIsMarkup answering false for an AEM soft-404         → §10, §11
 * KILLED  the soft-404 row rendering the not-read wording instead  → §11
 * KILLED  the not-checked row counted as a pass                    → §6, §11
 * KILLED  the row no longer naming the address to go and open      → §11
 * KILLED  notRobotsReason condemning an EMPTY / comments-only file → §4, §10
 * KILLED  markup judged before the comment strip                   → §10
 * KILLED  directives judged before markup                          → §10
 * KILLED  the `no-directives` arm deleted                          → §10
 * KILLED  bodyIsMarkup losing the element-name rule                → §10
 * KILLED  the studio route keeping a private markup test           → §12
 * KILLED  the inline audit keeping a private markup test           → §12
 *
 * Two of those were earned rather than predicted, and both are findings about
 * the CHECK:
 *
 *   "directives judged before markup" SURVIVED its first run. The fixture was
 *   a page mentioning "Disallow: /" mid-sentence, which no directive test
 *   recognises — the field before the colon is "<p>a line reading disallow" —
 *   so the page was refused as markup whichever rule ran first, and the
 *   fixture tested nothing about the order it was written for. The <pre> block
 *   in §10 replaced it.
 *
 *   "bodyIsMarkup losing the element-name rule" SURVIVED for the same shape of
 *   reason: every fixture tripped three or four of the markup rules at once.
 *   The meta-refresh stub trips exactly one.
 *
 * SURVIVED  bodyIsMarkup losing the doctype rule.
 * SURVIVED  bodyIsMarkup losing the closing-tag rule.
 *           The three remaining markup rules overlap on every REAL body: an
 *           AEM soft-404 has a doctype AND an <html> tag AND closing tags, so
 *           deleting any one of them changes no verdict here. That is a
 *           property of the subject — the predicate is deliberately
 *           belt-and-braces — rather than a gap to be closed with three
 *           contrived fixtures. Recorded so the next reader knows the rules
 *           are pinned as a SET and not individually, and so that anyone who
 *           deletes one on the grounds that "the check still passes" has been
 *           told in advance that it would. (The first-line rule is no longer
 *           among them: §10b's autolink and banner fixtures pin it.)
 *
 * 2026-09-17, SECOND PASS — what the first pass's own checks could not see.
 * Three defects, all found by re-reading the checks rather than the code, and
 * every mutation below run in a detached worktree at HEAD + the diff.
 *
 * KILLED  crawlerAccess parsing a non-robots body (the live defect,     → §4, §10, §11
 *         re-run against the rewritten predicate: 19 red)
 * KILLED  ANY recognised word before a colon accepted as a robots file  → §10
 *         — the old rule, under which an echo of the request headers
 *         (`Host:`, `User-Agent:`) and the prose "Sitemap: not available
 *         on this server, sorry" both parsed into "allows all 6 AI
 *         crawlers checked on this path"
 * KILLED  the sitemap-only branch removed                               → §10
 * KILLED  the seam dropping llms.txt on the BROAD predicate             → §10b, §12
 *         — a real llms.txt carrying a <script> example or a <details>
 *         block was being reported as absent
 * KILLED  the seam flattening a non-robots robots body to null          → §12
 * KILLED  one caller re-implementing the seam (the exact divergence     → §12
 *         the old §12 passed green: the studio route flattening while
 *         the inline audit did not)
 * KILLED  bodyIsServedPage back to any first-line angle bracket         → §10b
 * KILLED  the HTML-comment exception removed                            → §10b
 * KILLED  the shared seam reaching the network with a bare fetch        → §12
 * KILLED  the inline audit fetching /robots.txt itself again            → §12
 *
 * THE ONE TO READ is the seam divergence, because the old §12 asserted a LINE
 * and this one asserts a VALUE. Renaming the route's binding and re-flattening
 * the body satisfied /siteFile\("\/robots\.txt"\)/ and /robotsTxt,/ perfectly
 * while the two audits printed different sentences about the same site. The
 * answer was to delete the sibling rather than to write a cleverer regex:
 * there is now ONE seam (lib/optimizer/site-files.ts), §12 drives it with
 * fixture bodies through its `read` parameter, and what is left for the source
 * to prove is an ABSENCE — that neither caller has grown a private copy back.
 * That absence assertion is what kills the divergence mutation, and it is
 * honest work for a regex in a way that "this line still exists" is not.
 */
import { crawlerAccess, notRobotsReason, bodyIsMarkup, bodyIsServedPage, AI_CRAWLERS } from "../lib/optimizer/crawler-access";
import { auditPage } from "../lib/optimizer/page-audit";
import { fetchSiteFiles } from "../lib/optimizer/site-files";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/**
 * Source assertions must not be satisfied by a COMMENT about the thing.
 *
 * The opener is line-anchored on purpose. The obvious /\/\*[\s\S]*?\*\// is
 * fooled by a `/*` inside a string literal — an Accept header of
 * "…application/pdf,*&#47;*;q=0.8" is enough — and it then deletes whichever
 * code sits between there and the next `*&#47;`. That produced a red assertion
 * in the sibling url check about code that was present and correct; the same
 * mangling on an assertion phrased the other way round would have been a
 * silent green.
 */
const stripComments = (src: string) =>
  src.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

let failures = 0;
const pass = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

const verdictFor = (robots: string | null, token: string, path = "/") => {
  const v = crawlerAccess(robots, path);
  if (!v) return null;
  return v.filter((x) => x.token === token)[0] || null;
};

// ── 1. An empty Disallow means ALLOW ───────────────────────────────────────
console.log("\n1. The empty Disallow");
{
  const robots = "User-agent: *\nDisallow:";
  const v = verdictFor(robots, "GPTBot");
  assert(!!v && v.allowed,
    "`Disallow:` with no value allows everything — reading it as a block inverts the answer");

  const blocked = verdictFor("User-agent: *\nDisallow: /", "GPTBot");
  assert(!!blocked && !blocked.allowed, "`Disallow: /` blocks everything");
}

// ── 2. A named group beats the wildcard ────────────────────────────────────
console.log("\n2. Groups");
{
  const robots = "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n";
  const gpt = verdictFor(robots, "GPTBot");
  const claude = verdictFor(robots, "ClaudeBot");
  assert(!!gpt && gpt.allowed && gpt.via === "own-group",
    "a site that blocks everything then allows GPTBot is ALLOWING GPTBot");
  assert(!!claude && !claude.allowed && claude.via === "wildcard",
    "and still blocking the ones with no group of their own");

  const shared = "User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n";
  assert(!verdictFor(shared, "GPTBot")!.allowed && !verdictFor(shared, "ClaudeBot")!.allowed,
    "consecutive User-agent lines share the rules beneath them");
}

// ── 3. Longest match wins, Allow wins a tie ────────────────────────────────
console.log("\n3. Rule resolution");
{
  const robots = "User-agent: *\nDisallow: /\nAllow: /blog/\n";
  assert(verdictFor(robots, "GPTBot", "/blog/post")!.allowed,
    "a longer Allow beats a shorter Disallow — first-match-wins gets this backwards");
  assert(!verdictFor(robots, "GPTBot", "/pricing")!.allowed,
    "and the Disallow still applies everywhere else");

  const tie = "User-agent: *\nDisallow: /docs\nAllow: /docs\n";
  assert(verdictFor(tie, "GPTBot", "/docs/x")!.allowed, "Allow wins an exact tie");
}

// ── 4. Case, comments, junk ────────────────────────────────────────────────
console.log("\n4. Real files are messy");
{
  assert(!verdictFor("user-agent: gptbot\ndisallow: /", "GPTBot")!.allowed,
    "agent and field names match case-insensitively");
  assert(verdictFor("# nothing here\n\n", "GPTBot")!.allowed,
    "a file with no groups allows by default — the standard's own answer");
  assert(verdictFor("", "GPTBot")!.allowed, "an empty file allows");
  // THIS ASSERTION USED TO READ THE OTHER WAY, and it was the bug written down
  // as a requirement: "junk parses to no rules rather than throwing", asserting
  // that `<html><body>404</body></html>` allows every crawler. Not throwing was
  // the right half; answering "allowed" was the whole live defect. See §10.
  assert(crawlerAccess("<html><body>404</body></html>", "/") === null,
    "junk does not throw — and does not parse to a cheerful set of passes either");
  const all = crawlerAccess("User-agent: *\nDisallow: /", "/");
  assert(!!all && all.length === AI_CRAWLERS.length, "every registered crawler gets a verdict");
}

// ── 5. Not read is NOT allowed ─────────────────────────────────────────────
console.log("\n5. Not looking, versus looking and finding nothing");
assert(crawlerAccess(null, "/") === null,
  "a robots.txt that could not be read returns null, never a set of passes");

// ── 6. The check reports that difference on screen ─────────────────────────
console.log("\n6. The audit row");
{
  const page = "<html><head><title>T</title></head><body><h1>H</h1><p>x</p></body></html>";
  const base = { page, finalUrl: "https://example.com/a", httpStatus: 200 };

  const notRead = auditPage({ ...base, robotsTxt: null }, new Date());
  const row = notRead.checks.filter((c) => c.id === "ai-crawler-access")[0];
  assert(!!row && row.status === "info", "an unread robots.txt reports INFO, never pass");
  assert(!!row && /not checked/i.test(row.detail) && /not the same as/i.test(row.detail),
    "and says so in words — that is the whole point of the row");

  const blocked = auditPage({ ...base, robotsTxt: "User-agent: GPTBot\nDisallow: /" }, new Date());
  const brow = blocked.checks.filter((c) => c.id === "ai-crawler-access")[0];
  assert(!!brow && brow.status === "fail", "a blocked crawler FAILS — it is not a warning");
  assert(!!brow && /GPTBot/.test(brow.detail) && /ChatGPT/.test(brow.detail),
    "naming the crawler AND who it feeds, because one of those means something to a marketer");

  const open = auditPage({ ...base, robotsTxt: "User-agent: *\nAllow: /" }, new Date());
  const orow = open.checks.filter((c) => c.id === "ai-crawler-access")[0];
  assert(!!orow && orow.status === "pass", "an open robots.txt passes");

  // The path matters: a blanket allow with one blocked directory must not
  // report the whole site blocked.
  const scoped = auditPage(
    { ...base, finalUrl: "https://example.com/blog/x", robotsTxt: "User-agent: *\nDisallow: /private/" },
    new Date()
  );
  assert(scoped.checks.filter((c) => c.id === "ai-crawler-access")[0].status === "pass",
    "the verdict is for THIS page's path, not the site as a whole");
}

// ── 7. Schema against the visible copy ─────────────────────────────────────
console.log("\n7. Schema versus copy");
{
  const withSchema = (ld: string, body: string) =>
    `<html><head><title>T</title><script type="application/ld+json">${ld}</script></head><body><h1>Head</h1>${body}</body></html>`;

  const agree = auditPage(
    { page: withSchema('{"@type":"Article","datePublished":"2026-08-01"}', "<p>Published 1 August 2026. Text.</p>"), finalUrl: "https://e.com/a", httpStatus: 200 },
    new Date()
  ).checks.filter((c) => c.id === "schema-copy-consistency")[0];
  assert(agree.status === "pass", "schema and copy that agree pass");

  const disagree = auditPage(
    { page: withSchema('{"@type":"Article","datePublished":"2023-01-01"}', "<p>Published 1 August 2026. Text.</p>"), finalUrl: "https://e.com/a", httpStatus: 200 },
    new Date()
  ).checks.filter((c) => c.id === "schema-copy-consistency")[0];
  assert(disagree.status === "warn", "a schema year that contradicts the visible year WARNS");
  assert(/2023/.test(disagree.detail) && /2026/.test(disagree.detail),
    "and quotes both, so the reader can see which to fix");
  assert(disagree.status !== "fail",
    "never FAIL — every comparison here has a legitimate exception, and a check that cries wolf gets skipped");

  // The one that stops it crying wolf.
  const headline = auditPage(
    { page: withSchema('{"@type":"Article","headline":"A different headline"}', "<p>Text.</p>"), finalUrl: "https://e.com/a", httpStatus: 200 },
    new Date()
  ).checks.filter((c) => c.id === "schema-copy-consistency")[0];
  assert(headline.status === "pass",
    "a schema headline differing from the H1 does NOT change the status — that is normal practice");
  assert(/headline differs/i.test(headline.detail), "it is reported as detail only");

  const none = auditPage(
    { page: "<html><body><h1>H</h1><p>x</p></body></html>", finalUrl: "https://e.com/a", httpStatus: 200 },
    new Date()
  ).checks.filter((c) => c.id === "schema-copy-consistency")[0];
  assert(none.status === "info" && /no schema/i.test(none.detail),
    "with no schema it reports NOT CHECKED, rather than passing a comparison it never made");
}

// ── 8. Internal links are counted in the article, and honest about direction ─
console.log("\n8. Internal link density");
{
  const body = `<article>${"<p>word word word word word word word word word word.</p>".repeat(40)}
    <p><a href="/one">one</a> <a href="https://example.com/two">two</a>
       <a href="https://elsewhere.com/x">out</a> <a href="#frag">frag</a>
       <a href="mailto:a@b.c">mail</a></p></article>`;
  const nav = `<nav>${'<a href="/n">n</a>'.repeat(50)}</nav>`;
  const r = auditPage(
    { page: `<html><body>${nav}${body}</body></html>`, finalUrl: "https://example.com/a", httpStatus: 200 },
    new Date()
  ).checks.filter((c) => c.id === "internal-link-density")[0];
  assert(/\b2\b/.test(r.detail),
    "counts 2 internal links: the relative one and the absolute SAME-HOST one, which parse.ts would call external");
  assert(!/\b52\b/.test(r.detail), "and not the 50 in the nav — the article is the unit");
  assert(/site tree/.test(r.detail),
    "and states plainly that it does not know direction — up, sideways or down needs the site tree");
}

// ── 9. URL hygiene ─────────────────────────────────────────────────────────
console.log("\n9. URL shape");
{
  const at = (u: string) =>
    auditPage({ page: "<html><body><h1>H</h1></body></html>", finalUrl: u, httpStatus: 200 }, new Date())
      .checks.filter((c) => c.id === "url-hygiene")[0];
  assert(at("https://e.com/cement-products").status === "pass", "a clean slug passes");
  assert(at("https://e.com/Cement-Products").status === "warn", "mixed case warns");
  assert(at("https://e.com/2019/03/post").status === "warn", "a date in the path warns");
  assert(at("https://e.com/index.php?id=166747").status === "warn", "a numeric id warns");
  assert(/only you can make/i.test(at("https://e.com/Bad").remedy || ""),
    "and it says which property it is NOT judging — stability is a human call");
}

// ── 10. A body that is not a robots file is not an open robots file ────────
//
// THE LIVE DEFECT. Temasek's /robots.txt answers 200 with a 67KB AEM soft-404:
// the site has no robots file at all. crawlerAccess read that page as "a file
// with no rules in it" and returned every crawler allowed via "default", and
// the panel printed "robots.txt allows all 6 AI crawlers checked on this path"
// — the exact sentence this module's header says it exists to prevent, printed
// on the strength of a megamenu.
//
// The fixtures are the real shapes, because the shapes are the point: a CMS
// soft-404, a CDN challenge, a CDN denial page. And the two near-empty files
// that must keep reading as OPEN, because over-correcting here invents a block
// nobody wrote, which is the expensive error in the other direction.
console.log("\n10. The body has to be a robots file");
{
  // An AEM soft-404, as Temasek serves one: a full page, title and all.
  const AEM_SOFT_404 = `<!DOCTYPE HTML>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page Not Found | Temasek</title>
<link rel="stylesheet" href="/etc.clientlibs/temasek/clientlibs/clientlib-base.lc-6f3b.min.css">
<script src="/etc.clientlibs/core/wcm/components/commons/site/clientlibs/container.lc-0a9c.min.js"></script>
</head>
<body class="page basicpage">
<nav class="cmp-navigation"><ul><li><a href="/en/who-we-are">Who We Are</a></li>
<li><a href="/en/what-we-do">What We Do</a></li><li><a href="/en/news-and-resources">News &amp; Resources</a></li></ul></nav>
<main class="root container"><h1>We can't find that page</h1>
<p>The page you are looking for may have moved. Try our search.</p></main>
<footer><p>&copy; 2026 Temasek Holdings (Private) Limited</p></footer>
</body>
</html>`;

  // Cloudflare's interstitial. Served 403 with cf-ray, and served at any path
  // — including /robots.txt, which is how this one reaches the parser.
  const CF_CHALLENGE = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>
<meta http-equiv="refresh" content="390"><meta name="robots" content="noindex,nofollow"></head>
<body class="no-js"><div class="main-wrapper" role="main">
<div id="challenge-error-text">Enable JavaScript and cookies to continue</div></div>
<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>`;

  // Akamai's Access Denied, the 491-byte one measured on temasek.com.sg.
  const AKAMAI_DENIED = `<HTML><HEAD>
<TITLE>Access Denied</TITLE>
</HEAD><BODY>
<H1>Access Denied</H1>

You don't have permission to access "http&#58;&#47;&#47;www&#46;temasek&#46;com&#46;sg&#47;robots&#46;txt" on this server.<P>
Reference&#32;&#35;18&#46;5d4c2f17&#46;1757999123&#46;9a1b4c2<P>
https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18&#46;5d4c2f17&#46;1757999123&#46;9a1b4c2
</BODY>
</HTML>`;
  assert(AKAMAI_DENIED.length < 600,
    `the Akamai fixture stays the tiny page it really is (${AKAMAI_DENIED.length} bytes) — a body this small is part of the signature`);

  assert(crawlerAccess(AEM_SOFT_404, "/en/x") === null,
    "an AEM soft-404 at /robots.txt is NOT a robots file — it returns null, not six passes");
  assert(crawlerAccess(CF_CHALLENGE, "/") === null, "nor is a Cloudflare challenge page");
  assert(crawlerAccess(AKAMAI_DENIED, "/") === null, "nor is Akamai's Access Denied page");
  assert(notRobotsReason(AEM_SOFT_404) === "markup" && notRobotsReason(AKAMAI_DENIED) === "markup",
    "and each is refused as MARKUP, so the row can say which kind of nothing it got");

  // Not-HTML junk. A JSON error body and a plain-text soft-404 both carry no
  // directive at all, and both used to read as a permissive file.
  assert(crawlerAccess('{"error":"not found","status":404}', "/") === null,
    "a JSON error body is not a robots file either");
  assert(notRobotsReason("Page not found. Please try the search.") === "no-directives",
    "nor is a plain-text soft-404 — no markup, and no directive either");

  // A redirect stub: a line of text, then a meta refresh, and nothing else.
  // Added because mutation testing showed the four markup rules overlap on
  // every other fixture — this body trips ONE of them (the element list) and
  // no other, so the rule is pinned rather than merely present. It is also the
  // shape a load balancer serves at /robots.txt while a site is being moved.
  const REDIRECT_STUB = "Redirecting...\n<meta http-equiv=\"refresh\" content=\"0;url=/en/\">\n";
  assert(notRobotsReason(REDIRECT_STUB) === "markup",
    "a meta-refresh stub is markup even with a line of plain text in front of it");

  // THE TWO LEGITIMATE NEAR-EMPTY FILES. Both really do allow everything, and
  // reading either as junk would invent a block on a site that wrote none.
  assert(crawlerAccess("", "/") !== null && verdictFor("", "GPTBot")!.allowed,
    "a genuinely EMPTY robots.txt is a robots file, and an open one");
  assert(crawlerAccess("   \n\n\t\n", "/") !== null, "whitespace only, the same");
  const commentsOnly = "# robots.txt managed by platform-ops\n# last reviewed 2026-05-01\n\n# no rules on purpose\n";
  assert(crawlerAccess(commentsOnly, "/") !== null && verdictFor(commentsOnly, "GPTBot")!.allowed,
    "a COMMENTS-ONLY robots.txt is a robots file, and an open one");
  assert(notRobotsReason("# see <html> for the page that explains this\nUser-agent: *\nDisallow:\n") === null,
    "a comment mentioning markup does not condemn the file it documents — comments are stripped first");

  // CONTENT TYPE IS NOT CONSULTED, and this is the fixture that states which
  // way that call went. A robots.txt served as text/html with real directives
  // in it reads as a ROBOTS FILE: static hosts mislabel plain-text files all
  // the time, the directives are unambiguous evidence, and refusing it would
  // report a site with a perfectly good robots.txt as unreadable — the
  // crying-wolf direction of the same error. Markup still beats directives, so
  // the mislabelled-but-real file is accepted while a PAGE that happens to
  // contain the word "Disallow:" is not.
  const MISLABELLED = "User-agent: *\nDisallow: /private/\nSitemap: https://example.com/sitemap.xml\n";
  assert(notRobotsReason(MISLABELLED) === null,
    "a real robots.txt served as text/html is still a robots file — the bytes decide, not the header");
  assert(!verdictFor(MISLABELLED, "GPTBot", "/private/x")!.allowed && verdictFor(MISLABELLED, "GPTBot", "/blog/x")!.allowed,
    "and its rules are honoured, which is the whole reason not to throw it away");
  // A page that QUOTES a robots.txt, one directive per line, inside a <pre>.
  // The obvious fixture — a paragraph mentioning "Disallow: /" mid-sentence —
  // does not test this at all: the field before the colon is then "<p>a line
  // reading disallow", which no directive test recognises, so the page is
  // refused as markup whichever rule runs first. This shape is the one that
  // tells the two orders apart, and it is not contrived: a docs page showing a
  // sample robots.txt is exactly what a CMS search-and-soft-404 serves.
  const PAGE_QUOTING_ROBOTS = `<!doctype html><html><head><title>How we configure crawlers</title></head>
<body><article><h1>Our robots.txt, explained</h1>
<pre>
User-agent: *
Disallow: /admin/
Sitemap: https://example.com/sitemap.xml
</pre>
</article></body></html>`;
  assert(notRobotsReason(PAGE_QUOTING_ROBOTS) === "markup",
    "a PAGE quoting a robots.txt line for line is still markup — markup is judged BEFORE directives");
  assert(crawlerAccess(PAGE_QUOTING_ROBOTS, "/admin/x") === null,
    "and its quoted rules are never honoured as if the site had written them");

  // A SITEMAP-ONLY robots.txt. A real shape — sites that block nothing often
  // serve exactly this — and the one the directive rule must not condemn.
  assert(notRobotsReason("Sitemap: https://example.com/sitemap.xml\n") === null,
    "a sitemap-only robots.txt is a robots file, and an open one");
  assert(verdictFor("Sitemap: https://example.com/sitemap.xml\n", "GPTBot")!.allowed,
    "and reads as allowing everything, because that is what it says");

  // A RECOGNISED WORD BEFORE A COLON IS NOT EVIDENCE. Both of these used to be
  // accepted as robots files on one matching field name, parsed into no rules,
  // and printed as "robots.txt allows all 6 AI crawlers checked on this path".
  assert(notRobotsReason("Host: www.example.com\nUser-Agent: curl/8.4.0\nAccept: */*\n") === "no-directives",
    "an echo of the request headers is not a robots file — a User-Agent line with no rules under it proves nothing");
  assert(crawlerAccess("Host: www.example.com\nUser-Agent: curl/8.4.0\nAccept: */*\n", "/") === null,
    "and it is refused rather than parsed into six cheerful passes");
  assert(notRobotsReason("Sitemap: not available on this server, sorry\n") === "no-directives",
    "nor is a sentence that happens to begin with the word Sitemap — the standard says that value is a URL");

  // An S3-style XML error. No doctype, no element this predicate lists by
  // name: the FIRST-LINE rule is the only one that catches it, which is what
  // pins that rule rather than leaving it overlapping with the other three.
  const S3_ERROR = '<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>';
  assert(notRobotsReason(S3_ERROR) === "markup",
    "an XML error document is markup too — a declaration on the first line is a document, not a file");
}

// ── 10b. What the llms.txt seam may throw away ─────────────────────────────
//
// llms.txt has no downstream judge: its row reports a word count and nothing
// else, so a web page served at that address is dropped at the fetch seam or
// 67KB of megamenu is reported as a present llms.txt of 9,000 words.
//
// Which makes the predicate it is dropped on a live risk in the OTHER
// direction, and this section is that risk written down. An llms.txt is
// MARKDOWN. Real ones carry `<br>`, `<details>`, an `<img>` badge, a `<script>`
// tag inside an embed example — and the broad robots predicate reads every one
// of those as a page, reporting a file that is present and correct as absent.
// Two predicates, then, and these fixtures are the reason there are two.
console.log("\n10b. A markdown llms.txt is not a web page");
{
  const LLMS_WITH_HTML = `# Example Corp

> Tools and docs for Example Corp.

Embed the widget with:

    <script src="https://example.com/w.js"></script>

<details><summary>Older versions</summary>

- [v1 guide](https://example.com/v1)

</details>

## Docs
- [Guide](https://example.com/guide): how to start
`;
  assert(bodyIsServedPage(LLMS_WITH_HTML) === false,
    "a real llms.txt carrying a <script> example and a <details> block SURVIVES — markdown is allowed to contain tags");
  assert(bodyIsMarkup(LLMS_WITH_HTML) === true,
    "while the broad robots predicate condemns it — which is exactly why the seam uses the narrow one");

  // THE TWO SHAPES THAT PIN THE FIRST-LINE RULE, both of which open with an
  // angle bracket and neither of which is a document. A bracket alone used to
  // be enough, and it condemned both.
  const LLMS_AUTOLINK = "<https://example.com/docs>\n\n# Example Corp\n- [Guide](https://example.com/guide)\n";
  assert(bodyIsServedPage(LLMS_AUTOLINK) === false,
    "one whose first line is a markdown autolink survives — an angle bracket is not a tag, and `https:` is not a tag name");
  const LLMS_BANNER = "<!-- generated by docs-build, do not edit -->\n# Example Corp\n\n- [Guide](https://example.com/guide)\n";
  assert(bodyIsServedPage(LLMS_BANNER) === false,
    "and so does one opening with a generator banner — an HTML comment is not a doctype");

  const MEGAMENU = `<!DOCTYPE HTML>\n<html lang="en"><head><title>Page Not Found</title></head>\n<body><nav><ul><li><a href="/en">Home</a></li></ul></nav><main><h1>We can't find that page</h1></main></body></html>`;
  assert(bodyIsServedPage(MEGAMENU) === true,
    "a soft-404 page at /llms.txt is still dropped — that is the fact the narrow predicate must keep");
  assert(bodyIsServedPage('<?xml version="1.0"?>\n<Error><Code>NoSuchKey</Code></Error>') === true,
    "and so is an XML error document");
  assert(bodyIsServedPage("") === false, "an empty body is not a page — it is nothing, and the row says so");
}

// ── 11. The verdict on screen, which is where the defect was visible ───────
//
// The parser returning null is necessary and not sufficient: the defect a
// reader met was a SENTENCE. So this asserts the rendered string, and asserts
// the two INFO states are told apart — "we never saw it answer" and "it
// answered with a web page" are different facts with different next steps.
console.log("\n11. What the panel says about a soft-404 robots.txt");
{
  const page = "<html><head><title>T</title></head><body><h1>H</h1><p>x</p></body></html>";
  const base = { page, finalUrl: "https://www.temasek.com.sg/en/news-and-resources/stories/future/alt-assets", httpStatus: 200 };
  const soft404 = `<!DOCTYPE HTML>\n<html lang="en"><head><title>Page Not Found | Temasek</title></head>\n<body><nav><a href="/en">Home</a></nav><main><h1>We can't find that page</h1></main></body></html>`;

  const row = auditPage({ ...base, robotsTxt: soft404 }, new Date()).checks.filter((c) => c.id === "ai-crawler-access")[0];
  assert(!!row && row.status === "info", "a soft-404 body reports INFO — never pass, and never fail");
  assert(!/allows all/i.test(row.detail),
    "THE SENTENCE IS GONE: the panel no longer claims robots.txt allows all 6 AI crawlers");
  assert(/answered with a web page/i.test(row.detail) && /not a robots file/i.test(row.detail),
    "it says what the address actually answered with");
  assert(/not the same as being open/i.test(row.detail),
    "and keeps the line that makes the difference plain");
  assert(row.detail.indexOf("https://www.temasek.com.sg/robots.txt") >= 0,
    "naming the address the reader should open, on the site's own origin rather than the page's path");
  assert(/\bcould not be read\b/i.test(row.detail) === false,
    "and it is NOT flattened into the not-read wording — that is a different fact");
  assert(/no robots\.txt does leave crawlers unrestricted/i.test(row.remedy || ""),
    "the remedy states the honest possibility without asserting it — a page at that address is not evidence either way");

  // THE OTHER ARM OF THE PREDICATE, rendered. Until this was added the
  // "no robots directives in it" wording was pinned by the parser's return
  // value alone — the thinner of the two arms, and the sentence nobody had
  // read. The body is the header echo from §10, which used to pass as a file.
  const noDirectives = auditPage(
    { ...base, robotsTxt: "Host: www.example.com\nUser-Agent: curl/8.4.0\nAccept: */*\n" }, new Date()
  ).checks.filter((c) => c.id === "ai-crawler-access")[0];
  assert(noDirectives.status === "info" && !/allows all/i.test(noDirectives.detail),
    "a body with no directives in it is INFO too, and never 'allows all'");
  assert(/no robots directives in it/i.test(noDirectives.detail),
    "and says which kind of nothing it got — a body, not a page, and not a file either");
  assert(noDirectives.detail.indexOf("https://www.temasek.com.sg/robots.txt") >= 0,
    "naming the same address to go and open");

  // The other INFO state still reads as itself.
  const unread = auditPage({ ...base, robotsTxt: null }, new Date()).checks.filter((c) => c.id === "ai-crawler-access")[0];
  assert(/could not be read/i.test(unread.detail), "a file that was never read still says so");
  assert(unread.detail !== row.detail, "the two INFO states are distinguishable on screen");

  // And an INFO never lands in the pass column.
  const counts = auditPage({ ...base, robotsTxt: soft404 }, new Date()).counts;
  const passing = auditPage({ ...base, robotsTxt: "User-agent: *\nAllow: /" }, new Date()).counts;
  assert(passing.pass === counts.pass + 1,
    "the soft-404 costs the page exactly the pass a real open robots.txt would have earned — it is not counted");
}

// ── 12. One fetch seam, and what it actually hands the judge ──────────────
//
// THIS SECTION USED TO TEST THAT A LINE EXISTED, and it was wrong in the way
// this repo keeps being wrong. There were two seams — the studio route and the
// inline chat audit — and §12 read both files and asserted a regex matched in
// each. Renaming one seam's binding and re-flattening a soft-404 robots body to
// null satisfied every regex, type-checked clean, and left the two audits
// printing different sentences about the same site: the inline one said "answered
// with a web page, not a robots file", the studio one said "could not be read".
// A fix in one path and not its sibling, green.
//
// The subject changed rather than the assertion. There is now ONE seam,
// lib/optimizer/site-files.ts, and both callers call it — so the two cannot
// disagree, and the interesting question becomes what the seam RETURNS. That is
// a value, and `read` lets a fixture supply the bodies without a network. What
// is left for the source to answer is an ABSENCE: that neither caller has grown
// a private copy of the seam back. Absence is a thing a source check can
// honestly prove.
async function seamChecks() {
  console.log("\n12. The one fetch seam, driven with fixture bodies");

  const AEM_SOFT_404 = `<!DOCTYPE HTML>\n<html lang="en"><head><title>Page Not Found | Temasek</title></head>\n<body><nav><a href="/en">Home</a></nav><main><h1>We can't find that page</h1></main></body></html>`;
  const LLMS_WITH_HTML = "# Example Corp\n\nEmbed with:\n\n    <script src=\"https://example.com/w.js\"></script>\n\n## Docs\n- [Guide](https://example.com/guide)\n";
  const PAGE_URL = "https://www.temasek.com.sg/en/news-and-resources/stories/future/alt-assets";
  const serve = (files: { [path: string]: string | null }) =>
    async (path: string) => (path in files ? files[path] : null);

  // The live case. Both addresses answer 200 with a web page.
  const soft = await fetchSiteFiles(PAGE_URL, { read: serve({ "/robots.txt": AEM_SOFT_404, "/llms.txt": AEM_SOFT_404 }) });
  assert(soft.robotsTxt === AEM_SOFT_404,
    "the robots body reaches the judge AS FETCHED — flattening it here would make a soft-404 indistinguishable from a timeout");
  assert(soft.llmsTxt === null,
    "while a web page at /llms.txt is dropped, because that row has no judge — only a word count");

  // The other direction, which is the one an over-eager seam breaks.
  const real = await fetchSiteFiles(PAGE_URL, {
    read: serve({ "/robots.txt": "User-agent: *\nDisallow: /private/\n", "/llms.txt": LLMS_WITH_HTML }),
  });
  assert(real.llmsTxt === LLMS_WITH_HTML,
    "a markdown llms.txt carrying a <script> example is kept — reporting a present file as absent is the same error inverted");
  assert(real.robotsTxt === "User-agent: *\nDisallow: /private/\n", "and a real robots.txt is untouched");

  const missing = await fetchSiteFiles(PAGE_URL, { read: serve({}) });
  assert(missing.robotsTxt === null && missing.llmsTxt === null,
    "a file that could not be read is null — never an empty string, which parses as an OPEN robots file");

  // END TO END: the seam's own output through the judge, which is where the
  // defect was visible. This is the assertion the old §12 could not make.
  const row = auditPage(
    { page: "<html><head><title>T</title></head><body><h1>H</h1></body></html>",
      finalUrl: PAGE_URL, httpStatus: 200, robotsTxt: soft.robotsTxt, llmsTxt: soft.llmsTxt },
    new Date()
  ).checks.filter((c) => c.id === "ai-crawler-access")[0];
  assert(row.status === "info" && /answered with a web page/i.test(row.detail),
    "and what the seam hands over renders as the soft-404 sentence, not as six passes and not as 'could not be read'");

  // The absence assertions. A caller that fetched for itself again, or passed
  // its own reader, would be a sibling — and siblings drift.
  const seams = [
    "app/api/optimizer/sessions/[id]/audit/route.ts",
    "lib/optimizer/inline-audit.ts",
  ];
  for (let i = 0; i < seams.length; i++) {
    const src = stripComments(read(seams[i]));
    const where = seams[i];
    assert(/fetchSiteFiles\(/.test(src), `${where} reads the site's files through the shared seam`);
    assert(src.indexOf("/robots.txt") < 0 && src.indexOf("/llms.txt") < 0,
      `${where} does not fetch either file itself — the paths live in one place`);
    assert(!/bodyIsMarkup\(|bodyIsServedPage\(|<html\|<!doctype/i.test(src),
      `${where} carries no markup test of its own — one rule, in one place`);
    assert(!/fetchSiteFiles\([^)]*read\s*:/.test(src),
      `${where} does not pass its own reader, which would be the sibling growing back`);
    assert(/robotsTxt,/.test(src), `${where} hands the robots body to the judge`);
  }
  // The seam itself: through safeFetch, like every other outbound request. The
  // fixture reader above deliberately bypasses the network, so this is the one
  // fact only the source can still answer.
  const seamSrc = stripComments(read("lib/optimizer/site-files.ts"));
  assert(/safeFetch\(/.test(seamSrc) && !/[^a-zA-Z]fetch\(/.test(seamSrc.replace(/safeFetch\(/g, "")),
    "and the seam's own fetch goes through safeFetch — a second unguarded path is a second SSRF surface");
  assert(/bodyIsServedPage\(/.test(seamSrc) && !/bodyIsMarkup\(/.test(seamSrc),
    "and it drops llms.txt on the NARROW predicate, so markdown carrying tags survives");

  // And the judge is wired to the same predicate, rather than re-deciding.
  const audit = stripComments(read("lib/optimizer/page-audit.ts"));
  assert(/notRobotsReason\(/.test(audit) && /crawler-access/.test(audit),
    "page-audit asks crawler-access which kind of nothing it received");
}

// ── Self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  console.log("\n── self-test: each detector against input it must reject ──");
  let broken = 0;
  const detects = (what: string, fired: boolean) => {
    if (fired) console.log(`  ✓ fires on ${what}`);
    else { broken++; console.log(`  ✗ SILENT on ${what}`); }
  };

  detects("an empty Disallow read as a block",
    verdictFor("User-agent: *\nDisallow:", "GPTBot")!.allowed === true);
  detects("the wildcard overriding an agent's own group",
    verdictFor("User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /", "GPTBot")!.allowed === true);
  detects("first-match-wins instead of longest-match",
    verdictFor("User-agent: *\nDisallow: /\nAllow: /blog/", "GPTBot", "/blog/x")!.allowed === true);
  detects("case-sensitive agent matching",
    verdictFor("user-agent: gptbot\ndisallow: /", "GPTBot")!.allowed === false);
  detects("an unread file reported as allowed", crawlerAccess(null, "/") === null);
  {
    const page = "<html><head><title>T</title></head><body><h1>H</h1><p>x</p></body></html>";
    const row = auditPage({ page, finalUrl: "https://e.com/a", httpStatus: 200, robotsTxt: null }, new Date())
      .checks.filter((c) => c.id === "ai-crawler-access")[0];
    detects("the audit row passing on a robots.txt it never read", row.status === "info");
  }
  // The live defect, from both ends: the parser's answer and the sentence.
  detects("a web page read as an open robots file",
    crawlerAccess("<!DOCTYPE HTML><html><body><h1>Not found</h1></body></html>", "/") === null);
  detects("a body with no directives read as an open robots file",
    crawlerAccess('{"error":"not found"}', "/") === null);
  {
    const row = auditPage(
      { page: "<html><body><h1>H</h1></body></html>", finalUrl: "https://e.com/a", httpStatus: 200,
        robotsTxt: "<!DOCTYPE HTML><html><body>Not found</body></html>" },
      new Date()
    ).checks.filter((c) => c.id === "ai-crawler-access")[0];
    detects("the panel claiming a soft-404 allows every crawler",
      row.status === "info" && !/allows all/i.test(row.detail));
  }
  // And the other direction, which is the one an over-eager predicate breaks.
  detects("an empty robots.txt condemned as junk", crawlerAccess("", "/") !== null);
  detects("a comments-only robots.txt condemned as junk",
    crawlerAccess("# nothing to see\n# really\n", "/") !== null);
  detects("a real robots.txt condemned for its content type",
    notRobotsReason("User-agent: *\nDisallow: /private/\n") === null);
  detects("an echo of the request headers read as an open robots file",
    crawlerAccess("Host: www.example.com\nUser-Agent: curl/8.4.0\nAccept: */*\n", "/") === null);
  detects("a sitemap-only robots.txt condemned as junk",
    notRobotsReason("Sitemap: https://example.com/sitemap.xml\n") === null);
  detects("a markdown llms.txt condemned as a web page",
    bodyIsServedPage("# Corp\n\n    <script src=\"x.js\"></script>\n\n- [Guide](https://e.com/g)\n") === false);
  detects("a soft-404 page kept as a present llms.txt",
    bodyIsServedPage("<!DOCTYPE HTML><html><body><h1>Not found</h1></body></html>") === true);
  {
    const row = auditPage(
      { page: "<html><body><h1>H</h1></body></html>", finalUrl: "https://e.com/a", httpStatus: 200,
        robotsTxt: "Host: www.example.com\nUser-Agent: curl/8.4.0\n" },
      new Date()
    ).checks.filter((c) => c.id === "ai-crawler-access")[0];
    detects("the panel claiming a directive-free body allows every crawler",
      row.status === "info" && /no robots directives/i.test(row.detail));
  }

  detects("a headline mismatch counted against the page",
    auditPage(
      { page: '<html><head><script type="application/ld+json">{"@type":"Article","headline":"X"}</script></head><body><h1>Y</h1></body></html>', finalUrl: "https://e.com/a", httpStatus: 200 },
      new Date()
    ).checks.filter((c) => c.id === "schema-copy-consistency")[0].status === "pass");

  if (broken > 0) { console.log(`\n✗ ${broken} detector(s) failed to fire — reporting nothing.`); process.exit(1); }
  console.log("  all detectors fire.");
}

seamChecks().then(() => {
  if (process.argv.indexOf("--self-test") >= 0) selfTest();
  console.log(failures === 0 ? "\n✓ crawler-access checks pass\n" : `\n✗ ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
});

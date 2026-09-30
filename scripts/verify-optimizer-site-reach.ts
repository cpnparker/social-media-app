/**
 * Guards the three findings about the FETCH rather than the page: a site that
 * refuses non-browser clients, a site with no robots.txt, and an address that
 * lands on somebody else's site.
 *
 * Run: npx tsx scripts/verify-optimizer-site-reach.ts --self-test
 *
 * ── WHY THESE THREE, AND WHY NONE OF THEM IS A FAIL ─────────────────────────
 *
 * Measured on 2026-09-17 against /robots.txt on all 77 client hosts in
 * app_clients. 57 serve a real robots file. Then:
 *
 *   5 REFUSE a plain HTTP client with 403 — www.iso.org, hydrogencouncil.com,
 *     www.holcim.com, orsted.com, www.bp.com;
 *   6 answer 200 or 202 with something that is NOT a robots file, and those six
 *     turned out to be three different situations, which is why this is three
 *     findings and not one:
 *       3 have MOVED DOMAIN — cyberpeaceinstitute.org → protect.ngo,
 *         www.myovant.com → www.us.sumitomo-pharma.com, holcimmaqer.com →
 *         holcimmaqerventures.com — homepage and all, so every other
 *         measurement on the page describes a different organisation;
 *       2 are a CDN CHALLENGE DRESSED AS SUCCESS — www.zurich.com answers 200
 *         with 212 bytes of Imperva challenge, www.ieee.org answers 202 with a
 *         zero-byte body;
 *       1 is a GENUINE SOFT-404 — www.temasek.com.sg redirects internally to
 *         /en/site-services/404-error and serves 67KB with a 200.
 *   3 return a clean 404, 1 is empty, 1 answers 405, 4 are unreachable.
 *
 * NONE of the three findings is a FAIL, and that is the panel's own rule rather
 * than timidity: telling someone they are blocked when they are not sends them
 * to their infrastructure team for nothing. From out here we can prove that WE
 * were refused. We cannot prove that GPTBot was, because Akamai and Cloudflare
 * both let a customer allow-list AI crawlers by user-agent plus reverse-DNS and
 * the only way to see that list is to impersonate those crawlers. So the
 * refusal row's remedy is a QUESTION, and this file asserts that it stays one.
 *
 * ── THE LIVE DEFECT THIS CLOSED ─────────────────────────────────────────────
 *
 * readSiteFile accepted any 2xx, so www.ieee.org's 202-with-zero-bytes arrived
 * as the empty string — and an empty robots.txt is a REAL and OPEN robots file,
 * correctly so. The panel therefore printed "robots.txt allows all 6 AI
 * crawlers checked on this path" about a site that had served it nothing at
 * all: the exact sentence crawler-access.ts says it exists to prevent, one
 * commit after that sentence was supposed to be gone. §4 is red without the
 * fix.
 *
 * ── AND THE ONE THAT WAS FOUND BY MEASURING RATHER THAN BY THINKING ─────────
 *
 * The 200-challenge test cannot simply look for a CDN's marks in the body.
 * Shopify's real robots.txt contains `Disallow: /cdn-cgi/challenge-platform*`
 * and the New York Times' contains `/athletic/cdn-cgi/`. Of fourteen real
 * robots.txt files pulled while this was built, two carried a Cloudflare mark
 * and one of those carried the exact challenge-platform string — one in seven
 * would have been condemned as a CDN block and reported as a site refusing AI
 * crawlers. The answer is not a cleverer mark: it is that a body which parses
 * as DIRECTIVES is a robots file whatever strings are inside it, so
 * auditRefusal asks notRobotsReason first. §3 pins that with the real lines.
 *
 * ── THE SAME LESSON, TWICE MORE, ON THE PAGE PATH ───────────────────────────
 *
 * A page has no notRobotsReason to save it, and the first version of this had
 * no other gate: the marks were read straight off any 2xx body. Driven with
 * real pages rather than with walls, that reported a CDN challenge about two
 * pages the audit was scoring in the same breath.
 *
 *   CLOUDFLARE PUTS ITS CHALLENGE PATH ON HEALTHY PAGES. JS Detections injects
 *   `/cdn-cgi/challenge-platform/scripts/jsd/main.js` into ordinary 200 HTML.
 *   The path means "behind Cloudflare", not "refused by Cloudflare".
 *
 *   AND A PAGE CAN BE ABOUT THE THING. An article explaining Error 1020 prints
 *   "Access denied" and a reference id because that is its subject — and the
 *   old pairing answered "Akamai", which is not even the vendor it was reading
 *   about.
 *
 * So the page path now asks two questions instead of one: a mark that is a
 * machine artefact NOTHING ELSE WRITES, and a body that is not a document. §2b
 * takes those apart one at a time, with the same mark in a short body and in a
 * long one.
 *
 * ── AND TWO STATUSES THE AUDIT DELIBERATELY WILL NOT REPORT ─────────────────
 *
 * A 429 is a moment, not a posture: it clears on the next run, and an unbranded
 * one may be the site's own per-account limiter. A 503 is an outage — and the
 * one status where the vendor marks actively mislead, because every
 * Cloudflare-proxied origin's own maintenance page links /cdn-cgi/ assets. Both
 * still reach the IMPORTER, which is explaining something to somebody standing
 * there watching it happen; neither becomes a standing sentence in a report.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 * Every mutation applied in a DETACHED WORKTREE (git worktree add --detach),
 * never the shared tree, which deploys.
 *
 * KILLED  readSiteFileResponse back to `if (!res.ok) return null` — the live   → §4
 *         defect, ieee.org's 202 arriving as "" and the panel printing
 *         "robots.txt allows all 6 AI crawlers checked on this path"
 * KILLED  readSiteFileResponse classifying nothing at all                      → §4
 * KILLED  the empty-body rule widened from `status !== 200` to any 2xx —       → §3, §4
 *         which condemns www.ifpma.org's genuinely empty robots.txt
 * KILLED  the notRobotsReason gate removed from auditRefusal — Shopify's       → §3
 *         real robots.txt reported as a Cloudflare challenge
 * KILLED  botWallVendor losing the `_Incapsula_Resource` mark                  → §2, §3
 * KILLED  botWallVendor losing the entity decode (Akamai's body)               → §2
 * KILLED  the broad Cloudflare marks moved INTO botWallVendor — "Just a        → §2
 *         moment" is a sentence a person can write, and botWallVendor is the
 *         read that may be asked about a body nobody refused (it feeds
 *         cdnBlockVendor, which has a failing status behind it; the 200 path
 *         is challengeVendor, below)
 * KILLED  sameSite falling back to false instead of comparing registrable      → §1
 *         domains — news.bbc.co.uk and www.bbc.co.uk read as two sites
 * KILLED  registrableDomain taking two labels always — temasek.com.sg and      → §1
 *         singtel.com.sg become the same site
 * KILLED  registrableDomain losing the address-literal guard                   → §1
 * KILLED  sameSite treating an unknown host as a move                          → §1
 * KILLED  hostOf losing its try/catch (a stored ref that is not a URL)         → §1
 * KILLED  site-redirect pushed after the content rows instead of first         → §5d
 * KILLED  site-redirect raised to `fail`                                       → §5c
 * KILLED  crossSiteRedirect ignoring where the robots request landed           → §5c
 * KILLED  edge-refusal raised to `warn`                                        → §5a
 * KILLED  robots-txt-present raised to `warn`                                  → §5b
 * KILLED  the refusal remedy rewritten as an assertion ("AI crawlers are       → §5a
 *         blocked at the edge. Tell the CDN team…") rather than a question
 * KILLED  the caveat dropped from the refusal detail                           → §5a
 * KILLED  edgeRefusal reading only the PAGE refusal, dropping the robots one   → §5a
 * KILLED  robots-txt-present firing when the edge refused                      → §5b
 * KILLED  robots-txt-present firing when the robots fetch crossed hosts        → §5b
 * KILLED  robots-txt-present losing the "leaves every crawler unrestricted"    → §5b
 *         sentence — the asymmetry is the finding
 * KILLED  a 401 with WWW-Authenticate classified as an edge refusal            → §3
 * KILLED  ai-crawler-access losing the "refused this request" wording          → §4
 * KILLED  the inline card losing the site-redirect hoist                       → §6
 * KILLED  the studio route dropping requestedUrl                               → §7
 * KILLED  the inline audit dropping requestedUrl                               → §7
 * KILLED  the inline audit dropping the refusals                               → §7
 *
 * ── THE REVIEW ROUND: WHAT IT PRINTED ABOUT PAGES THAT WERE FINE ────────────
 *
 * Every line below is a false claim the first version made, reproduced against
 * the real code before it was fixed. They are grouped because they are one
 * family: a row that says "we could not reach this properly" is only worth
 * printing if it is silent when we did.
 *
 * KILLED  challengeVendor replaced by botWallVendor — an ordinary article      → §2b, §3
 *         carrying Cloudflare's JS Detections script reported as a challenge
 *         page, and an article ABOUT Error 1020 attributed to Akamai
 * KILLED  challengeVendor keeping the marks but losing the document gate       → §2b
 * KILLED  challengeVendor taking the bare cdn-cgi/challenge-platform path      → §3
 * KILLED  the notRobotsReason gate removed — re-proved against a robots.txt    → §3
 *         that disallows /_Incapsula_Resource, since Shopify's file no longer
 *         matches the narrowed marks and had stopped testing the gate
 * KILLED  auditRefusal taking 429 and 503 again — a rate limit and a           → §3
 *         maintenance page reported as bot management, with the CDN question
 * KILLED  204 No Content read as a wall rather than as an empty file           → §3, §4
 * KILLED  robots-txt-present ignoring a refused PAGE — Temasek, the one host   → §5b
 *         in the 77 that raises this row, printed "refused by Akamai's bot
 *         management" and "nothing redirected and nothing refused" two rows
 *         apart in the same run
 * KILLED  robots-txt-present firing on a moved site                            → §5b
 * KILLED  the "nothing redirected and nothing refused" clause unscoped from    → §5b
 *         the /robots.txt request back to the whole panel
 * KILLED  the hedge dropped — an unbranded interstitial at /robots.txt told    → §5b
 *         to publish the file it is hiding
 * KILLED  the row named "The site publishes a robots.txt", which is the        → §5b
 *         opposite of what it fires on
 * KILLED  "a Imperva challenge page" — the article agreement, in the sentence  → §5a
 *         that fires for zurich.com and prints in the client's report
 * KILLED  the empty arm claiming a cause ("which is bot management accepting   → §5a
 *         the request and serving nothing") from "accepted, not answered"
 * KILLED  the branded 403 sentence dropping the vendor                         → §5a
 * KILLED  the regional corroboration removed — a .com routing to .co.uk        → §5c
 *         flagged as a site that has moved, on every run, forever
 * KILLED  every move called regional                                           → §5c
 * KILLED  a leftover RSS or stylesheet link to the old domain accepted as a    → §5c
 *         locale claim, which would swallow the row on a half-migrated site
 * KILLED  the robots-arm remedy emptied                                        → §5c
 * KILLED  the refusal and the redirect pushed in the other order, proved with  → §5d
 *         a fixture where the address BOTH moved and was refused — no fixture
 *         had both, so "reported BEFORE the others" was unpinned in exactly
 *         the case it is for
 * KILLED  the status row's "redirected from" emptied — newly live behaviour,   → §5f
 *         since the dead field it replaced was never read
 * KILLED  edge-refusal not marked `measured`                                   → §6
 * KILLED  the chat card's notes carrying names only                            → §6
 * KILLED  the render sentence unconditional again — "The site refuses          → §6
 *         non-browser clients" listed as a gap in the audit and blamed on a
 *         browser render, which is where the caveat was being lost
 * KILLED  PageAuditCard printing the note's name without its detail            → §6
 *
 * Fourteen of the entries above the divider were re-run after the restructuring
 * and all fourteen still die where they died before.
 *
 * TWO OF THOSE WERE EARNED RATHER THAN PREDICTED, and both are findings about
 * the check rather than the code.
 *
 *   The FIRST line above SURVIVED on its first run. §4 drove fetchSiteFiles
 *   through its `read` test seam, which is the right seam for asserting what
 *   the two callers receive — and which walks straight past the code that reads
 *   a real response. Restoring the exact live defect changed nothing and every
 *   assertion stayed green: a test seam that bypasses the thing under test is a
 *   check that silently tests nothing, which is this repo's other recorded
 *   failure mode. The answer was to split readSiteFileResponse out as a pure
 *   function and assert on IT, with the status and the body as data.
 *
 *   "registrableDomain losing the address-literal guard" also survived first
 *   time round, for the ordinary reason: no fixture used an IP. One was added.
 *
 * Both survivors below were re-run after the restructuring and both still
 * survive, for the reasons already recorded.
 *
 * SURVIVED  narrowing `error\s*(code:)?\s*10\d\d` to `error 1020`. Every
 *           Cloudflare fixture here and in the sibling url check uses 1020 or
 *           1015, and both still match. Recorded rather than closed: the range
 *           is deliberate because Cloudflare's block codes run 1006–1030, and
 *           writing a fixture for 1009 would pin my guess at their numbering
 *           rather than anything measured. A reader who narrows it on the
 *           grounds that the check stays green has been told in advance that
 *           it would.
 * SURVIVED  removing the subdomain escape from sameSite. Every host in these
 *           fixtures — www→apex, m.→apex, news.bbc.co.uk, cybathlon.ethz.ch —
 *           is already answered by the registrable-domain comparison, so the
 *           escape changes no verdict here. That is a property of the rule
 *           rather than a gap: for a child and its parent the last two labels
 *           are identical, so both take the same number of labels and reach
 *           the same answer, and the escape can only matter for a host with
 *           fewer labels than the rule takes — `docs.intranet` against
 *           `intranet`, which safeFetch would refuse to resolve anyway. It is
 *           kept as defence for a comparison this file openly calls a
 *           heuristic, and recorded so that deleting it is a decision rather
 *           than a tidy-up.
 */
import {
  botWallVendor, challengeVendor, registrableDomain, sameSite, hostOf, type SiteRefusal,
} from "../lib/optimizer/site-reach";
import { auditRefusal, classifyFetchRefusal } from "../lib/optimizer/url-import";
import { fetchSiteFiles, readSiteFileResponse } from "../lib/optimizer/site-files";
import { auditPage, type AuditCheck } from "../lib/optimizer/page-audit";
import { buildInlineAudit, inlineAuditForModel } from "../lib/optimizer/inline-audit";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Source assertions must not be satisfied by a COMMENT about the thing. The
 *  opener is line-anchored for the reason the sibling check records: a bare
 *  /\*[\s\S]*?\*&#47;/ is fooled by a `/*` inside a string literal. */
const stripComments = (src: string) =>
  src.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

let failures = 0;
const pass = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const assert = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

const hdr = (h: { [k: string]: string }) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

// ── THE REAL SHAPES ────────────────────────────────────────────────────────
//
// Each of these is a body somebody's site actually served on 2026-09-17, at the
// length it served it. The lengths matter: a challenge page is tiny and a
// soft-404 is not, and a fixture written as a paraphrase of one has already
// cost this repo a rule that could not fire on the body it was written for.

/** www.zurich.com/robots.txt — 200, text/html, Imperva's challenge at the
 *  measured 212 bytes. The resource token is synthetic; the marks are not. */
const IMPERVA_CHALLENGE =
  '<html style="height:100%"><head><META NAME="ROBOTS" CONTENT="NOINDEX, NOFOLLOW">' +
  '<script src="/_Incapsula_Resource?SWJIYLWA=8f3c1b2d4e5a6f7089ab0cd1e2f3a4b5c6d7e8f9" async>' +
  "</script></head><body></body></html>";

/** www.ieee.org/robots.txt — 202 Accepted, CloudFront, and nothing at all. */
const IEEE_EMPTY = "";

/** www.temasek.com.sg/robots.txt — 200, 67KB of AEM soft-404. Trimmed to its
 *  shape: what matters is that it is an ordinary page with no CDN mark on it. */
const AEM_SOFT_404 = `<!DOCTYPE HTML>
<html lang="en" class="no-js">
<head><meta charset="utf-8"><title>Page Not Found | Temasek</title>
<link rel="stylesheet" href="/etc.clientlibs/temasek/clientlibs/clientlib-base.lc-6f3b.min.css"></head>
<body class="page basicpage">
<nav class="cmp-navigation"><ul><li><a href="/en/who-we-are">Who We Are</a></li></ul></nav>
<main class="root container"><h1>We can't find that page</h1>
<p>The page you are looking for may have moved. Try our search.</p></main>
<footer><p>&copy; 2026 Temasek Holdings (Private) Limited</p></footer>
</body></html>`;

/** Akamai's Access Denied, the 491-byte one measured on temasek.com.sg. Its
 *  reference id and error URL are numeric entities, which is why the decode
 *  exists at all. */
const AKAMAI_DENIED = `<HTML><HEAD>
<TITLE>Access Denied</TITLE>
</HEAD><BODY>
<H1>Access Denied</H1>

You don't have permission to access "http&#58;&#47;&#47;www&#46;temasek&#46;com&#46;sg&#47;robots&#46;txt" on this server.<P>
Reference&#32;&#35;18&#46;5d4c2f17&#46;1757999123&#46;9a1b4c2<P>
https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18&#46;5d4c2f17&#46;1757999123&#46;9a1b4c2
</BODY>
</HTML>`;

/** Cloudflare's rule block. hydrogencouncil.com answers /robots.txt 403 with
 *  103 bytes; iso.org answers it 403 with the full interstitial. */
const CF_1020 = `<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head>
<body><h1>Error 1020</h1><p>Ray ID: 8f2a1c4d5e6f0a1b</p><p>Access denied</p></body></html>`;

/** THE FIXTURE THAT KILLS THE OBVIOUS IMPLEMENTATION. Real lines from
 *  www.shopify.com/robots.txt, which blocks Cloudflare's own challenge path. */
const SHOPIFY_ROBOTS = `User-agent: *
Disallow: /admin
Disallow: /cart
Disallow: /*/cdn-cgi/challenge-platform*
Disallow: /cdn-cgi/challenge-platform*
Sitemap: https://www.shopify.com/sitemap.xml
`;

/** www.ifpma.org/robots.txt — 200, text/plain, zero bytes. A real, open robots
 *  file, and the reason the empty rule keys on the STATUS and not the length. */
const EMPTY_ROBOTS = "";

const prose = (n: number, what: string) =>
  Array.from({ length: n }, (_, i) => `<p>${what} This is sentence ${i} of an article that runs on the way articles do, at the length a published piece is actually written at.</p>`).join("");

/**
 * AN ORDINARY ARTICLE ON A SITE THAT USES CLOUDFLARE.
 *
 * `/cdn-cgi/challenge-platform/scripts/jsd/main.js` is what Cloudflare's JS
 * Detections injects into perfectly ordinary 200 responses — it is not the
 * challenge page, it is a script on the page. A rule keyed on that path
 * condemns the healthiest page on the client book, and does it while the audit
 * is scoring the article's real headings two rows further down.
 */
const JSD_ARTICLE = `<!DOCTYPE html><html lang="en"><head><title>How we cut emissions in half</title>
<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></head>
<body><main><article><h1>How we cut emissions in half</h1>
${prose(10, "The programme began in 2024.")}</article></main></body></html>`;

/** AN ARTICLE ABOUT BOT MANAGEMENT, which quotes every phrase a block page
 *  prints because those phrases are its subject. Vocabulary cannot tell prose
 *  from a wall; length can. */
const CDN_ERROR_ARTICLE = `<!DOCTYPE html><html lang="en"><head><title>What Cloudflare Error 1020 means</title></head>
<body><main><article><h1>What Cloudflare Error 1020 means</h1>
<p>When a firewall rule fires, the visitor sees Access denied, a Reference #18.5d4c2f17 and nothing else.</p>
${prose(10, "Error 1020 is a rule block rather than a rate limit.")}</article></main></body></html>`;

/** Cloudflare's managed challenge itself — the interstitial, which defines the
 *  state object its own script reads. THAT is the mark a 200 may be judged on. */
const CF_MANAGED_CHALLENGE = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head>
<body class="no-js"><div id="challenge-running"><h1>www.example.com</h1>
<p>Verifying you are human. This may take a few seconds.</p></div>
<script>window._cf_chl_opt={cvId:"3",cType:"managed",cRay:"8f2a1c4d5e6f0a1b"};</script></body></html>`;

/** The Imperva mark, on a page that is a page. The mark does not stop being a
 *  mark; the body stops being a wall. */
const IMPERVA_ON_A_REAL_PAGE = `<!DOCTYPE html><html lang="en"><head><title>Our 2026 results</title>
<script src="/_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3" async></script></head>
<body><main><article><h1>Our 2026 results</h1>${prose(12, "Revenue grew across all four regions.")}</article></main></body></html>`;

/** A Cloudflare-proxied origin's OWN maintenance page. Its asset links are
 *  /cdn-cgi/ ones because that is where Cloudflare serves them from — which is
 *  true of every such origin, so the mark says "behind Cloudflare" and not
 *  "refused by Cloudflare". */
const CF_MAINTENANCE_503 = `<!DOCTYPE html><html><head><title>Back soon</title>
<link rel="stylesheet" href="/cdn-cgi/styles/main.css"></head>
<body><h1>We&rsquo;ll be back shortly</h1><p>We are performing scheduled maintenance.</p></body></html>`;

/** An origin's own limiter: JSON, a Retry-After, no CDN anywhere in it. */
const RATE_LIMITED = '{"error":"Too many requests"}';

/** A REAL robots.txt on a site that sits behind Imperva, naming the resource
 *  path the challenge script uses. Directives, and therefore a file. */
const INCAPSULA_ROBOTS = `User-agent: *
Disallow: /_Incapsula_Resource
Disallow: /admin
Sitemap: https://example.com/sitemap.xml
`;

/** A page that routes by region: it landed on the ccTLD and still names the
 *  .com in its canonical, which is the page saying "I am one of its locales". */
const REGIONAL_PAGE = `<!DOCTYPE html><html lang="en-GB"><head><title>Insurance</title>
<link rel="canonical" href="https://example.com/a">
<link rel="alternate" hreflang="de" href="https://example.de/a"></head>
<body><main><article><h1>Insurance</h1>${prose(6, "Cover for the things that matter.")}</article></main></body></html>`;

/**
 * A page on a site that HAS moved, half way through the migration: its feed and
 * its stylesheet still point at the old domain, and its canonical is its own.
 *
 * Links back to the old host are what a migration looks like. Only a canonical
 * or an hreflang alternate is a claim that the two addresses are one site — a
 * rule that took any rel=alternate, or any link at all, would read a leftover
 * RSS URL as "this is a locale" and swallow the row on exactly the sites it was
 * written for.
 */
const MOVED_PAGE_WITH_OLD_LINKS = `<!DOCTYPE html><html lang="en"><head><title>Reports</title>
<link rel="canonical" href="https://protect.ngo/reports/x">
<link rel="alternate" type="application/rss+xml" href="https://cyberpeaceinstitute.org/feed.xml">
<link rel="stylesheet" href="https://cyberpeaceinstitute.org/assets/site.css"></head>
<body><main><article><h1>Reports</h1>${prose(6, "The 2026 report is out.")}</article></main></body></html>`;

const PAGE = "<html><head><title>T</title></head><body><h1>H</h1><p>some words here</p></body></html>";
const rowsOf = (checks: AuditCheck[], id: string) => checks.filter((c) => c.id === id);
const rowOf = (checks: AuditCheck[], id: string) => rowsOf(checks, id)[0];

// ── 1. The same site, and the three that are not ───────────────────────────
console.log("\n1. Registrable domains, not hosts");
{
  assert(sameSite("www.example.com", "example.com"), "www → apex is the same site, and must never raise a move");
  assert(sameSite("example.com", "www.example.com"), "and apex → www, which is just as common");
  assert(sameSite("m.example.com", "example.com"), "m. → apex too — handled by the subdomain escape, not by a list of prefixes");
  assert(sameSite("news.bbc.co.uk", "www.bbc.co.uk"), "two subdomains of a three-label registrable domain are one site");
  assert(sameSite("cybathlon.ethz.ch", "ethz.ch"), "and a real client's subdomain is not a move");

  // The three that really had moved.
  assert(!sameSite("cyberpeaceinstitute.org", "protect.ngo"), "cyberpeaceinstitute.org → protect.ngo IS a different site");
  assert(!sameSite("www.myovant.com", "www.us.sumitomo-pharma.com"), "and myovant.com → us.sumitomo-pharma.com");
  assert(!sameSite("holcimmaqer.com", "holcimmaqerventures.com"),
    "and holcimmaqer.com → holcimmaqerventures.com, which a prefix test would call the same site");

  // The ccTLD rule, which is the only reason registrableDomain is not two labels.
  assert(registrableDomain("www.temasek.com.sg") === "temasek.com.sg", "temasek.com.sg is the registrable domain, not com.sg");
  assert(registrableDomain("www.bbc.co.uk") === "bbc.co.uk", "and bbc.co.uk, not co.uk");
  assert(registrableDomain("cybathlon.ethz.ch") === "ethz.ch", "while a two-letter TLD with an ordinary label takes two");
  assert(!sameSite("temasek.com.sg", "singtel.com.sg"),
    "two different com.sg registrations are two different sites — a two-label rule calls them one");
  assert(registrableDomain("orsted.com") === "orsted.com", "an apex is its own registrable domain");
  assert(registrableDomain("") === "", "and nothing yields nothing rather than throwing");
  // An address literal has no registrable domain, and the label rule would
  // invent one: 203.0.113.5 and 198.51.113.5 both end "113.5". safeFetch will
  // happily fetch a public IP literal, so this is a shape that can arrive.
  assert(registrableDomain("203.0.113.5") === "203.0.113.5", "an address literal is its own site — labels are not sliced off one");
  assert(!sameSite("203.0.113.5", "198.51.113.5"), "so two unrelated addresses are not read as one registration");

  // Nothing to compare is NOT evidence of a move. A session imported before the
  // source column held a URL has no requestedUrl at all.
  assert(sameSite("", "protect.ngo"), "an unknown host is not a move — silence is not evidence");
  assert(hostOf("not a url") === "", "and a ref that is not a URL yields no host rather than throwing");
}

// ── 2. Which vendor's wall a BODY is ───────────────────────────────────────
console.log("\n2. The body marks");
{
  assert(botWallVendor(IMPERVA_CHALLENGE) === "Imperva", "Imperva's challenge is recognised from _Incapsula_Resource");
  assert(IMPERVA_CHALLENGE.length < 400,
    `and the fixture stays the tiny page it really is (${IMPERVA_CHALLENGE.length} bytes, measured at 212) — the size is part of the signature`);
  assert(botWallVendor(AKAMAI_DENIED) === "Akamai",
    "Akamai's Access Denied is recognised THROUGH its numeric entities — the decode is not decoration");
  assert(botWallVendor(CF_1020) === "Cloudflare", "and Cloudflare's own block code");
  assert(botWallVendor(AEM_SOFT_404) === null,
    "an ordinary CMS soft-404 carries no vendor mark — it is a missing file, not a block");
  assert(botWallVendor("") === null, "and an empty body names nobody, because there is nothing to name them with");

  // THE HAZARD, stated as a fact about the predicate rather than hidden by it.
  // botWallVendor DOES match Shopify's robots.txt. That is not a bug here; it
  // is why the caller gates on notRobotsReason first — see §3.
  assert(botWallVendor(SHOPIFY_ROBOTS) === "Cloudflare",
    "a REAL robots.txt naming /cdn-cgi/challenge-platform matches the mark — which is exactly why the mark is never the whole test");

  // And the marks the 200 test may NOT use, because a page or a file can carry
  // them innocently. They still work for the importer, where a status has
  // already refused: classifyFetchRefusal is the caller that may read them.
  assert(botWallVendor("<html><head><title>Just a moment...</title></head><body></body></html>") === null,
    "'Just a moment' alone is not evidence on a 200 — it is a sentence a person could write");
  const cfSoft = classifyFetchRefusal(403, hdr({}), "<html><head><title>Just a moment...</title></head><body></body></html>");
  assert(!!cfSoft && cfSoft.cdn === "Cloudflare",
    "while the same body behind a 403 still names Cloudflare — the broad marks did not disappear, they moved to the caller that may use them");
}

// ── 2b. The NARROW read, for a body behind a SUCCESS status ────────────────
//
// Two gates, and the fixtures below take them apart one at a time. This section
// exists because the one-function version was wrong on real pages in both
// directions at once: it condemned an ordinary article that carries Cloudflare's
// JS Detections script, and it named the wrong vendor from an article's PROSE
// about CDN errors — while the audit was scoring that article's real headings.
console.log("\n2b. What a 200 body has to be before it is called a wall");
{
  assert(challengeVendor(IMPERVA_CHALLENGE) === "Imperva", "Imperva's challenge is still recognised — the narrowing kept every real wall");
  assert(challengeVendor(AKAMAI_DENIED) === "Akamai", "and Akamai's Access Denied, through its error host");
  assert(challengeVendor(CF_MANAGED_CHALLENGE) === "Cloudflare",
    "and Cloudflare's managed challenge, from the state object its own script defines");

  // THE MARK GATE. Each of these is a string that appears in pages nobody is
  // blocking, so none of them may condemn a 200 on its own.
  assert(challengeVendor(JSD_ARTICLE) === null,
    "an ordinary article carrying Cloudflare's JS DETECTIONS script is not a challenge page — that script is injected into healthy 200s");
  assert(challengeVendor(CDN_ERROR_ARTICLE) === null,
    "and an article ABOUT Error 1020 is not a block by Akamai — prose cannot be told from a wall by its vocabulary");
  assert(botWallVendor(CDN_ERROR_ARTICLE) === "Akamai",
    "the broad read DOES take that bait, which is why it is only ever asked behind a status that already refused");
  assert(challengeVendor(CF_1020) === null,
    "even Cloudflare's own 1020 body is not evidence on a 200 — it arrives on a 403, where botWallVendor names it");
  assert(botWallVendor(CF_1020) === "Cloudflare", "and there it is still named");

  // THE DOCUMENT GATE, on its own: same mark, one short body and one long one.
  assert(challengeVendor(IMPERVA_ON_A_REAL_PAGE) === null,
    "a real article carrying the Imperva mark is a page, not a wall — a site can be behind a wall and still be served");
  assert(botWallVendor(IMPERVA_ON_A_REAL_PAGE) === "Imperva",
    "the mark is genuinely there; what changes the answer is that the body is a document");
  assert(challengeVendor(AEM_SOFT_404) === null, "and a CMS soft-404 names nobody either way");
}

// ── 3. Was this fetch refused? ─────────────────────────────────────────────
//
// The classifier the seams call, driven from data. Every case below is a host
// from the survey.
console.log("\n3. auditRefusal, on the shapes that were measured");
{
  const at = (where: "page" | "robots", status: number, body: string, h: { [k: string]: string } = {}) =>
    auditRefusal(where, `https://example.com${where === "robots" ? "/robots.txt" : "/a"}`, status, hdr(h), body);

  // 3a. A refusing status. All five 403 hosts arrive here.
  const iso = at("robots", 403, CF_1020, { server: "cloudflare" });
  assert(!!iso && iso.kind === "status" && iso.cdn === "Cloudflare", "a 403 carrying a Cloudflare block page is a refusal, and names Cloudflare");
  const holcim = at("robots", 403, "<html><head><title>403 Forbidden</title></head><body></body></html>", {});
  assert(!!holcim && holcim.kind === "status" && holcim.cdn === null,
    "an UNBRANDED 403 is still a refusal — three of the five refusing hosts sign nothing, and 'we were refused' is true of all five");

  // 3b. A challenge behind a success status. THE LESSON: a block is not a 4xx.
  const zurich = at("robots", 200, IMPERVA_CHALLENGE);
  assert(!!zurich && zurich.kind === "challenge" && zurich.cdn === "Imperva",
    "a 200 whose body is an Imperva challenge is a refusal, not a robots file");

  // 3c. A success status with nothing in it — and the discrimination that makes
  // it safe. These two bodies are IDENTICAL; only the status differs.
  const ieee = at("robots", 202, IEEE_EMPTY);
  assert(!!ieee && ieee.kind === "empty", "202 Accepted with a zero-byte body is a request accepted and a file not sent");
  assert(at("robots", 200, EMPTY_ROBOTS) === null,
    "while 200 with the SAME zero bytes is a genuinely empty robots.txt — a real file, and an open one");
  // 204 goes with the 200 and not with the 202: "no content" is what a 204 is
  // FOR, so reading the spec's own way of saying "there is nothing here" as a
  // wall invents a block out of a correct answer.
  assert(at("robots", 204, "") === null,
    "and 204 No Content is an empty file, not a wall — it is the one 2xx that MEANS there is nothing to send");

  // 3d. THE SHOPIFY GATE. A body that parses as directives is a file, whatever
  // strings are inside it.
  assert(at("robots", 200, SHOPIFY_ROBOTS) === null,
    "a real robots.txt blocking /cdn-cgi/challenge-platform is NOT a challenge page");
  // THE ONE THAT ISOLATES THE GATE. Shopify's file no longer matches the narrow
  // mark set either, so it would now pass for two reasons; this one still
  // carries a mark the narrow read accepts, and only notRobotsReason saves it.
  assert(at("robots", 200, INCAPSULA_ROBOTS) === null,
    "and a real robots.txt that DISALLOWS Imperva's own resource path is a file — directives are asked first, whatever strings follow them");
  assert(challengeVendor(INCAPSULA_ROBOTS) === "Imperva",
    "which is a gate and not a coincidence: that body does match the mark, and is a robots.txt anyway");
  assert(at("page", 200, SHOPIFY_ROBOTS) === null,
    "a PAGE carrying the same lines is not condemned either — the mark alone was never enough on a success status");

  // 3e. What must NOT be a refusal.
  assert(at("page", 200, JSD_ARTICLE) === null,
    "AN ORDINARY ARTICLE IS NOT A CHALLENGE PAGE, even with Cloudflare's JS Detections script in its head — the audit is scoring that article as it says this");
  assert(at("page", 200, CDN_ERROR_ARTICLE) === null, "nor is an article about CDN blocks a CDN block");
  assert(at("page", 429, RATE_LIMITED, { "retry-after": "60", "content-type": "application/json" }) === null,
    "A 429 IS A MOMENT, NOT A POSTURE — it clears on the next run, and 'this site refuses non-browser clients' is a standing claim");
  assert(at("page", 429, CF_1020, { "cf-mitigated": "challenge" }) === null,
    "and a branded 429 is dropped too — the row would outlive the condition either way");
  assert(at("page", 503, CF_MAINTENANCE_503) === null,
    "a maintenance page behind Cloudflare is an OUTAGE, not bot management: every Cloudflare-proxied origin's own error page links /cdn-cgi/ assets");
  assert(!!classifyFetchRefusal(503, hdr({}), CF_MAINTENANCE_503),
    "the importer still explains that 503 in the moment — this is the audit declining to write it down as a standing fact");
  assert(at("robots", 404, "<html><body>Not found</body></html>") === null,
    "a clean 404 is not a refusal — it is the site correctly saying there is no such file");
  assert(at("page", 200, PAGE) === null, "and an ordinary page is not a refusal");
  assert(at("robots", 200, "User-agent: *\nDisallow: /private/\n") === null, "nor is an ordinary robots.txt");
  assert(at("page", 401, "", { "www-authenticate": 'Basic realm="Staging"' }) === null,
    "A CREDENTIALS WALL IS NOT BOT MANAGEMENT — a 401 asking for a password is a staging site, and sending its owner to their CDN team would be wrong");
  assert(at("page", 503, "<html><body>Service Unavailable</body></html>", { server: "nginx" }) === null,
    "and an unbranded 503 is an origin having a bad day");
  assert(at("page", 500, "error", { server: "AkamaiGHost" }) === null,
    "a 500 is not a refusal even from an edge that signs its refusals");
}

// ── 4. The seam, driven with fixture responses ─────────────────────────────
//
// THE LIVE DEFECT IS IN HERE. Without the fix, ieee.org's 202 arrives as "" and
// the panel prints "robots.txt allows all 6 AI crawlers checked on this path".
console.log("\n4. What the shared seam hands the judge");
async function seamChecks() {
  const PAGE_URL = "https://www.ieee.org/about/x";
  const serve = (r: { text?: string | null; finalUrl?: string | null; refusal?: SiteRefusal | null }) =>
    async (path: string) => ({
      text: path === "/robots.txt" ? (r.text ?? null) : null,
      finalUrl: r.finalUrl ?? `https://www.ieee.org${path}`,
      refusal: path === "/robots.txt" ? (r.refusal ?? null) : null,
    });

  const refused: SiteRefusal = { where: "robots", url: "https://www.ieee.org/robots.txt", status: 202, cdn: null, kind: "empty" };
  const files = await fetchSiteFiles(PAGE_URL, { read: serve({ text: null, refusal: refused }) });
  assert(files.robotsTxt === null,
    "a refused robots.txt is NULL, never the empty string — an empty string parses as an OPEN robots file");
  assert(files.robotsRefusal === refused, "and the refusal itself reaches the judge, so the panel can say why there is no file");
  assert(files.robotsFinalUrl === "https://www.ieee.org/robots.txt", "along with where the request landed");

  const ok = await fetchSiteFiles(PAGE_URL, { read: serve({ text: "User-agent: *\nDisallow: /x\n" }) });
  assert(ok.robotsTxt === "User-agent: *\nDisallow: /x\n" && ok.robotsRefusal === null,
    "a real robots.txt still goes through as fetched, with nothing attached to it");

  // THE RESPONSE HANDLER ITSELF, which the fixture reader above skips straight
  // past. Mutation testing put this here: `if (!res.ok) return null` — the live
  // defect, restored — left every assertion above green, because no fixture had
  // ever reached the code that reads a real response. A test seam that bypasses
  // the thing under test is a check that quietly tests nothing.
  const resp = (status: number, body: string, url = "https://www.ieee.org/robots.txt") =>
    readSiteFileResponse("/robots.txt", { status, ok: status >= 200 && status < 300, url, headers: hdr({}) }, body, url);

  const ieee202 = resp(202, IEEE_EMPTY);
  assert(ieee202.text === null && !!ieee202.refusal && ieee202.refusal.kind === "empty",
    "THE LIVE DEFECT: a 202 with a zero-byte body yields NULL and a refusal — not the empty string, which parses as an open robots file");
  const ifpma200 = resp(200, EMPTY_ROBOTS);
  assert(ifpma200.text === "" && ifpma200.refusal === null,
    "while a 200 with the same zero bytes yields the empty string, because that is a real and open robots.txt");
  const noContent = resp(204, "");
  assert(noContent.text === "" && noContent.refusal === null,
    "and so does a 204, which is the status whose whole meaning is that there was nothing to send");
  const blocked403 = resp(403, CF_1020);
  assert(blocked403.text === null && !!blocked403.refusal && blocked403.refusal.kind === "status",
    "a 403 yields no body and a refusal, so the panel can say what happened rather than that it could not look");
  const real200 = resp(200, SHOPIFY_ROBOTS);
  assert(real200.text === SHOPIFY_ROBOTS && real200.refusal === null,
    "and a real robots.txt comes back byte for byte, cdn-cgi lines and all");
  const landed = resp(200, "User-agent: *\n", "https://protect.ngo/robots.txt");
  assert(landed.finalUrl === "https://protect.ngo/robots.txt",
    "the address it LANDED on is carried, not the one that was asked for — res.url, not a guess");
  const llms = readSiteFileResponse("/llms.txt", { status: 200, ok: true, url: "https://e.com/llms.txt", headers: hdr({}) }, IMPERVA_CHALLENGE, "https://e.com/llms.txt");
  assert(llms.refusal === null,
    "and only /robots.txt is classified — llms.txt has no finding to feed, so it gets no bot-wall verdict");

  // END TO END, which is where the defect was visible: the seam's output
  // through the judge and out as a sentence.
  const row = rowOf(
    auditPage({ page: PAGE, finalUrl: PAGE_URL, httpStatus: 200, robotsTxt: files.robotsTxt,
                robotsFinalUrl: files.robotsFinalUrl, refusals: [files.robotsRefusal] }, new Date()).checks,
    "ai-crawler-access"
  );
  assert(row.status === "info" && !/allows all/i.test(row.detail),
    "THE SENTENCE IS GONE: a 202 with no body no longer reads as robots.txt allowing all 6 AI crawlers");
  assert(/refused this request rather than answering it/i.test(row.detail),
    "and the row says the address refused rather than that it could not be read — different facts, different next steps");
}

// ── 5. The three rows on screen ────────────────────────────────────────────
console.log("\n5. The rows, and what they refuse to say");
function rowChecks() {
  const base = { page: PAGE, httpStatus: 200 };
  const refusal = (r: Partial<SiteRefusal>): SiteRefusal =>
    ({ where: "robots", url: "https://www.zurich.com/robots.txt", status: 200, cdn: "Imperva", kind: "challenge", ...r });

  // 5a. THE REFUSAL ROW.
  const refused = auditPage(
    { ...base, finalUrl: "https://www.zurich.com/en/a", robotsTxt: null,
      refusals: [refusal({})] },
    new Date()
  );
  const edge = rowOf(refused.checks, "edge-refusal");
  assert(!!edge, "a refused fetch raises a row of its own");
  assert(edge.status === "info", "as INFO — we were refused, which is not proof that a named crawler was");
  assert(/upstream of robots\.txt/i.test(edge.detail) && /no robots rule can grant access/i.test(edge.detail),
    "and it says the thing that makes it worth printing: this sits upstream of robots.txt");
  assert(/does NOT prove GPTBot is blocked/.test(edge.detail),
    "THE CAVEAT IS IN THE FINDING, not a footnote — being refused from here proves nothing about GPTBot");
  assert(/reverse-DNS/i.test(edge.detail),
    "and names the mechanism that makes it unknowable, so the caveat is a reason rather than a hedge");
  assert(/are the AI crawler categories allowed through bot management\?/i.test(edge.remedy || ""),
    "the remedy is a QUESTION for the CDN team, and it is the question by name");
  assert(!/is blocked|are blocked|blocks AI crawlers/i.test(edge.remedy || ""),
    "and never asserts a block — that assertion is what sends a comms team to infrastructure with a false premise");
  assert(/challenge page from Imperva/.test(edge.detail),
    "the evidence is named: which vendor, and that a success status carried a challenge");
  assert(!/\ba (?:Imperva|Akamai|Incapsula)\b/.test(edge.detail),
    "and the vendor's name never sits behind an article — 'a Imperva challenge page' printed in the client's own report");

  // The three sentences, each pinned. Two of these were unasserted and both
  // mutations survived: the vendor could be dropped from the 403 arm, and the
  // empty arm could claim any cause it liked.
  const branded = rowOf(
    auditPage({ ...base, finalUrl: "https://www.temasek.com.sg/a", robotsTxt: null,
                refusals: [refusal({ where: "page", cdn: "Akamai", kind: "status", status: 403, url: "https://www.temasek.com.sg/a" })] }, new Date()).checks,
    "edge-refusal"
  );
  assert(/refused with HTTP 403 by Akamai's bot management/.test(branded.detail),
    "a signed 403 names the vendor that signed it — the whole point of reading the body at all");
  const empty = rowOf(
    auditPage({ ...base, finalUrl: "https://www.ieee.org/a", robotsTxt: null,
                refusals: [refusal({ status: 202, cdn: null, kind: "empty", url: "https://www.ieee.org/robots.txt" })] }, new Date()).checks,
    "edge-refusal"
  );
  assert(/a success status carrying no file/.test(empty.detail),
    "an empty 2xx reports what arrived: a success status and no file");
  assert(!/which is bot management/i.test(empty.detail),
    "AND CLAIMS NO CAUSE FOR IT — the evidence is 'accepted, not answered', which a broken edge rule produces too; a 405 from a load balancer is left out of this row for the same reason");

  const unsigned = rowOf(
    auditPage({ ...base, finalUrl: "https://orsted.com/a", robotsTxt: null,
                refusals: [refusal({ cdn: null, kind: "status", status: 403, url: "https://orsted.com/robots.txt" })] }, new Date()).checks,
    "edge-refusal"
  );
  assert(/nothing in the response says who refused it/i.test(unsigned.detail),
    "an unbranded refusal says so rather than guessing a vendor — three of the five refusing hosts sign nothing");

  const bothEnds = rowOf(
    auditPage({ ...base, finalUrl: "https://www.temasek.com.sg/en/a", robotsTxt: null,
                refusals: [
                  { where: "page", url: "https://www.temasek.com.sg/en/a", status: 403, cdn: "Akamai", kind: "status" },
                  { where: "robots", url: "https://www.temasek.com.sg/robots.txt", status: 403, cdn: "Akamai", kind: "status" },
                ] }, new Date()).checks,
    "edge-refusal"
  );
  assert(/The page itself/.test(bothEnds.detail) && /\/robots\.txt/.test(bothEnds.detail),
    "when both the page and the robots file were refused, both are reported — one row, both facts");

  assert(!rowOf(auditPage({ ...base, finalUrl: "https://e.com/a", robotsTxt: "User-agent: *\nAllow: /" }, new Date()).checks, "edge-refusal"),
    "and a site that answered normally gets no refusal row at all — the row only exists when it fired");

  // 5b. THE NO-ROBOTS ROW.
  const soft = auditPage(
    { ...base, finalUrl: "https://www.temasek.com.sg/en/news-and-resources/stories/x",
      robotsTxt: AEM_SOFT_404, robotsFinalUrl: "https://www.temasek.com.sg/robots.txt" },
    new Date()
  );
  const present = rowOf(soft.checks, "robots-txt-present");
  assert(!!present && present.status === "info", "a web page at /robots.txt raises the no-robots row, as INFO");
  assert(present.name === "The site publishes no robots.txt",
    "NAMED FOR THE STATE THAT IS MISSING, like the two rows beside it — the client report lists these by name alone, where 'The site publishes a robots.txt' read as the reassurance it is the opposite of");
  assert(/likeliest reading is that this site has no robots\.txt/i.test(present.detail),
    "and states the conclusion the evidence supports — a CMS serving a page at that address has never heard of it");
  assert(/looks the same from out here/i.test(present.detail),
    "HEDGED, because an edge serving automated clients something else produces the same page — the same hedge the row above carries");
  assert(/neither redirected nor refused/i.test(present.detail) && /that request was/i.test(present.detail),
    "and the clause is about THE /robots.txt REQUEST, not about the panel — it was a claim about the whole audit, printed two rows under a refusal");
  assert(/leaves every crawler unrestricted/i.test(present.detail),
    "THE HONEST ASYMMETRY: having no robots.txt blocks nobody, and the row says so before it asks for anything");
  assert(/ability to say otherwise|ability to check/i.test(present.detail),
    "what it costs is the ability to TELL, which is the actual finding");
  assert(/in a browser first/i.test(present.remedy || "") && /publish one/i.test(present.remedy || "") && /GPTBot/.test(present.remedy || ""),
    "the remedy opens with the check and then offers the cheap fix, naming the agents a file would let the site address");
  assert(present.detail.indexOf("https://www.temasek.com.sg/robots.txt") >= 0,
    "naming the address on the site's own origin, not the page's path");

  // The suppressions. Each is a case where "you have no robots.txt" would be a
  // claim the evidence does not support.
  assert(!rowOf(
    auditPage({ ...base, finalUrl: "https://www.zurich.com/en/a", robotsTxt: IMPERVA_CHALLENGE,
                refusals: [refusal({})] }, new Date()).checks, "robots-txt-present"),
    "it does NOT fire when the edge refused — a body that never arrived is not evidence of a missing file");
  // THE COMBINATION THAT ACTUALLY LANDS, and the only host in the 77 that
  // raises this row: Temasek's ARTICLE is refused by Akamai while its
  // /robots.txt is a genuine soft-404. The suppression read the robots refusal
  // only, so the panel printed "was refused by Akamai's bot management" and
  // "nothing redirected and nothing refused" two rows apart about one site.
  const refusedPage = auditPage(
    { ...base, httpStatus: 403, finalUrl: "https://www.temasek.com.sg/en/news/x",
      robotsTxt: AEM_SOFT_404, robotsFinalUrl: "https://www.temasek.com.sg/robots.txt",
      refusals: [{ where: "page", url: "https://www.temasek.com.sg/en/news/x", status: 403, cdn: "Akamai", kind: "status" }] },
    new Date()
  );
  assert(!!rowOf(refusedPage.checks, "edge-refusal") && !rowOf(refusedPage.checks, "robots-txt-present"),
    "nor when the PAGE was refused, though the robots fetch itself answered — a site whose edge turns this server away is not a site to draw conclusions about from an absence");
  assert(!rowOf(
    auditPage({ ...base, finalUrl: "https://holcimmaqer.com/a", robotsTxt: AEM_SOFT_404,
                robotsFinalUrl: "https://holcimmaqerventures.com/robots.txt" }, new Date()).checks, "robots-txt-present"),
    "nor when the robots request crossed to another site — that is another site's missing file");
  assert(!rowOf(
    auditPage({ ...base, requestedUrl: "https://cyberpeaceinstitute.org/x", finalUrl: "https://protect.ngo/x",
                robotsTxt: AEM_SOFT_404, robotsFinalUrl: "https://protect.ngo/robots.txt" }, new Date()).checks, "robots-txt-present"),
    "nor when the PAGE crossed to another site — the missing file would be reported under the wrong company's name");
  assert(!rowOf(auditPage({ ...base, finalUrl: "https://e.com/a", robotsTxt: null }, new Date()).checks, "robots-txt-present"),
    "nor on a clean 404 or a timeout, where the file was simply not read");
  assert(!rowOf(auditPage({ ...base, finalUrl: "https://e.com/a", robotsTxt: SHOPIFY_ROBOTS }, new Date()).checks, "robots-txt-present"),
    "and never on a site that has one");

  // 5c. THE REDIRECT ROW.
  const moved = auditPage(
    { ...base, requestedUrl: "https://cyberpeaceinstitute.org/reports/x",
      finalUrl: "https://protect.ngo/reports/x", robotsTxt: null },
    new Date()
  );
  const red = rowOf(moved.checks, "site-redirect");
  assert(!!red && red.status === "warn", "a cross-site redirect is flagged — loud, and still not a fail");
  assert(/protect\.ngo/.test(red.detail) && /cyberpeaceinstitute\.org/.test(red.detail),
    "naming both registrable domains, so the reader can see which is which");
  assert(/Every other finding on this page describes what is served at/i.test(red.detail),
    "and says the thing that makes it first: every other measurement is about a different site");
  assert(/Re-import this piece from/i.test(red.remedy || ""), "the remedy is to audit the address that exists");

  assert(!rowOf(auditPage({ ...base, requestedUrl: "https://www.example.com/a", finalUrl: "https://example.com/a" }, new Date()).checks, "site-redirect"),
    "www → apex does NOT fire it — a row that shouts about that is ignored within a day");
  assert(!rowOf(auditPage({ ...base, requestedUrl: "https://m.example.com/a", finalUrl: "https://example.com/a" }, new Date()).checks, "site-redirect"),
    "nor does m. → apex");
  assert(!rowOf(auditPage({ ...base, requestedUrl: "https://example.com/a", finalUrl: "https://example.com/a/" }, new Date()).checks, "site-redirect"),
    "nor a trailing slash the server added");
  assert(!rowOf(auditPage({ ...base, finalUrl: "https://example.com/a" }, new Date()).checks, "site-redirect"),
    "and a session with no requested URL raises nothing — not looking is not evidence of a move");

  // The robots-only arm: the page stayed, its robots.txt did not.
  const robotsMoved = rowOf(
    auditPage({ ...base, finalUrl: "https://holcimmaqer.com/a", robotsFinalUrl: "https://holcimmaqerventures.com/robots.txt" }, new Date()).checks,
    "site-redirect"
  );
  assert(!!robotsMoved && /robots\.txt comes back from/i.test(robotsMoved.detail),
    "a robots.txt that comes back from another domain is reported too, in its own words");
  assert(!/Every other finding on this page/i.test(robotsMoved.detail),
    "and NOT with the page-moved sentence — the page did answer here, and overclaiming is the failure this panel names");
  assert(/re-import from holcimmaqerventures\.com/i.test(robotsMoved.remedy || "") && /still being served at the old address/i.test(robotsMoved.remedy || ""),
    "with its own remedy, which is not the page arm's — that one tells you to re-import the page, and this page was not the thing that moved");

  // A COUNTRY SITE IS NOT A MOVE. The survey could not test this: it measured
  // /robots.txt on each host as given, so nothing in it ever crossed a ccTLD.
  // A .com routing this server to .co.uk would otherwise fire on every run of a
  // healthy multinational site — and several of these clients are one.
  const regional = rowOf(
    auditPage({ ...base, page: REGIONAL_PAGE, requestedUrl: "https://example.com/a", finalUrl: "https://example.co.uk/a" }, new Date()).checks,
    "site-redirect"
  );
  assert(!!regional && regional.status === "info",
    "a ccTLD hop whose page still names the requested domain is INFO, not a warning that fires forever on a site working as designed");
  assert(/canonical or hreflang/i.test(regional.detail) && !/under the wrong name/i.test(regional.detail),
    "and says WHY it is not a move, rather than claiming every finding below is about somebody else");
  assert(/describe the example\.co\.uk page/i.test(regional.detail),
    "while still naming which of the two the findings describe — the reader is owed that either way");
  const notClaimed = rowOf(
    auditPage({ ...base, page: PAGE, requestedUrl: "https://example.com/a", finalUrl: "https://example.co.uk/a" }, new Date()).checks,
    "site-redirect"
  );
  assert(!!notClaimed && notClaimed.status === "warn",
    "THE CORROBORATION IS THE WHOLE RULE: the same hop with no such claim on the landed page is still a move, and still flagged");
  const halfMigrated = rowOf(
    auditPage({ ...base, page: MOVED_PAGE_WITH_OLD_LINKS, requestedUrl: "https://cyberpeaceinstitute.org/reports/x",
                finalUrl: "https://protect.ngo/reports/x" }, new Date()).checks,
    "site-redirect"
  );
  assert(!!halfMigrated && halfMigrated.status === "warn",
    "and a moved site whose feed and stylesheet still point at the old domain is STILL a move — only a canonical or an hreflang alternate is a claim that two addresses are one site, and a leftover asset URL is what a migration looks like");

  // 5d. ORDER. First in the list, because it changes what the list is about.
  assert(moved.checks[0].id === "site-redirect",
    "the redirect row is the FIRST row the panel holds, ahead of even the status check");
  assert(refused.checks[0].id === "edge-refusal",
    "and the refusal row leads when there was no redirect");
  // BOTH AT ONCE, which no fixture had: swapping the two pushes survived, so
  // "reported BEFORE the others" was unpinned in exactly the case it is for.
  const movedAndRefused = auditPage(
    { ...base, httpStatus: 403, requestedUrl: "https://holcimmaqer.com/a", finalUrl: "https://holcimmaqerventures.com/a",
      robotsTxt: null, refusals: [{ where: "page", url: "https://holcimmaqerventures.com/a", status: 403, cdn: null, kind: "status" }] },
    new Date()
  );
  assert(movedAndRefused.checks[0].id === "site-redirect" && !!rowOf(movedAndRefused.checks, "edge-refusal"),
    "and when the address BOTH moved and was refused, the move is still first — which is the whole claim, and the only case where the order can be got wrong");
  assert(rowOf(soft.checks, "http-status") === soft.checks[0],
    "while an ordinary audit is unchanged — neither row exists when neither fired");

  // 5f. The status row's own "redirected from", which replaced a dead field and
  // was asserted nowhere. It is a different question from the row above: this
  // one fires for ANY changed address, including within one site.
  const withinSite = rowOf(
    auditPage({ ...base, requestedUrl: "https://example.com/a", finalUrl: "https://www.example.com/a" }, new Date()).checks,
    "http-status"
  );
  assert(/redirected from https:\/\/example\.com\/a/.test(withinSite.detail),
    "the status row says where the address came from when it changed — www → apex raises no move, and is still worth one clause");
  assert(!/redirected from/.test(rowOf(auditPage({ ...base, requestedUrl: "https://example.com/a", finalUrl: "https://example.com/a/" }, new Date()).checks, "http-status").detail),
    "and says nothing about a trailing slash the server added, which is noise dressed as a finding");

  // 5e. INFO NEVER LANDS IN THE PASS COLUMN, and a warn is counted once.
  const plain = auditPage({ ...base, finalUrl: "https://www.temasek.com.sg/en/news-and-resources/stories/x", robotsTxt: AEM_SOFT_404 }, new Date());
  assert(plain.counts.pass === soft.counts.pass && plain.counts.warn === soft.counts.warn,
    "the no-robots row costs nothing and earns nothing — it is a statement, not a score");
  assert(moved.counts.warn >= 1, "while the redirect row is counted as a warning, because someone has to act on it");

  return { moved, refused };
}

// ── 6. The inline card leads with it ───────────────────────────────────────
//
// The card shows four findings, worst first. A cross-site redirect is a WARN,
// so worst-first would bury it behind failures that only exist BECAUSE the
// audit is looking at the wrong page.
console.log("\n6. The chat card");
function cardChecks(moved: ReturnType<typeof auditPage>, refused: ReturnType<typeof auditPage>) {
  const card = buildInlineAudit(moved, { url: "https://cyberpeaceinstitute.org/reports/x", finalUrl: "https://protect.ngo/reports/x", httpStatus: 200 });
  assert(card.ok === true && card.findings.length > 0, "the card carries findings");
  assert(card.findings[0].id === "site-redirect",
    "and leads with the redirect — otherwise the first thing a reader sees is a confident failure about somebody else's page");
  assert(card.findings.filter((f) => f.status === "fail").length > 0,
    "with the real failures still on it, below — the hoist reorders, it does not hide");
  assert(!!card.findings[0].remedy, "and the lead finding carries its remedy, not an empty string");

  // ── THE CAVEAT HAS TO SURVIVE THE TRIP INTO CHAT ─────────────────────────
  //
  // The studio panel prints name AND detail, so it always carried this. The
  // chat card had room for names only, and put them in a list headed "Not
  // measured" under a sentence about the browser render — so the finding Chris
  // asked for BY NAME reached the model as the bare assertion "The site refuses
  // non-browser clients", with no caveat, no upstream-of-robots.txt and no
  // question for the CDN team. An INFO row means two different things and only
  // one of them is a gap in the audit.
  const chat = buildInlineAudit(refused, { url: "https://www.zurich.com/en/a", finalUrl: "https://www.zurich.com/en/a", httpStatus: 200 });
  const note = chat.noted.filter((n) => n.id === "edge-refusal")[0];
  assert(!!note, "a measured INFO finding reaches the card as a NOTE, not as a gap");
  assert(chat.notMeasured.filter((n) => n.id === "edge-refusal").length === 0,
    "and is not also listed among the checks that could not be run — it ran, and it found something");
  assert(!!note && /does NOT prove GPTBot is blocked/.test(note.detail),
    "THE CAVEAT TRAVELS WITH THE CLAIM: the card carries the detail, because the name on its own is the assertion the finding is worded to avoid");
  assert(!!note && /are the AI crawler categories allowed/i.test(note.remedy),
    "and so does the question, which is the only remedy this row has");

  const forModel = inlineAuditForModel(chat);
  assert(/does NOT prove GPTBot is blocked/.test(forModel), "the model is handed the caveat too, not a name in a list");
  assert(/MEASURED BUT NOT SCORED/.test(forModel) && !/Not measured[^\n]*refuses non-browser/.test(forModel),
    "and is told these were measured — a model told a finding was 'not measured' will say so in its own words");
  assert(/needs a browser render/.test(forModel),
    "the render sentence is still there while a render row is in the list");
  const noRender = buildInlineAudit(
    { checks: refused.checks.filter((c) => c.id !== "js-dependency" && c.id !== "render-ran"), counts: refused.counts, fetchedAt: refused.fetchedAt },
    { url: "https://www.zurich.com/en/a", finalUrl: "https://www.zurich.com/en/a", httpStatus: 200 }
  );
  assert(!/needs a browser render/.test(inlineAuditForModel(noRender)),
    "and gone when no render row is — it explains the JavaScript gap and nothing else, and it was explaining a measured refusal");

  const ui = stripComments(read("components/ai-writer/PageAuditCard.tsx"));
  assert(/noted/.test(ui) && /n\.detail/.test(ui),
    "the card component prints those notes with their detail — on screen as in the prompt");
  assert(/renderMissing/.test(ui), "and makes the render sentence conditional there too");
}

// ── 7. Both audits hand over the same evidence ─────────────────────────────
//
// The recorded failure mode here is a fix that lands in one path and not its
// sibling. There is one seam and one judge; what the source still has to answer
// is whether both callers actually PASS the new evidence, because a caller that
// silently drops requestedUrl turns the redirect row off for that surface
// alone, and nothing else would notice.
console.log("\n7. Neither audit is missing a wire");
function wiringChecks() {
  const callers = [
    "app/api/optimizer/sessions/[id]/audit/route.ts",
    "lib/optimizer/inline-audit.ts",
  ];
  for (let i = 0; i < callers.length; i++) {
    const src = stripComments(read(callers[i]));
    const where = callers[i];
    assert(/requestedUrl:/.test(src), `${where} tells the audit which address was asked for`);
    assert(/robotsFinalUrl/.test(src), `${where} passes where the robots request landed`);
    assert(/refusals:\s*\[/.test(src), `${where} passes the refusals it was handed`);
    assert(/robotsRefusal/.test(src) && /fetched\.refusal/.test(src),
      `${where} passes BOTH refusals — the page's and the robots file's`);
    assert(!/registrableDomain\(|sameSite\(/.test(src),
      `${where} does not decide "same site" for itself — two callers deciding that is how the two audits drift`);
  }
  // And the judge stays offline. Importing url-import to reach the classifier
  // would pull safeFetch into the pure module and end "the route fetches, this
  // decides".
  const judge = stripComments(read("lib/optimizer/page-audit.ts"));
  assert(/from "\.\/site-reach"/.test(judge), "page-audit reads the host comparison from the shared pure module");
  assert(!/url-import|safe-fetch|safeFetch/.test(judge),
    "and imports nothing that touches the network — page-audit is pure and offline, and stays that way");
  const reach = stripComments(read("lib/optimizer/site-reach.ts"));
  assert(!/^import /m.test(reach), "site-reach imports nothing at all — it is the part a fixture can drive");
}

// ── Self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  console.log("\n── self-test: each detector against input it must reject ──");
  let broken = 0;
  const detects = (what: string, fired: boolean) => {
    if (fired) console.log(`  ✓ fires on ${what}`);
    else { broken++; console.log(`  ✗ SILENT on ${what}`); }
  };
  const base = { page: PAGE, httpStatus: 200 };

  detects("a 202 with no body read as an open robots file",
    !!auditRefusal("robots", "https://e.com/robots.txt", 202, hdr({}), ""));
  detects("a genuinely empty robots.txt condemned as a refusal",
    auditRefusal("robots", "https://e.com/robots.txt", 200, hdr({}), "") === null);
  detects("a real robots.txt condemned for naming /cdn-cgi/challenge-platform",
    auditRefusal("robots", "https://e.com/robots.txt", 200, hdr({}), SHOPIFY_ROBOTS) === null);
  detects("an Imperva challenge behind a 200 read as a robots file",
    !!auditRefusal("robots", "https://e.com/robots.txt", 200, hdr({}), IMPERVA_CHALLENGE));
  detects("a sign-in wall reported as bot management",
    auditRefusal("page", "https://e.com/a", 401, hdr({ "www-authenticate": "Basic" }), "") === null);
  detects("www → apex reported as a site move", sameSite("www.example.com", "example.com"));
  detects("a genuine move reported as the same site", !sameSite("holcimmaqer.com", "holcimmaqerventures.com"));
  detects("two different com.sg registrations read as one site", !sameSite("temasek.com.sg", "singtel.com.sg"));
  {
    const r = rowOf(auditPage({ ...base, requestedUrl: "https://cyberpeaceinstitute.org/x", finalUrl: "https://protect.ngo/x" }, new Date()).checks, "site-redirect");
    detects("a cross-site redirect passing silently", !!r && r.status === "warn");
  }
  {
    const checks = auditPage({ ...base, requestedUrl: "https://cyberpeaceinstitute.org/x", finalUrl: "https://protect.ngo/x" }, new Date()).checks;
    detects("the redirect row buried below the content rows", checks[0].id === "site-redirect");
  }
  {
    const r = rowOf(auditPage({ ...base, finalUrl: "https://www.zurich.com/a", robotsTxt: null,
      refusals: [{ where: "robots", url: "https://www.zurich.com/robots.txt", status: 200, cdn: "Imperva", kind: "challenge" }] }, new Date()).checks, "edge-refusal");
    detects("a refusal reported without its caveat", !!r && /does NOT prove GPTBot is blocked/.test(r.detail));
    detects("a refusal remedy that asserts a block instead of asking",
      !!r && /are the AI crawler categories allowed/i.test(r.remedy || ""));
  }
  {
    const r = rowOf(auditPage({ ...base, finalUrl: "https://www.temasek.com.sg/a", robotsTxt: AEM_SOFT_404,
      robotsFinalUrl: "https://www.temasek.com.sg/robots.txt" }, new Date()).checks, "robots-txt-present");
    detects("a page at /robots.txt passing without the no-robots row", !!r);
    detects("the no-robots row losing the asymmetry", !!r && /leaves every crawler unrestricted/i.test(r.detail));
  }
  detects("the no-robots row firing on a refused fetch",
    !rowOf(auditPage({ ...base, finalUrl: "https://www.zurich.com/a", robotsTxt: IMPERVA_CHALLENGE,
      refusals: [{ where: "robots", url: "https://www.zurich.com/robots.txt", status: 200, cdn: "Imperva", kind: "challenge" }] }, new Date()).checks, "robots-txt-present"));
  detects("the no-robots row firing while the PAGE was refused",
    !rowOf(auditPage({ ...base, httpStatus: 403, finalUrl: "https://www.temasek.com.sg/a", robotsTxt: AEM_SOFT_404,
      robotsFinalUrl: "https://www.temasek.com.sg/robots.txt",
      refusals: [{ where: "page", url: "https://www.temasek.com.sg/a", status: 403, cdn: "Akamai", kind: "status" }] }, new Date()).checks, "robots-txt-present"));
  detects("Akamai's entity-encoded body going unrecognised", botWallVendor(AKAMAI_DENIED) === "Akamai");

  // The narrow read, one gate at a time.
  detects("an ordinary article condemned for carrying Cloudflare's JS Detections script", challengeVendor(JSD_ARTICLE) === null);
  detects("an article ABOUT CDN blocks read as a CDN block", challengeVendor(CDN_ERROR_ARTICLE) === null);
  detects("a real article condemned by a mark in its head", challengeVendor(IMPERVA_ON_A_REAL_PAGE) === null);
  detects("a real Cloudflare challenge going unrecognised", challengeVendor(CF_MANAGED_CHALLENGE) === "Cloudflare");
  detects("a rate limit reported as bot management",
    auditRefusal("page", "https://e.com/a", 429, hdr({ "retry-after": "60" }), RATE_LIMITED) === null);
  detects("a maintenance page behind Cloudflare reported as bot management",
    auditRefusal("page", "https://e.com/a", 503, hdr({}), CF_MAINTENANCE_503) === null);
  detects("204 No Content read as a wall", auditRefusal("robots", "https://e.com/robots.txt", 204, hdr({}), "") === null);
  {
    const r = rowOf(auditPage({ ...base, page: REGIONAL_PAGE, requestedUrl: "https://example.com/a", finalUrl: "https://example.co.uk/a" }, new Date()).checks, "site-redirect");
    detects("a country site reported as a site that has moved", !!r && r.status === "info");
  }
  {
    const audit = auditPage({ ...base, finalUrl: "https://www.zurich.com/a", robotsTxt: null,
      refusals: [{ where: "robots", url: "https://www.zurich.com/robots.txt", status: 200, cdn: "Imperva", kind: "challenge" }] }, new Date());
    const card = buildInlineAudit(audit, { url: "https://www.zurich.com/a", finalUrl: "https://www.zurich.com/a", httpStatus: 200 });
    detects("the caveat dropped on the way to the chat card",
      card.noted.some((n) => /does NOT prove GPTBot is blocked/.test(n.detail)));
    detects("a measured finding listed among the checks that did not run",
      !card.notMeasured.some((n) => n.id === "edge-refusal"));
  }

  if (broken > 0) { console.log(`\n✗ ${broken} detector(s) failed to fire — reporting nothing.`); process.exit(1); }
  console.log("  all detectors fire.");
}

seamChecks().then(() => {
  const { moved, refused } = rowChecks();
  cardChecks(moved, refused);
  wiringChecks();
  if (process.argv.indexOf("--self-test") >= 0) selfTest();
  console.log(failures === 0 ? "\n✓ site-reach checks pass\n" : `\n✗ ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
});

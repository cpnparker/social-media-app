/**
 * The URL importer's extraction, checked by making it fail.
 *
 * Scope: the PURE functions only — extractArticleRegion and extractTitle.
 * importFromUrl is network-bound and its two guards that matter (public-address
 * checks, scheme allowlist) belong to safeFetch, which has its own script.
 * This one answers the question those cannot: given a real page's markup, does
 * the article come out and does the chrome stay behind?
 *
 * The stakes are quieter than they look. Extraction feeds the sanitiser, so
 * nothing here is a security boundary — but a wrong REGION choice silently
 * imports a page's navigation as prose, and every downstream number (word
 * count, keyword density, AI-tell rate) is then computed over menu items. The
 * writer sees a bad score for an article that was never read.
 *
 *   npx tsx scripts/verify-optimizer-url.ts
 *
 * MUTATION LOG — every entry run in a throwaway git worktree, never the
 * shared tree (`vercel deploy --prod` uploads the working directory).
 *
 *   2026-08-21  scripts stripped AFTER the region choice   → 1 fail  ✓
 *   2026-08-21  region preference inverted (body first)    → 1 fail  ✓
 *   2026-08-21  the 400-char floor removed                 → 2 fail  ✓
 *   2026-08-21  og:title preference dropped                → 1 fail  ✓
 *   2026-08-21  the site-suffix trim removed               → 1 fail  ✓
 *   2026-08-21  the nav/header/footer strip removed        → 3 fail  ✓ (2nd try)
 *   (baseline, unmutated: exit 0)
 *
 * The nav-strip mutation SURVIVED the first run, and the reason is a shape
 * this repo keeps meeting: the strip is load-bearing only on the BODY-FALLBACK
 * path, because on the article/main paths the chrome sits outside the chosen
 * region and never enters it. Every fixture had an <article> or <main>, so the
 * one page shape where the strip matters — a chromeful page with neither —
 * was exactly the shape not tested. The §2 chromeful-body fixture exists
 * because of that survival.
 *
 * 2026-09-17 — THE CDN REFUSAL (§5, §6). Same method, same detached worktree.
 *
 *   KILLED  403 dropped from the refusal statuses                    → §5 (11 red)
 *   KILLED  importFromUrl back to "That page answered 403."          → §6
 *   KILLED  the CDN's name dropped from the sentence                 → §5.1
 *   KILLED  cdnBlockVendor reading the body without decoding it      → §5.1
 *   KILLED  cdnBlockVendor reading the body but never the headers    → §5.1, §5.4
 *   KILLED  the 429 branch removed, so rate limiting reads as a block→ §5.4
 *   KILLED  the no-retry promise dropped from the 429 wording        → §5.4
 *   KILLED  an ordinary 404 dressed up as a bot block                → §5.5
 *   KILLED  an unbranded 503 read as a refusal                       → §5.5
 *   KILLED  the importer's tabs offered on the sources surface       → §5.5
 *
 * The entity-decode mutation is the one worth reading, because the fix it
 * guards was itself found this way round: the first draft of cdnBlockVendor
 * matched /errors\.edgesuite\.net/ against a body that reads
 * `https&#58;&#47;&#47;errors&#46;edgesuite&#46;net`, and the fixture went red
 * on the real 491 bytes. A paraphrased fixture would have agreed with the
 * paraphrased matcher and both would have been wrong about the live page.
 *
 * 2026-09-17, SECOND PASS — cdnBlockVendor was testing for a CDN's PRESENCE
 * rather than for a BLOCK. `server: cloudflare`, `cf-ray`, `x-iinfo` and
 * `x-akamai-request-id` ride on every response those networks proxy —
 * measured: cloudflare.com's own 404 for a nonsense path carries `server:
 * cloudflare` and a `cf-ray` — so every paywall, permissions error and staging
 * Basic-auth wall behind them was being reported as "that site refuses
 * automated requests… no setting on this side changes it". A confident false
 * claim, which is worse than the useless true one it replaced. §5.6 is that
 * fixture set; the evidence is now edge-generated marks only.
 *
 *   KILLED  cf-ray presence treated as block evidence                → §5.6 (4 red)
 *   KILLED  server: cloudflare treated as block evidence             → §5.6 (4 red)
 *   KILLED  x-akamai-request-id treated as block evidence            → §5.6
 *   KILLED  x-iinfo treated as block evidence                        → §5.6
 *   KILLED  the unbranded refusal dressed up as a CDN block          → §5.5
 *   KILLED  the unbranded 429 given the CDN's sentence               → §5.6
 *   KILLED  the WWW-Authenticate branch removed                      → §5.7
 *   KILLED  401 dropped from the refusal statuses                    → §5.7 (5 red)
 *   KILLED  503 dropped from the refusal statuses                    → §5.4b
 *   KILLED  the AkamaiGHost header rule deleted                      → §5.1
 *   KILLED  the Cloudflare body marks deleted                        → §5.2, §5.4b
 *   KILLED  the entity decode removed                                → §5.1
 *   KILLED  403 dropped from the refusal statuses (re-run)           → §5 (16 red)
 *
 * The unbranded-wording mutation is the one that had SURVIVED the first pass,
 * unrecorded: §5.5 asserted only that no vendor was named and that the surface
 * advice was right, so putting "Its CDN answered 403" into the sentence walked
 * past the whole suite. What a sentence must NOT say turns out to be as
 * load-bearing as what it says, and §5.5 now asserts both. 401 and 503 were
 * unpinned in the same way — both sat in REFUSAL_STATUSES with no fixture
 * reaching them, and this diff had already deleted fetchSourceFromUrl's own
 * 401 branch in favour of that list.
 *
 * SURVIVED  deleting the edgesuite mark from cdnBlockVendor. Akamai's page
 *           carries TWO marks — the edgesuite URL and "Access Denied" beside a
 *           reference id — so the measured body still matches on the other
 *           one. The finding is that the two marks are pinned as a pair and
 *           not individually; a variant carrying only the error URL would go
 *           unnoticed by this check, and is where to look if one turns up.
 *           (Re-run on the second pass, from the other side: deleting the
 *           "Access Denied" + reference-id mark survives too, for the same
 *           reason and with the same finding.)
 */
import { extractArticleRegion, extractTitle, classifyFetchRefusal, refusalMessage } from "../lib/optimizer/url-import";
import { readFileSync } from "fs";
import { join } from "path";

let failures = 0;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const has = (label: string, hay: string, needle: string) =>
  hay.indexOf(needle) >= 0 ? pass(label) : fail(`${label} — ${JSON.stringify(needle)} not found`);
const hasnt = (label: string, hay: string, needle: string) =>
  hay.indexOf(needle) < 0 ? pass(label) : fail(`${label} — ${JSON.stringify(needle)} IS present`);

/** A long-enough article body: the 400-char floor is part of the contract. */
const BODY = "<p>" + "Real article prose about payment routing. ".repeat(12) + "</p>";

// ── 1. Region choice ─────────────────────────────────────────────────────
console.log(`\n1. The article region wins over the chrome`);
{
  const page =
    `<html><body><nav><a href="/">Home</a><a href="/about">About us</a></nav>` +
    `<div class="sidebar">Related stories and other teasers live here</div>` +
    `<article>${BODY}</article>` +
    `<footer>Copyright Vaultline 2026. All rights reserved.</footer></body></html>`;
  const region = extractArticleRegion(page);
  has("the article's prose is in the region", region, "Real article prose");
  hasnt("the nav did not come with it", region, "About us");
  hasnt("the footer did not come with it", region, "All rights reserved");
  hasnt("the sidebar did not come with it", region, "Related stories");

  // Precondition: the fixture's chrome must live OUTSIDE <article>, or the
  // assertions above test the sanitiser's future work, not the region choice.
  page.indexOf("<nav>") < page.indexOf("<article>")
    ? pass("the fixture's chrome sits outside the article")
    : fail("the fixture's chrome is inside the article — region choice is untested");
}

console.log(`\n2. Fallbacks`);
{
  const mainOnly = `<html><body><nav><a>Menu item</a></nav><main>${BODY}</main></body></html>`;
  has("<main> is used when there is no <article>", extractArticleRegion(mainOnly), "Real article prose");
  hasnt("...and the nav still stays behind", extractArticleRegion(mainOnly), "Menu item");

  const bare = `<html><body>${BODY}</body></html>`;
  has("body is the last resort", extractArticleRegion(bare), "Real article prose");

  // The nav strip is load-bearing ONLY here. On the article/main paths the
  // chrome sits outside the chosen region and never enters it, so a mutation
  // deleting the strip survived every earlier fixture — the one page shape
  // where it matters is a chromeful page with no article or main at all.
  const chromefulBody =
    `<html><body><nav><a>Menu item</a><a>Second menu item</a></nav>` +
    `<header>Site masthead text</header>${BODY}<footer>All rights reserved.</footer></body></html>`;
  const fell = extractArticleRegion(chromefulBody);
  has("the body fallback keeps the prose", fell, "Real article prose");
  hasnt("...and strips the nav, which nothing downstream would catch as chrome", fell, "Menu item");
  hasnt("...and the masthead", fell, "masthead");
  hasnt("...and the footer", fell, "All rights reserved");
}

// ── 3. The floor: a teaser <article> must not shadow the real content ────
console.log(`\n3. The 400-character floor`);
{
  // News homepages wrap every card in <article>. Choosing the first tiny one
  // would import a headline and a read-more link as the whole piece.
  const teaser =
    `<html><body><article><p>Short teaser card.</p></article><main>${BODY}</main></body></html>`;
  const region = extractArticleRegion(teaser);
  has("a sub-400-char article is skipped in favour of main", region, "Real article prose");

  // Precondition: the teaser really is under the floor.
  "Short teaser card.".length < 400
    ? pass("the teaser fixture is genuinely under 400 characters")
    : fail("the teaser fixture is too long to test the floor");

  // A script cannot pad a region past the floor: scripts die BEFORE the length
  // test, or a page whose <article> is one line of text and 10k of analytics
  // bootstrap gets chosen on the strength of its JavaScript.
  const padded =
    `<html><body><article><p>One line.</p><script>${"x".repeat(5000)}</script></article>` +
    `<main>${BODY}</main></body></html>`;
  has("script bytes do not count toward the floor", extractArticleRegion(padded), "Real article prose");
}

// ── 4. Titles ────────────────────────────────────────────────────────────
console.log(`\n4. Titles`);
{
  const both =
    `<head><meta property="og:title" content="The Real Name"><title>The Real Name | Vaultline Media</title></head>`;
  extractTitle(both) === "The Real Name"
    ? pass("og:title wins outright")
    : fail(`og:title lost: ${JSON.stringify(extractTitle(both))}`);

  const reversed = `<head><meta content="Reversed Attributes" property="og:title"></head>`;
  extractTitle(reversed) === "Reversed Attributes"
    ? pass("the attribute-order variant of og:title is read")
    : fail(`reversed og:title missed: ${JSON.stringify(extractTitle(reversed))}`);

  const suffixed = `<head><title>Ten Things About Zephyr | Vaultline</title></head>`;
  extractTitle(suffixed) === "Ten Things About Zephyr"
    ? pass("the site suffix is trimmed from a bare <title>")
    : fail(`suffix survived: ${JSON.stringify(extractTitle(suffixed))}`);

  const entities = `<head><title>Q&amp;A: What&#39;s Next</title></head>`;
  extractTitle(entities) === "Q&A: What's Next"
    ? pass("entities decode in titles")
    : fail(`entities survived: ${JSON.stringify(extractTitle(entities))}`);

  extractTitle("<p>no title anywhere</p>") === ""
    ? pass("no title yields empty, never an invention")
    : fail("a title was invented from nothing");
}

// ── 5. A refusal, told apart from a failure ──────────────────────────────
//
// "That page answered 403." is true and useless: it reads as a broken link, so
// the writer checks the address, pastes it again and gets the same sentence.
// What actually happened to the Temasek page was Akamai Bot Manager refusing a
// non-browser client — measured, with `server: AkamaiGHost` and a 491-byte
// Access Denied body carrying an edgesuite reference id, identical for curl's
// UA, a Chrome UA and a Chrome UA with full Accept headers, while a real
// browser on the same network loaded the page.
//
// So these fixtures are the real bodies and the real headers. NOTHING in the
// subject tries to get past a block — no impersonation, no named-crawler user
// agent, and no retry — and §5.4 pins the "no retry" promise to the string,
// because a product that says it will not hammer a blocked origin should mean
// it.
console.log(`\n5. Blocked by a CDN, and saying so`);
{
  const hdr = (h: { [k: string]: string }) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

  // 5.1 Akamai. The measured shape, down to the byte count.
  const AKAMAI = `<HTML><HEAD>
<TITLE>Access Denied</TITLE>
</HEAD><BODY>
<H1>Access Denied</H1>

You don't have permission to access "http&#58;&#47;&#47;www&#46;temasek&#46;com&#46;sg&#47;en&#47;news-and-resources&#47;stories&#47;future&#47;x" on this server.<P>
Reference&#32;&#35;18&#46;5d4c2f17&#46;1757999123&#46;9a1b4c2<P>
https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18&#46;5d4c2f17&#46;1757999123&#46;9a1b4c2
</BODY>
</HTML>`;
  const akamaiHeaders = hdr({ server: "AkamaiGHost", "content-type": "text/html", "server-timing": "cdn-cache; desc=HIT" });
  const a = classifyFetchRefusal(403, akamaiHeaders, AKAMAI);
  a && a.cdn === "Akamai" ? pass("the Akamai 403 is recognised as a CDN refusal") : fail("Akamai's Access Denied was not recognised");
  const aMsg = refusalMessage(403, akamaiHeaders, AKAMAI, "import") || "";
  /refuses automated requests/i.test(aMsg) ? pass("the message says the site refuses automated requests") : fail(`wrong wording: ${aMsg}`);
  /Akamai/.test(aMsg) ? pass("and names the CDN that refused it") : fail("the CDN is not named");
  /the address is not the problem/i.test(aMsg) ? pass("and says the address is not the problem, which is the thing they would otherwise re-check") : fail("the address is not exonerated");
  /Paste it/.test(aMsg) && /Upload a file/.test(aMsg)
    ? pass("and names the two tabs that do work — advice a writer can act on")
    : fail(`no route offered: ${aMsg}`);
  aMsg.indexOf("That page answered 403.") < 0
    ? pass("and the old dead-end sentence is gone from this path entirely")
    : fail("the message is still just a status code");

  // EACH EVIDENCE PATH ON ITS OWN. Mutation testing put these here: with the
  // full response in hand, headers and body both name Akamai, so deleting
  // either path changed nothing and the check could not tell which one was
  // working. A denial page proxied on loses its headers long before it loses
  // its reference id, and a bare refusal can arrive with no body at all.
  const bodyOnly = classifyFetchRefusal(403, hdr({}), AKAMAI);
  bodyOnly && bodyOnly.cdn === "Akamai" ? pass("recognised from the body alone when the headers are gone") : fail("body-only detection missed Akamai");
  const headerOnly = classifyFetchRefusal(403, akamaiHeaders, "");
  headerOnly && headerOnly.cdn === "Akamai" ? pass("and from the header alone when there is no body at all") : fail("header-only detection missed Akamai");

  // 5.2 Cloudflare, both the challenge page and the 1020 rule block.
  const CF_CHALLENGE = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>
<meta http-equiv="refresh" content="390"></head><body class="no-js">
<div id="challenge-error-text">Enable JavaScript and cookies to continue</div>
<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>`;
  const cf = classifyFetchRefusal(403, hdr({ server: "cloudflare", "cf-ray": "8f2a1c4d5e6f0a1b-SIN" }), CF_CHALLENGE);
  cf && cf.cdn === "Cloudflare" ? pass("a Cloudflare challenge is recognised") : fail("the Cloudflare challenge was missed");
  const CF_1020 = `<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head>
<body><h1>Error 1020</h1><p>Ray ID: 8f2a1c4d5e6f0a1b</p><p>Access denied</p></body></html>`;
  const cf2 = classifyFetchRefusal(403, hdr({}), CF_1020);
  cf2 && cf2.cdn === "Cloudflare" ? pass("and so is error 1020 with no headers left on it") : fail("error 1020 was missed");

  // 5.3 Imperva, on the header its WAF always sets.
  const imp = classifyFetchRefusal(403, hdr({ "x-iinfo": "9-12345678-0 NNNN CT(1 1 0)" }), "<html><body>Request unsuccessful. Incapsula incident ID: 123-456</body></html>");
  imp && imp.cdn === "Imperva" ? pass("Imperva is recognised too") : fail("Imperva was missed");

  // 5.4 Rate limiting is its own sentence, and carries the no-retry promise.
  // A 429 usually arrives with nothing in the body, so the vendor name here can
  // only have come from the header — `cf-mitigated`, which Cloudflare sets when
  // its OWN rules acted. That is what pins the header path.
  const rl = refusalMessage(429, hdr({ server: "cloudflare", "cf-ray": "abc-SIN", "cf-mitigated": "challenge" }), "", "import") || "";
  /rate-limiting/i.test(rl) ? pass("a 429 is described as rate limiting, not as a block") : fail(`429 wording: ${rl}`);
  /Nothing here will retry it/.test(rl) ? pass("and promises no retry — hammering a blocked origin is not a fix") : fail("the no-retry promise is missing");
  /Cloudflare/.test(rl) ? pass("and names the CDN, from a header on an empty body") : fail(`the CDN was lost on an empty body: ${rl}`);

  // 5.4b LEGACY CLOUDFLARE SERVES A BLOCK AS 503, which is the only reason 503
  // is in the refusal list at all. Unbranded it stays an origin having a bad
  // day (5.5); with the block page on it, it is a block.
  const CF_503 = `<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head>
<body><h1>Error 1015</h1><p>You are being rate limited</p></body></html>`;
  const legacy = classifyFetchRefusal(503, hdr({ server: "cloudflare", "cf-ray": "abc-SIN" }), CF_503);
  legacy && legacy.cdn === "Cloudflare" ? pass("a legacy Cloudflare 503 block page IS a refusal") : fail("the branded 503 was dropped — then nothing in the list justifies 503 being in it");

  // 5.5 The ORDINARY failures keep the plain wording. A check that turns every
  // failure into a CDN story is a check that cries wolf.
  classifyFetchRefusal(404, hdr({ server: "nginx" }), "<html><body>Not found</body></html>") === null
    ? pass("a 404 is NOT a refusal — plain wording survives")
    : fail("a 404 was dressed up as a bot block");
  classifyFetchRefusal(500, hdr({ server: "AkamaiGHost" }), "error") === null
    ? pass("nor is a 500, even from behind Akamai — a CDN in front of a broken origin is not a refusal")
    : fail("a 500 behind a CDN was read as a bot block");
  classifyFetchRefusal(503, hdr({ server: "nginx" }), "<html><body>Service Unavailable</body></html>") === null
    ? pass("nor is an unbranded 503 — an origin having a bad day is not bot protection")
    : fail("a plain 503 was read as a refusal");
  const bare = classifyFetchRefusal(403, hdr({ server: "nginx" }), "<html><head><title>403 Forbidden</title></head><body><h1>403 Forbidden</h1></body></html>");
  bare && bare.cdn === null ? pass("a plain 403 IS a refusal, but names no vendor it cannot see") : fail("an unbranded 403 invented a CDN");
  const bareMsg = refusalMessage(403, hdr({ server: "nginx" }), "403 Forbidden", "source") || "";
  /attach it with File/.test(bareMsg) ? pass("and the sources surface gets ITS route, not the importer's") : fail(`wrong surface advice: ${bareMsg}`);
  !/Paste it/.test(bareMsg) ? pass("with no tab named that is not on that screen") : fail("the importer's tabs leaked onto the sources surface");
  // THE UNBRANDED SENTENCE ITSELF, which nothing pinned until a mutation put
  // the CDN claim into it and walked past the whole suite. It is the sentence
  // that has to stay true whether the 403 came from bot protection, a paywall
  // or a misconfigured origin, so what it must NOT say is as load-bearing as
  // what it says.
  !/refuses automated requests/i.test(bareMsg) && !/CDN/.test(bareMsg)
    ? pass("and claims nothing about WHY, because from here we cannot see why")
    : fail(`the unbranded refusal invented a diagnosis: ${bareMsg}`);
  /serve a page to a browser and refuse a server/i.test(bareMsg)
    ? pass("keeping the browser-versus-server hedge, which is true of all three causes")
    : fail(`the hedge is gone: ${bareMsg}`);

  // 5.6 A CDN IN FRONT IS NOT A BLOCK. `server: cloudflare`, `cf-ray`,
  // `x-iinfo` and `x-akamai-request-id` ride on EVERY response those networks
  // proxy — measured: cloudflare.com's own 404 for a nonsense path carries
  // `server: cloudflare` and a `cf-ray`. Read as evidence they turn every
  // paywall, permissions error and staging wall behind those networks into
  // "that site refuses automated requests… no setting on this side changes
  // it", which is false three times over for a page you could read by signing
  // in. These are the fixtures that hold the line.
  const CF_ORIGIN = { server: "cloudflare", "cf-ray": "8f2a1c4d5e6f0a1b-ZRH" };
  const paywall = classifyFetchRefusal(403, hdr(CF_ORIGIN), "<html><body><h1>Members only</h1><p>Subscribe to keep reading.</p></body></html>");
  paywall && paywall.cdn === null
    ? pass("a paywall 403 behind Cloudflare names no CDN — the origin wrote that page, Cloudflare relayed it")
    : fail("a members-only page was reported as a bot block");
  const paywallMsg = refusalMessage(403, hdr(CF_ORIGIN), "<html><body><h1>Members only</h1></body></html>", "import") || "";
  !/refuses automated requests/i.test(paywallMsg)
    ? pass("and is not told the site refuses automated requests, which it does not")
    : fail(`the paywall got the bot-block sentence: ${paywallMsg}`);
  const originRl = refusalMessage(429, hdr(CF_ORIGIN), '{"error":"too many requests from this account"}', "import") || "";
  !/CDN/.test(originRl) && /Nothing here will retry it/.test(originRl)
    ? pass("an account rate limit behind Cloudflare is still described as rate limiting, but without a CDN it cannot see")
    : fail(`the origin's own 429 was attributed to the CDN: ${originRl}`);
  const impOrigin = classifyFetchRefusal(403, hdr({ "x-iinfo": "9-12345678-0 NNNN CT(1 1 0)" }), "<html><body><h1>Forbidden</h1></body></html>");
  impOrigin && impOrigin.cdn === null
    ? pass("Imperva's routing header on an ordinary origin 403 is not a block either")
    : fail("x-iinfo alone was read as an Incapsula block");
  const akaOrigin = classifyFetchRefusal(403, hdr({ "x-akamai-request-id": "1a2b3c4d", server: "Apache" }), "<html><body><h1>403 Forbidden</h1></body></html>");
  akaOrigin && akaOrigin.cdn === null
    ? pass("nor is an Akamai request id in front of an Apache 403 — AkamaiGHost is the edge, Apache is the origin")
    : fail("an Akamai routing header was read as a bot block");

  // 5.7 A 401 THAT ASKS FOR CREDENTIALS SAYS SO. The browser-versus-server
  // hedge is a guess when the response is holding the one header that states
  // what it wants, and this is the surface that regressed into it: the
  // importer used to answer this with the flat "That page answered 401."
  const stagingHdrs = hdr({ server: "nginx", "www-authenticate": 'Basic realm="Staging"' });
  const staging = refusalMessage(401, stagingHdrs, "", "import") || "";
  /needs a sign-in/i.test(staging) && /401/.test(staging)
    ? pass("a 401 carrying WWW-Authenticate is reported as needing a sign-in")
    : fail(`the credentials challenge was ignored: ${staging}`);
  !/refuses automated requests/i.test(staging)
    ? pass("and is not dressed up as bot protection")
    : fail("a Basic-auth wall was reported as a bot block");
  /Paste it/.test(staging) ? pass("with the same way through — the page is readable once they are signed in") : fail("no route offered on a 401");
  const stagingSrc = refusalMessage(401, stagingHdrs, "", "source") || "";
  /attach it with File/.test(stagingSrc) ? pass("and the sources surface keeps its own route on a 401") : fail(`wrong surface advice on 401: ${stagingSrc}`);
  const behindCf = refusalMessage(401, hdr({ ...CF_ORIGIN, "www-authenticate": 'Basic realm="Staging"' }), "", "import") || "";
  /needs a sign-in/i.test(behindCf)
    ? pass("and a staging wall behind Cloudflare is still a sign-in, not a CDN refusing automated clients")
    : fail(`the CDN header beat the response's own statement: ${behindCf}`);
  const bare401 = refusalMessage(401, hdr({ server: "nginx" }), "Unauthorized", "import") || "";
  /HTTP 401/.test(bare401) && !/needs a sign-in/i.test(bare401)
    ? pass("while a 401 with no challenge header keeps the hedge — 401 must stay in the refusal list for either to be reached")
    : fail(`the bare 401 fell through to plain wording: ${bare401}`);
}

// ── 6. The wording is actually wired to the failures ─────────────────────
//
// The classifier is pure and the fetch is not, so this is the one thing only
// the source can answer: that both refusal paths CALL it. A repo that has
// already reported a live security hole closed on the strength of a line
// merely existing does not get to assert "the function is defined".
console.log(`\n6. Both refusal paths use it`);
{
  // BLOCK COMMENTS ARE STRIPPED BY A LINE-ANCHORED OPENER, not by the obvious
  // /\/\*[\s\S]*?\*\//. This very file is why: the Accept header ends
  // "…application/pdf,*/*;q=0.8", whose `/*` opens a comment the naive stripper
  // closes far below, swallowing the entire 401/403 branch. It reported the
  // sources path as unwired while the code was sitting right there. A source
  // assertion reading a mangled copy of the file is the "check that silently
  // tests nothing" failure — this time it happened to fail loudly, which is the
  // only reason it was caught rather than quietly agreeing with itself.
  //
  // The closer stays un-anchored (it only has to end its line) because a
  // one-line `/* … */` is a shape this file uses.
  const src = readFileSync(join(__dirname, "..", "lib/optimizer/url-import.ts"), "utf8")
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, "").replace(/^\s*\/\/.*$/gm, "");
  const importer = src.slice(src.indexOf("export async function importFromUrl"), src.indexOf("export async function fetchSourceFromUrl"));
  const sources = src.slice(src.indexOf("export async function fetchSourceFromUrl"));
  /refusalMessage\(res\.status, res\.headers, refusedBody, "import"\)/.test(importer)
    ? pass("importFromUrl classifies its own refusals")
    : fail("importFromUrl still answers a 403 with a status code");
  /refusalMessage\(res\.status, res\.headers, refusedBody, "source"\)/.test(sources)
    ? pass("and so does the background-source fetch, on its own surface")
    : fail("the sources path was left behind — the recorded failure mode of this repo");
  // No retry. Not a loop, not a second attempt with different headers, not a
  // named crawler's user agent to see whether that one is allowed in.
  !/GPTBot|Googlebot|ClaudeBot|PerplexityBot/.test(src)
    ? pass("and nothing sends a named crawler's user agent to test the allow-list")
    : fail("a crawler user-agent is being impersonated");
  !/for\s*\([^)]*\)\s*\{[^}]*safeFetch/.test(src) && (src.match(/safeFetch\(/g) || []).length === 3
    ? pass("three fetches, none of them in a retry loop")
    : fail("a retry against a blocked origin appeared");
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);

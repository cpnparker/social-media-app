/**
 * Import a published page by URL.
 *
 * The most common real content to optimise is content that is already live —
 * a client's published article that should start earning AI citations. The
 * writer pastes the URL; this fetches the page, cuts the article out of the
 * chrome, and hands it to the same converter every other import uses.
 *
 * SSRF: the URL is user-supplied and fetched server-side, which is exactly the
 * shape safeFetch exists for — public-address checks on every redirect hop,
 * scheme allowlist, size cap. This module never calls fetch directly.
 *
 * EXTRACTION over readability libraries, deliberately. A dependency that walks
 * arbitrary DOM needs a DOM implementation server-side; this needs only the
 * repo's existing regex-over-HTML idiom, and its failure mode is honest — if
 * no article container is found it falls back to <body>, and the sanitiser
 * already strips nav/script/style wholesale.
 */

import { safeFetch } from "@/lib/net/safe-fetch";
import { toEditorHtml } from "./import-html";
import { botWallVendor, challengeVendor, type SiteRefusal } from "./site-reach";
import { notRobotsReason } from "./crawler-access";

const MAX_HTML_BYTES = 3_000_000;

export interface UrlImportResult {
  ok: boolean;
  title?: string;
  html?: string;
  /** The page's own publisher — see extractSiteBrand. First-party source for
   *  claims the page makes about itself. */
  siteName?: string;
  error?: string;
}

/**
 * A REFUSAL, told apart from a failure.
 *
 * "That page answered 403." is true and useless. It reads as a broken link, so
 * the writer checks the address, pastes it again, gets the same sentence and
 * concludes the product cannot read their client's site.
 *
 * What actually happened to the Temasek page is a different thing entirely and
 * it is knowable from the response we already hold. Akamai Bot Manager refused
 * it: `server: AkamaiGHost`, a 491-byte Access Denied body carrying an
 * edgesuite reference id. Measured, not assumed — the same 403 came back for
 * curl's default user agent, for a Chrome user agent, and for a Chrome user
 * agent with full Accept and Accept-Language headers, while a real browser on
 * the same network loaded the page fine. The refusal is on the client's
 * fingerprint, the whole origin does it (/, the article and /robots.txt alike),
 * and the site is entitled to do it.
 *
 * So the product's job is to SAY so: that the site refuses automated requests,
 * that this is the site's CDN and not a wrong address, and what to do instead.
 * Nothing here tries to get around a block — no impersonation, no named-crawler
 * user agent, and explicitly no retry, because retrying a bot block is how a
 * blocked origin gets hammered by a product that has already been told no.
 *
 * Pure, so the check can drive it from fixtures: everything comes in as data,
 * including the headers. This half carries the DIAGNOSIS alone — what to do
 * next differs by surface, and refusalMessage below puts the two together, so
 * that the sentence a person actually reads is itself a pure value a fixture
 * can assert. A diagnosis with no way out of it is the same dead end as "That
 * page answered 403." in better prose.
 */
export interface FetchRefusal {
  /** The CDN that signed the refusal, when one signed it. */
  cdn: string | null;
  /**
   * WHICH of the three tiers below answered, as a value rather than as a
   * sentence to be read back.
   *
   * The audit needs to tell a bot wall from a credentials wall — the first is
   * an AI-visibility finding and the second is a login page — and the only
   * thing that knew the difference was the wording. Re-deriving it with a regex
   * over `diagnosis` is precisely the failure this repo keeps paying for: a
   * check that a LINE exists, standing in for what the line evaluates to. So
   * the classifier says which tier it took, and the two callers agree because
   * they are reading the same field.
   */
  kind: "cdn" | "rate-limit" | "sign-in" | "unattributed";
  /** What happened, in the product's voice, with no advice attached. */
  diagnosis: string;
}

/**
 * Statuses a refusal actually arrives as.
 *
 * 503 is legacy Cloudflare's, and it only ever reaches the branded wording:
 * an unbranded 503 is an origin having a bad day, which classifyFetchRefusal
 * says in as many words.
 */
const REFUSAL_STATUSES = [401, 403, 429, 503];

type HeaderBag = { get(name: string): string | null } | null | undefined;

/**
 * Which CDN's bot protection SIGNED this refusal — not which CDN is in front
 * of the site.
 *
 * That distinction is the whole function, and getting it wrong produces a
 * confident false claim rather than a vague one. `server: cloudflare`, `cf-ray`,
 * `x-iinfo` and `x-akamai-request-id` are stamped on EVERY response those
 * networks proxy, not on blocks: measured 2026-09-17, `curl -sIL
 * https://www.cloudflare.com/this-page-does-not-exist-abc123` answers an
 * ordinary 404 — and a 301 before it — carrying `server: cloudflare` and a
 * `cf-ray`, and carrying no `cf-mitigated`, which is the discriminator. Read as
 * evidence, they turn every paywall, members-only page, app permissions error
 * and staging Basic-auth wall behind those networks into "that site refuses
 * automated requests… no setting on this side changes it" — three claims that
 * are all false of a paywall, where signing in is exactly what changes it.
 *
 * So this asks only for marks the EDGE writes when the edge itself refuses:
 *
 *   - Akamai: `server: AkamaiGHost`, which is the edge generating the response
 *     rather than passing one through; or the Access Denied body, which carries
 *     a reference id and an errors.edgesuite.net URL.
 *   - Cloudflare: `cf-mitigated`, set when Cloudflare's own rules act; or the
 *     challenge and block pages — the cdn-cgi challenge script, "Just a
 *     moment", "Attention Required", an Error 10xx code. Not a bare Ray ID:
 *     Cloudflare's ORIGIN-error pages (502, 522, 523) carry one too.
 *   - Imperva: the Incapsula incident body its block page prints.
 *
 * With none of those the caller falls through to wording that names no vendor
 * and claims nothing about why — which is honest about a 403 whose cause we
 * genuinely cannot see from here.
 */
export function cdnBlockVendor(headers: HeaderBag, body: string): string | null {
  const h = (name: string) => String((headers && headers.get(name)) || "");
  const server = h("server").toLowerCase();

  if (server.indexOf("akamaighost") >= 0) return "Akamai";
  if (h("cf-mitigated")) return "Cloudflare";

  // THE BODY MARKS LIVE IN ONE PLACE, lib/optimizer/site-reach.ts, because the
  // audit now asks the same question of a 200 and two copies of "which vendor
  // wrote this page" would drift the first time a vendor changed its wording.
  // That shared half is deliberately the NARROW one — machine artefacts only,
  // including the entity decode Akamai's page needs.
  const shared = botWallVendor(body);
  if (shared) return shared;

  // And these are the ones only THIS caller may use, because only this caller
  // has a refusing status behind it. "Just a moment" is a sentence a person
  // could write and `/cdn-cgi/` is a directory a robots.txt routinely names —
  // both are fine as corroboration of a 403 and neither is evidence on its own.
  const b = String(body || "").slice(0, 4000);
  if (/cdn-cgi\/|attention required|just a moment/i.test(b)) return "Cloudflare";
  return null;
}

/**
 * Is this failed response a refusal worth explaining, and what is it?
 *
 * Returns null for an ordinary failure — a 404, a 500, a wrong address — where
 * "answered 404" is exactly the right thing to say and dressing it up as a bot
 * block would be a guess presented as a diagnosis.
 *
 * Three tiers, deliberately, because a classifier that turns every 4xx into a
 * CDN story cries wolf: a signed block gets the bot-block wording; a 401 whose
 * response ASKS FOR CREDENTIALS gets the sign-in wording; an unbranded 401/403
 * gets the hedge that stays true whichever of the three it was.
 */
export function classifyFetchRefusal(status: number, headers: HeaderBag, body: string): FetchRefusal | null {
  if (REFUSAL_STATUSES.indexOf(status) < 0) return null;
  const cdn = cdnBlockVendor(headers, body);

  if (status === 429) {
    return {
      cdn,
      kind: "rate-limit",
      diagnosis: cdn
        ? `That site is rate-limiting automated requests — its CDN (${cdn}) answered 429. Nothing here will retry it.`
        // Unbranded: it may be the site's own per-account or per-IP limiter, so
        // "automated requests" would be a guess. What is certain is that it was
        // this server asking, and that nothing here will ask again.
        : "That site is rate-limiting requests from this server — it answered 429. Nothing here will retry it.",
    };
  }
  if (cdn) {
    return {
      cdn,
      kind: "cdn",
      diagnosis:
        `That site refuses automated requests. Its CDN (${cdn}) answered ${status} before the page itself was reached — ` +
        "the address is not the problem, and no setting on this side changes it.",
    };
  }
  // A 401 CARRYING WWW-Authenticate IS NOT A GUESS. "May need a sign-in" was
  // dropped from the wording below because it was exactly that on a bare 403 —
  // but a challenge header is the response's own statement of what it wants,
  // and answering it with the browser-versus-server story sends the reader off
  // to test a theory the server already ruled out.
  if (status === 401 && h401(headers)) {
    return { cdn: null, kind: "sign-in", diagnosis: "That page needs a sign-in — the site asked for credentials (HTTP 401)." };
  }
  // 503 with nothing to point at is an origin having a bad day, not a refusal.
  if (status === 503) return null;
  return {
    cdn: null,
    kind: "unattributed",
    diagnosis:
      `That site refused the request (HTTP ${status}). Plenty of sites serve a page to a browser and refuse a server ` +
      "asking for the same thing.",
  };
}

/** The credentials challenge, read through the same bag as everything else. */
function h401(headers: HeaderBag): boolean {
  return !!(headers && headers.get("www-authenticate"));
}

/**
 * The AUDIT's version of the same question, which has to answer it for a 200.
 *
 * classifyFetchRefusal above serves the importer, where the status has already
 * failed and the only question left is who refused and what to tell the writer.
 * The audit asks something harder: a block is NOT ALWAYS A 4xx. Measured across
 * 77 client sites on 2026-09-17, two answer /robots.txt with a success status
 * and no file —
 *
 *   www.zurich.com  200, text/html, 212 bytes of Imperva challenge carrying a
 *                   META robots noindex,nofollow and an _Incapsula_Resource
 *                   script;
 *   www.ieee.org    202 Accepted with a ZERO-BYTE body, from CloudFront.
 *
 * The second is the one that was live: readSiteFile accepted the 202, handed
 * the empty string on, and an empty robots.txt is a REAL AND OPEN robots file —
 * so the panel printed "robots.txt allows all 6 AI crawlers checked on this
 * path" about a site that had served it nothing at all.
 *
 * ── THE THREE DISCRIMINATIONS, EACH OF WHICH IS A MEASUREMENT ───────────────
 *
 * 202-WITH-NOTHING versus 200-WITH-NOTHING. www.ifpma.org answers /robots.txt
 * 200, text/plain, zero bytes: a genuinely empty robots.txt, which really does
 * allow everything, and condemning it would invent a block nobody wrote. The
 * discriminator is not the empty body — both are empty — it is the status. A
 * 200 with nothing in it is a file with nothing in it; a 202 is a request
 * accepted and a file not sent, which is not a robots.txt whatever produced it.
 * 204 goes with the 200: "no content" is what a 204 is FOR, and reading the
 * spec's own way of saying "there is nothing here" as a wall would be inventing
 * a block out of a correct answer.
 *
 * A ROBOTS FILE IS NEVER A CHALLENGE, whatever strings are in it. Shopify's
 * robots.txt contains `Disallow: /cdn-cgi/challenge-platform*`. So on the
 * robots path the body is offered to notRobotsReason FIRST, and a body that
 * parses as directives is a file and the question stops there. One judge, one
 * rule — the same predicate the crawler check refuses on.
 *
 * A CREDENTIALS WALL IS NOT BOT MANAGEMENT. A 401 that asks for a password is
 * a staging site or a members area; saying "this site refuses AI crawlers" of
 * it, and sending the reader to their CDN team, would be wrong in the exact
 * direction this panel's own rule forbids. It is dropped here rather than
 * reported, and the tier comes off `kind` rather than out of the sentence.
 *
 * ── AND ONLY 401 AND 403, WHICH IS NARROWER THAN THE IMPORTER'S LIST ────────
 *
 * The importer explains whatever went wrong to somebody who is standing there
 * watching it go wrong, so a 429 and a 503 belong in its list: "it is rate
 * limiting us" and "that origin is having a bad day" are the two most useful
 * things it can say in the moment. The audit is doing something else — writing
 * a standing sentence into a report a client reads next week — and neither of
 * those survives the trip.
 *
 *   A 429 IS A MOMENT, NOT A POSTURE. It clears on the next run, and the
 *   classifier above already knows an unbranded one may be the site's own
 *   per-account limiter. Printing "this site refuses non-browser clients" off
 *   it, and sending a comms team to their CDN team about it, describes a
 *   condition that no longer exists by the time anyone reads the sentence.
 *
 *   AND A 503 IS AN OUTAGE. Worse, it is the one status where the vendor marks
 *   actively mislead: any Cloudflare-proxied origin's own maintenance page
 *   links `/cdn-cgi/` assets, so "We'll be back shortly" behind Cloudflare gets
 *   attributed to bot management by a rule whose real discriminator is whether
 *   the site uses Cloudflare at all.
 */
export function auditRefusal(
  where: "page" | "robots",
  url: string,
  status: number,
  headers: HeaderBag,
  body: string
): SiteRefusal | null {
  if (status >= 200 && status < 300) {
    const b = String(body || "");
    // 204 IS THE ONE 2xx THAT MEANS "NOTHING TO SEND", and it means it in the
    // spec rather than by accident — so an empty 204 is an empty file, exactly
    // as an empty 200 is, and an empty robots.txt leaves every crawler
    // unrestricted. www.ieee.org's 202-with-nothing is the shape this rule is
    // for: a success status that accepted the request and answered no file.
    if (status !== 200 && status !== 204 && !b.trim()) return { where, url, status, cdn: null, kind: "empty" };
    if (where === "robots" && notRobotsReason(b) === null) return null;
    // The NARROW read — see challengeVendor. A 2xx body has no failing status
    // standing behind it, and the page it might wrongly condemn is one the
    // audit is scoring in the same breath.
    const vendor = challengeVendor(b);
    return vendor ? { where, url, status, cdn: vendor, kind: "challenge" } : null;
  }
  if (status !== 401 && status !== 403) return null;
  const refusal = classifyFetchRefusal(status, headers, body);
  if (!refusal || refusal.kind === "sign-in") return null;
  return { where, url, status, cdn: refusal.cdn, kind: "status" };
}

/**
 * The whole sentence a person reads, diagnosis and way through.
 *
 * Composed here rather than at each call site so the check can assert the
 * STRING — the diagnosis is only half the fix, and a diagnosis with no way
 * through is the same dead end as "That page answered 403." in better prose.
 * The tabs are named, because "import it another way" is advice a writer
 * cannot act on: the importer's screen offers Paste it and Upload a file, and
 * a background source is attached with File.
 *
 * Returns null for an ordinary failure, where the caller's own wording is right.
 */
export function refusalMessage(
  status: number,
  headers: HeaderBag,
  body: string,
  surface: "import" | "source"
): string | null {
  const refusal = classifyFetchRefusal(status, headers, body);
  if (!refusal) return null;
  const instead =
    surface === "import"
      ? "Open the page in your browser and bring the article in with Paste it — or save the page and use Upload a file."
      : "Open the link yourself, save the file, and attach it with File.";
  return `${refusal.diagnosis} ${instead}`;
}

/** Cut the region most likely to be the article out of a full page. */
export function extractArticleRegion(page: string): string {
  // Kill the wrappers whose CONTENT must not survive even as text, before any
  // region choice — a <script> inside <article> is still a script.
  const s = page
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, " ")
    // Chrome that lives INSIDE <article>/<main> and so survives the tag strip
    // above. Both rules are structural rather than class-based, because class
    // names are per-site guesses and dropping real content is the worse error.
    //
    // A control's label is never article prose: a close button contributed
    // "&times;" as the block right after the H1, and answer-first-position
    // anchored the article's opening to it.
    .replace(/<button\b[\s\S]*?<\/button\s*>/gi, " ")
    // Hidden from the accessibility tree or from display is hidden from a
    // reader, and this audit reports on what a reader (and a crawler) sees.
    // The glyph above sat in a display:none aria-hidden video modal.
    .replace(/<(\w+)\b[^>]*\b(?:aria-hidden=["']true["']|hidden)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(\w+)\b[^>]*style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi, " ");

  // Preference order: the page's own claim about where the article is.
  for (const tag of ["article", "main"]) {
    const m = s.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "i"));
    if (m && m[1].replace(/<[^>]+>/g, "").trim().length > 400) return m[1];
  }
  const body = s.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  return body ? body[1] : s;
}

/**
 * A Google link that reached the GENERIC page fetch — which now means one we
 * cannot export.
 *
 * Docs, Sheets, Slides and Drive-hosted files are all handled before this
 * point, by the sources route, from the link itself rather than from what the
 * client claimed. What is left is the rest of Google — Forms, Calendar, a
 * folder — and for those the old advice ("download it") is the right advice.
 *
 * It still matters, because the fetch below refuses only on `if (!text)` and a
 * Google viewer shell HAS text: menu labels, a filename, "Sign in". Without
 * this the attach succeeds and stores Google's chrome as the writer's research.
 *
 * Exported so the check can run it rather than grep for its strings.
 */
export function googleLinkKind(rawUrl: string): string | null {
  let host = "", path = "";
  try {
    const u = new URL(rawUrl);
    host = u.hostname.toLowerCase();
    path = u.pathname;
  } catch {
    return null;
  }
  // Exact hosts, not a substring: "docs.google.com.evil.test" is a different
  // registrable domain and must not be treated as Google at all.
  if (host !== "docs.google.com" && host !== "drive.google.com") return null;

  // The four exportable shapes are handled upstream. If one reaches here the
  // caller bypassed that path, and refusing a link the product supports would
  // be worse than the junk this guards against — so let it through.
  if (/^\/(document|spreadsheets|presentation)\//.test(path)) return null;
  if (host === "drive.google.com") return null;

  return "That Google link is not a document, sheet, deck or file. Open it, export what you need, and attach that.";
}

/**
 * The PUBLISHER of an imported page, from the page's own disclosure.
 *
 * An imported article usually has no client attached, so it had no brand
 * names, so every first-party figure on it read as an unsourced statistic —
 * "Amrize generated $11.7 billion in revenue" was marked source-less on
 * Amrize's own site. The publisher of a page is a first-party source for
 * claims about itself, and the page states who that is.
 *
 * og:site_name first because it is the publisher's own words. The domain is
 * the fallback, stripped of www and the public suffix: a host is not a brand,
 * but "amrize" matches "Amrize" once both are compared case-insensitively,
 * and being wrong here costs a missing source note, not a false one.
 */
export function extractSiteBrand(page: string, finalUrl?: string): string {
  const meta = page.match(/<meta\s[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)
    || page.match(/<meta\s[^>]*content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i)
    || page.match(/<meta\s[^>]*name=["']application-name["'][^>]*content=["']([^"']+)["']/i);
  if (meta) {
    const name = decodeTitle(meta[1]).slice(0, 60).trim();
    if (name) return name;
  }
  try {
    const host = new URL(finalUrl || "").hostname.replace(/^www\./i, "");
    const label = host.split(".")[0] || "";
    if (label.length >= 3) return label;
  } catch {
    /* no usable URL — no publisher, which is a fine answer */
  }
  return "";
}

/**
 * The publisher to score a session against: the client's own name if one is
 * attached, else the page's, else nothing.
 *
 * Resolved at READ time from the stored source URL rather than only at import,
 * because import-time-only would have left every session created before the
 * publisher existed permanently without one — and those are exactly the
 * sessions someone is looking at when they notice their own figures reported
 * as unsourced. A stored ref that is not a URL (a content id, a file name)
 * yields "", which is the correct answer for a piece that was never fetched.
 */
export function publisherFor(canon: { brandName?: string; publisherName?: string } | null | undefined, sourceRef?: string | null): string {
  const c = canon || {};
  if (c.brandName) return "";           // a real client canon already supplies the first party
  if (c.publisherName) return c.publisherName;
  return extractSiteBrand("", sourceRef || "");
}

/** The page's own name for itself: og:title beats <title>, which carries the site suffix. */
export function extractTitle(page: string): string {
  const og = page.match(/<meta\s[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    || page.match(/<meta\s[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  if (og) return decodeTitle(og[1]);
  const t = page.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) {
    // "Article Name | Site Name" — keep the article's half.
    return decodeTitle(t[1]).split(/\s*[|–—]\s+/)[0].trim();
  }
  return "";
}

function decodeTitle(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** The raw page plus fetch metadata, for the live-page audit. Same safeFetch,
 *  same UA — the audit must see the page a crawler sees, unsanitised. */
export async function fetchPageForAudit(rawUrl: string): Promise<
  { ok: true; page: string; finalUrl: string; httpStatus: number; refusal: SiteRefusal | null }
  | { ok: false; error: string }
> {
  const url = (rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Not a web address." };
  try {
    const res = await safeFetch(url, {
      timeoutMs: 20_000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        // BROADER THAN WHAT WE WANT, on purpose. A narrow Accept of
        // "text/html,application/xhtml+xml" was getting 403 from servers that
        // hold a non-HTML file at that address — measured against a live TYPO3
        // dumpFile URL, where the identical request with */* returned 200.
        // Being refused before we can even look at the content type is worse
        // than fetching and then declining: the content-type check below still
        // rejects anything that is not a page, so nothing downstream changes.
        Accept: "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
      },
    });
    const page = await res.text();
    if (page.length > MAX_HTML_BYTES) return { ok: false, error: "That page is too large to read." };
    // A NON-200 STILL COMES BACK AS A PAGE, ON PURPOSE AND FOR NOW.
    //
    // This is the audit's fetch, not the importer's, and the audit's contract
    // is to report what is at the address rather than to refuse it. So a CDN
    // block arrives here as httpStatus 403 and a 491-byte Access Denied body,
    // and every check downstream then measures that denial page: no title, no
    // H1, no schema — a page of findings about a page nobody has seen.
    //
    // WHAT CHANGED: the seam left named here is now wired. The refusal is
    // classified and threaded to the audit as DATA, and what the audit RETURNS
    // is untouched — a blocked page still comes back as the page, so nothing
    // downstream of this line behaves differently. A page no automated client
    // can fetch is a real AI-visibility fact, and page-audit says so in a
    // finding of its own rather than this function refusing the URL.
    return {
      ok: true,
      page,
      finalUrl: res.url || url,
      httpStatus: res.status,
      refusal: auditRefusal("page", res.url || url, res.status, res.headers, page),
    };
  } catch (e: any) {
    // NO RESPONSE AT ALL — a timeout, a reset, a refused connection. There is no
    // status and no body to classify, so there is nothing to diagnose: naming a
    // bot block here would be a guess, and the audit needs the live page, so
    // Paste it / Upload a file is not the alternative it is on the import
    // screen. The two honest sentences are the ones already here.
    return { ok: false, error: String(e?.message || "").indexOf("not a public address") >= 0 ? "That address is not reachable from here." : "Could not reach that page." };
  }
}

export async function importFromUrl(rawUrl: string): Promise<UrlImportResult> {
  const url = (rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "That is not a web address — it should start with https://" };
  }

  let res: Response;
  try {
    res = await safeFetch(url, {
      timeoutMs: 20_000,
      headers: {
        // Some CDNs serve bots an interstitial; a browserish UA gets the page.
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        // BROADER THAN WHAT WE WANT, on purpose. A narrow Accept of
        // "text/html,application/xhtml+xml" was getting 403 from servers that
        // hold a non-HTML file at that address — measured against a live TYPO3
        // dumpFile URL, where the identical request with */* returned 200.
        // Being refused before we can even look at the content type is worse
        // than fetching and then declining: the content-type check below still
        // rejects anything that is not a page, so nothing downstream changes.
        Accept: "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
      },
    });
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.indexOf("not a public address") >= 0) {
      return { ok: false, error: "That address is not reachable from here." };
    }
    return { ok: false, error: "Could not reach that page." };
  }
  if (!res.ok) {
    // The body of the refusal is evidence, and we already have the response —
    // reading it is not a second request, and there is deliberately no retry.
    const refusedBody = await res.text().catch(() => "");
    const refused = refusalMessage(res.status, res.headers, refusedBody, "import");
    if (refused) return { ok: false, error: refused };
    if (res.status === 404) return { ok: false, error: "That page answered 404 — check the address, or the page may have moved." };
    return { ok: false, error: `That page answered ${res.status}.` };
  }

  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (ctype && ctype.indexOf("html") < 0) {
    return { ok: false, error: "That address is not an article page." };
  }

  const page = await res.text();
  if (page.length > MAX_HTML_BYTES) {
    return { ok: false, error: "That page is too large to read." };
  }

  const region = extractArticleRegion(page);
  const html = toEditorHtml(region, true);
  if (!html.replace(/<[^>]+>/g, "").trim()) {
    return { ok: false, error: "Could not find any article text on that page." };
  }
  return { ok: true, title: extractTitle(page), html, siteName: extractSiteBrand(page, res.url || url) };
}

/**
 * Fetch a URL as BACKGROUND MATERIAL, which is a different job from importing.
 *
 * importFromUrl exists to mint a document that will be SCORED, so it refuses
 * anything that is not a page: the rubric measures structure, and a PDF's
 * headings and lists do not survive extraction. Background material is read for
 * its WORDS — it is never edited, never scored, never listed as content — so
 * the same refusal there is a rule enforced for a reason that does not apply.
 *
 * The owner hit this with a real document: an IOE position paper served from a
 * TYPO3 dumpFile URL. It failed twice over — 403 from a narrow Accept header,
 * and then "not an article page" once that was fixed.
 *
 * Returns plain text either way, because that is all a source ever needs to be.
 */
export async function fetchSourceFromUrl(
  rawUrl: string,
  maxChars: number
): Promise<{ ok: true; title: string; text: string; kind: "page" | "pdf" } | { ok: false; error: string }> {
  const url = (rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "That is not a web address — it should start with https://" };
  }

  // A GOOGLE LINK THAT GOT THIS FAR IS A LINK NOBODY CAN READ.
  //
  // Native Google Docs are routed to the gdoc-link path, which exports their
  // text. Everything else on those hosts — Sheets, Slides, and the
  // drive.google.com/file/d/... shape Drive's own share dialog produces for
  // uploaded files — falls through to here, and fetching it returns the
  // viewer's HTML shell. The guard further down is `if (!text)`, and a viewer
  // shell HAS text: menu labels, a filename, "Sign in". So the attach succeeds
  // and stores Google's chrome as the writer's research. A named reason beats
  // both silence and junk.
  const googleShape = googleLinkKind(url);
  if (googleShape) return { ok: false, error: googleShape };

  let res: Response;
  try {
    res = await safeFetch(url, {
      timeoutMs: 25_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
      },
    });
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg.indexOf("not a public address") >= 0) {
      return { ok: false, error: "That address is not reachable from here." };
    }
    return { ok: false, error: "Could not reach that page." };
  }
  if (!res.ok) {
    // A 401/403 is the SITE refusing us, not us refusing the writer, and the
    // difference decides what they should do next. Measured on a live TYPO3
    // dumpFile link that served the PDF happily to a browser and blocked this
    // server — no header combination changed it. Telling them to download and
    // attach it is the actual way through; "may need a sign-in" was a guess
    // dressed as a diagnosis.
    //
    // Which vendor refused is now named when the response says so, through the
    // same classifier the importer uses — the advice below was already right
    // for this surface, and "its CDN (Akamai) answered 403" is the sentence
    // that stops the writer re-pasting the link to see if it takes this time.
    const refusedBody = await res.text().catch(() => "");
    const refused = refusalMessage(res.status, res.headers, refusedBody, "source");
    if (refused) return { ok: false, error: refused };
    if (res.status === 404) {
      return { ok: false, error: "That address answered 404 — the link may have expired." };
    }
    return { ok: false, error: `That address answered ${res.status}.` };
  }

  const ctype = (res.headers.get("content-type") || "").toLowerCase();

  if (ctype.indexOf("pdf") >= 0) {
    // Shared with the uploaded-source path — see lib/optimizer/pdf.ts. The
    // pdf-parse import workaround and the scanned-PDF wording live there once,
    // because two copies of a subtle workaround go stale in one of them.
    const { readPdf } = await import("./pdf");
    const buffer = Buffer.from(await res.arrayBuffer());
    let nameFromUrl = "";
    try { nameFromUrl = new URL(url).pathname.split("/").pop() || ""; } catch { /* no name to derive */ }
    const r = await readPdf(buffer, nameFromUrl);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, title: r.title, text: r.text.slice(0, maxChars), kind: "pdf" };
  }

  const page = await res.text();
  if (page.length > MAX_HTML_BYTES) return { ok: false, error: "That page is too large to read." };
  const region = extractArticleRegion(page);
  const text = toEditorHtml(region, true).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, error: "Could not find any text on that page." };
  return { ok: true, title: extractTitle(page), text: text.slice(0, maxChars), kind: "page" };
}


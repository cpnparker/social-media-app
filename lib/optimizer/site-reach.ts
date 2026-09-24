/**
 * Whether we reached the site at all, and whether it was even the right site.
 *
 * ── WHY THIS IS A SEPARATE FILE ─────────────────────────────────────────────
 *
 * Every other judgement in the audit is about the page's CONTENT. These three
 * are about the fetch: was the request refused before the page was reached, and
 * did the address we asked for end up somewhere else entirely? Both are facts
 * about the transport, both are invisible to a reader of the HTML, and both
 * change what every other finding on the panel is a finding ABOUT.
 *
 * Pure and import-free, on purpose. page-audit.ts is pure and offline and says
 * so in its own header — "the route fetches, this decides" — and importing
 * url-import.ts to reach these would pull safeFetch into it and end that. The
 * classification of a live response needs headers and therefore happens at the
 * fetch seams; what lives here is the part a fixture can drive.
 *
 * ── TWO READINGS OF A BODY, AND WHY THEY ARE NOT ONE FUNCTION ───────────────
 *
 * botWallVendor answers "which vendor's wall is this" for a body that arrived
 * behind a REFUSING STATUS. The status has already said the request failed, so
 * the body only has to name who refused it, and a mark that is merely
 * suggestive costs nothing: the request failed either way.
 *
 * challengeVendor answers the same question for a body that arrived behind a
 * SUCCESS status, where the body is the whole of the evidence and a wrong
 * answer is a false claim printed about a page the audit is simultaneously
 * scoring. It was one function, and that was wrong in two directions that both
 * showed up when it was driven with real pages:
 *
 *   CLOUDFLARE INJECTS ITS CHALLENGE PATH INTO ORDINARY RESPONSES. JS
 *   Detections adds `<script src="/cdn-cgi/challenge-platform/scripts/jsd/
 *   main.js">` to perfectly ordinary 200 HTML. A page carrying that is not a
 *   challenge page; it is a page behind Cloudflare. So the bare path is not in
 *   the narrow set, and `cf_chl_opt` — the challenge page's own state object,
 *   which the jsd script does not set — is.
 *
 *   AND A PAGE MAY BE ABOUT THE THING. An article explaining Cloudflare's
 *   Error 1020 contains "Error 1020", "Access denied" and a reference id,
 *   because that is the subject. Prose cannot be told from a wall by its
 *   vocabulary, so the narrow read also asks whether the body is a DOCUMENT at
 *   all: a wall is a handful of words, and an article is not.
 *
 * Even that is not enough on the robots path, and the proof is a real file.
 * Shopify's robots.txt contains
 *
 *     Disallow: /cdn-cgi/challenge-platform*
 *
 * — a perfectly ordinary, perfectly correct robots.txt carrying the exact
 * string that identifies a Cloudflare challenge page. (The New York Times'
 * carries a bare `/athletic/cdn-cgi/` for the same reason.) Measured, against
 * fourteen real robots.txt files pulled while this was being built: one in
 * seven would have been condemned as a CDN challenge and reported as a site
 * that refuses AI crawlers. So the CALLER also gates on the body not already
 * being a robots file — see auditRefusal in url-import.ts — and that gate is
 * the general answer rather than a patch for one mark: a file that parses as
 * directives is a file, whatever strings happen to be inside it.
 *
 * ── AND "THE SAME SITE" IS A REGISTRABLE DOMAIN, NOT A HOST ─────────────────
 *
 * www→apex and m.→apex are the same site and must never be reported as a move.
 * Three client sites in the survey genuinely had moved — cyberpeaceinstitute.org
 * to protect.ngo, www.myovant.com to www.us.sumitomo-pharma.com, holcimmaqer.com
 * to holcimmaqerventures.com — and in each case the homepage redirects too, so
 * the audit was describing a different company's page.
 *
 * There is no public-suffix list in this repo and pulling one in for a string
 * comparison would be a dependency with a monthly update cadence. The rule
 * below is the well-behaved 95%: two labels, or three when the second-to-last
 * is one of the handful of registry labels that sit under a two-letter ccTLD
 * (temasek.com.sg, bbc.co.uk, ethz.ch). It is allowed to be wrong in the
 * direction of calling two different sites the same one — that merely fails to
 * raise a finding — and the subdomain escape below means it cannot be wrong in
 * the direction that shouts about a site that never moved.
 */

/**
 * A fetch that was refused, or answered with something that is not the thing
 * asked for. Threaded from the seams to the audit as DATA.
 */
export interface SiteRefusal {
  /** Which request it was: the audited page, or the site's robots.txt. */
  where: "page" | "robots";
  /** The address that was refused, after redirects. */
  url: string;
  status: number;
  /** The vendor that signed it, when one signed it. Null is an honest answer:
   *  plenty of edges refuse without saying who they are, and naming a guess is
   *  worse than naming nothing. */
  cdn: string | null;
  /**
   * How we know.
   *
   *   status     — the response said no: 401, 403, 429, a branded 503.
   *   challenge  — a 2xx whose body is a bot-management interstitial. A block
   *                is not always a 4xx, which is the lesson zurich.com taught:
   *                200, content-type text/html, 212 bytes of Imperva challenge
   *                served where robots.txt should be.
   *   empty      — a 2xx that is not 200, carrying nothing. ieee.org answers
   *                /robots.txt with 202 and zero bytes.
   */
  kind: "status" | "challenge" | "empty";
}

/**
 * Entity-decoded, and truncated to the head of the body.
 *
 * Akamai's Access Denied writes its own URL and reference id as numeric
 * entities — `Reference&#32;&#35;18.5d4c…` — so a matcher written against a
 * tidied-up paraphrase finds nothing in the page it was written for. This cost
 * a fixture going red for the right reason once already; the decode stays.
 */
function readableHead(body: string): string {
  return String(body || "")
    .slice(0, 4000)
    .replace(/&#(\d{1,4});/g, (m, d) => { const n = parseInt(d, 10); return n > 0 && n < 128 ? String.fromCharCode(n) : m; })
    .replace(/&#x([0-9a-f]{1,3});/gi, (m, x) => { const n = parseInt(x, 16); return n > 0 && n < 128 ? String.fromCharCode(n) : m; });
}

/**
 * Which vendor's bot wall this BODY is, for a body that came back behind a
 * REFUSING STATUS.
 *
 * Corroboration, not evidence: the 403 has already established that the request
 * failed, and these marks only decide whose name goes in the sentence. That is
 * why "Access Denied" beside a reference id is allowed to count here and not in
 * the narrow read below — on a refusal it cannot be an article about refusals.
 *
 * Deliberately NOT here: "Just a moment", "Attention Required" and a bare
 * `/cdn-cgi/` path. Those are real Cloudflare marks and url-import's
 * cdnBlockVendor still reads them — but only after this one has declined, and
 * only on a status that has already refused.
 */
export function botWallVendor(body: string): string | null {
  const b = readableHead(body);
  if (!b) return null;
  if (/errors\.edgesuite\.net/i.test(b)) return "Akamai";
  if (/access denied/i.test(b) && /reference\s*(&#35;|#)/i.test(b)) return "Akamai";
  if (/_Incapsula_Resource/i.test(b)) return "Imperva";
  if (/incapsula incident id|powered by imperva/i.test(b)) return "Imperva";
  if (/cdn-cgi\/challenge-platform|cf_chl_opt|error\s*(code:)?\s*10\d\d/i.test(b)) return "Cloudflare";
  return null;
}

/**
 * The most words a wall can be and still be a wall.
 *
 * Measured against the pages themselves: Imperva's challenge has NO visible
 * text at all, Akamai's Access Denied has about twenty words, and Cloudflare's
 * full "Sorry, you have been blocked" interstitial — the wordiest of them, with
 * its why-am-I-blocked and what-can-I-do paragraphs — runs to roughly a
 * hundred and ten. An article is hundreds. The gap is wide enough that the
 * threshold does not have to be clever, and it is set well above the widest
 * wall on purpose: the error this exists to prevent is calling a real page a
 * challenge, and the error it risks is staying quiet about a chatty one.
 */
const CHALLENGE_MAX_WORDS = 200;

/** Visible words, with the parts a reader never sees taken out first. */
function visibleWords(body: string): number {
  const text = String(body || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.split(" ").length : 0;
}

/**
 * Which vendor's bot wall this body is, for a body that came back behind a
 * SUCCESS STATUS — where the body is the whole of the evidence.
 *
 * Two gates, and both are load-bearing.
 *
 * THE MARK MUST BE A MACHINE ARTEFACT NOTHING ELSE WRITES. `_Incapsula_Resource`
 * is the query path Imperva's challenge script fetches, `errors.edgesuite.net`
 * is Akamai's error host, `cf_chl_opt` is the state object Cloudflare's
 * challenge page defines for itself. A bare `/cdn-cgi/challenge-platform/`
 * path is NOT one of them, however much it looks like the giveaway: Cloudflare's
 * JS Detections injects exactly that script into ordinary 200 responses, so the
 * path says the site is behind Cloudflare and nothing more. Nor is an error
 * number, or "Access denied" beside a reference id — an article about CDN blocks
 * quotes all three, and quoting them is what an article about them is for.
 *
 * AND THE BODY MUST NOT BE A DOCUMENT. Whatever marks it carries, a body with
 * hundreds of words of prose in it is the thing that was asked for; a page can
 * be behind a wall and still be served, and the audit is reading and scoring it
 * as we speak. Saying "this answered with a challenge page" about a page whose
 * real headings and paragraphs are being measured two rows down is the exact
 * false claim this panel exists to refuse.
 */
export function challengeVendor(body: string): string | null {
  const b = readableHead(body);
  if (!b) return null;
  let vendor: string | null = null;
  if (/_Incapsula_Resource/i.test(b) || /incapsula incident id/i.test(b)) vendor = "Imperva";
  else if (/errors\.edgesuite\.net/i.test(b)) vendor = "Akamai";
  else if (/cf_chl_opt/i.test(b)) vendor = "Cloudflare";
  if (!vendor) return null;
  // The whole body, not the head: an article's marks can sit in a <script> in
  // the head while its prose runs on for another 40KB.
  return visibleWords(body) <= CHALLENGE_MAX_WORDS ? vendor : null;
}

/**
 * Registry labels that sit under a two-letter ccTLD, so that the registrable
 * domain is three labels rather than two. Not a public suffix list — the
 * common shapes, and the ones the client book actually contains.
 */
const CC_SECOND_LEVEL = [
  "co", "com", "org", "net", "gov", "edu", "ac", "mil", "int",
  "ne", "or", "go", "gr", "sch", "nhs", "gob", "asn", "id", "in", "jus", "web",
];

/** The domain someone REGISTERED, which is the unit of "the same site". */
export function registrableDomain(host: string): string {
  const h = String(host || "").toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  if (!h) return "";
  // An address literal has no registrable domain, and slicing labels off one
  // would make 10.0.0.1 and 192.0.0.1 "the same site" (both "0.1").
  if (/^\[|^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return h;
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const take = tld.length === 2 && CC_SECOND_LEVEL.indexOf(sld) >= 0 ? 3 : 2;
  return parts.slice(parts.length - take).join(".");
}

/**
 * Are these two hosts the same site?
 *
 * Registrable domains first, then a subdomain escape. The escape is not
 * redundant: it is what stops the heuristic above from ever raising a false
 * alarm on a host whose suffix it guessed wrong, because a subdomain of a host
 * is the same site whatever the suffix turns out to be.
 */
export function sameSite(a: string, b: string): boolean {
  const x = String(a || "").toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  const y = String(b || "").toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  if (!x || !y) return true; // nothing to compare is not evidence of a move
  if (x === y) return true;
  // `.endsWith` is ES2015 and scripts/ is compiled with no target, so the
  // suffix test is written the way the rest of this repo writes it.
  const under = (child: string, parent: string) =>
    child.length > parent.length && child.indexOf("." + parent) === child.length - parent.length - 1;
  if (under(x, y) || under(y, x)) return true;
  const rx = registrableDomain(x);
  const ry = registrableDomain(y);
  return !!rx && rx === ry;
}

/** The host of a URL, or "" when it does not parse. */
export function hostOf(url: string): string {
  try { return new URL(String(url || "")).hostname.toLowerCase(); } catch { return ""; }
}

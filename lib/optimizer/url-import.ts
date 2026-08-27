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
 * Is this a Google link the generic page fetch cannot read, and what should the
 * writer do about it?
 *
 * Returns null for anything else, INCLUDING a native Doc — those are routed to
 * the gdoc-link path before they reach the fetch, and refusing a link that
 * works elsewhere in the product would be worse than the bug this prevents.
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
  if (/^\/document\//.test(path)) return null;

  if (/^\/spreadsheets\//.test(path)) {
    return "That is a Google Sheet. Background material is read as prose — download it as .csv and attach the file.";
  }
  if (/^\/presentation\//.test(path)) {
    return "That is a Google Slides deck. Download it as .txt or .docx and attach the file.";
  }
  if (host === "drive.google.com") {
    return "That is a Drive link to a file rather than a Google Doc. Open it, download it, and attach the file — a PDF works.";
  }
  return "That Google link is not a Google Doc. Open the document and copy the link from its address bar, or download the file and attach it.";
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
  { ok: true; page: string; finalUrl: string; httpStatus: number } | { ok: false; error: string }
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
    return { ok: true, page, finalUrl: res.url || url, httpStatus: res.status };
  } catch (e: any) {
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
  if (!res.ok) return { ok: false, error: `That page answered ${res.status}.` };

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
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error:
          "That site refused the request. Some sites block servers while serving the same file to a browser — open the link yourself, save the file, and attach it with File.",
      };
    }
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


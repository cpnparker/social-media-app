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
  error?: string;
}

/** Cut the region most likely to be the article out of a full page. */
export function extractArticleRegion(page: string): string {
  // Kill the wrappers whose CONTENT must not survive even as text, before any
  // region choice — a <script> inside <article> is still a script.
  const s = page
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, " ");

  // Preference order: the page's own claim about where the article is.
  for (const tag of ["article", "main"]) {
    const m = s.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "i"));
    if (m && m[1].replace(/<[^>]+>/g, "").trim().length > 400) return m[1];
  }
  const body = s.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  return body ? body[1] : s;
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
  return { ok: true, title: extractTitle(page), html };
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
    try {
      const buffer = Buffer.from(await res.arrayBuffer());
      // The lib entry, not the package root: pdf-parse's index runs a demo
      // against a bundled test file on import, which throws in a serverless
      // filesystem and has nothing to do with the caller's document.
      // @ts-expect-error - pdf-parse ships types for its package root only,
      // and the root is the entry that must be avoided (see above).
      const mod = await import("pdf-parse/lib/pdf-parse.js");
      const pdfParse = (mod.default || mod) as (b: Buffer) => Promise<any>;
      const parsed = await pdfParse(buffer);
      const text = String(parsed?.text || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (!text) {
        // A scanned PDF is images of words. Said plainly, because "no text
        // found" reads as a bug when it is an accurate description of the file.
        return { ok: false, error: "That PDF has no selectable text — it looks like a scan. Attach the source document instead." };
      }
      return { ok: true, title: extractPdfTitle(parsed, url), text: text.slice(0, maxChars), kind: "pdf" };
    } catch {
      return { ok: false, error: "That PDF could not be read." };
    }
  }

  const page = await res.text();
  if (page.length > MAX_HTML_BYTES) return { ok: false, error: "That page is too large to read." };
  const region = extractArticleRegion(page);
  const text = toEditorHtml(region, true).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, error: "Could not find any text on that page." };
  return { ok: true, title: extractTitle(page), text: text.slice(0, maxChars), kind: "page" };
}

/** A PDF's own title if it has one, else the filename, else the host. */
function extractPdfTitle(parsed: any, url: string): string {
  const meta = String(parsed?.info?.Title || "").trim();
  if (meta) return meta.slice(0, 200);
  try {
    const u = new URL(url);
    const name = (u.pathname.split("/").pop() || "").replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim();
    return (name || u.hostname).slice(0, 200);
  } catch {
    return "PDF document";
  }
}

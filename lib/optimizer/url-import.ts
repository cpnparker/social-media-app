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
        Accept: "text/html,application/xhtml+xml",
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
        Accept: "text/html,application/xhtml+xml",
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

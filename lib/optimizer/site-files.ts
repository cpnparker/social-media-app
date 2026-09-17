/**
 * The two files a site publishes for crawlers, fetched once for both audits.
 *
 * ── WHY THIS IS A FILE AND NOT TWO COPIES OF A CLOSURE ──────────────────────
 *
 * There are two audits — the studio route and the inline chat one — and until
 * now each fetched robots.txt and llms.txt with its own local `siteFile`
 * helper, twenty identical lines apart. They were kept in step by a comment
 * saying "identical, deliberately and line for line", and by a check that read
 * both files and asserted a regex matched in each.
 *
 * That is the shape this repo keeps getting bitten by. A regex proving a LINE
 * exists cannot see what the line now evaluates to: renaming one seam's binding
 * and re-flattening a soft-404 body to null passed every assertion, type-checked
 * clean, and left the two audits printing different sentences about the same
 * site. A fix that lands in one path and not its sibling is the recorded
 * failure mode, and the only durable answer is to stop having a sibling.
 *
 * So the seam is ONE function, and the callers have nothing left to disagree
 * about. What is still worth asserting about them is an absence — that neither
 * has grown a private copy — and absence is a thing a source check can honestly
 * prove.
 *
 * ── WHAT IS DECIDED HERE, AND WHAT IS NOT ───────────────────────────────────
 *
 * Fetching only, plus the one judgement that has nowhere else to live:
 *
 *   - robots.txt GOES THROUGH AS FETCHED, web page and all. This seam can
 *     refuse a body but it cannot SAY anything, so flattening a soft-404 to
 *     null here would make it indistinguishable from a timeout downstream.
 *     crawler-access.ts refuses a non-robots body itself and page-audit names
 *     which of the two happened. One judge, one rule.
 *   - llms.txt has NO such judge — its row reports a word count and nothing
 *     else — so a web page served at that address is dropped here, or 67KB of
 *     megamenu is reported as a present llms.txt of 9,000 words. It is dropped
 *     on the NARROW predicate, because an llms.txt is markdown and markdown
 *     carries tags: bodyIsServedPage asks only for the marks a served page has
 *     and a markdown file does not.
 *
 * Both fail to NULL, never to "allowed": a 404, a timeout or a refusal all mean
 * we did not look, and the audit renders that differently from a clean bill of
 * health.
 */
import { safeFetch } from "@/lib/net/safe-fetch";
import { bodyIsServedPage } from "./crawler-access";

/** As much of either file as is worth holding in memory. */
const MAX_SITE_FILE_BYTES = 100_000;

export interface SiteFiles {
  /** The robots.txt body as served — including a page served in its place. */
  robotsTxt: string | null;
  /** The llms.txt body, or null when absent, unreadable, or a web page. */
  llmsTxt: string | null;
}

/**
 * Read one path off the site, through safeFetch like every other outbound
 * request in this app — the host comes from a caller-supplied URL, and a
 * second unguarded fetch path is a second SSRF surface only one of which any
 * check would cover.
 */
async function readSiteFile(origin: string, path: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await safeFetch(`${origin}${path}`, { timeoutMs });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, MAX_SITE_FILE_BYTES);
  } catch {
    return null;
  }
}

/**
 * robots.txt and llms.txt for the site this page is on.
 *
 * `read` exists so a check can drive the REAL seam — the pass-through, the
 * llms filter, the failure-to-null — against fixture bodies rather than
 * asserting that its lines are still spelled the same way. It is the only test
 * seam in here, and the callers never pass it; a check asserts that too, since
 * a caller that supplied its own reader would be back to having a sibling.
 */
export async function fetchSiteFiles(
  pageUrl: string,
  opts?: { timeoutMs?: number; read?: (path: string) => Promise<string | null> }
): Promise<SiteFiles> {
  const timeoutMs = opts?.timeoutMs ?? 8000;
  let read = opts?.read;
  if (!read) {
    let origin: string;
    try {
      const u = new URL(pageUrl);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      return { robotsTxt: null, llmsTxt: null };
    }
    read = (path: string) => readSiteFile(origin, path, timeoutMs);
  }

  const [robotsTxt, llmsRaw] = await Promise.all([read("/robots.txt"), read("/llms.txt")]);
  return {
    robotsTxt,
    llmsTxt: llmsRaw !== null && bodyIsServedPage(llmsRaw) ? null : llmsRaw,
  };
}

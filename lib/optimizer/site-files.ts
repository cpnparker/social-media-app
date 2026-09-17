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
 *
 * ── AND THE SEAM NOW CARRIES TWO FACTS IT USED TO DISCARD ───────────────────
 *
 * WHERE THE REQUEST LANDED. safeFetch follows redirects, and three client sites
 * in the 77-host survey answer /robots.txt from a different registrable domain
 * because the whole site has moved. res.url knows that and this function used
 * to throw it away; the audit cannot report "you are auditing a different site"
 * from a body.
 *
 * AND WHY THERE IS NO BODY, when a live response refused rather than answered.
 * That one closes a defect: `if (!res.ok) return null` accepted every 2xx, so
 * www.ieee.org's 202-with-zero-bytes arrived as the empty string — and an empty
 * robots.txt is a real, open robots file, so the loudest row on the panel read
 * "robots.txt allows all 6 AI crawlers checked on this path" about a site that
 * had served nothing. A refusal now returns null AND says so, which is the
 * difference between the panel being quiet and the panel being wrong.
 *
 * The classification itself is url-import's auditRefusal, not a second copy
 * here: it needs headers and a status, this is where those exist, and the rules
 * for reading them already had a home.
 */
import { safeFetch } from "@/lib/net/safe-fetch";
import { bodyIsServedPage } from "./crawler-access";
import { auditRefusal } from "./url-import";
import type { SiteRefusal } from "./site-reach";

/** As much of either file as is worth holding in memory. */
const MAX_SITE_FILE_BYTES = 100_000;

/** One address, read. The shape the test seam supplies and the fetcher returns. */
export interface SiteFileRead {
  /** The body as served, or null when there was nothing readable to take. */
  text: string | null;
  /** Where the request ended up after redirects, or null when it never landed. */
  finalUrl: string | null;
  /** Set when the address ANSWERED but refused, rather than failing to answer. */
  refusal: SiteRefusal | null;
}

export interface SiteFiles {
  /** The robots.txt body as served — including a page served in its place. */
  robotsTxt: string | null;
  /** The llms.txt body, or null when absent, unreadable, or a web page. */
  llmsTxt: string | null;
  /** Where /robots.txt landed, so the audit can see a cross-host redirect. */
  robotsFinalUrl: string | null;
  /** Why there is no robots body, when the address refused rather than missed. */
  robotsRefusal: SiteRefusal | null;
}

/**
 * WHAT ONE RESPONSE MEANS, with the network taken out of it.
 *
 * Separated from the fetch because the fetch is the only part a check cannot
 * drive, and everything interesting is on this side of it. `read` below lets a
 * fixture stand in for the whole seam — which is right for the callers, and was
 * WRONG for this: a mutation putting `if (!res.ok) return null` back, the exact
 * live defect, left every assertion green because no fixture ever reached the
 * code that handles a real response. A test seam that skips the thing under
 * test is a check that silently tests nothing.
 *
 * ONLY /robots.txt IS CLASSIFIED. The refusal is evidence for a finding about
 * robots.txt, and llms.txt has no finding to feed: putting a bot-wall verdict
 * on a markdown file nothing downstream reads would be a claim made for the
 * sake of symmetry.
 *
 * A 2xx IS NOT ENOUGH. `if (!res.ok)` accepted every 2xx, so www.ieee.org's
 * 202-with-zero-bytes arrived as the empty string — and an empty robots.txt is
 * a real, open robots file. The panel then printed "robots.txt allows all 6 AI
 * crawlers checked on this path" about a site that had served it nothing.
 */
export function readSiteFileResponse(
  path: string,
  res: { status: number; ok: boolean; url?: string; headers: { get(name: string): string | null } },
  body: string,
  requestedUrl: string
): SiteFileRead {
  const finalUrl = res.url || requestedUrl;
  const refusal = path === "/robots.txt" ? auditRefusal("robots", finalUrl, res.status, res.headers, body) : null;
  if (!res.ok || refusal) return { text: null, finalUrl, refusal };
  return { text: body.slice(0, MAX_SITE_FILE_BYTES), finalUrl, refusal: null };
}

/**
 * Read one path off the site, through safeFetch like every other outbound
 * request in this app — the host comes from a caller-supplied URL, and a
 * second unguarded fetch path is a second SSRF surface only one of which any
 * check would cover.
 */
async function readSiteFile(origin: string, path: string, timeoutMs: number): Promise<SiteFileRead> {
  const address = `${origin}${path}`;
  try {
    const res = await safeFetch(address, { timeoutMs });
    // The body is read even on a failure. It is the evidence, we already hold
    // the response, and reading it is not a second request — there is
    // deliberately no retry against an origin that has said no.
    return readSiteFileResponse(path, res, await res.text(), address);
  } catch {
    return { text: null, finalUrl: null, refusal: null };
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
  opts?: { timeoutMs?: number; read?: (path: string) => Promise<SiteFileRead> }
): Promise<SiteFiles> {
  const timeoutMs = opts?.timeoutMs ?? 8000;
  let read = opts?.read;
  if (!read) {
    let origin: string;
    try {
      const u = new URL(pageUrl);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      return { robotsTxt: null, llmsTxt: null, robotsFinalUrl: null, robotsRefusal: null };
    }
    read = (path: string) => readSiteFile(origin, path, timeoutMs);
  }

  const [robots, llms] = await Promise.all([read("/robots.txt"), read("/llms.txt")]);
  const llmsRaw = llms.text;
  return {
    robotsTxt: robots.text,
    llmsTxt: llmsRaw !== null && bodyIsServedPage(llmsRaw) ? null : llmsRaw,
    robotsFinalUrl: robots.finalUrl,
    robotsRefusal: robots.refusal,
  };
}

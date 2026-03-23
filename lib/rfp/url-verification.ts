/**
 * URL Verification Pipeline for RFP Discovery
 *
 * After AI search returns opportunities with URLs, this module:
 * 1. Detects generic portal pages (homepages, /procurement, /tenders)
 * 2. Checks each URL with a HEAD request (parallel, 5s timeout)
 * 3. Cross-references domains against the trusted portal registry
 * 4. Content-checks top URLs for "closed/expired" signals
 * 5. Assigns a confidence tier + status to each opportunity
 * 6. Generates fallback portal search links for broken/unverified URLs
 */

import {
  findPortalByDomain,
  findPortalForOrganisation,
  getPortalSearchUrl,
  TRUSTED_PORTALS,
} from "./portals";

export type UrlConfidence =
  | "verified"
  | "trusted_domain"
  | "unverified"
  | "portal_page"
  | "failed"
  | "none";

export type RfpStatus =
  | "confirmed_open"
  | "likely_open"
  | "likely_closed"
  | "unknown";

export interface VerifiedOpportunity {
  sourceUrl: string | null;
  urlConfidence: UrlConfidence;
  portalName: string | null;
  portalSearchUrl: string | null;
  status: RfpStatus;
}

interface OpportunityForVerification {
  sourceUrl: string | null;
  organisation: string;
  title: string;
  status?: RfpStatus;
  /** Whether matchRealUrl() found this URL in the actual search API results */
  crossReferenced?: boolean;
}

const HEAD_TIMEOUT_MS = 5000;
const CONTENT_TIMEOUT_MS = 4000;
const MAX_CONCURRENT = 8;
const MAX_CONTENT_CHECKS = 8;

// ─── Generic URL patterns ────────────────────────────────────────────

/**
 * Path segments that indicate a generic portal/category page rather than
 * a specific tender notice. A URL ending with one of these (with no further
 * ID/slug) is almost certainly NOT a direct link to an individual RFP.
 */
const GENERIC_PATH_ENDINGS = [
  "/procurement",
  "/tenders",
  "/tenders/",
  "/opportunities",
  "/opportunities/",
  "/rfps",
  "/rfp",
  "/contracts",
  "/procurement/",
  "/doing-business",
  "/doing-business/",
  "/suppliers",
  "/suppliers/",
  "/supply",
  "/supply/",
  "/business-opportunities",
  "/business-opportunities/",
  "/work-with-us",
  "/work-with-us/",
];

/**
 * Hostnames of sites known to be aggregator homepages / blog-style sites
 * rather than procurement portals with direct tender links.
 */
const AGGREGATOR_HOMEPAGES = [
  "fundsforngos.org",
  "www.fundsforngos.org",
  "www2.fundsforngos.org",
  "opportunitiesforyouth.org",
  "youthop.com",
  "opportunitydesk.org",
];

/**
 * Detect whether a URL is a generic portal/search page rather than a link
 * to a specific tender notice. Returns true if the URL is generic.
 */
export function isGenericPortalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, "");

  // Known aggregator homepages
  if (AGGREGATOR_HOMEPAGES.some((h) => hostname === h || hostname === h.replace(/^www\./, ""))) {
    // If path is just / or very short, it's a homepage
    if (pathname.length <= 1) return true;
  }

  // Root path = homepage
  if (pathname === "" || pathname === "/") return true;

  // Exact match to a known portal search URL
  const fullUrl = url.replace(/\/+$/, "").replace(/\?.*$/, ""); // strip trailing slash + query
  for (const portal of TRUSTED_PORTALS) {
    const portalSearch = portal.searchUrl.replace(/\/+$/, "").replace(/\?.*$/, "");
    if (fullUrl === portalSearch) {
      console.log(`[RFP Verify] Generic portal URL detected (exact match): ${url} → ${portal.name}`);
      return true;
    }
  }

  // Path ends with a generic segment and has no ID/slug after it
  for (const ending of GENERIC_PATH_ENDINGS) {
    const clean = ending.replace(/\/+$/, "");
    if (pathname === clean || pathname.endsWith(clean)) {
      // Check if there's nothing specific after the generic part
      // e.g. /procurement = generic, /procurement/12345 = specific
      const afterGeneric = pathname.slice(pathname.lastIndexOf(clean) + clean.length);
      if (afterGeneric === "" || afterGeneric === "/") {
        console.log(`[RFP Verify] Generic portal URL detected (path ending): ${url}`);
        return true;
      }
    }
  }

  // Very short path with no ID-like segment (e.g. /about-us/procurement but not /notice/274082)
  // Heuristic: if pathname has no numeric component and ≤ 3 segments, likely generic
  const segments = pathname.split("/").filter(Boolean);
  const hasNumericSegment = segments.some((s) => /\d{3,}/.test(s));
  const hasSlugSegment = segments.some((s) => s.length > 20 && s.includes("-"));
  if (segments.length <= 2 && !hasNumericSegment && !hasSlugSegment) {
    // Check if any segment looks like a generic category word
    const genericWords = ["procurement", "tenders", "opportunities", "supply", "suppliers", "rfp", "rfps", "contracts", "business"];
    if (segments.some((s) => genericWords.includes(s.toLowerCase()))) {
      console.log(`[RFP Verify] Generic portal URL detected (short generic path): ${url}`);
      return true;
    }
  }

  return false;
}

// ─── Content-level verification ──────────────────────────────────────

/**
 * Keywords that strongly signal an RFP is closed/expired/awarded.
 * Checked case-insensitively against page text.
 */
const CLOSED_SIGNALS = [
  "this tender is closed",
  "this notice is closed",
  "this opportunity is closed",
  "deadline has passed",
  "submission period has ended",
  "submission period ended",
  "no longer accepting",
  "no longer open",
  "bidding is closed",
  "bidding closed",
  "this rfp has been closed",
  "this rfp is closed",
  "tender closed",
  "notice closed",
  "opportunity closed",
  "contract awarded",
  "has been awarded",
  "award decision",
  "cancelled",
  "this procurement has been cancelled",
  "withdrawn",
  "this notice has expired",
  "this tender has expired",
  "expired on",
  "closed on",
  "status: closed",
  "status: awarded",
  "status: cancelled",
  "status:closed",
  "status:awarded",
];

/**
 * Keywords that signal an RFP is currently open and accepting submissions.
 */
const OPEN_SIGNALS = [
  "submit your proposal",
  "submit proposal",
  "submit your bid",
  "submit bid",
  "apply now",
  "register your interest",
  "register interest",
  "how to apply",
  "submission deadline",
  "closing date",
  "deadline for submission",
  "responses due",
  "proposals due",
  "bids due",
  "accepting proposals",
  "accepting bids",
  "open for submissions",
  "currently open",
  "status: open",
  "status:open",
  "status: active",
];

/**
 * Fetch a URL and check its content for closed/expired vs open signals.
 * Returns a status determination. Uses GET with a size limit.
 */
async function contentVerifyUrl(
  url: string
): Promise<{ status: RfpStatus; closedSignal?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONTENT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "TCE-RFP-Checker/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) return { status: "unknown" };

    // Read limited body — we only need text to check keywords
    const reader = res.body?.getReader();
    if (!reader) return { status: "unknown" };

    let text = "";
    const decoder = new TextDecoder();
    const MAX_BYTES = 50000; // 50KB should capture the main content

    try {
      let totalRead = 0;
      while (totalRead < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        totalRead += value.length;
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    // Strip HTML tags for cleaner text matching
    const plainText = text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .toLowerCase();

    // Check for closed signals
    for (const signal of CLOSED_SIGNALS) {
      if (plainText.includes(signal)) {
        console.log(`[RFP Verify] Content check CLOSED signal found: "${signal}" on ${url}`);
        return { status: "likely_closed", closedSignal: signal };
      }
    }

    // Check for open signals
    for (const signal of OPEN_SIGNALS) {
      if (plainText.includes(signal)) {
        return { status: "confirmed_open" };
      }
    }

    return { status: "unknown" };
  } catch {
    return { status: "unknown" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Run content verification on a batch of URLs in parallel.
 */
async function contentCheckBatch(
  urls: string[]
): Promise<Map<string, { status: RfpStatus; closedSignal?: string }>> {
  const results = new Map<string, { status: RfpStatus; closedSignal?: string }>();
  const unique = Array.from(new Set(urls));

  // Process in chunks of MAX_CONCURRENT
  for (let i = 0; i < unique.length; i += MAX_CONCURRENT) {
    const chunk = unique.slice(i, i + MAX_CONCURRENT);
    const checks = await Promise.allSettled(
      chunk.map(async (url) => {
        const result = await contentVerifyUrl(url);
        return { url, result };
      })
    );

    for (const check of checks) {
      if (check.status === "fulfilled") {
        results.set(check.value.url, check.value.result);
      }
    }
  }

  return results;
}

// ─── HEAD check ──────────────────────────────────────────────────────

/**
 * Lightweight HEAD check to see if a URL resolves.
 * Returns status code. 0 means network error or timeout.
 */
async function headCheck(url: string): Promise<{ ok: boolean; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "TCE-RFP-Checker/1.0" },
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Process a batch of URLs with HEAD requests in parallel.
 */
async function headCheckBatch(
  urls: (string | null)[]
): Promise<Map<string, { ok: boolean; status: number }>> {
  const results = new Map<string, { ok: boolean; status: number }>();
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean) as string[]));

  for (let i = 0; i < uniqueUrls.length; i += MAX_CONCURRENT) {
    const chunk = uniqueUrls.slice(i, i + MAX_CONCURRENT);
    const checks = await Promise.allSettled(
      chunk.map(async (url) => {
        const result = await headCheck(url);
        return { url, result };
      })
    );

    for (const check of checks) {
      if (check.status === "fulfilled") {
        results.set(check.value.url, check.value.result);
      }
    }
  }

  return results;
}

// ─── Main verification pipeline ──────────────────────────────────────

/**
 * Full URL verification pipeline:
 * 1. Detect generic portal URLs → mark as portal_page, drop URL
 * 2. HEAD-check remaining URLs → mark failed ones
 * 3. Cross-reference against trusted portal domains
 * 4. Content-check top URLs for closed/expired signals
 * 5. Return enriched opportunities with confidence + status
 */
export async function verifyOpportunityUrls<
  T extends OpportunityForVerification
>(opportunities: T[]): Promise<(T & VerifiedOpportunity)[]> {
  // ── Step 1: Generic URL detection ──
  const withGenericCheck = opportunities.map((opp) => {
    if (opp.sourceUrl && isGenericPortalUrl(opp.sourceUrl)) {
      const portal = (() => {
        try {
          return findPortalByDomain(new URL(opp.sourceUrl).hostname);
        } catch {
          return undefined;
        }
      })();
      const fallbackPortal = portal || findPortalForOrganisation(opp.organisation);
      return {
        ...opp,
        _originalUrl: opp.sourceUrl,
        sourceUrl: null as string | null, // Drop the generic URL
        _isGeneric: true,
        _portal: fallbackPortal,
      };
    }
    return { ...opp, _originalUrl: opp.sourceUrl, _isGeneric: false, _portal: undefined as any };
  });

  // ── Step 2: HEAD-check non-generic URLs ──
  const urlsToCheck = withGenericCheck
    .filter((o) => !o._isGeneric && o.sourceUrl)
    .map((o) => o.sourceUrl);

  let headResults: Map<string, { ok: boolean; status: number }>;
  try {
    headResults = await headCheckBatch(urlsToCheck);
  } catch (err) {
    console.error("[RFP Verify] HEAD check batch failed:", err);
    headResults = new Map();
  }

  // ── Step 3: Assign initial confidence + identify URLs for content check ──
  const urlsForContentCheck: string[] = [];

  const withConfidence = withGenericCheck.map((opp) => {
    // Generic portal pages
    if (opp._isGeneric) {
      return {
        ...opp,
        urlConfidence: "portal_page" as UrlConfidence,
        portalName: opp._portal?.name || null,
        portalSearchUrl: opp._portal ? getPortalSearchUrl(opp._portal) : null,
        status: (opp.status || "unknown") as RfpStatus,
      };
    }

    // No URL at all
    if (!opp.sourceUrl) {
      const orgPortal = findPortalForOrganisation(opp.organisation);
      return {
        ...opp,
        urlConfidence: "none" as UrlConfidence,
        portalName: orgPortal?.name || null,
        portalSearchUrl: orgPortal ? getPortalSearchUrl(orgPortal) : null,
        status: (opp.status || "unknown") as RfpStatus,
      };
    }

    // Determine domain trust
    let portal;
    try {
      const hostname = new URL(opp.sourceUrl).hostname;
      portal = findPortalByDomain(hostname);
    } catch {
      portal = undefined;
    }

    const head = headResults.get(opp.sourceUrl);
    const headOk = head?.ok ?? false;

    let confidence: UrlConfidence;
    if (headOk && opp.crossReferenced) {
      confidence = "verified";
    } else if (headOk && portal) {
      confidence = "trusted_domain";
    } else if (headOk) {
      confidence = "unverified";
    } else {
      confidence = "failed";
    }

    // Collect URLs for content verification (only if URL resolved)
    if (headOk && opp.sourceUrl && urlsForContentCheck.length < MAX_CONTENT_CHECKS) {
      urlsForContentCheck.push(opp.sourceUrl);
    }

    if (confidence === "failed") {
      const fallbackPortal = portal || findPortalForOrganisation(opp.organisation);
      return {
        ...opp,
        sourceUrl: null as string | null,
        urlConfidence: confidence,
        portalName: fallbackPortal?.name || null,
        portalSearchUrl: fallbackPortal ? getPortalSearchUrl(fallbackPortal) : null,
        status: (opp.status || "unknown") as RfpStatus,
      };
    }

    const fallbackPortal = portal || findPortalForOrganisation(opp.organisation);
    return {
      ...opp,
      urlConfidence: confidence,
      portalName: portal?.name || fallbackPortal?.name || null,
      portalSearchUrl: fallbackPortal ? getPortalSearchUrl(fallbackPortal) : null,
      status: (opp.status || "unknown") as RfpStatus,
    };
  });

  // ── Step 4: Content verification for closed/expired signals ──
  let contentResults: Map<string, { status: RfpStatus; closedSignal?: string }>;
  try {
    contentResults = urlsForContentCheck.length > 0
      ? await contentCheckBatch(urlsForContentCheck)
      : new Map();
  } catch (err) {
    console.error("[RFP Verify] Content check batch failed:", err);
    contentResults = new Map();
  }

  const contentChecked = contentResults.size;
  const closedCount = Array.from(contentResults.values()).filter(
    (r) => r.status === "likely_closed"
  ).length;
  if (contentChecked > 0) {
    console.log(
      `[RFP Verify] Content checked ${contentChecked} URLs: ${closedCount} likely closed`
    );
  }

  // ── Step 5: Merge content results into final output ──
  const result = withConfidence.map((opp) => {
    const url = opp.sourceUrl || opp._originalUrl;
    const contentCheck = url ? contentResults.get(url) : undefined;

    let finalStatus = opp.status;
    if (contentCheck) {
      if (contentCheck.status === "likely_closed") {
        finalStatus = "likely_closed";
      } else if (contentCheck.status === "confirmed_open" && finalStatus !== "likely_closed") {
        finalStatus = "confirmed_open";
      }
    }

    // Clean up internal properties
    const { _originalUrl, _isGeneric, _portal, ...clean } = opp;
    return {
      ...clean,
      status: finalStatus,
    } as T & VerifiedOpportunity;
  });

  return result;
}

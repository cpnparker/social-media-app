/**
 * URL Verification Pipeline for RFP Discovery
 *
 * After AI search returns opportunities with URLs, this module:
 * 1. Checks each URL with a HEAD request (parallel, 5s timeout)
 * 2. Cross-references domains against the trusted portal registry
 * 3. Assigns a confidence tier to each opportunity
 * 4. Generates fallback portal search links for broken/unverified URLs
 */

import { findPortalByDomain, findPortalForOrganisation, getPortalSearchUrl } from "./portals";

export type UrlConfidence = "verified" | "trusted_domain" | "unverified" | "failed" | "none";

export interface VerifiedOpportunity {
  sourceUrl: string | null;
  urlConfidence: UrlConfidence;
  portalName: string | null;
  portalSearchUrl: string | null;
}

interface OpportunityForVerification {
  sourceUrl: string | null;
  organisation: string;
  title: string;
  /** Whether matchRealUrl() found this URL in the actual search API results */
  crossReferenced?: boolean;
}

const HEAD_TIMEOUT_MS = 5000;
const MAX_CONCURRENT = 8;

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
 * Process a batch of URLs in parallel.
 */
async function checkBatch(
  urls: (string | null)[]
): Promise<Map<string, { ok: boolean; status: number }>> {
  const results = new Map<string, { ok: boolean; status: number }>();
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean) as string[]));

  // Process in chunks of MAX_CONCURRENT
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

/**
 * Verify URLs for an array of opportunities and assign confidence tiers.
 *
 * Returns the same array with verification metadata attached.
 */
export async function verifyOpportunityUrls<
  T extends OpportunityForVerification
>(opportunities: T[]): Promise<(T & VerifiedOpportunity)[]> {
  // Run HEAD checks in parallel
  const urls = opportunities.map((o) => o.sourceUrl);
  let headResults: Map<string, { ok: boolean; status: number }>;

  try {
    headResults = await checkBatch(urls);
  } catch (err) {
    console.error("[RFP Verify] HEAD check batch failed:", err);
    // Graceful degradation: skip verification, mark all as unverified
    headResults = new Map();
  }

  return opportunities.map((opp) => {
    // No URL at all
    if (!opp.sourceUrl) {
      const orgPortal = findPortalForOrganisation(opp.organisation);
      return {
        ...opp,
        urlConfidence: "none" as UrlConfidence,
        portalName: orgPortal?.name || null,
        portalSearchUrl: orgPortal ? getPortalSearchUrl(orgPortal) : null,
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

    // Get HEAD check result (may not exist if batch failed)
    const head = headResults.get(opp.sourceUrl);
    const headOk = head?.ok ?? false;

    // Determine confidence tier
    let confidence: UrlConfidence;

    if (headOk && opp.crossReferenced) {
      // URL resolves AND was cross-referenced against actual search results
      confidence = "verified";
    } else if (headOk && portal) {
      // URL resolves and domain is a trusted procurement portal
      confidence = "trusted_domain";
    } else if (headOk) {
      // URL resolves but domain isn't trusted and wasn't cross-referenced
      confidence = "unverified";
    } else {
      // URL doesn't resolve (4xx, 5xx, timeout, network error)
      confidence = "failed";
    }

    // For failed URLs, null out sourceUrl and try to provide a fallback
    if (confidence === "failed") {
      const fallbackPortal = portal || findPortalForOrganisation(opp.organisation);
      return {
        ...opp,
        sourceUrl: null, // Drop the broken URL
        urlConfidence: confidence,
        portalName: fallbackPortal?.name || null,
        portalSearchUrl: fallbackPortal ? getPortalSearchUrl(fallbackPortal) : null,
      };
    }

    // For unverified URLs, keep URL but also provide a portal fallback
    const fallbackPortal = portal || findPortalForOrganisation(opp.organisation);
    return {
      ...opp,
      urlConfidence: confidence,
      portalName: portal?.name || fallbackPortal?.name || null,
      portalSearchUrl: fallbackPortal ? getPortalSearchUrl(fallbackPortal) : null,
    };
  });
}

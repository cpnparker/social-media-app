/**
 * Subdomain URL helper.
 *
 * On production (*.thecontentengine.com), returns full cross-subdomain URLs.
 * On localhost / preview URLs, returns relative paths (stays on same host).
 */

type SubdomainArea = "engine" | "operations" | "ai";

const SUBDOMAIN_MAP: Record<SubdomainArea, string> = {
  engine: "engine.thecontentengine.com",
  operations: "operations.thecontentengine.com",
  ai: "ai.thecontentengine.com",
};

const DEFAULT_PATHS: Record<SubdomainArea, string> = {
  engine: "/dashboard",
  operations: "/operations/commissioned-cus",
  ai: "/",
};

/** Check if the current host is a production subdomain */
export function isProductionHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.endsWith("thecontentengine.com");
}

/** Get the current area based on hostname */
export function getCurrentSubdomain(): SubdomainArea | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;
  if (host === "ai.thecontentengine.com") return "ai";
  if (host === "operations.thecontentengine.com") return "operations";
  if (host === "engine.thecontentengine.com") return "engine";
  return null;
}

/**
 * Get the URL for a given area. On production, returns a full cross-subdomain URL.
 * On dev/preview, returns a relative path.
 */
export function getSubdomainUrl(area: SubdomainArea, path?: string): string {
  const targetPath = path || DEFAULT_PATHS[area];

  if (!isProductionHost()) {
    // On localhost or preview URLs, just use relative paths
    return targetPath;
  }

  return `https://${SUBDOMAIN_MAP[area]}${targetPath}`;
}

/**
 * Navigate to a different subdomain area.
 * Uses window.location for cross-origin navigation.
 */
export function navigateToSubdomain(area: SubdomainArea, path?: string) {
  const url = getSubdomainUrl(area, path);

  if (isProductionHost()) {
    // Cross-subdomain: full page navigation
    window.location.href = url;
  } else {
    // Dev/preview: use router would be better but this also works
    window.location.href = url;
  }
}

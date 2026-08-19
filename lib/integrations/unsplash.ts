/**
 * Unsplash — the stock layer for slide imagery.
 *
 * Two of their API terms shape this file rather than being footnotes to it:
 *
 *   1. Images must be HOTLINKED from Unsplash's CDN, not rehosted. That runs
 *      against this codebase's habit of copying everything into Blob, so the
 *      URL returned here is deliberately theirs and must stay theirs. It works
 *      out: Google fetches createImage URLs server-side, so a hotlink is all
 *      Slides needs.
 *   2. When an image is actually USED, the download endpoint must be pinged.
 *      It is not a download — it is how photographers get credited with a use,
 *      and skipping it is the thing most likely to lose us API access.
 *
 * Licensing note that belongs next to the code: Unsplash images carry no model
 * or property releases. A recognisable face in a client deck can read as
 * endorsement, which is a legal problem the licence fee never was — hence the
 * bias below towards environmental and abstract imagery.
 */

const API = "https://api.unsplash.com";

export interface StockPhoto {
  url: string;
  /** Ping when the image is used. See note 2 above. */
  downloadLocation: string;
  credit: string;
  creditUrl: string;
  width: number;
  height: number;
}

export function unsplashConfigured(): boolean {
  return !!process.env.UNSPLASH_ACCESS_KEY?.trim();
}

function headers() {
  return {
    Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY?.trim()}`,
    "Accept-Version": "v1",
  };
}

/** Terms that push results away from portraits and towards the environmental,
 *  architectural and abstract imagery that is safe in a client deck. */
const SAFER_SUBJECTS = "architecture OR landscape OR texture OR abstract OR workspace";

export async function searchStockPhoto(
  query: string,
  orientation: "landscape" | "portrait" | "squarish" = "landscape"
): Promise<StockPhoto | null> {
  if (!unsplashConfigured()) return null;
  try {
    const params = new URLSearchParams({
      query: `${query} ${SAFER_SUBJECTS}`,
      orientation,
      per_page: "10",
      content_filter: "high",
    });
    const res = await fetch(`${API}/search/photos?${params}`, {
      headers: headers(),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      // 403 here is almost always the demo-tier rate limit (50/hour), which is
      // a capacity problem rather than a broken key — worth saying which.
      console.warn(
        `[Unsplash] search failed (${res.status})${res.status === 403 ? " — likely the 50/hour demo rate limit" : ""}`
      );
      return null;
    }
    const json = await res.json();
    const hit = (json?.results || [])[0];
    if (!hit) return null;

    return {
      url: hit.urls?.regular,
      downloadLocation: hit.links?.download_location,
      credit: hit.user?.name || "Unsplash",
      creditUrl: hit.user?.links?.html || "https://unsplash.com",
      width: hit.width,
      height: hit.height,
    };
  } catch (err: any) {
    console.warn(`[Unsplash] search error: ${err?.message}`);
    return null;
  }
}

/** Required by Unsplash's guidelines whenever a photo is used. Fire-and-forget:
 *  a deck must never fail because an attribution ping timed out. */
export async function trackStockUse(downloadLocation?: string): Promise<void> {
  if (!downloadLocation || !unsplashConfigured()) return;
  try {
    await fetch(downloadLocation, { headers: headers(), signal: AbortSignal.timeout(6_000) });
  } catch {
    /* attribution telemetry only */
  }
}

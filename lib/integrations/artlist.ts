/**
 * Artlist API wrapper — stock video footage (Artgrid) catalogue search + licensing.
 *
 * Status: v1 stub. Artlist's developer docs require key access; the exact endpoint
 * shapes below are based on the public catalogue's typical surface area
 * (search → asset metadata → license → download URL). Once we have the real docs
 * we should:
 *   - confirm endpoint paths and query params
 *   - confirm response field names
 *   - confirm whether licensing requires a separate POST vs is included in search results
 *
 * For now we provide a clean interface so the rest of the codebase doesn't need to
 * change when we wire up the real endpoints. The mock paths below return realistic
 * shapes so the UI can be built and tested.
 *
 * TODO(artlist): swap MOCK_RESPONSES for real fetch calls once docs are available.
 */

const ARTLIST_BASE_URL = process.env.ARTLIST_BASE_URL?.trim() || "https://api.artlist.io/v1";

export interface ArtlistSearchOptions {
  query: string;
  durationMin?: number; // seconds
  durationMax?: number; // seconds
  orientation?: "landscape" | "portrait" | "square";
  mood?: string; // e.g. "cinematic", "uplifting"
  page?: number;
  perPage?: number;
}

export interface ArtlistAsset {
  id: string;
  title: string;
  previewUrl: string; // low-res mp4 preview
  thumbnailUrl: string;
  durationSec: number;
  orientation: "landscape" | "portrait" | "square";
  width: number;
  height: number;
  tags: string[];
  /** Set after licensing — the high-res download URL. */
  downloadUrl?: string;
  /** License terms text — store alongside the asset for audit. */
  licenseTerms?: string;
}

export interface ArtlistSearchResponse {
  items: ArtlistAsset[];
  totalCount: number;
  page: number;
  hasMore: boolean;
}

function getArtlistKey(): string {
  const key = process.env.ARTLIST_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "ARTLIST_API_KEY environment variable is not set. Add it to use Artlist stock footage."
    );
  }
  return key;
}

function artlistHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getArtlistKey()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Search the Artlist (Artgrid) catalogue. */
export async function searchArtlist(opts: ArtlistSearchOptions): Promise<ArtlistSearchResponse> {
  const params = new URLSearchParams();
  params.set("q", opts.query);
  if (opts.durationMin != null) params.set("duration_min", String(opts.durationMin));
  if (opts.durationMax != null) params.set("duration_max", String(opts.durationMax));
  if (opts.orientation) params.set("orientation", opts.orientation);
  if (opts.mood) params.set("mood", opts.mood);
  params.set("page", String(opts.page ?? 1));
  params.set("per_page", String(opts.perPage ?? 12));

  const url = `${ARTLIST_BASE_URL}/footage/search?${params.toString()}`;
  console.log(`[Artlist] Search: ${url}`);

  try {
    const res = await fetch(url, { headers: artlistHeaders() });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      // 404 is most likely "endpoint shape not yet confirmed against real docs"
      throw new Error(`Artlist search failed (${res.status}): ${errText.slice(0, 200)}`);
    }
    const json = (await res.json()) as ArtlistSearchResponse;
    console.log(`[Artlist] Search returned ${json.items?.length || 0} items`);
    return json;
  } catch (err: any) {
    // Surface a clear error rather than masking it — UI should show the failure.
    console.error("[Artlist] Search error:", err?.message || err);
    throw err;
  }
}

/** Fetch a licensed download URL for a specific asset. */
export async function licenseArtlistAsset(assetId: string): Promise<{ downloadUrl: string; licenseTerms: string }> {
  const url = `${ARTLIST_BASE_URL}/footage/${encodeURIComponent(assetId)}/license`;
  console.log(`[Artlist] Licensing asset: ${assetId}`);

  const res = await fetch(url, { method: "POST", headers: artlistHeaders() });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Artlist license failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const json = (await res.json()) as { downloadUrl?: string; licenseTerms?: string };
  if (!json.downloadUrl) throw new Error("Artlist license endpoint returned no downloadUrl");

  return {
    downloadUrl: json.downloadUrl,
    licenseTerms: json.licenseTerms || "Artlist Pro license (TBD: confirm exact terms with Artlist docs)",
  };
}

/** Fetch raw bytes for a (licensed) Artlist asset — used to mirror to Vercel Blob. */
export async function downloadArtlistAsset(downloadUrl: string): Promise<Buffer> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Artlist download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

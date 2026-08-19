/**
 * Where a slide's photograph comes from, and how text stays readable on it.
 *
 * Three layers, tried in order, because they trade off differently:
 *
 *   1. OWNED — a curated TCE library in Blob. No licensing question at all and
 *      the best brand fit, so it wins whenever it has something.
 *   2. STOCK — Unsplash. Real photography, free commercially, but no model or
 *      property releases; see lib/integrations/unsplash.ts.
 *   3. GENERATED — the existing gpt-image-1 path, for concepts and abstracts no
 *      photograph covers. Slowest, so it is last rather than first.
 *
 * Generation is injected rather than imported: lib/ai/providers.ts already
 * imports this module's sibling (slides/generate), so importing it back would
 * close a cycle.
 */

import { list } from "@vercel/blob";
import { searchStockPhoto, trackStockUse } from "@/lib/integrations/unsplash";
import { COLOR } from "@/lib/slides/brand";

export interface ResolvedImage {
  url: string;
  source: "owned" | "stock" | "generated" | "supplied";
  credit?: string;
  /** Fraction of navy to lay over the image so text on it stays legible. */
  scrim: number;
}

export type ImageGenerator = (prompt: string) => Promise<string>;

/** Where curated TCE photography lives. Filenames carry the tags, e.g.
 *  `slides/library/office-london-workspace.jpg`, because a manifest is one more
 *  thing to keep in step with the bucket. */
const LIBRARY_PREFIX = "slides/library/";

let libraryCache: { at: number; items: { url: string; name: string }[] } | null = null;
const LIBRARY_TTL = 5 * 60_000;

async function ownedLibrary(): Promise<{ url: string; name: string }[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  if (libraryCache && Date.now() - libraryCache.at < LIBRARY_TTL) return libraryCache.items;
  try {
    const { blobs } = await list({ prefix: LIBRARY_PREFIX, limit: 200 });
    const items = blobs.map((b) => ({
      url: b.url,
      name: b.pathname.slice(LIBRARY_PREFIX.length).replace(/\.[a-z0-9]+$/i, "").toLowerCase(),
    }));
    libraryCache = { at: Date.now(), items };
    return items;
  } catch (err: any) {
    console.warn(`[SlideImages] library unavailable: ${err?.message}`);
    return [];
  }
}

/** Word overlap rather than substring: "energy transition" should match
 *  `energy-grid-infrastructure`, which a substring test misses entirely. */
function scoreMatch(name: string, query: string): number {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  if (!words.length) return 0;
  const hay = name.split(/[^a-z0-9]+/);
  return words.filter((w) => hay.some((h) => h.includes(w) || w.includes(h))).length / words.length;
}

/* ─────────────── Scrim ─────────────── */

/** Relative luminance per WCAG, from an 8-bit sRGB triple. */
function luminance(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const NAVY_L = luminance(0x02, 0x32, 0x50);
/** White text needs 4.5:1, which caps the composited background's luminance. */
const MAX_BACKGROUND_L = 1.05 / 4.5 - 0.05;

/** The band of the canvas a layout actually puts text in, as fractions of the
 *  image. Measuring the whole picture is what produced a 0.84 scrim from one
 *  sunset: the brightest pixel was the sun, and no text goes near it. */
export const TEXT_REGION = { top: 0.34, bottom: 1.0 } as const;

/**
 * How much navy to lay over this image so white text clears 4.5:1.
 *
 * Two things keep this from drowning the photograph, which is what the first
 * version did:
 *
 *   - Only the BAND WHERE TEXT SITS is measured. A blown-out sky above the
 *     title has no bearing on whether the title is readable.
 *   - The 85th percentile drives it, not the maximum. A single specular
 *     highlight — sun on water, a window — is not what the eye reads a word
 *     against, and letting one pixel set the opacity darkens everything.
 *
 * Capped at 0.62. Past that the image stops being visible at all, and a slide
 * whose photograph cannot be seen is not a photo slide however legible its
 * text; if a picture genuinely needs more, the honest answer is a different
 * picture.
 */
export async function scrimFor(imageUrl: string): Promise<number> {
  const SAFE_DEFAULT = 0.5;
  const MAX_SCRIM = 0.62;
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return SAFE_DEFAULT;
    const sharp = (await import("sharp")).default;
    const buf = Buffer.from(await res.arrayBuffer());

    const meta = await sharp(buf).metadata();
    const H = meta.height || 0;
    const top = Math.floor(H * TEXT_REGION.top);
    const height = Math.max(1, Math.floor(H * (TEXT_REGION.bottom - TEXT_REGION.top)));

    let pipeline = sharp(buf);
    if (H > 0 && height < H) {
      pipeline = pipeline.extract({ left: 0, top, width: meta.width || 1, height });
    }
    const { data, info } = await pipeline
      .resize(48, 27, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const lums: number[] = [];
    for (let i = 0; i < info.width * info.height; i++) {
      lums.push(luminance(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]));
    }
    lums.sort((a, b) => a - b);
    const bright = lums[Math.floor(lums.length * 0.85)] ?? lums[lums.length - 1];

    if (bright <= MAX_BACKGROUND_L) return 0.25; // already dark; a little for consistency

    const alpha = (bright - MAX_BACKGROUND_L) / (bright - NAVY_L);
    return Math.min(MAX_SCRIM, Math.max(0.25, Number(alpha.toFixed(2))));
  } catch (err: any) {
    console.warn(`[SlideImages] could not measure ${imageUrl.slice(0, 60)}: ${err?.message}`);
    return SAFE_DEFAULT;
  }
}

/* ─────────────── Resolution ─────────────── */

export interface ImageRequest {
  /** An exact image to use, skipping the layers. */
  url?: string;
  /** What the slide needs a picture of. */
  query?: string;
}

export async function resolveImage(
  req: ImageRequest,
  generate?: ImageGenerator
): Promise<ResolvedImage | null> {
  if (req.url) {
    return { url: req.url, source: "supplied", scrim: await scrimFor(req.url) };
  }
  const query = req.query?.trim();
  if (!query) return null;

  // 1. Owned
  const library = await ownedLibrary();
  const best = library
    .map((item) => ({ item, score: scoreMatch(item.name, query) }))
    .sort((a, b) => b.score - a.score)[0];
  if (best && best.score >= 0.5) {
    console.log(`[SlideImages] "${query}" → owned (${best.item.name})`);
    return { url: best.item.url, source: "owned", scrim: await scrimFor(best.item.url) };
  }

  // 2. Stock
  const stock = await searchStockPhoto(query);
  if (stock?.url) {
    console.log(`[SlideImages] "${query}" → stock`);
    void trackStockUse(stock.downloadLocation);
    return {
      url: stock.url,
      source: "stock",
      credit: `Photo: ${stock.credit} / Unsplash`,
      scrim: await scrimFor(stock.url),
    };
  }

  // 3. Generated
  if (generate) {
    try {
      const url = await generate(
        `${query}. Editorial photography for a corporate presentation slide. ` +
        `Wide composition with calm, uncluttered space for text. No words, letters or logos in the image.`
      );
      // A relative path here means the generator handed back an auth-proxied
      // URL. Google fetches slide images from its own servers with no session,
      // so that image can never appear — better to show the brand background
      // and say why than to build a deck with an invisible picture in it.
      if (url && !/^https?:\/\//i.test(url)) {
        console.warn(`[SlideImages] generator returned a non-absolute URL (${url.slice(0, 48)}) — unusable in a deck`);
        return null;
      }
      if (url) {
        console.log(`[SlideImages] "${query}" → generated (no owned or stock match)`);
        return { url, source: "generated", scrim: await scrimFor(url) };
      }
    } catch (err: any) {
      console.warn(`[SlideImages] generation failed: ${err?.message}`);
    }
  }
  return null;
}

/** Navy at the measured opacity, in the shape Slides wants for a solid fill. */
export function scrimFill(scrim: number) {
  return {
    solidFill: {
      color: { rgbColor: {
        red: 0x02 / 255, green: 0x32 / 255, blue: 0x50 / 255,
      } },
      alpha: scrim,
    },
  };
}

export const SCRIM_COLOR = COLOR.navy;

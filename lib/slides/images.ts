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

import { list, put } from "@vercel/blob";
import { signedMediaUrl } from "@/lib/media/signed";
import { searchStockPhoto, trackStockUse } from "@/lib/integrations/unsplash";
import { COLOR } from "@/lib/slides/brand";

export interface ResolvedImage {
  url: string;
  source: "owned" | "stock" | "generated" | "supplied";
  credit?: string;
  /** Fraction of navy to lay over the image so text on it stays legible. */
  scrim: number;
  /** Which lockup reads against THIS picture's top-right corner. */
  logo?: "white" | "navy";
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

/**
 * Crop a photograph to the slide's aspect and, for text-bearing layouts, burn
 * a gradient scrim into it.
 *
 * Both of the visible faults came from doing this in Slides instead. Slides
 * LETTERBOXES an image into the box it is given, so a 3:2 photograph on a 16:9
 * canvas showed 112pt of navy as bars down the sides. And a gradient cannot be
 * drawn at all — the API has solid fills only — so the scrim was one flat
 * rectangle, dark enough to guarantee contrast everywhere and therefore dark
 * enough to bury the picture. Stacked rectangles do not rescue it: their alpha
 * accumulates and the steps read as stripes at any count worth using.
 *
 * Baked, all three problems disappear at once: the crop is exact, the gradient
 * is smooth, and the preview shows the identical file the deck gets.
 *
 * Rehosting rather than hotlinking is a deliberate departure from Unsplash's
 * guideline, taken because Slides copies the image into the presentation at
 * insertion regardless — the hotlink never survives into the deck, so it buys
 * the photographer nothing here. What does matter to them we still do: the
 * download endpoint is pinged and the credit is printed on the slide.
 */
/** Where the lockup will sit, as fractions of the image. */
export interface LogoRegion { x: number; y: number; w: number; h: number }

async function bakeBackdrop(
  imageUrl: string,
  opts: { aspect: number; gradient: boolean; logoRegion?: LogoRegion }
): Promise<{ url: string; logo: "white" | "navy" } | null> {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const sharp = (await import("sharp")).default;
    const input = Buffer.from(await res.arrayBuffer());

    const W = 1600;
    const H = Math.round(W / opts.aspect);
    // `cover` crops to fill rather than fitting inside — the whole point.
    let pipeline = sharp(input).resize(W, H, { fit: "cover", position: "attention" });

    let logo: "white" | "navy" = "white";
    if (opts.gradient) {
      const peak = await gradientPeakFor(input, sharp);
      const { stop: top, logo: variant } = await logoTreatmentFor(input, sharp, peak, opts.logoRegion);
      logo = variant;
      // A real linear gradient, rasterised once and composited. Transparent at
      // the top so the photograph keeps its colour where no text sits.
      const overlay = Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
           <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0%" stop-color="#023250" stop-opacity="${top.toFixed(2)}"/>
             <stop offset="42%" stop-color="#023250" stop-opacity="${Math.max(0.14, top * 0.6).toFixed(2)}"/>
             <stop offset="72%" stop-color="#023250" stop-opacity="${(peak * 0.75).toFixed(2)}"/>
             <stop offset="100%" stop-color="#023250" stop-opacity="${peak.toFixed(2)}"/>
           </linearGradient></defs>
           <rect width="${W}" height="${H}" fill="url(#g)"/>
         </svg>`
      );
      pipeline = pipeline.composite([{ input: overlay, blend: "over" }]);
    }

    const out = await pipeline.jpeg({ quality: 86 }).toBuffer();
    const blob = await put(`slides/backdrops/${Date.now()}.jpg`, out, {
      access: "private",
      contentType: "image/jpeg",
      addRandomSuffix: true,
    });
    return { url: signedMediaUrl(blob.pathname), logo };
  } catch (err: any) {
    console.warn(`[SlideImages] backdrop bake failed: ${err?.message}`);
    return null;
  }
}

/** What the head of the gradient should do, and which lockup to use with it.
 *
 *  Every full-bleed layout puts the lockup top-right, and the gradient is
 *  bottom-weighted by design so the picture keeps its colour up there — which
 *  is exactly where a bright sky leaves a white logo invisible. Measured on the
 *  top-right corner it actually occupies, not the whole top, and held to 3:1:
 *  a mark is a graphic, not body copy, and darkening the sky to text standards
 *  would undo the reason the gradient is shaped this way.
 */
/** Default region: the top-right corner, where most layouts put the lockup. */
const DEFAULT_LOGO_REGION: LogoRegion = { x: 0.6, y: 0, w: 0.4, h: 0.22 };

/** The gradient's opacity at a given depth, from the stops bakeBackdrop uses.
 *
 *  Needed because the logo is judged against the FINISHED picture, not the
 *  source. A closing slide's mark sits in the gradient's dark foot: reading the
 *  raw pixels there says "bright sea, use navy", and navy on that foot is
 *  invisible. The gradient has to be accounted for before the choice is made. */
function gradientAlphaAt(depth: number, top: number, peak: number): number {
  const stops: [number, number][] = [[0, top], [0.42, Math.max(0.14, top * 0.6)], [0.72, peak * 0.75], [1, peak]];
  for (let i = 1; i < stops.length; i++) {
    const [d0, a0] = stops[i - 1], [d1, a1] = stops[i];
    if (depth <= d1) return a0 + ((depth - d0) / (d1 - d0)) * (a1 - a0);
  }
  return peak;
}

async function logoTreatmentFor(
  input: Buffer, sharp: any, peak: number, region: LogoRegion = DEFAULT_LOGO_REGION
): Promise<{ stop: number; logo: "white" | "navy" }> {
  const FLOOR = 0.1;
  try {
    const meta = await sharp(input).metadata();
    const W = meta.width || 0, H = meta.height || 0;
    if (!W || !H) return { stop: FLOOR, logo: "white" };
    // Measure WHERE THE LOGO GOES. Hard-coding the top-right measured the wrong
    // corner on the two layouts that move it: a cover centres it near the top,
    // a closing slide puts it low and centred. Both came back reading a part of
    // the sky the mark never touches.
    const { data, info } = await sharp(input)
      .extract({
        left: Math.min(W - 1, Math.max(0, Math.floor(W * region.x))),
        top: Math.min(H - 1, Math.max(0, Math.floor(H * region.y))),
        width: Math.max(1, Math.min(W - Math.floor(W * region.x), Math.floor(W * region.w))),
        height: Math.max(1, Math.min(H - Math.floor(H * region.y), Math.floor(H * region.h))),
      })
      .resize(32, 16, { fit: "fill" })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const lums: number[] = [];
    for (let i = 0; i < info.width * info.height; i++) {
      lums.push(luminance(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]));
    }
    lums.sort((a, b) => a - b);
    const raw = lums[Math.floor(lums.length * 0.85)] ?? 1;

    // What the mark will actually sit on, once the gradient is burnt in.
    const depth = region.y + region.h / 2;
    const alpha = gradientAlphaAt(depth, FLOOR, peak);
    const seen = alpha * NAVY_L + (1 - alpha) * raw;

    const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (contrast(1, seen) >= 3) return { stop: FLOOR, logo: "white" };
    if (contrast(NAVY_L, seen) >= 3) return { stop: FLOOR, logo: "navy" };

    // Neither mark reads — a mid-tone. Darken a little and take whichever is
    // better, rather than flattening the picture to force a rule to pass.
    const stop = Math.min(0.3, Math.max(FLOOR, alpha + 0.15));
    const darker = stop * NAVY_L + (1 - stop) * raw;
    return { stop, logo: contrast(1, darker) >= contrast(NAVY_L, darker) ? "white" : "navy" };
  } catch {
    return { stop: 0.22, logo: "white" };
  }
}

/** How dark the foot of the gradient must be for white text to clear 4.5:1
 *  there. Measured on the bottom third — the only place a baked gradient is
 *  asked to carry text. */
async function gradientPeakFor(input: Buffer, sharp: any): Promise<number> {
  try {
    const meta = await sharp(input).metadata();
    const H = meta.height || 0;
    const band = Math.max(1, Math.floor(H * 0.4));
    const { data, info } = await sharp(input)
      .extract({ left: 0, top: H - band, width: meta.width || 1, height: band })
      .resize(48, 24, { fit: "fill" })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const lums: number[] = [];
    for (let i = 0; i < info.width * info.height; i++) {
      lums.push(luminance(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]));
    }
    lums.sort((a, b) => a - b);
    const bright = lums[Math.floor(lums.length * 0.9)] ?? 1;
    if (bright <= MAX_BACKGROUND_L) return 0.45;
    const alpha = (bright - MAX_BACKGROUND_L) / (bright - NAVY_L);
    return Math.min(0.92, Math.max(0.5, Number(alpha.toFixed(2))));
  } catch {
    return 0.75;
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
  generate?: ImageGenerator,
  treatment: { aspect: number; gradient: boolean; logoRegion?: LogoRegion } =
    { aspect: 16 / 9, gradient: true }
): Promise<ResolvedImage | null> {
  const finish = async (
    url: string, source: ResolvedImage["source"], credit?: string
  ): Promise<ResolvedImage> => {
    const baked = await bakeBackdrop(url, treatment);
    // Falling back to the raw image keeps a picture on the slide when baking
    // fails; it will letterbox, which is visibly wrong but better than blank.
    return { url: baked?.url || url, source, credit, scrim: 0, logo: baked?.logo };
  };

  if (req.url) return finish(req.url, "supplied");
  const query = req.query?.trim();
  if (!query) return null;

  // 1. Owned
  const library = await ownedLibrary();
  const best = library
    .map((item) => ({ item, score: scoreMatch(item.name, query) }))
    .sort((a, b) => b.score - a.score)[0];
  if (best && best.score >= 0.5) {
    console.log(`[SlideImages] "${query}" → owned (${best.item.name})`);
    return finish(best.item.url, "owned");
  }

  // 2. Stock
  const stock = await searchStockPhoto(query);
  if (stock?.url) {
    console.log(`[SlideImages] "${query}" → stock`);
    void trackStockUse(stock.downloadLocation);
    return finish(stock.url, "stock", `Photo: ${stock.credit} / Unsplash`);
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
        return finish(url, "generated");
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

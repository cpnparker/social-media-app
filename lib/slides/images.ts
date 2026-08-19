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
import { safeFetchBuffer } from "@/lib/net/safe-fetch";
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
  /** Found, but it cannot be made safe to put text on — the bake failed, and on
   *  a text-bearing layout the baked gradient IS the contrast mechanism. */
  unusable?: string;
  /** Used as it came: the crop failed, so Slides will letterbox it. Ugly, but
   *  nothing on it is unreadable. */
  degraded?: string;
}

/** A picture that has been CHOSEN but not yet cropped or darkened.
 *
 *  The two halves are separate because only choosing can fail, and the grid
 *  needs to know how many pictures it actually got before it can decide what
 *  shape to crop them to. */
export interface ImageSource {
  url: string;
  source: ResolvedImage["source"];
  credit?: string;
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
    // Guarded: this URL can come straight from the tool call, and an
    // unguarded server-side fetch of a caller's URL reaches whatever our
    // network can reach. See lib/net/safe-fetch.ts.
    const buf = await safeFetchBuffer(imageUrl, 12_000);
    if (!buf) return SAFE_DEFAULT;
    const sharp = (await import("sharp")).default;

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

/** The finished gradient for a picture: what each text band needs, the floor
 *  the lockup needs, and which lockup to use.
 *
 *  Exported so the promise this makes — white text clears 4.5:1 everywhere a
 *  layout actually writes — can be ASSERTED against a real image without a
 *  Google round-trip or a Blob upload. The previous version's guarantee held
 *  only at the very bottom edge of the canvas and nothing checked the rest. */
export async function gradientProfileFor(
  input: Buffer, sharp: any, bands?: TextBand[], logoRegion?: LogoRegion
): Promise<{ profile: [number, number][]; logo: "white" | "navy" }> {
  const use = bands?.length ? bands : [DEFAULT_TEXT_BAND];
  const measured: MeasuredBand[] = [];
  for (const band of use) {
    measured.push({ ...band, alpha: await alphaForBand(input, sharp, band) });
  }
  // The lockup is judged against the FINISHED picture, so the profile has to
  // exist before the mark can be chosen — and the mark may then ask for a
  // darker floor, which changes the profile. Twice round, not once.
  const FLOOR = 0.1;
  const provisional = buildProfile(measured, FLOOR);
  const treatment = await logoTreatmentFor(
    input, sharp, (d) => alphaFromProfile(provisional, d), logoRegion
  );
  return {
    profile: treatment.floor > FLOOR ? buildProfile(measured, treatment.floor) : provisional,
    logo: treatment.logo,
  };
}

/** Navy's luminance and the ceiling white text may sit on, for callers that
 *  need to check a composited result. */
export const CONTRAST = { navyLuminance: NAVY_L, maxBackgroundLuminance: MAX_BACKGROUND_L };

async function bakeBackdrop(
  imageUrl: string,
  opts: {
    aspect: number; gradient: boolean; logoRegion?: LogoRegion;
    fit?: "cover" | "contain";
    /** Where this layout draws text on the picture. Supplied by the caller
     *  because only the layout knows: a cover writes across the foot, a closing
     *  slide across the middle, a feature slide starts at the very top. */
    textBands?: TextBand[];
  }
): Promise<{ ok: true; url: string; logo: "white" | "navy" } | { ok: false; reason: string }> {
  try {
    const input = await safeFetchBuffer(imageUrl, 15_000);
    if (!input) return { ok: false, reason: "the image could not be fetched" };
    const sharp = (await import("sharp")).default;

    const W = 1600;
    const H = Math.round(W / opts.aspect);
    // `cover` crops to fill, which is right for a photograph and WRONG for a
    // logo: cropping a client's mark is a misuse of their trademark, not a
    // design choice. `contain` fits it whole on white instead.
    const fit = opts.fit ?? "cover";
    let pipeline = fit === "contain"
      ? sharp(input).resize(W, H, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
      : sharp(input).resize(W, H, { fit: "cover", position: "attention" });

    let logo: "white" | "navy" = "white";
    if (opts.gradient) {
      const built = await gradientProfileFor(input, sharp, opts.textBands, opts.logoRegion);
      logo = built.logo;

      // A real linear gradient, rasterised once and composited. Light where no
      // text sits, so the photograph keeps its colour there.
      const stops = built.profile
        .map(([d, a]) =>
          `<stop offset="${(d * 100).toFixed(1)}%" stop-color="#023250" stop-opacity="${a.toFixed(3)}"/>`)
        .join("");
      const overlay = Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
           <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>
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
    return { ok: true, url: signedMediaUrl(blob.pathname), logo };
  } catch (err: any) {
    console.warn(`[SlideImages] backdrop bake failed: ${err?.message}`);
    return { ok: false, reason: err?.message || "the image could not be prepared" };
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

async function logoTreatmentFor(
  input: Buffer, sharp: any,
  alphaAt: (depth: number) => number,
  region: LogoRegion = DEFAULT_LOGO_REGION
): Promise<{ floor: number; logo: "white" | "navy" }> {
  const FLOOR = 0.1;
  try {
    const meta = await sharp(input).metadata();
    const W = meta.width || 0, H = meta.height || 0;
    if (!W || !H) return { floor: FLOOR, logo: "white" };
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
    const alpha = alphaAt(depth);
    const seen = alpha * NAVY_L + (1 - alpha) * raw;

    const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (contrast(1, seen) >= 3) return { floor: FLOOR, logo: "white" };
    if (contrast(NAVY_L, seen) >= 3) return { floor: FLOOR, logo: "navy" };

    // Neither mark reads — a mid-tone. Darken a little and take whichever is
    // better, rather than flattening the picture to force a rule to pass.
    const floor = Math.min(0.3, Math.max(FLOOR, alpha + 0.15));
    const darker = floor * NAVY_L + (1 - floor) * raw;
    return { floor, logo: contrast(1, darker) >= contrast(NAVY_L, darker) ? "white" : "navy" };
  } catch {
    return { floor: 0.22, logo: "white" };
  }
}

/** How dark the gradient must be over ONE band of the picture for white text to
 *  clear 4.5:1 there.
 *
 *  Per band, because the gradient used to be solved for the bottom 40% and
 *  applied at full strength only at the very bottom edge. Everything drawn
 *  above that got whatever the interpolation happened to give it: a cover title
 *  sitting at 59–83% depth received about half the alpha the measurement had
 *  demanded, a closing title at 33–54% got a fifth of it — over a bright sky
 *  that is white text at 1.6:1, which is to say invisible — and the contrast
 *  machinery reported success the whole time, because it was only ever
 *  promising 4.5:1 at a depth where nothing is drawn.
 */
async function alphaForBand(
  input: Buffer, sharp: any, band: TextBand
): Promise<number> {
  try {
    const meta = await sharp(input).metadata();
    const H = meta.height || 0, W = meta.width || 1;
    if (!H) return 0.6;
    const top = Math.min(H - 1, Math.max(0, Math.floor(H * band.top)));
    const height = Math.max(1, Math.min(H - top, Math.round(H * (band.bottom - band.top))));
    const { data, info } = await sharp(input)
      .extract({ left: 0, top, width: W, height })
      .resize(48, 12, { fit: "fill" })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const lums: number[] = [];
    for (let i = 0; i < info.width * info.height; i++) {
      lums.push(luminance(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]));
    }
    lums.sort((a, b) => a - b);
    // The 85th percentile, not the maximum: one specular highlight is not what
    // the eye reads a word against, and letting it set the opacity darkens the
    // whole picture.
    const bright = lums[Math.floor(lums.length * 0.85)] ?? 1;
    if (bright <= MAX_BACKGROUND_L) return 0.3;
    const alpha = (bright - MAX_BACKGROUND_L) / (bright - NAVY_L);
    // Capped, because past this the photograph stops being visible at all and a
    // slide whose picture cannot be seen wants a different picture, not a
    // darker one.
    return Math.min(0.88, Math.max(0.3, Number(alpha.toFixed(2))));
  } catch {
    return 0.7;
  }
}

/** Where a layout puts text on the picture, as fractions of the canvas. */
export interface TextBand { top: number; bottom: number }

/** The band to assume when a caller does not say: the bottom third, which is
 *  where a cover puts its title. */
const DEFAULT_TEXT_BAND: TextBand = { top: 0.6, bottom: 1 };

type MeasuredBand = TextBand & { alpha: number };

/** The gradient as a list of stops: what each band needs where it sits, the
 *  floor everywhere else, and a soft ramp between so the change never reads as
 *  an edge. */
const FEATHER = 0.09;
const PROFILE_STEPS = 21;

function buildProfile(bands: MeasuredBand[], floor: number): [number, number][] {
  // Sampled at the BAND EDGES as well as on a regular grid. On the grid alone
  // a band that starts at 0.34 has its first stop at 0.35, so the top line of a
  // closing title sat on the feather ramp instead of the plateau and came out a
  // full contrast step short of what had been measured for it.
  const depths: number[] = [];
  for (let i = 0; i < PROFILE_STEPS; i++) depths.push(i / (PROFILE_STEPS - 1));
  for (const b of bands) {
    depths.push(b.top, b.bottom, Math.max(0, b.top - FEATHER), Math.min(1, b.bottom + FEATHER));
  }
  depths.sort((x, y) => x - y);

  const out: [number, number][] = [];
  let previous = -1;
  for (const d of depths) {
    if (d - previous < 0.001) continue;
    previous = d;
    let a = floor;
    for (const b of bands) {
      if (d >= b.top && d <= b.bottom) { a = Math.max(a, b.alpha); continue; }
      const gap = d < b.top ? b.top - d : d - b.bottom;
      if (gap < FEATHER) a = Math.max(a, floor + (b.alpha - floor) * (1 - gap / FEATHER));
    }
    out.push([d, a]);
  }
  return out;
}

function alphaFromProfile(profile: [number, number][], depth: number): number {
  for (let i = 1; i < profile.length; i++) {
    const [d0, a0] = profile[i - 1], [d1, a1] = profile[i];
    if (depth <= d1) return a0 + ((depth - d0) / (d1 - d0)) * (a1 - a0);
  }
  return profile[profile.length - 1][1];
}

/* ─────────────── Resolution ─────────────── */

export interface ImageRequest {
  /** An exact image to use, skipping the layers. */
  url?: string;
  /** What the slide needs a picture of. */
  query?: string;
}

export interface ImageTreatment {
  aspect: number; gradient: boolean; logoRegion?: LogoRegion; fit?: "cover" | "contain";
  textBands?: TextBand[];
  /** This image must be a REAL mark, so the search and the generator are both
   *  off. A client logo that cannot be found has to be absent: standing an
   *  Unsplash photograph or an invented image in for someone's trademark puts
   *  a false claim on a credibility slide, in front of the client it names. */
  trademark?: boolean;
}

/**
 * Crop and darken a chosen picture.
 *
 * Split out from the choosing because a failed bake is NOT a failed
 * resolution — it always yields something — and the image grid has to know how
 * many pictures it actually got before it can decide what shape to crop them
 * to. Six asked for and four found used to bake a 1.70 crop into a 2.29 cell.
 */
export async function bakeImageSource(
  src: ImageSource, treatment: ImageTreatment
): Promise<ResolvedImage> {
  const baked = await bakeBackdrop(src.url, treatment);
  if (baked.ok) {
    return { url: baked.url, source: src.source, credit: src.credit, scrim: 0, logo: baked.logo };
  }
  // On a text-bearing layout the baked gradient IS the contrast mechanism —
  // the flat scrim rectangle it replaced is gone. So an unbaked photograph
  // there is not "a bit rough", it is white type on raw daylight, and the
  // slide is better off on its designed navy ground. Elsewhere the bake is
  // only a crop, and the raw file letterboxes: ugly, but nothing is unreadable.
  return treatment.gradient
    ? { url: src.url, source: src.source, credit: src.credit, scrim: 0, unusable: baked.reason }
    : { url: src.url, source: src.source, credit: src.credit, scrim: 0, degraded: baked.reason };
}

/** Which picture to use — owned, then stock, then generated. The only half of
 *  resolution that can come back empty-handed. */
export async function selectImageSource(
  req: ImageRequest,
  generate?: ImageGenerator,
  opts: { trademark?: boolean } = {}
): Promise<ImageSource | null> {
  const finish = (
    url: string, source: ResolvedImage["source"], credit?: string
  ): ImageSource => ({ url, source, credit });

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

  if (opts.trademark) {
    console.warn(`[SlideImages] no owned mark for "${query}" — a logo is never searched or generated`);
    return null;
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

/** Choose a picture and prepare it. Kept as a literal composition of the two
 *  halves, so the only way to change what it does is a typo. */
export async function resolveImage(
  req: ImageRequest,
  generate?: ImageGenerator,
  treatment: ImageTreatment = { aspect: 16 / 9, gradient: true }
): Promise<ResolvedImage | null> {
  const src = await selectImageSource(req, generate, { trademark: treatment.trademark });
  return src ? bakeImageSource(src, treatment) : null;
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

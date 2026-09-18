/**
 * Icons for slides, from Lucide.
 *
 * Chosen over generating them, which was the alternative on the table. Icons
 * have to be CONSISTENT across a deck — the same stroke weight, the same
 * corner treatment, the same optical size — and an image model gives none of
 * that: six generated icons are six illustrations. A drawn set is the only
 * thing that reads as a system.
 *
 * Lucide specifically because lucide-react is already a dependency of this app,
 * so a deck's icons match the product's own; and because its licence is
 * unambiguous for client work.
 *
 *   Lucide is ISC licensed — commercial use permitted, no attribution required.
 *   Icons derived from Feather carry MIT. Both require only that the copyright
 *   and permission notice be preserved in source, which this comment does.
 *   https://lucide.dev/license
 *
 * Fetched through the Iconify API, which serves any set by name and recolours
 * server-side, then rasterised here because Slides accepts PNG, JPEG and GIF —
 * an SVG URL is rejected outright.
 */

import { put } from "@vercel/blob";
import { signedMediaUrl } from "@/lib/media/signed";
import { COLOR } from "@/lib/slides/brand";

const ICONIFY = "https://api.iconify.design";
/** Pinned to one set. Mixing sets is how a deck ends up with two visual
 *  languages, which is worse than having no icons. */
const SET = "lucide";
const SIZE = 256;

/** A deck reuses the same few icons, and each one is a fetch, a rasterise and
 *  an upload. Keyed by name AND colour since both change the bytes. */
const cache = new Map<string, string>();

/** Lucide names are kebab-case. Anything else is a typo or a guess, and a 404
 *  from Iconify is silent, so normalise rather than pass through. */
function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/**
 * A brand-coloured icon as a URL Slides can fetch, or null.
 *
 * Null rather than a placeholder: a card with no icon is a card, whereas a card
 * with a broken-image glyph is a defect on a client's screen.
 */
export async function resolveIcon(
  name: string,
  colour: string = COLOR.navy
): Promise<string | null> {
  const slug = normalise(name);
  if (!slug || !process.env.BLOB_READ_WRITE_TOKEN) return null;

  const key = `${slug}:${colour}`;
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const url = `${ICONIFY}/${SET}/${slug}.svg?color=%23${colour.replace("#", "")}&height=${SIZE}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    // Iconify answers 404 with a body, so trust the status, not the bytes.
    if (!res.ok) {
      console.warn(`[Icons] "${slug}" not found in ${SET} (${res.status})`);
      return null;
    }
    const svg = Buffer.from(await res.arrayBuffer());

    const sharp = (await import("sharp")).default;
    const png = await sharp(svg, { density: 300 })
      .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const blob = await put(`slides/icons/${slug}-${colour.replace("#", "")}.png`, png, {
      access: "private",
      contentType: "image/png",
      addRandomSuffix: true,
    });
    const signed = signedMediaUrl(blob.pathname);
    cache.set(key, signed);
    console.log(`[Icons] ${slug} → ${colour}`);
    return signed;
  } catch (err: any) {
    console.warn(`[Icons] "${slug}" failed: ${err?.message}`);
    return null;
  }
}

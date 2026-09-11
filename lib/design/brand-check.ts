/**
 * Brand-check engine v1 — palette histogram on a rendered frame.
 *
 * For each generated still / video, samples a downscaled copy and classifies
 * each pixel to its nearest brand palette colour. Returns the per-colour
 * percentage of the frame plus a list of brand-rule certificates (one per
 * known quantitative rule).
 *
 * Today it implements one rule: the "sandstone cap" (a secondary accent
 * colour can occupy at most N% of the frame — defaults to 14%). The engine
 * is generalised enough to take any palette + cap rule.
 *
 * Future extensions:
 *   - Categorical rules ("no lens flares") via a vision model
 *   - Logo lockup compliance via OCR / template matching
 */

import sharp from "sharp";

export interface BrandColor {
  name: string;
  hex: string;
}

export interface BrandRule {
  rule: string;                      // human-readable rule id (e.g. "Sandstone cap")
  type: "max_pct_of_frame";          // future: "min_pct" | "logo_clearspace" | "no_drop_shadow"
  colorName?: string;                // for max_pct_of_frame: which palette colour
  thresholdPct: number;              // 0–100
}

export type CertResultStatus = "pass" | "warn" | "fail";

export interface CertResult {
  rule: string;
  status: CertResultStatus;
  value?: number;                    // measured (for quantitative rules)
  threshold?: number;
  detail: string;
}

export interface BrandCheckOutcome {
  results: CertResult[];
  histogram: Record<string, number>; // colorName → fraction (0..1)
  onBrand: boolean;                  // true if no rule has status === "fail"
}

/**
 * Run brand checks against an image (or video poster frame).
 *
 * @param imageBuffer raw image bytes (PNG/JPEG/etc.)
 * @param palette     full brand palette to classify against (primary + secondary)
 * @param rules       brand rules to evaluate
 */
export async function evaluateImageAgainstBrand(
  imageBuffer: Buffer,
  palette: BrandColor[],
  rules: BrandRule[],
): Promise<BrandCheckOutcome> {
  if (palette.length === 0) {
    return {
      results: [{ rule: "Palette", status: "warn", detail: "No brand palette to check against" }],
      histogram: {},
      onBrand: true,
    };
  }

  // 1. Sample a small (96-px wide max) raw RGB buffer.
  const downscaled = await sharp(imageBuffer)
    .resize({ width: 96, fit: "inside", withoutEnlargement: false })
    .raw()
    .ensureAlpha(0)
    .toBuffer({ resolveWithObject: true });

  const { data, info } = downscaled;
  const pxCount = info.width * info.height;
  if (pxCount === 0) {
    return {
      results: [{ rule: "Palette", status: "warn", detail: "Image too small to sample" }],
      histogram: {},
      onBrand: true,
    };
  }

  // 2. Classify each pixel to nearest palette colour (Euclidean distance in RGB).
  const palRgb = palette.map((c) => ({ name: c.name, rgb: hexToRgb(c.hex) }));
  const counts: Record<string, number> = {};
  palRgb.forEach((p) => (counts[p.name] = 0));

  const channels = info.channels; // 3 (RGB) or 4 (RGBA)
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let best = palRgb[0];
    let bestDist = Infinity;
    for (const p of palRgb) {
      const dr = r - p.rgb[0];
      const dg = g - p.rgb[1];
      const db = b - p.rgb[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) { best = p; bestDist = d; }
    }
    counts[best.name] += 1;
  }

  const histogram: Record<string, number> = {};
  for (const name of Object.keys(counts)) {
    histogram[name] = counts[name] / pxCount;
  }

  // 3. Evaluate each rule.
  const results: CertResult[] = [];
  for (const rule of rules) {
    if (rule.type === "max_pct_of_frame" && rule.colorName) {
      const fraction = histogram[rule.colorName] ?? 0;
      const pct = fraction * 100;
      const threshold = rule.thresholdPct;
      if (pct <= threshold) {
        results.push({
          rule: rule.rule,
          status: "pass",
          value: round1(pct),
          threshold,
          detail: `${rule.colorName} at ${round1(pct)}% (cap ${threshold}%)`,
        });
      } else if (pct <= threshold + 3) {
        results.push({
          rule: rule.rule,
          status: "warn",
          value: round1(pct),
          threshold,
          detail: `${rule.colorName} at ${round1(pct)}% — just over the ${threshold}% cap`,
        });
      } else {
        results.push({
          rule: rule.rule,
          status: "fail",
          value: round1(pct),
          threshold,
          detail: `${rule.colorName} at ${round1(pct)}% exceeds the ${threshold}% cap`,
        });
      }
    }
  }

  const onBrand = !results.some((r) => r.status === "fail");
  return { results, histogram, onBrand };
}

/**
 * Build the default brand-rule set from a visual_identity object. Currently
 * only synthesises the sandstone-cap rule — extend as we get more structured
 * brand-rule data.
 */
export function defaultRulesFromVisualIdentity(visualIdentity: any): BrandRule[] {
  const rules: BrandRule[] = [];
  // Look for a secondary colour named Sandstone (or similar warm-gold name)
  // and add a 14% cap rule.
  const secondary = visualIdentity?.secondary || [];
  const sandstone = (secondary as BrandColor[]).find((c) =>
    /sandstone|gold|saffron|amber|ochre/i.test(c.name)
  );
  if (sandstone) {
    rules.push({
      rule: "Sandstone cap",
      type: "max_pct_of_frame",
      colorName: sandstone.name,
      thresholdPct: 14,
    });
  }
  return rules;
}

/** Resolve a full brand palette (primary + secondary as BrandColor[]) from a visual_identity object. */
export function paletteFromVisualIdentity(visualIdentity: any): BrandColor[] {
  const primary = (visualIdentity?.primary as BrandColor[]) || [];
  const secondary = (visualIdentity?.secondary as BrandColor[]) || [];
  return [...primary, ...secondary].filter((c) => c && c.hex);
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "").trim();
  if (m.length === 3) {
    return [parseInt(m[0] + m[0], 16), parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16)];
  }
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Image reframing — produce 9:16 / 1:1 / 16:9 / 4:5 derivative crops from a
 * source image using `sharp`. Crops are centred by default; future versions
 * can add saliency-aware cropping (Smart Crop / attention).
 *
 * v1 scope: still images only. Video reframing requires ffmpeg + a Vercel
 * runtime that allows it — tracked separately.
 */

import sharp from "sharp";

export type DerivativeRatio = "9:16" | "1:1" | "16:9" | "4:5";

const RATIO_TO_SIZE: Record<DerivativeRatio, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1":  { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
  "4:5":  { width: 1080, height: 1350 },
};

/**
 * Centre-crop and resize a source image to the target ratio. Returns a PNG
 * buffer (consistent output format).
 */
export async function reframeImage(
  sourceBuffer: Buffer,
  ratio: DerivativeRatio
): Promise<{ buffer: Buffer; width: number; height: number; contentType: string }> {
  const target = RATIO_TO_SIZE[ratio];
  const img = sharp(sourceBuffer, { failOn: "none" });
  const meta = await img.metadata();
  const srcW = meta.width || target.width;
  const srcH = meta.height || target.height;
  const srcAspect = srcW / srcH;
  const targetAspect = target.width / target.height;

  let cropW: number;
  let cropH: number;
  if (srcAspect > targetAspect) {
    // Source is wider — crop horizontally
    cropH = srcH;
    cropW = Math.round(srcH * targetAspect);
  } else {
    // Source is taller — crop vertically
    cropW = srcW;
    cropH = Math.round(srcW / targetAspect);
  }
  const left = Math.floor((srcW - cropW) / 2);
  const top = Math.floor((srcH - cropH) / 2);

  const buffer = await sharp(sourceBuffer, { failOn: "none" })
    .extract({ left, top, width: cropW, height: cropH })
    .resize(target.width, target.height, { fit: "fill" })
    .png({ quality: 92 })
    .toBuffer();

  return { buffer, width: target.width, height: target.height, contentType: "image/png" };
}

export function ratioSupported(ratio: string): ratio is DerivativeRatio {
  return ratio === "9:16" || ratio === "1:1" || ratio === "16:9" || ratio === "4:5";
}

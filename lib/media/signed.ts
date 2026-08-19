/**
 * Capability URLs for blobs that a THIRD PARTY has to fetch.
 *
 * The Blob store is private, and `/api/media/file` gates on a session — right
 * for chat, useless for Google. Slides fetches an image from its own servers
 * with no cookies, so a picture in a deck has to be reachable without one.
 * Making the store public was the obvious move and is not available: Vercel
 * rejects `access: "public"` on a private store outright.
 *
 * So: a signed, expiring, path-scoped URL. Holding it grants exactly one blob
 * and nothing else, which is the same property an unguessable public Blob URL
 * would have had, with an expiry on top.
 *
 * Thirty days rather than an hour, deliberately. Slides fetches once at
 * insertion and keeps its own copy, so the deck would survive a short life —
 * but the in-chat preview is persisted on the message and re-rendered whenever
 * the thread is reopened, and a one-hour URL would turn every older preview
 * into a broken image.
 */

import crypto from "crypto";

const TTL_SECONDS = 30 * 24 * 60 * 60;

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is required to sign media URLs");
  return s;
}

function sign(path: string, exp: number): string {
  return crypto.createHmac("sha256", secret()).update(`${path}|${exp}`).digest("base64url");
}

function publicOrigin(): string {
  const configured = (process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  const isPublic = /^https:\/\//.test(configured) && !/localhost|127\.0\.0\.1/.test(configured);
  return isPublic ? configured : "https://ai.thecontentengine.com";
}

/** An absolute URL any server can fetch, for exactly this blob. */
export function signedMediaUrl(blobPath: string, origin?: string): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const params = new URLSearchParams({ path: blobPath, exp: String(exp), sig: sign(blobPath, exp) });
  return `${(origin || publicOrigin()).replace(/\/$/, "")}/api/media/signed?${params}`;
}

export function verifyMediaSignature(blobPath: string, exp: string, sig: string): boolean {
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry * 1000 < Date.now()) return false;
  const expected = sign(blobPath, expiry);
  // Length check first: timingSafeEqual throws on a length mismatch rather
  // than returning false, which would turn a malformed signature into a 500.
  if (expected.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

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

export function verifyMediaSignature(
  blobPath: string, exp: string, sig: string, opts?: { allowExpired?: boolean }
): boolean {
  const expiry = Number(exp);
  if (!Number.isFinite(expiry)) return false;
  if (!opts?.allowExpired && expiry * 1000 < Date.now()) return false;
  const expected = Buffer.from(sign(blobPath, expiry));
  const given = Buffer.from(sig);
  // Compared as BYTES. timingSafeEqual throws on a length mismatch rather than
  // returning false, and the guard used to compare string lengths — so a
  // signature of the right character count but containing a multibyte
  // character passed the guard and threw inside the comparison, turning a
  // malformed signature into a 500 instead of a 404.
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

/**
 * Reissue a URL this module minted, expired or not.
 *
 * A draft outlives its pictures: the capability URLs last thirty days and the
 * draft sitting in the thread does not expire at all, so a deck reopened five
 * weeks later published with links Google could only 404 — and one unfetchable
 * image fails the WHOLE batchUpdate, so the deck did not build at all.
 *
 * Reissuing on a VERIFIED signature and never on a bare path: the HMAC is the
 * proof that we granted this blob before, so this extends a grant we already
 * made. Signing whatever path a caller hands over would turn this into an
 * oracle for the entire private store. Anything we did not mint is returned
 * untouched.
 */
export function refreshSignedMediaUrl(url: string): string {
  try {
    if (typeof url !== "string" || !url.includes("/api/media/signed")) return url;
    const u = new URL(url);
    if (u.pathname !== "/api/media/signed") return url;
    const path = u.searchParams.get("path");
    const exp = u.searchParams.get("exp");
    const sig = u.searchParams.get("sig");
    if (!path || !exp || !sig) return url;
    if (!verifyMediaSignature(path, exp, sig, { allowExpired: true })) return url;
    return signedMediaUrl(path);
  } catch {
    // secret() throws when NEXTAUTH_SECRET is absent, and this runs on the
    // conversation-read path: a missing env var must not stop a thread loading.
    return url;
  }
}

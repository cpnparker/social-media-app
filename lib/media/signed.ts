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

/**
 * TTL POLICY. A signed URL is a bearer capability: whoever holds it can fetch
 * that blob, with no session and no further check. So the life of the URL is
 * the size of the window if one ever leaks — through a log line, a copied link,
 * a browser history, a referrer.
 *
 * Two classes, because they carry different things:
 *
 *  - LONG (30 days) is for material the workspace already treats as shareable:
 *    client logos and brand assets pulled from the asset library. The long life
 *    is load-bearing, and not for Google — Google fetches once at insertion and
 *    keeps its own copy, so minutes would do there. It is for the IN-CHAT
 *    PREVIEW, which is persisted on the message and re-rendered every time the
 *    thread is reopened. A short URL with no reissue turns every older preview
 *    into a broken image.
 *
 *  - SHORT (2 hours) is for anything sourced from a USER ATTACHMENT — a
 *    screenshot, a document page, whatever someone dragged into the composer.
 *    That is a different sensitivity class from a logo: it is client material,
 *    uploaded in confidence, and there is no reason a URL to it should still
 *    work in a month. Two hours covers the deck build and the rest of the
 *    working session; after that the preview is refreshed by the read path
 *    rather than kept alive by a grant nobody can revoke.
 *
 * SHORT is only safe once the read path reissues — see refreshSignedMediaUrl.
 * Shortening it without that in place breaks previews instead of protecting
 * anything, which is why the mint sites opt IN rather than this default moving.
 */
export const TTL_LONG_SECONDS = 30 * 24 * 60 * 60;
export const TTL_SHORT_SECONDS = 2 * 60 * 60;

const TTL_SECONDS = TTL_LONG_SECONDS;

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

/**
 * An absolute URL any server can fetch, for exactly this blob.
 *
 * `ttlSeconds` defaults to LONG so no existing caller changes behaviour. Pass
 * TTL_SHORT_SECONDS at any site minting a URL to user-attachment material.
 */
export function signedMediaUrl(
  blobPath: string,
  origin?: string,
  opts?: { ttlSeconds?: number }
): string {
  const exp = Math.floor(Date.now() / 1000) + (opts?.ttlSeconds ?? TTL_SECONDS);
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
 *
 * NEVER MAKE THIS REACHABLE WITH CALLER-SUPPLIED INPUT. It accepts expired
 * signatures by design — refusing to refresh the URLs that have actually rotted
 * would defeat it — so it is safe only while every caller is server-side and
 * passes a URL read from OUR OWN stored content, for a viewer already
 * authorised to read it. Expose it as an endpoint (/api/media/refresh?url=…),
 * or as a tool parameter, and mere possession of a leaked URL converts into
 * permanent access: the holder renews it forever and the expiry buys nothing.
 * If you need a refresh somewhere new, gate it on the caller's access to the
 * owning conversation, not on their possession of the URL.
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

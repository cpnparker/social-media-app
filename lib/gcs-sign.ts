import { createSign } from "crypto";

// Media files for content deliverables live in the TCE platform's private GCS
// bucket (uploaded by the engine app; objects are keyed "{id_file}/{file_name}").
// This signs V2-style download URLs with the same reflex service account the
// app uses. V2 (legacy) signing is deliberate: it allows multi-year expiries,
// while the V4 scheme caps at 7 days — useless for client offboarding exports.
const BUCKET = "reflex_deploy_private";

let cachedKey: { client_email: string; private_key: string } | null | undefined;

function serviceKey() {
  if (cachedKey !== undefined) return cachedKey;
  try {
    const raw = process.env.GOOGLE_SERVICE;
    const parsed = raw ? JSON.parse(raw) : null;
    // Shape check: valid-JSON-but-wrong-shape must degrade to "can't sign",
    // not throw inside createSign() and 500 the whole export.
    cachedKey =
      parsed && typeof parsed.client_email === "string" && typeof parsed.private_key === "string"
        ? parsed
        : null;
  } catch {
    cachedKey = null;
  }
  return cachedKey;
}

export function canSignMedia(): boolean {
  return serviceKey() !== null;
}

/** Signed download URL for a GCS object path ("{id_file}/{file_name}"), or null if no key. */
export function signMediaUrl(objectPath: string, expiresUnix: number): string | null {
  const key = serviceKey();
  if (!key) return null;
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const resource = `/${BUCKET}/${encodedPath}`;
  const signer = createSign("RSA-SHA256");
  signer.update(`GET\n\n\n${expiresUnix}\n${resource}`);
  const signature = signer.sign(key.private_key, "base64");
  return `https://storage.googleapis.com${resource}?GoogleAccessId=${encodeURIComponent(key.client_email)}&Expires=${expiresUnix}&Signature=${encodeURIComponent(signature)}`;
}

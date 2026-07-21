/**
 * Google service-account auth (drive.readonly), shared by the finance
 * forecast and the general Drive-docs tool. JWT bearer grant signed with
 * Node crypto — no googleapis dependency. Token cached ~50 min.
 *
 * Env: GOOGLE_SA_EMAIL + GOOGLE_SA_PRIVATE_KEY_B64 (base64 of the PEM key —
 * avoids env-var newline mangling).
 */

import crypto from "crypto";

let tokenCache: { at: number; token: string } | null = null;

export function googleSaConfigured(): boolean {
  return !!(process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY_B64);
}

export function googleSaEmail(): string {
  return (process.env.GOOGLE_SA_EMAIL || "").trim();
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export async function getGoogleAccessToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.at < 50 * 60_000) return tokenCache.token;
  const email = googleSaEmail();
  const pem = Buffer.from((process.env.GOOGLE_SA_PRIVATE_KEY_B64 || "").trim(), "base64").toString("utf8");
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(pem));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Google auth failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
  const tok = await res.json();
  tokenCache = { at: Date.now(), token: tok.access_token };
  return tok.access_token;
}

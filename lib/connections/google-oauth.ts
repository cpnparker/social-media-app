/**
 * Google connect, run BY EngineAI, stored WHERE MeetingBrain looks.
 *
 * The point of this file: a user should be able to connect their Google account
 * from inside EngineAI without ever seeing MeetingBrain or the Engine settings
 * area — many of them have access to neither. But MeetingBrain owns every
 * connector that reads Gmail and Calendar, and rebuilding those here would mean
 * two token stores that drift apart and two things to keep correct.
 *
 * So the split is: EngineAI runs the OAuth handshake and writes the resulting
 * grant into `meetingbrain.account`, the exact table and shape MeetingBrain's
 * NextAuth adapter writes. Everything downstream — getGoogleClient, the Gmail
 * and Calendar bridges, MeetingBrain's own scanners — keeps working unchanged,
 * because as far as they can tell the user signed in over there.
 *
 * Two things make that possible rather than wishful:
 *   1. Both apps are on the SAME Supabase project, so Engine's service-role
 *      client can write the meetingbrain schema directly (getMeetingBrainDb).
 *   2. The token must be minted under the SAME Google OAuth client MeetingBrain
 *      refreshes with, or its refresh calls will fail with invalid_client. So
 *      we use MeetingBrain's client id/secret here, not Engine's login client.
 *
 * REQUIRED SETUP (both are console/env changes, not code):
 *   - `<origin>/api/connections/google/callback` registered as an authorised
 *     redirect URI on the MeetingBrain Google OAuth client, for every origin
 *     users reach EngineAI on (ai.thecontentengine.com at minimum).
 *   - MB_GOOGLE_CLIENT_ID / MB_GOOGLE_CLIENT_SECRET set in Engine's env to the
 *     values MeetingBrain uses. If both apps already share one OAuth client,
 *     Engine's existing GOOGLE_CLIENT_ID/SECRET are used as the fallback and
 *     nothing extra is needed.
 */
import { createHmac, timingSafeEqual } from "crypto";

/** Byte-for-byte MeetingBrain's sign-in scopes. A narrower set here would mint
 *  a grant that silently lacks a scope its scanners depend on; a wider one
 *  would ask users for more than they already gave. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
].join(" ");

export function googleClientId(): string {
  return (process.env.MB_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
}

export function googleClientSecret(): string {
  return (process.env.MB_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();
}

export function isConfigured(): boolean {
  return !!googleClientId() && !!googleClientSecret();
}

/** The callback must be an absolute URL and must match the registered URI
 *  exactly, including host — Google compares strings, not intent. */
export function callbackUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/connections/google/callback`;
}

/* ─────────────── Signed state ─────────────── */

/**
 * State carries the return path and the user it was started for, signed so the
 * callback cannot be replayed or retargeted. Same shape as the Xero connect
 * flow already in this repo.
 *
 * Binding the userId matters: without it, a callback could be completed in a
 * different browser session and attach someone else's Google grant to whoever
 * happened to be signed in.
 */
export function signState(payload: Record<string, unknown>): string {
  const secret = process.env.NEXTAUTH_SECRET || "";
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string): Record<string, any> | null {
  const secret = process.env.NEXTAUTH_SECRET || "";
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}

/* ─────────────── Token exchange ─────────────── */

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Google's error body is the useful part — `invalid_client` here almost
    // always means Engine is using a different OAuth client than MeetingBrain,
    // and `redirect_uri_mismatch` means the URI is not registered.
    throw new Error(`token exchange failed (${res.status}): ${json?.error || "unknown"}`);
  }
  return json as GoogleTokens;
}

/** The signed-in Google identity, used to confirm the account connected is the
 *  one we expected rather than whichever account the browser was already in. */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const j = await res.json();
    return (j?.email || "").toLowerCase() || null;
  } catch {
    return null;
  }
}

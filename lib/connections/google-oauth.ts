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
// State signing lives in ./state.ts — shared by the Google, Slack and Microsoft
// flows so there is one implementation of the thing that binds a callback to
// the user who started it, rather than three that can drift.
export { signState, verifyState, stateIsStale } from "./state";

/** Scope needed to create a Google Slides deck in the user's own Drive.
 *
 *  `drive.file` is sufficient on its own — presentations.create and
 *  presentations.batchUpdate both accept it — and it is classified
 *  NON-SENSITIVE, so it carries no OAuth verification requirement. The
 *  alternatives both do: `presentations` is sensitive (app review, ~10 days)
 *  and `drive` is restricted (review plus an annual CASA assessment).
 *
 *  Its limitation is the reason lib/slides/ builds decks from tokens in code
 *  rather than copying a template: drive.file reaches only files this app
 *  created, so files.copy against a shared template deck returns 404. */
export const SLIDES_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** MeetingBrain's sign-in scopes, plus what EngineAI needs on top.
 *
 *  Was byte-for-byte MeetingBrain's list. Adding is safe where narrowing would
 *  not be: this stays a strict SUPERSET, so no MeetingBrain scanner can
 *  silently lose a scope it depends on, and the start route already sends
 *  include_granted_scopes=true so a re-consent returns old AND new scopes
 *  rather than replacing them. Existing refresh tokens keep working untouched.
 *
 *  Never REMOVE an entry here — a narrower grant would mint tokens that fail
 *  over in MeetingBrain rather than here, where nobody would think to look. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  SLIDES_SCOPE,
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

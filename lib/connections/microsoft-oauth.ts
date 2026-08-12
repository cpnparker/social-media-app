/**
 * Microsoft 365 connect, run BY EngineAI, stored WHERE MeetingBrain looks.
 *
 * Lands in `meetingbrain.account` with provider "azure-ad" — the row
 * MeetingBrain's NextAuth AzureADProvider would have written, and the one
 * lib/microsoft.ts getMicrosoftToken reads and refreshes.
 *
 * The token MUST be minted under MeetingBrain's app registration: getMicrosoftToken
 * refreshes with MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT_ID
 * from MeetingBrain's env, so a token issued by a different registration would
 * fail refresh with invalid_client an hour after connecting — a failure that
 * looks like anything but the cause.
 *
 * REQUIRED SETUP (console/env, not code):
 *   - `<origin>/api/connections/microsoft/callback` added as a Redirect URI on
 *     the MeetingBrain Azure app registration (Authentication → Web), for every
 *     origin users reach EngineAI on.
 *   - MB_MICROSOFT_CLIENT_ID / MB_MICROSOFT_CLIENT_SECRET (and optionally
 *     MB_MICROSOFT_TENANT_ID) in Engine's env, set to MeetingBrain's values.
 *     Falls back to MICROSOFT_* if Engine already carries the same app's
 *     credentials.
 */

/** Byte-for-byte MeetingBrain's AzureADProvider scopes. offline_access is what
 *  yields a refresh token; without it the grant lasts about an hour. */
export const MICROSOFT_SCOPES = [
  "openid", "profile", "email", "offline_access",
  "User.Read", "Mail.Read", "Calendars.Read", "Chat.Read", "ChannelMessage.Read.All",
].join(" ");

export function microsoftClientId(): string {
  return (process.env.MB_MICROSOFT_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || "").trim();
}

export function microsoftClientSecret(): string {
  return (process.env.MB_MICROSOFT_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET || "").trim();
}

export function microsoftTenantId(): string {
  return (process.env.MB_MICROSOFT_TENANT_ID || process.env.MICROSOFT_TENANT_ID || "common").trim();
}

export function isConfigured(): boolean {
  return !!microsoftClientId() && !!microsoftClientSecret();
}

export function callbackUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/connections/microsoft/callback`;
}

export function authorizeUrl(): string {
  return `https://login.microsoftonline.com/${microsoftTenantId()}/oauth2/v2.0/authorize`;
}

export function tokenUrl(): string {
  return `https://login.microsoftonline.com/${microsoftTenantId()}/oauth2/v2.0/token`;
}

export interface MicrosoftTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<MicrosoftTokens> {
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: microsoftClientId(),
      client_secret: microsoftClientSecret(),
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: MICROSOFT_SCOPES,
    }),
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    // Microsoft's error_description is genuinely useful — AADSTS50011 is a
    // redirect-URI mismatch, AADSTS7000215 a bad secret — so surface it rather
    // than flattening to "failed".
    const detail = json?.error_description || json?.error || `HTTP ${res.status}`;
    throw new Error(String(detail).split("\n")[0].slice(0, 200));
  }
  return json as MicrosoftTokens;
}

/** The signed-in Microsoft identity, to confirm the right account was authorised. */
export async function fetchMicrosoftEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const j = await res.json();
    // Work accounts populate mail; some only carry userPrincipalName.
    return String(j?.mail || j?.userPrincipalName || "").toLowerCase() || null;
  } catch {
    return null;
  }
}

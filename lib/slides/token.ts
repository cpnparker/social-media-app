/**
 * The user's own Google access token, for writing a presentation into THEIR
 * Drive rather than a service account's.
 *
 * Unlike Gmail and Calendar — which go over the MeetingBrain HTTP bridge
 * because MeetingBrain holds the connection — this reads the grant directly.
 * Both apps share one Supabase project, and EngineAI's own connect flow already
 * WRITES this row (app/api/connections/google/callback), so reading it back is
 * the same access path in reverse, not a new one.
 *
 * The grant deliberately lives in `meetingbrain.account`, so refreshes must use
 * MeetingBrain's OAuth client id/secret. A refresh signed by a different client
 * fails with invalid_client.
 */

import { meetingBrainDb } from "@/lib/supabase-meetingbrain";
import { googleClientId, googleClientSecret, SLIDES_SCOPE } from "@/lib/connections/google-oauth";

export type SlidesAuthFailure =
  | "not_connected"   // no Google grant at all
  | "needs_reconnect" // grant predates the drive.file scope
  | "refresh_failed"  // refresh token rejected or revoked
  | "not_configured"; // no OAuth client on this deployment

export interface SlidesAuth {
  ok: boolean;
  accessToken?: string;
  reason?: SlidesAuthFailure;
}

interface AccountRow {
  id: string | number;
  user_id: string;
  refresh_token: string | null;
  access_token: string | null;
  expires_at: number | null;
  scope: string | null;
}

/** Refresh a minute early — a token that expires mid-batchUpdate produces a
 *  401 halfway through a deck, which leaves a half-built file behind. */
const EXPIRY_SKEW_SECONDS = 60;

async function loadAccount(userEmail: string): Promise<AccountRow | null> {
  const mb = meetingBrainDb;
  const { data: user, error: userErr } = await mb
    .from("users")
    .select("id")
    .eq("email", userEmail.toLowerCase())
    .maybeSingle();
  if (userErr || !user) return null;

  const { data: account, error: accErr } = await mb
    .from("account")
    .select("id, user_id, refresh_token, access_token, expires_at, scope")
    .eq("user_id", (user as any).id)
    .eq("provider", "google")
    .maybeSingle();
  if (accErr || !account) return null;
  return account as unknown as AccountRow;
}

/** Whether this user's stored grant covers slide creation.
 *
 *  Users who connected before drive.file was added hold a valid grant that
 *  simply lacks the scope. That is a reconnect prompt, not an error — and it is
 *  knowable up front because the callback persists the granted scope string. */
export function grantCoversSlides(scope: string | null | undefined): boolean {
  if (!scope) return false;
  const scopes = scope.split(/\s+/);
  return scopes.includes(SLIDES_SCOPE) || scopes.includes("https://www.googleapis.com/auth/drive");
}

/** Cheap pre-flight, so the chat tool can be gated without a token round-trip. */
export async function canGenerateSlides(userEmail: string): Promise<SlidesAuth> {
  if (!googleClientId() || !googleClientSecret()) return { ok: false, reason: "not_configured" };
  const account = await loadAccount(userEmail);
  if (!account || !account.refresh_token) return { ok: false, reason: "not_connected" };
  if (!grantCoversSlides(account.scope)) return { ok: false, reason: "needs_reconnect" };
  return { ok: true };
}

export async function getUserGoogleToken(userEmail: string): Promise<SlidesAuth> {
  if (!googleClientId() || !googleClientSecret()) return { ok: false, reason: "not_configured" };

  const account = await loadAccount(userEmail);
  if (!account || !account.refresh_token) return { ok: false, reason: "not_connected" };
  if (!grantCoversSlides(account.scope)) return { ok: false, reason: "needs_reconnect" };

  const now = Math.floor(Date.now() / 1000);
  if (account.access_token && account.expires_at && account.expires_at - EXPIRY_SKEW_SECONDS > now) {
    return { ok: true, accessToken: account.access_token };
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
    }),
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json?.access_token) {
    console.warn(`[Slides] token refresh failed (${res.status}): ${json?.error || "unknown"}`);
    return { ok: false, reason: "refresh_failed" };
  }

  // Google refresh tokens are not single-use, so only the access token changes.
  // Persisting it keeps the next call from spending a round-trip; a failure to
  // persist is not worth failing the request over.
  const expiresAt = json.expires_in ? now + Number(json.expires_in) : null;
  const { error: updErr } = await meetingBrainDb
    .from("account")
    .update({ access_token: json.access_token, expires_at: expiresAt })
    .eq("user_id", account.user_id)
    .eq("provider", "google");
  if (updErr) console.warn(`[Slides] could not cache access token: ${updErr.message}`);

  return { ok: true, accessToken: json.access_token as string };
}

/** What to tell the user when auth is not available. Phrased as an action they
 *  can take — "no access" is never the whole truth here, since the connection
 *  either exists or is one click away. */
export function authFailureMessage(reason: SlidesAuthFailure): string {
  switch (reason) {
    case "needs_reconnect":
      return "Slide creation needs one extra Google permission that your existing connection predates. Reconnect Google in Settings → Connections and it will work — your Gmail and Calendar access is unaffected.";
    case "not_connected":
      return "Connect your Google account in Settings → Connections and I can build the deck straight into your Drive.";
    case "refresh_failed":
      return "Your Google connection has expired or been revoked. Reconnect it in Settings → Connections.";
    case "not_configured":
      return "Google Slides creation isn't configured on this deployment.";
  }
}

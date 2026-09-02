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
  | "not_configured"  // no OAuth client on this deployment
  /** We could not find OUT. A database blip on the grant store is our fault
   *  and nothing the user can act on — telling them to reconnect a perfectly
   *  good Google account sends them to fix something that is not broken, and if
   *  they do reconnect it still will not work. */
  | "unavailable";

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

/** "No grant" and "could not ask" are different answers and were conflated:
 *  `userErr || !user` returned null for both, so a Supabase outage was reported
 *  as an unconnected Google account. */
type AccountLookup = { ok: true; account: AccountRow | null } | { ok: false };

/**
 * Which of a user's Google grants to use.
 *
 * A user can hold MORE THAN ONE `provider: "google"` row: MeetingBrain's own
 * sign-in keys its row by the numeric Google subject, EngineAI's connect flow
 * keys its own by email address, and the two do not recognise each other. This
 * function used to end in `.maybeSingle()`, which is not "give me one" — it is
 * an ASSERTION that at most one exists, and PostgREST answers a second row with
 * PGRST116, an ERROR. The error became `unavailable`, which tells the user the
 * fault is at our end and to try again later.
 *
 * It was never going to work later. Every slide export for that user failed
 * permanently, and reconnecting could not clear it: the connect callback
 * updates every google row, so a reconnect refreshed both and left both there.
 * One real user (of fifteen) was in exactly this state and had no way out.
 *
 * So: take the rows, rank them, use the best one. A refresh token outranks the
 * slides scope because a grant that cannot be refreshed dies within the hour,
 * while a refreshable grant that lacks the scope produces an honest "reconnect"
 * the user can act on. Expiry breaks the tie.
 */
export function bestGrant(rows: AccountRow[] | null | undefined): AccountRow | null {
  const usable = (rows || []).filter(Boolean);
  if (!usable.length) return null;
  const score = (r: AccountRow) => (r.refresh_token ? 4 : 0) + (grantCoversSlides(r.scope) ? 2 : 0);
  let best = usable[0];
  for (let i = 1; i < usable.length; i++) {
    const r = usable[i];
    const d = score(r) - score(best);
    if (d > 0 || (d === 0 && (r.expires_at || 0) > (best.expires_at || 0))) best = r;
  }
  return best;
}

async function loadAccount(userEmail: string): Promise<AccountLookup> {
  const mb = meetingBrainDb;
  // `.limit(2)` rather than `.maybeSingle()` for the same reason as below: two
  // users sharing an email is a data problem, not a reason to refuse the export.
  const { data: users, error: userErr } = await mb
    .from("users")
    .select("id")
    .eq("email", userEmail.toLowerCase())
    .limit(2);
  if (userErr) {
    console.warn(`[Slides] meetingbrain.users lookup failed for ${userEmail}: ${userErr.message}`);
    return { ok: false };
  }
  if (!users?.length) return { ok: true, account: null };
  if (users.length > 1) {
    console.warn(`[Slides] ${userEmail} matches more than one meetingbrain.users row — using the first`);
  }

  const { data: accounts, error: accErr } = await mb
    .from("account")
    .select("id, user_id, refresh_token, access_token, expires_at, scope")
    .eq("user_id", (users[0] as any).id)
    .eq("provider", "google");
  if (accErr) {
    console.warn(`[Slides] meetingbrain.account lookup failed for ${userEmail}: ${accErr.message}`);
    return { ok: false };
  }
  // The select returns a LIST. Saying so out loud because the cast below is an
  // `as unknown as` — it would let a `.maybeSingle()` back in without tsc
  // noticing, and that shape reached `bestGrant` as a crash rather than a
  // refusal. A 500 is a worse answer than a wrong one.
  if (accounts && !Array.isArray(accounts)) {
    console.warn(`[Slides] account lookup returned a single object, not a list — the query shape changed`);
    return { ok: false };
  }
  const rows = (accounts || []) as unknown as AccountRow[];
  if (rows.length > 1) {
    console.warn(`[Slides] ${userEmail} holds ${rows.length} google grants — using the strongest`);
  }
  return { ok: true, account: bestGrant(rows) };
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
  const lookup = await loadAccount(userEmail);
  if (!lookup.ok) return { ok: false, reason: "unavailable" };
  const account = lookup.account;
  if (!account || !account.refresh_token) return { ok: false, reason: "not_connected" };
  if (!grantCoversSlides(account.scope)) return { ok: false, reason: "needs_reconnect" };
  return { ok: true };
}

export async function getUserGoogleToken(userEmail: string): Promise<SlidesAuth> {
  if (!googleClientId() || !googleClientSecret()) return { ok: false, reason: "not_configured" };

  const lookup = await loadAccount(userEmail);
  if (!lookup.ok) return { ok: false, reason: "unavailable" };
  const account = lookup.account;
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
  // By ROW ID, not by (user, provider): a user may hold more than one google
  // grant, and writing this token across all of them would stamp a token minted
  // from one refresh token onto a row holding a different one.
  const { error: updErr } = await meetingBrainDb
    .from("account")
    .update({ access_token: json.access_token, expires_at: expiresAt })
    .eq("id", account.id);
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
    case "unavailable":
      return "I couldn't check your Google connection just now — that's a problem at our end, not yours. Try again in a moment.";
  }
}

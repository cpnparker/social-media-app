/**
 * Slack connect, run BY EngineAI, stored WHERE MeetingBrain looks.
 *
 * Same split as Google: EngineAI runs the handshake so the user never leaves,
 * MeetingBrain keeps owning and using the grant. Slack differs from the other
 * two in where it lands — there is no `account` row. MeetingBrain stores Slack
 * on columns of `meetingbrain.users` (slack_access_token, slack_bot_token,
 * slack_team_id, …), which is what lib/slack-query.ts reads, so that is what
 * this writes.
 *
 * REQUIRED SETUP (console/env, not code):
 *   - `<origin>/api/connections/slack/callback` added to the Slack app's
 *     OAuth & Permissions → Redirect URLs, for every origin users reach
 *     EngineAI on (ai.thecontentengine.com at minimum).
 *   - MB_SLACK_CLIENT_ID / MB_SLACK_CLIENT_SECRET in Engine's env, set to the
 *     values MeetingBrain uses. Falls back to SLACK_CLIENT_ID/SECRET if Engine
 *     already carries the same app's credentials.
 */

/**
 * Scopes copied verbatim from MeetingBrain's own install URL
 * (app/api/settings/slack/route.ts → getSlackInstallUrl).
 *
 * They must match: Slack grants exactly what is asked for, so a narrower set
 * here would mint a token that silently lacks a scope MeetingBrain's scanners
 * depend on, and a wider one would ask users to approve more than they already
 * have. Kept as two lists because Slack's bot and user tokens carry different
 * scopes and both are stored.
 */
export const SLACK_BOT_SCOPES = [
  "channels:history", "channels:read", "groups:history", "groups:read",
  "im:history", "im:read", "mpim:history", "mpim:read",
  "users:read", "chat:write", "links:read",
].join(",");

export const SLACK_USER_SCOPES = [
  "channels:history", "channels:read", "groups:history", "groups:read",
  "im:history", "im:read", "mpim:history", "mpim:read",
  "users:read", "search:read",
].join(",");

export function slackClientId(): string {
  return (process.env.MB_SLACK_CLIENT_ID || process.env.SLACK_CLIENT_ID || "").trim();
}

export function slackClientSecret(): string {
  return (process.env.MB_SLACK_CLIENT_SECRET || process.env.SLACK_CLIENT_SECRET || "").trim();
}

export function isConfigured(): boolean {
  return !!slackClientId() && !!slackClientSecret();
}

export function callbackUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/connections/slack/callback`;
}

export interface SlackTokenResponse {
  ok: boolean;
  error?: string;
  access_token?: string;            // bot token
  team?: { id?: string; name?: string };
  authed_user?: { id?: string; access_token?: string };
}

export async function exchangeCode(code: string, redirectUri: string): Promise<SlackTokenResponse> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: slackClientId(),
      client_secret: slackClientSecret(),
      code,
      redirect_uri: redirectUri,
    }),
  });
  // Slack answers 200 with { ok: false, error } rather than an HTTP error, so
  // res.ok is not the check that matters here.
  return (await res.json()) as SlackTokenResponse;
}

/** Slack's error codes are terse; these are the ones a user can act on. */
export function explainSlackError(code: string | undefined): string {
  switch (code) {
    case "bad_redirect_uri":
    case "redirect_uri_mismatch":
      return "This app's callback URL isn't registered in Slack. An admin needs to add it under OAuth & Permissions.";
    case "invalid_client_id":
    case "invalid_client_secret":
    case "bad_client_secret":
      return "Slack rejected the app credentials for this deployment.";
    case "invalid_code":
    case "code_already_used":
      return "That authorisation link was already used. Close this window and try again.";
    default:
      return code ? `Slack returned: ${code}` : "Slack rejected the connection.";
  }
}

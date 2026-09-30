import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { GOOGLE_SCOPES, callbackUrl, googleClientId, isConfigured, signState } from "@/lib/connections/google-oauth";

/**
 * GET /api/connections/google/start — begin connecting Google, from EngineAI.
 *
 * Redirects the user straight to Google. They never see MeetingBrain, and they
 * never need the Engine settings area — the whole point of the exercise.
 *
 * `prompt=consent` + `access_type=offline` are both required, and not just
 * belt-and-braces: Google issues a refresh_token only on a consent screen, and
 * for a user who has already granted these scopes it will silently skip consent
 * and return an access token with NO refresh token unless consent is forced.
 * A grant without a refresh token works for an hour and then dies, which is a
 * far worse failure than an extra click.
 */
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.NEXTAUTH_SECRET) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }
  if (!isConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google connect isn't configured on this deployment. Set MB_GOOGLE_CLIENT_ID and MB_GOOGLE_CLIENT_SECRET (the values MeetingBrain uses) and register this app's callback URL on that OAuth client.",
        status_code: "not_configured",
      },
      { status: 503 }
    );
  }

  // Build the callback from the REQUEST's own origin. Users reach EngineAI on
  // ai.thecontentengine.com and the Engine app on engine.…, and Google matches
  // the redirect URI as an exact string — hardcoding one host would break the
  // other. Both must be registered on the OAuth client.
  const origin = req.nextUrl.origin;
  const redirectUri = callbackUrl(origin);

  const state = signState({
    u: parseInt(session.user.id, 10),
    e: (session.user.email || "").toLowerCase(),
    o: origin,
    t: Date.now(),
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", googleClientId());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  // Pre-select the account they are signed in to EngineAI with, so the common
  // case is one click and the wrong-account mistake is harder to make.
  if (session.user.email) url.searchParams.set("login_hint", session.user.email);

  return NextResponse.redirect(url.toString());
}

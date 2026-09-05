import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { signState } from "@/lib/connections/state";
import {
  SLACK_BOT_SCOPES, SLACK_USER_SCOPES, callbackUrl, isConfigured, slackClientId,
} from "@/lib/connections/slack-oauth";

/** GET /api/connections/slack/start — begin connecting Slack, from EngineAI. */
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
          "Slack connect isn't configured on this deployment. Set MB_SLACK_CLIENT_ID and MB_SLACK_CLIENT_SECRET (the values MeetingBrain uses) and add this app's callback URL to the Slack app's redirect URLs.",
        status_code: "not_configured",
      },
      { status: 503 }
    );
  }

  // Built from the request's own origin: users reach EngineAI on ai.… and the
  // Engine app on engine.…, and Slack matches redirect URLs as exact strings.
  const origin = req.nextUrl.origin;

  const state = signState({
    u: parseInt(session.user.id, 10),
    e: (session.user.email || "").toLowerCase(),
    o: origin,
    t: Date.now(),
  });

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", slackClientId());
  url.searchParams.set("scope", SLACK_BOT_SCOPES);
  url.searchParams.set("user_scope", SLACK_USER_SCOPES);
  url.searchParams.set("redirect_uri", callbackUrl(origin));
  url.searchParams.set("state", state);

  return NextResponse.redirect(url.toString());
}

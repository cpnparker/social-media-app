import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { signState } from "@/lib/connections/state";
import {
  MICROSOFT_SCOPES, authorizeUrl, callbackUrl, isConfigured, microsoftClientId,
} from "@/lib/connections/microsoft-oauth";

/** GET /api/connections/microsoft/start — begin connecting Microsoft 365. */
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
          "Microsoft connect isn't configured on this deployment. Set MB_MICROSOFT_CLIENT_ID and MB_MICROSOFT_CLIENT_SECRET (the values MeetingBrain uses) and add this app's callback URL to that Azure app registration.",
        status_code: "not_configured",
      },
      { status: 503 }
    );
  }

  const origin = req.nextUrl.origin;

  const state = signState({
    u: parseInt(session.user.id, 10),
    e: (session.user.email || "").toLowerCase(),
    o: origin,
    t: Date.now(),
  });

  const url = new URL(authorizeUrl());
  url.searchParams.set("client_id", microsoftClientId());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", callbackUrl(origin));
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_SCOPES);
  url.searchParams.set("state", state);
  // Force the account chooser. Without it Azure silently reuses whichever work
  // account the browser is already signed into, which is how someone ends up
  // connecting a personal or wrong-tenant account without noticing.
  url.searchParams.set("prompt", "select_account");
  if (session.user.email) url.searchParams.set("login_hint", session.user.email);

  return NextResponse.redirect(url.toString());
}

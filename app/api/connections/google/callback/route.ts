import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { meetingBrainDb } from "@/lib/supabase-meetingbrain";
import {
  GOOGLE_SCOPES, callbackUrl, exchangeCode, fetchGoogleEmail, verifyState,
} from "@/lib/connections/google-oauth";

/**
 * GET /api/connections/google/callback — finish connecting, and store the grant
 * where MeetingBrain's connectors already look for it.
 *
 * This writes `meetingbrain.account` in the shape MeetingBrain's own NextAuth
 * adapter writes (linkAccount), so getGoogleClient, the Gmail/Calendar bridges
 * and MeetingBrain's scanners all pick it up with no changes on their side.
 * That is what "re-use the MeetingBrain connectors" means in practice: we add a
 * second way to ACQUIRE the grant, not a second place to keep it.
 *
 * Renders a small self-closing page rather than redirecting, because this runs
 * in a popup opened from the chat — the user should land back in the
 * conversation they started from, not on a settings screen.
 */
export const maxDuration = 30;

function closingPage(ok: boolean, message: string): NextResponse {
  // The opener re-reads status on close, so there is nothing to post back —
  // closing IS the signal. Escaped because `message` can carry provider text.
  const safe = message.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
  const html = `<!doctype html><meta charset="utf-8"><title>${ok ? "Connected" : "Couldn't connect"}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh;color:#111;background:#fff}
.b{max-width:26rem;padding:2rem;text-align:center}.t{font-weight:600;margin-bottom:.5rem}.m{color:#666;font-size:13px}
@media(prefers-color-scheme:dark){body{background:#0b0b0c;color:#eee}.m{color:#999}}</style>
<div class="b"><div class="t">${ok ? "Connected" : "Couldn’t connect"}</div><div class="m">${safe}</div></div>
<script>try{window.close()}catch(e){}
setTimeout(function(){try{window.close()}catch(e){}},${ok ? 900 : 4000});</script>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return closingPage(false, "Your session expired. Close this window, sign in again and retry.");
  }

  const params = req.nextUrl.searchParams;
  const err = params.get("error");
  if (err) {
    // access_denied is the user pressing Cancel — not a fault worth logging loudly.
    return closingPage(false, err === "access_denied" ? "You cancelled, so nothing changed." : `Google returned: ${err}`);
  }

  const code = params.get("code");
  const state = verifyState(params.get("state") || "");
  if (!code || !state) {
    return closingPage(false, "That link was invalid or expired. Close this window and try again.");
  }

  // The state is bound to the user who STARTED the flow. Without this check a
  // callback could be completed in another browser session and attach this
  // Google grant to whoever happened to be signed in there.
  const sessionUserId = parseInt(session.user.id, 10);
  if (state.u !== sessionUserId) {
    console.warn(`[Connections/google] state user mismatch: state=${state.u} session=${sessionUserId}`);
    return closingPage(false, "That link was started by a different account. Close this window and try again.");
  }
  // 10 minutes is generous for a consent screen and short enough that a leaked
  // URL in a history or a log is not a standing credential.
  if (typeof state.t === "number" && Date.now() - state.t > 10 * 60_000) {
    return closingPage(false, "That took too long. Close this window and try again.");
  }

  const email = (session.user.email || "").toLowerCase();
  if (!email) {
    return closingPage(false, "Your account has no email address, so there's nothing to link.");
  }

  try {
    const tokens = await exchangeCode(code, callbackUrl(String(state.o || req.nextUrl.origin)));

    // No refresh token means the grant dies in an hour. Google withholds it when
    // consent is skipped — we force prompt=consent precisely to avoid this, so
    // if it still happens something is wrong and a silent "Connected" would be
    // a lie that surfaces as a mystery failure later.
    if (!tokens.refresh_token) {
      console.warn("[Connections/google] no refresh_token returned");
      return closingPage(
        false,
        "Google didn't return a long-lived token. Remove EngineAI at myaccount.google.com/permissions and connect again."
      );
    }

    // Confirm WHICH Google account was actually authorised. Someone signed into
    // two accounts can easily authorise the wrong one, and silently storing it
    // means their chat reads a mailbox that isn't the one they think it is.
    const googleEmail = await fetchGoogleEmail(tokens.access_token);
    if (googleEmail && googleEmail !== email) {
      return closingPage(
        false,
        `You authorised ${googleEmail}, but you're signed in here as ${email}. Connect the matching account.`
      );
    }

    const mb = meetingBrainDb;

    // Find, or create, the MeetingBrain user this grant belongs to. Creating one
    // is legitimate and expected: plenty of Engine users have never opened
    // MeetingBrain, and the whole point is that they should not have to.
    let mbUserId: string | null = null;
    const { data: existingUser, error: userErr } = await mb
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (userErr) throw new Error(`user lookup failed: ${userErr.message}`);

    if (existingUser) {
      mbUserId = (existingUser as any).id;
    } else {
      const { data: created, error: createErr } = await mb
        .from("users")
        .insert({ email, name: session.user.name || null, image: (session.user as any).image || null })
        .select("id")
        .single();
      if (createErr) throw new Error(`could not create user: ${createErr.message}`);
      mbUserId = (created as any).id;
    }

    const expiresAt = tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : null;
    const row = {
      user_id: mbUserId,
      type: "oauth",
      provider: "google",
      provider_account_id: googleEmail || email,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token ?? null,
      expires_at: expiresAt,
      token_type: tokens.token_type ?? "Bearer",
      scope: tokens.scope || GOOGLE_SCOPES,
      id_token: tokens.id_token ?? null,
    };

    // Replace rather than accumulate. getGoogleClient picks a google row with no
    // ORDER BY, so leaving an older row behind is a coin-flip over which token
    // gets used — and a stale one produces intermittent auth failures that look
    // like anything but a duplicate row.
    const { data: prior } = await mb
      .from("account")
      .select("id")
      .eq("user_id", mbUserId)
      .eq("provider", "google");

    if (prior && prior.length > 0) {
      const { error: updErr } = await mb.from("account").update(row).eq("user_id", mbUserId).eq("provider", "google");
      if (updErr) throw new Error(`could not update grant: ${updErr.message}`);
    } else {
      const { error: insErr } = await mb.from("account").insert(row);
      if (insErr) throw new Error(`could not store grant: ${insErr.message}`);
    }

    // Clear any standing "reconnect Google" flag — the reason for it is gone.
    // Tolerated failure: the column may not exist on every deployment, and a
    // successful connection should not be reported as a failure over it.
    await mb.from("users").update({ google_auth_error: null }).eq("id", mbUserId);

    console.log(`[Connections/google] connected user=${sessionUserId} mb_user=${mbUserId}`);
    return closingPage(true, "Google is connected. You can close this window.");
  } catch (e: any) {
    console.error("[Connections/google] failed:", e?.message);
    return closingPage(false, `Couldn't complete the connection: ${String(e?.message || "unknown error").slice(0, 160)}`);
  }
}

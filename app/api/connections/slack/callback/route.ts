import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { meetingBrainDb } from "@/lib/supabase-meetingbrain";
import { closingPage } from "@/lib/connections/closing-page";
import { stateIsStale, verifyState } from "@/lib/connections/state";
import { callbackUrl, exchangeCode, explainSlackError } from "@/lib/connections/slack-oauth";

/**
 * GET /api/connections/slack/callback — finish connecting Slack.
 *
 * Writes the same columns on `meetingbrain.users` that MeetingBrain's own
 * /api/slack/callback writes, so lib/slack-query.ts and the EngineAI Slack
 * bridge pick it up with no change on their side.
 */
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return closingPage(false, "Your session expired. Close this window, sign in again and retry.", 401);
  }

  const params = req.nextUrl.searchParams;
  const err = params.get("error");
  if (err) {
    return closingPage(
      false,
      err === "access_denied" ? "You cancelled, so nothing changed." : `Slack returned: ${err}`,
      err === "access_denied" ? 200 : 400
    );
  }

  const code = params.get("code");
  const state = verifyState(params.get("state") || "");
  if (!code || !state) {
    return closingPage(false, "That link was invalid or expired. Close this window and try again.", 400);
  }

  const sessionUserId = parseInt(session.user.id, 10);
  if (state.u !== sessionUserId) {
    console.warn(`[Connections/slack] state user mismatch: state=${state.u} session=${sessionUserId}`);
    return closingPage(false, "That link was started by a different account. Close this window and try again.", 403);
  }
  if (stateIsStale(state)) {
    return closingPage(false, "That took too long. Close this window and try again.", 400);
  }

  const email = (session.user.email || "").toLowerCase();
  if (!email) {
    return closingPage(false, "Your account has no email address, so there's nothing to link.", 400);
  }

  try {
    const data = await exchangeCode(code, callbackUrl(String(state.o || req.nextUrl.origin)));
    // Slack answers HTTP 200 with { ok: false } — the body is the real result.
    if (!data.ok) {
      console.warn(`[Connections/slack] exchange rejected: ${data.error}`);
      return closingPage(false, explainSlackError(data.error), 400);
    }

    const botToken = data.access_token || null;
    const userToken = data.authed_user?.access_token || null;
    const slackUserId = data.authed_user?.id || null;

    // The USER token is what search and DM reads use. A bot-only grant would
    // store as "connected" and then return nothing for every personal query,
    // which reads as a broken integration rather than an incomplete one.
    if (!userToken) {
      return closingPage(
        false,
        "Slack didn't return a personal token, so your own messages couldn't be read. Try connecting again and approve all the requested permissions.",
        502
      );
    }

    const mb = meetingBrainDb;

    let mbUserId: string | null = null;
    const { data: existingUser, error: userErr } = await mb
      .from("users")
      .select("id, slack_team_id")
      .eq("email", email)
      .maybeSingle();
    if (userErr) throw new Error(`user lookup failed: ${userErr.message}`);

    if (existingUser) {
      mbUserId = (existingUser as any).id;
    } else {
      const { data: created, error: createErr } = await mb
        .from("users")
        .insert({ email, name: session.user.name || null })
        .select("id")
        .single();
      if (createErr) throw new Error(`could not create user: ${createErr.message}`);
      mbUserId = (created as any).id;
    }

    // Re-auth must not clobber scan preferences back to defaults — MeetingBrain's
    // own callback takes the same care, and someone who turned channel scanning
    // off would otherwise find it silently back on after reconnecting.
    const isReauth = !!(existingUser as any)?.slack_team_id;
    const updates: Record<string, unknown> = {
      slack_enabled: true,
      slack_team_id: data.team?.id ?? null,
      slack_team_name: data.team?.name ?? null,
      slack_user_id: slackUserId,
      slack_access_token: userToken,
      slack_bot_token: botToken,
    };
    if (!isReauth) {
      updates.slack_scan_dms = true;
      updates.slack_scan_mentions = true;
    }

    const { error: updErr } = await mb.from("users").update(updates).eq("id", mbUserId);
    if (updErr) throw new Error(`could not store grant: ${updErr.message}`);

    console.log(`[Connections/slack] ${isReauth ? "reconnected" : "connected"} user=${sessionUserId} mb_user=${mbUserId}`);
    return closingPage(
      true,
      `Slack is connected${data.team?.name ? ` to ${data.team.name}` : ""}. You can close this window.`
    );
  } catch (e: any) {
    console.error("[Connections/slack] failed:", e?.message);
    return closingPage(false, `Couldn't complete the connection: ${String(e?.message || "unknown error").slice(0, 160)}`, 500);
  }
}

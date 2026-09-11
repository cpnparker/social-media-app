import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { meetingBrainDb } from "@/lib/supabase-meetingbrain";
import { closingPage } from "@/lib/connections/closing-page";
import { stateIsStale, verifyState } from "@/lib/connections/state";
import {
  MICROSOFT_SCOPES, callbackUrl, exchangeCode, fetchMicrosoftEmail,
} from "@/lib/connections/microsoft-oauth";

/**
 * GET /api/connections/microsoft/callback — finish connecting Microsoft 365.
 *
 * Writes `meetingbrain.account` with provider "azure-ad", the row MeetingBrain's
 * NextAuth AzureADProvider would have written — so getMicrosoftToken reads and
 * refreshes it, and the EngineAI Microsoft bridge works unchanged.
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
    const desc = params.get("error_description") || "";
    return closingPage(
      false,
      err === "access_denied"
        ? "You cancelled, so nothing changed."
        : `Microsoft returned: ${desc.split("\n")[0].slice(0, 160) || err}`,
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
    console.warn(`[Connections/microsoft] state user mismatch: state=${state.u} session=${sessionUserId}`);
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
    const tokens = await exchangeCode(code, callbackUrl(String(state.o || req.nextUrl.origin)));

    // offline_access is requested precisely so this exists. Without it the grant
    // works for about an hour and then fails in a way that looks like anything
    // but a missing refresh token, so refuse rather than store a ticking clock.
    if (!tokens.refresh_token) {
      console.warn("[Connections/microsoft] no refresh_token returned");
      return closingPage(
        false,
        "Microsoft didn't return a long-lived token. The app registration may be missing the offline_access permission.",
        502
      );
    }

    // Which Microsoft account was actually authorised. Work accounts commonly
    // differ from the Google address someone signs into EngineAI with, so this
    // is a WARNING in the log rather than a refusal — but the connected
    // identity is reported back so the mismatch is visible, not silent.
    const msEmail = await fetchMicrosoftEmail(tokens.access_token);
    if (msEmail && msEmail !== email) {
      console.warn(`[Connections/microsoft] identity differs: ms=${msEmail} engine=${email}`);
    }

    const mb = meetingBrainDb;

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
        .insert({ email, name: session.user.name || null })
        .select("id")
        .single();
      if (createErr) throw new Error(`could not create user: ${createErr.message}`);
      mbUserId = (created as any).id;
    }

    const row = {
      user_id: mbUserId,
      type: "oauth",
      provider: "azure-ad",
      provider_account_id: msEmail || email,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token ?? null,
      expires_at: tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : null,
      token_type: tokens.token_type ?? "Bearer",
      scope: tokens.scope || MICROSOFT_SCOPES,
      id_token: tokens.id_token ?? null,
    };

    // Replace, don't accumulate: getMicrosoftToken picks an azure-ad row with no
    // ORDER BY, so a leftover stale row is a coin-flip over which token is used.
    const { data: prior } = await mb
      .from("account")
      .select("id")
      .eq("user_id", mbUserId)
      .eq("provider", "azure-ad");

    if (prior && prior.length > 0) {
      const { error: updErr } = await mb
        .from("account").update(row).eq("user_id", mbUserId).eq("provider", "azure-ad");
      if (updErr) throw new Error(`could not update grant: ${updErr.message}`);
    } else {
      const { error: insErr } = await mb.from("account").insert(row);
      if (insErr) throw new Error(`could not store grant: ${insErr.message}`);
    }

    // MeetingBrain gates its own Microsoft scanning on this; without it the
    // connection exists but its scanners skip the user.
    await mb.from("users").update({ ms_enabled: true }).eq("id", mbUserId);

    console.log(`[Connections/microsoft] connected user=${sessionUserId} mb_user=${mbUserId}`);
    return closingPage(
      true,
      msEmail && msEmail !== email
        ? `Connected as ${msEmail}. You can close this window.`
        : "Microsoft 365 is connected. You can close this window."
    );
  } catch (e: any) {
    console.error("[Connections/microsoft] failed:", e?.message);
    return closingPage(false, `Couldn't complete the connection: ${String(e?.message || "unknown error").slice(0, 160)}`, 500);
  }
}

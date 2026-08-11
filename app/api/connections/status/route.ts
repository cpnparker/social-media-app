import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";

/**
 * GET /api/connections/status — what the SIGNED-IN user is connected to.
 *
 * Two halves, from two places, deliberately kept apart in the response:
 *
 *  - CONNECTION lives in MeetingBrain. Google and Microsoft are the login
 *    there and Slack is installed per user, so EngineAI holds none of those
 *    grants and cannot start one. It asks the bridge.
 *  - PERMISSION lives here, in intelligence.users_access. An admin decides who
 *    may query what.
 *
 * Both must be true for a tool to work, and a UI that merges them is a UI that
 * tells someone "connected" when an admin hasn't granted it, or "unavailable"
 * when the only problem is a switch an admin can flip. So the response reports
 * `connected`, `permitted` and `available` separately and lets the page say
 * which one is missing.
 *
 * Strictly per-user: the email comes from the server session, never the query
 * string, so this cannot be pointed at a colleague.
 */
export const maxDuration = 20;

interface BridgeConnection {
  connected: boolean;
  engineaiEnabled: boolean | null;
  available: boolean;
  account?: string | null;
  problem?: string | null;
  connectUrl?: string | null;
}

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  const userEmail = (session.user.email || "").trim().toLowerCase();

  // ── Permission side (this app) ──
  // Read in two passes for the same reason the chat route does: an unknown
  // column fails the WHOLE PostgREST select, so folding the newer flags in with
  // the older ones would let a missing migration deny all of them at once.
  const permissions = { gmail: false, calendar: false, microsoft: false };
  const workspaceId = _req.nextUrl.searchParams.get("workspaceId");
  if (workspaceId) {
    try {
      const { data } = await intelligenceDb
        .from("users_access")
        .select("flag_access_gmail")
        .eq("id_workspace", workspaceId)
        .eq("user_target", userId)
        .maybeSingle();
      permissions.gmail = (data as any)?.flag_access_gmail === 1;
    } catch { /* absent row or column = denied */ }
    try {
      const { data } = await intelligenceDb
        .from("users_access")
        .select("flag_access_calendar, flag_access_microsoft")
        .eq("id_workspace", workspaceId)
        .eq("user_target", userId)
        .maybeSingle();
      permissions.calendar = (data as any)?.flag_access_calendar === 1;
      permissions.microsoft = (data as any)?.flag_access_microsoft === 1;
    } catch { /* absent row or column = denied */ }
  }

  // ── Connection side (MeetingBrain) ──
  const baseUrl = (process.env.MEETINGBRAIN_BASE_URL || "https://www.meetingbrain.ai").trim();
  const key = (process.env.ENGINEAI_GMAIL_KEY || process.env.MEETINGBRAIN_API_KEY || process.env.ENGINEGPT_INGEST_KEY || "").trim();

  let bridge: { linked: boolean; connections: Record<string, BridgeConnection>; manageUrl?: string; signInUrl?: string } = {
    linked: false,
    connections: {},
  };
  let bridgeError: string | null = null;

  if (!key || !userEmail) {
    bridgeError = !key ? "not_configured" : "no_email";
  } else {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/engineai/connections/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key },
        body: JSON.stringify({ userEmail }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        bridge = await res.json();
      } else {
        bridgeError = `http_${res.status}`;
        console.warn(`[Connections] bridge ${res.status}`);
      }
    } catch (err: any) {
      // A settings page must still render when MeetingBrain is unreachable —
      // it just cannot claim anything about connection state.
      bridgeError = err?.name === "TimeoutError" ? "timeout" : "unreachable";
      console.warn(`[Connections] bridge ${bridgeError}`);
    }
  }

  const merge = (name: "gmail" | "calendar" | "microsoft") => {
    const c = bridge.connections?.[name];
    const permitted = permissions[name];
    return {
      connected: c?.connected ?? false,
      permitted,
      // Both halves, plus whatever MeetingBrain itself says about consent.
      available: (c?.available ?? false) && permitted,
      account: c?.account ?? null,
      problem: c?.problem ?? (bridgeError ? "Couldn't reach MeetingBrain to check" : null),
      connectUrl: c?.connectUrl ?? null,
    };
  };

  return NextResponse.json({
    linked: bridge.linked === true,
    bridgeError,
    manageUrl: bridge.manageUrl || `${baseUrl.replace(/\/$/, "")}/profile/scans`,
    signInUrl: (bridge as any).signInUrl || `${baseUrl.replace(/\/$/, "")}/api/auth/signin`,
    connections: {
      gmail: merge("gmail"),
      calendar: merge("calendar"),
      microsoft: merge("microsoft"),
      // Slack has no EngineAI permission flag — access is governed by the
      // conversation being private, enforced at tool-registration time. So it
      // reports connection state only, and `permitted` is not claimed.
      slack: (() => {
        const c = bridge.connections?.slack;
        return {
          connected: c?.connected ?? false,
          permitted: null as boolean | null,
          available: c?.available ?? false,
          account: c?.account ?? null,
          problem: c?.problem ?? (bridgeError ? "Couldn't reach MeetingBrain to check" : null),
          connectUrl: c?.connectUrl ?? null,
        };
      })(),
    },
  });
}

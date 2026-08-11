"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExternalLink, Loader2, RefreshCw, Mail, Calendar, MessageSquare, Building2,
  CheckCircle2, CircleSlash, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The user's own connected services — Gmail, Calendar, Slack, Microsoft 365.
 *
 * ONE component, mounted twice: Settings → Connections in the Engine app, and
 * the Connections tab of the Personalise modal inside EngineAI. That is
 * deliberate. The single worst thing about this app's settings today is the
 * same value being editable from two screens that have drifted apart (the
 * context detail level has five options in one place and two in the other, and
 * touching the smaller one silently downgrades the setting). Adding a third
 * hand-written copy of a connections list would have been the same mistake.
 *
 * Connecting happens in MeetingBrain, which owns every one of these grants —
 * Google and Microsoft are its login, Slack is a per-user install. EngineAI
 * cannot start one and does not pretend to. What it CAN do is stop making you
 * leave: `connect` opens MeetingBrain in a popup and refreshes as soon as that
 * window closes, so you end up back in the conversation you started from.
 *
 * Two independent things must be true before a service is usable in chat, and
 * this reports them separately rather than as one tick:
 *   1. CONNECTED — the grant, in MeetingBrain.
 *   2. ALLOWED — the per-user flag an admin sets in Settings → Users.
 * They fail for different reasons and have different fixes, and a single
 * combined state would send people to the wrong one.
 */

interface ConnectionRow {
  connected: boolean;
  permitted: boolean | null;
  available: boolean;
  account: string | null;
  problem: string | null;
  connectUrl: string | null;
}

interface StatusPayload {
  linked: boolean;
  bridgeError: string | null;
  permissionsKnown?: boolean;
  manageUrl: string;
  signInUrl: string;
  connections: Record<string, ConnectionRow>;
}

const SERVICES = [
  { key: "gmail", name: "Gmail", icon: Mail,
    blurb: "Search and read your own work mailbox in chat — “what did Ceri say about the renewal?”" },
  { key: "calendar", name: "Google Calendar", icon: Calendar,
    blurb: "Ask what's on today, when you next meet someone, or find a past meeting." },
  { key: "slack", name: "Slack", icon: MessageSquare,
    blurb: "Read your own DMs, mentions and channels you're in." },
  { key: "microsoft", name: "Microsoft 365", icon: Building2,
    blurb: "Outlook mail and calendar, plus your Teams chats." },
] as const;

function StatusPill({ row, unknown }: { row: ConnectionRow | undefined; unknown?: boolean }) {
  if (!row) return null;
  // The server could not reach MeetingBrain, so it has no idea what is
  // connected. "Not connected" here would assert something we failed to look
  // up — and contradict the banner directly above it.
  if (unknown) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5" /> Couldn&rsquo;t check
      </span>
    );
  }
  if (row.available) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Available in chat
      </span>
    );
  }
  // `permitted === null` means the flag could not be resolved (no workspace, a
  // failed read, or Slack which has no flag) — NOT that it was denied. Saying
  // "access not granted" would send someone to an admin over nothing.
  if (row.connected && row.permitted === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Connected
      </span>
    );
  }
  if (row.connected && row.permitted === false) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" /> Connected — access not granted yet
      </span>
    );
  }
  if (row.connected) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CircleSlash className="h-3.5 w-3.5" /> Not connected
    </span>
  );
}

export default function ConnectionsPanel({
  workspaceId,
  compact = false,
}: {
  workspaceId: string | null;
  /** Modal mount — tighter spacing, no page heading. */
  compact?: boolean;
}) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
      const res = await fetch(`/api/connections/status${qs}`);
      if (res.ok) setStatus(await res.json());
    } catch {
      /* keep the previous view rather than blanking it */
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  // Clear any popup watcher on unmount — the modal can close mid-flow.
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  /**
   * Open MeetingBrain's connect flow without leaving the conversation.
   *
   * There is no cross-origin callback to listen for — MeetingBrain's OAuth
   * returns to MeetingBrain, not here — so we watch for the popup closing and
   * re-read status then. A blocked popup falls back to a normal navigation
   * rather than silently doing nothing.
   */
  const connect = (url: string) => {
    // `noopener` is deliberately NOT set: we need the window handle to notice
    // when it closes, and that is the only signal available — MeetingBrain's
    // OAuth returns to MeetingBrain, so there is no callback to this origin to
    // listen for. Retaining the opener is safe here because the popup is our
    // own app on a known host, not third-party content.
    const w = window.open(url, "mb-connect", "width=520,height=720");
    if (!w) {
      window.location.href = url;
      return;
    }
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      if (w.closed) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        // Google's consent round-trip can land a moment after the window goes.
        setTimeout(() => { void load(); }, 800);
      }
    }, 700);
  };

  return (
    <div className={cn("space-y-3", compact ? "" : "space-y-4")}>
      {!compact && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Your connections</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Personal services EngineAI can read on your behalf, in a private chat. These are
              yours alone — nobody else in the workspace can query them, and they are never
              available in a shared or team conversation.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 inline-flex items-center gap-2 h-8 px-3 rounded-lg border text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>
      )}

      {compact && (
        <p className="text-xs text-muted-foreground">
          Services EngineAI can read on your behalf, in a private chat only. Connecting opens
          MeetingBrain in a new window — it holds the connection, and you&rsquo;ll come straight
          back here.
        </p>
      )}

      {status && !status.linked && !status.bridgeError && (
        <div className="rounded-xl border p-4">
          <p className="text-sm">
            You don&rsquo;t have a MeetingBrain account yet. These connections live there, so
            you&rsquo;ll need to sign in once before EngineAI can use any of them.
          </p>
          <button
            onClick={() => connect(status.signInUrl)}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Sign in to MeetingBrain <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {status?.bridgeError && (
        <div className="rounded-xl border border-amber-500/40 p-4">
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Couldn&rsquo;t reach MeetingBrain to check your connections
            {status.bridgeError === "timeout" ? " (timed out)" : ""}. Nothing is broken — this
            just can&rsquo;t confirm anything right now. Try again in a moment.
          </p>
        </div>
      )}

      <div className="space-y-2.5">
        {SERVICES.map(({ key, name, icon: Icon, blurb }) => {
          const row = status?.connections?.[key];
          return (
            <div key={key} className="rounded-xl border p-3.5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="rounded-lg border p-2 shrink-0">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{name}</span>
                      {loading && !status ? (
                        <span className="text-xs text-muted-foreground">Checking…</span>
                      ) : (
                        <StatusPill row={row} unknown={!!status?.bridgeError} />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{blurb}</p>
                    {row?.account && (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Connected as <span className="font-medium">{row.account}</span>
                      </p>
                    )}
                    {row?.problem && !row.available && !status?.bridgeError && (
                      <p className="text-xs mt-1.5 text-muted-foreground">{row.problem}</p>
                    )}
                    {row?.connected && row?.permitted === false && !status?.bridgeError && (
                      <p className="text-xs mt-1.5 text-amber-600 dark:text-amber-400">
                        Ask an admin to enable {name} for you in Settings → Users. Nothing to
                        reconnect — the connection itself is fine.
                      </p>
                    )}
                  </div>
                </div>

                <div className="shrink-0">
                  {row?.connectUrl && (
                    <button
                      onClick={() => connect(row.connectUrl!)}
                      className={cn(
                        "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium",
                        row.connected
                          ? "border hover:bg-muted"
                          : "bg-primary text-primary-foreground hover:opacity-90"
                      )}
                    >
                      {row.connected ? "Manage" : "Connect"}
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        Connecting and disconnecting happens in MeetingBrain — Google, Microsoft and Slack grant
        access to that account, and EngineAI reads through it rather than holding its own copy.
        Whether EngineAI may then query a connected service is a separate, per-user permission set
        by an admin in Settings → Users. Both have to be true, which is why a service can show as
        connected but not yet available.
      </p>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Mail, Calendar, MessageSquare, Building2, CheckCircle2, CircleSlash, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Settings → Connections — the SIGNED-IN USER'S own connected services.
 *
 * Separate from the Administration → Integrations modal on purpose. That one is
 * workspace-scoped and admin-gated (Xero, Drive, Late — one connection serving
 * everyone). These are personal: your mailbox, your calendar, your Slack. Put
 * them in an admin modal and every admin sees their OWN connection state
 * rendered as if it were the workspace's, which is worse than not showing it.
 *
 * Two independent things have to be true before EngineAI can use any of these,
 * and the page says which one is missing rather than collapsing them into a
 * single tick:
 *   1. CONNECTED — the grant, which lives in MeetingBrain. Google and Microsoft
 *      are the login there, so this app cannot start one and never pretends it
 *      can; every action here is a link out.
 *   2. ALLOWED — the per-user flag an admin sets in Settings → Users.
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
  manageUrl: string;
  signInUrl: string;
  connections: Record<string, ConnectionRow>;
}

const SERVICES = [
  {
    key: "gmail",
    name: "Gmail",
    icon: Mail,
    blurb: "Search and read your own work mailbox in chat — “what did Ceri say about the renewal?”",
  },
  {
    key: "calendar",
    name: "Google Calendar",
    icon: Calendar,
    blurb: "Ask what's on today, when you next meet someone, or find a past meeting.",
  },
  {
    key: "slack",
    name: "Slack",
    icon: MessageSquare,
    blurb: "Read your own DMs, mentions and channels you're in.",
  },
  {
    key: "microsoft",
    name: "Microsoft 365",
    icon: Building2,
    blurb: "Outlook mail and calendar, plus your Teams chats.",
  },
] as const;

function StatusPill({ row }: { row: ConnectionRow | undefined }) {
  if (!row) return null;
  if (row.available) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Available in chat
      </span>
    );
  }
  // Connected but not permitted is the case worth naming precisely — nothing is
  // broken and there is nothing for the user to reconnect; an admin has to tick
  // a box. Telling them to "connect" here would send them round a loop.
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

export default function ConnectionsSettingsPage() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  // The permission half is workspace-scoped, so the flags can only be resolved
  // once we know which workspace the user is in.
  useEffect(() => {
    fetch("/api/me/workspaces")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const first = d?.workspaces?.[0]?.id ?? d?.[0]?.id ?? null;
        setWorkspaceId(first ? String(first) : null);
      })
      .catch(() => setWorkspaceId(null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
      const res = await fetch(`/api/connections/status${qs}`);
      if (res.ok) setStatus(await res.json());
    } catch {
      /* leaves the previous view in place rather than blanking the page */
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Your connections</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Personal services EngineAI can read on your behalf, in a private chat. These are yours
            alone — nobody else in the workspace can query them, and they are never available in a
            shared or team conversation.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="shrink-0">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {status && !status.linked && !status.bridgeError && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm">
              You don&rsquo;t have a MeetingBrain account yet. These connections live there, so
              you&rsquo;ll need to sign in once before EngineAI can use any of them.
            </p>
            <a
              href={status.signInUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Sign in to MeetingBrain <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </CardContent>
        </Card>
      )}

      {status?.bridgeError && (
        <Card className="border-amber-500/40">
          <CardContent className="p-4">
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Couldn&rsquo;t reach MeetingBrain to check your connections
              {status.bridgeError === "timeout" ? " (timed out)" : ""}. Nothing is broken — this
              page just can&rsquo;t confirm anything right now. Try Refresh in a moment.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {SERVICES.map(({ key, name, icon: Icon, blurb }) => {
          const row = status?.connections?.[key];
          return (
            <Card key={key}>
              <CardContent className="p-4">
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
                          <StatusPill row={row} />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{blurb}</p>
                      {row?.account && (
                        <p className="text-xs text-muted-foreground mt-1.5">
                          Connected as <span className="font-medium">{row.account}</span>
                        </p>
                      )}
                      {row?.problem && !row.available && (
                        <p className="text-xs mt-1.5 text-muted-foreground">{row.problem}</p>
                      )}
                      {row?.connected && row?.permitted === false && (
                        <p className="text-xs mt-1.5 text-amber-600 dark:text-amber-400">
                          Ask an admin to enable {name} for you in Settings → Users. Nothing to
                          reconnect — the connection is fine.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    {row?.connectUrl && (
                      <a
                        href={row.connectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium",
                          row.connected ? "border hover:bg-muted" : "bg-primary text-primary-foreground hover:opacity-90"
                        )}
                      >
                        {row.connected ? "Manage" : "Connect"}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
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

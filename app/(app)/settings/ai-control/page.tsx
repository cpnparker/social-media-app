"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Clock,
  Zap,
  Power,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import {
  AppName,
  APP_LABELS,
  APP_COLORS,
  ScheduleType,
} from "@/lib/admin/service-registry";

interface ServiceRow {
  id: string;
  app: AppName;
  typeSource: string;
  label: string;
  description: string;
  schedule: {
    type: ScheduleType;
    cronExpression?: string;
    cronPath?: string;
    vercelProject?: string;
  };
  killSwitchEnv?: string;
  metrics: {
    cost30dCents: number;
    cost7dCents: number;
    costTodayCents: number;
    calls30d: number;
    calls7d: number;
    callsToday: number;
    topModels: { model: string; cost30dCents: number }[];
  };
}

interface UnregisteredRow {
  typeApp: string;
  typeSource: string;
  cost30dCents: number;
  calls30d: number;
}

interface PayloadShape {
  services: ServiceRow[];
  unregistered: UnregisteredRow[];
}

function formatCost(cents: number): string {
  if (cents === 0) return "$0.00";
  const dollars = cents / 100;
  if (dollars < 0.01) return "<$0.01";
  return `$${dollars.toFixed(2)}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

const SCHEDULE_BADGE: Record<ScheduleType, { label: string; className: string }> = {
  cron: { label: "Cron", className: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  "user-triggered": { label: "User-triggered", className: "bg-slate-500/10 text-slate-700 border-slate-500/30" },
  background: { label: "Background", className: "bg-violet-500/10 text-violet-700 border-violet-500/30" },
};

function describeCron(expr: string): string {
  if (expr === "*/5 * * * *") return "Every 5 minutes";
  if (expr === "*/10 * * * *") return "Every 10 minutes";
  if (expr === "*/15 * * * *") return "Every 15 minutes";
  if (expr === "*/30 * * * *") return "Every 30 minutes";
  if (expr === "0 * * * *") return "Every hour";
  if (expr === "0 */1 * * *") return "Every hour";
  if (expr === "0 */12 * * *") return "Every 12 hours";
  if (expr === "0 7 * * *") return "Daily at 07:00 UTC";
  if (expr === "*/10 5-9 * * *") return "Every 10 min, 05–09 UTC";
  return expr;
}

export default function AIControlCentrePage() {
  const wsCtx = useWorkspaceSafe();
  const isOwnerOrAdmin =
    wsCtx?.selectedWorkspace?.role === "owner" ||
    wsCtx?.selectedWorkspace?.role === "admin";

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [data, setData] = useState<PayloadShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/workspace")
      .then((r) => r.json())
      .then((d) => {
        if (d.workspace?.id) setWorkspaceId(d.workspace.id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    fetch(`/api/admin/control-center?workspaceId=${workspaceId}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "request failed");
        return j as PayloadShape;
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const totals = useMemo(() => {
    if (!data) return { cost30d: 0, cost7d: 0, costToday: 0, services: 0, crons: 0 };
    const cost30d = data.services.reduce((s, x) => s + x.metrics.cost30dCents, 0);
    const cost7d = data.services.reduce((s, x) => s + x.metrics.cost7dCents, 0);
    const costToday = data.services.reduce((s, x) => s + x.metrics.costTodayCents, 0);
    const services = data.services.filter((x) => x.metrics.calls30d > 0).length;
    const crons = data.services.filter((x) => x.schedule.type === "cron").length;
    return { cost30d, cost7d, costToday, services, crons };
  }, [data]);

  const grouped = useMemo(() => {
    if (!data) return null;
    const out: Record<AppName, ServiceRow[]> = {
      authorityon: [],
      engine: [],
      meetingbrain: [],
    };
    for (const s of data.services) out[s.app].push(s);
    // sort each app's services by 30d cost desc
    for (const a of Object.keys(out) as AppName[]) {
      out[a].sort((x, y) => y.metrics.cost30dCents - x.metrics.cost30dCents);
    }
    return out;
  }, [data]);

  if (!isOwnerOrAdmin) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        AI Control Centre is restricted to workspace owners and admins.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700">
        Failed to load control centre: {error}
      </div>
    );
  }

  if (!data || !grouped) return null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">AI Control Centre</h1>
        <p className="text-sm text-muted-foreground">
          Single view of every LLM-using service across AuthorityOn, Engine and
          MeetingBrain — what models they use, when they run, and what they cost.
        </p>
      </header>

      {/* Headline tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Tile label="Today" value={formatCost(totals.costToday)} />
        <Tile label="Last 7 days" value={formatCost(totals.cost7d)} />
        <Tile label="Last 30 days" value={formatCost(totals.cost30d)} />
        <Tile label="Active services (30d)" value={String(totals.services)} sub={`of ${data.services.length}`} />
        <Tile label="Cron schedules" value={String(totals.crons)} />
      </div>

      {/* Per-app sections */}
      {(Object.keys(grouped) as AppName[]).map((app) => {
        const rows = grouped[app];
        const appTotal = rows.reduce((s, x) => s + x.metrics.cost30dCents, 0);
        return (
          <section key={app} className="space-y-2">
            <div className="flex items-baseline gap-3 px-1">
              <div className={cn("h-2 w-2 rounded-full", APP_COLORS[app])} />
              <h2 className="text-sm font-semibold uppercase tracking-wider">{APP_LABELS[app]}</h2>
              <span className="text-sm text-muted-foreground">
                {formatCost(appTotal)} · last 30d
              </span>
            </div>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0 divide-y">
                {rows.map((row) => (
                  <ServiceRowView key={row.id} row={row} />
                ))}
              </CardContent>
            </Card>
          </section>
        );
      })}

      {/* Unregistered sources (data we have but don't have metadata for) */}
      {data.unregistered.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wider">
              Unregistered sources
            </h2>
            <span className="text-xs text-muted-foreground">
              These appear in ai_usage but aren't in the registry. Add them to{" "}
              <code className="text-[11px]">lib/admin/service-registry.ts</code>.
            </span>
          </div>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0 divide-y">
              {data.unregistered.map((u) => (
                <div key={u.typeApp + u.typeSource} className="flex items-center px-4 py-3 text-sm">
                  <div className="flex-1 font-mono text-xs">
                    {u.typeApp} :: {u.typeSource}
                  </div>
                  <div className="text-muted-foreground tabular-nums w-32 text-right">
                    {formatNumber(u.calls30d)} calls
                  </div>
                  <div className="font-medium tabular-nums w-24 text-right">
                    {formatCost(u.cost30dCents)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ServiceRowView({ row }: { row: ServiceRow }) {
  const sb = SCHEDULE_BADGE[row.schedule.type];
  const cronText =
    row.schedule.type === "cron" && row.schedule.cronExpression
      ? describeCron(row.schedule.cronExpression)
      : null;
  return (
    <div className="grid grid-cols-12 gap-4 px-4 py-3 items-start">
      {/* Label + description */}
      <div className="col-span-5 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{row.label}</span>
          {row.killSwitchEnv && (
            <Badge variant="outline" className="text-[10px] gap-1 border-red-500/30 text-red-600">
              <Power className="h-3 w-3" />
              {row.killSwitchEnv}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {row.description}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {row.metrics.topModels.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">no usage in last 30d</span>
          ) : (
            row.metrics.topModels.map((m) => (
              <Badge key={m.model} variant="secondary" className="text-[10px] font-mono gap-1">
                <Zap className="h-3 w-3" />
                {m.model}
                <span className="text-muted-foreground/70">{formatCost(m.cost30dCents)}</span>
              </Badge>
            ))
          )}
        </div>
      </div>

      {/* Schedule */}
      <div className="col-span-3 text-xs space-y-1">
        <Badge variant="outline" className={cn("text-[10px] gap-1", sb.className)}>
          <Clock className="h-3 w-3" />
          {sb.label}
        </Badge>
        {cronText && <div className="text-muted-foreground">{cronText}</div>}
        {row.schedule.cronPath && (
          <div className="font-mono text-[10px] text-muted-foreground/80 truncate">
            {row.schedule.cronPath}
          </div>
        )}
      </div>

      {/* Spend */}
      <div className="col-span-4 grid grid-cols-3 gap-2 text-xs tabular-nums">
        <Metric label="Today" value={formatCost(row.metrics.costTodayCents)} sub={`${row.metrics.callsToday} calls`} />
        <Metric label="7d" value={formatCost(row.metrics.cost7dCents)} sub={`${row.metrics.calls7d} calls`} />
        <Metric label="30d" value={formatCost(row.metrics.cost30dCents)} sub={`${formatNumber(row.metrics.calls30d)} calls`} />
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

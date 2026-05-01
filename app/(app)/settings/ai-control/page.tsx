"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Clock,
  Zap,
  AlertTriangle,
  Settings2,
  PlayCircle,
  StopCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useWorkspaceSafe } from "@/lib/contexts/WorkspaceContext";
import {
  AppName,
  APP_LABELS,
  APP_COLORS,
  ScheduleType,
} from "@/lib/admin/service-registry";

interface ServiceConfigPayload {
  killed: boolean;
  killedReason: string | null;
  killedAt: string | null;
  dailyCapCents: number | null;
  monthlyCapCents: number | null;
  alertThresholdPct: number | null;
  hardBlock: boolean;
  overDailyCap: boolean;
  overMonthlyCap: boolean;
}

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
  config: ServiceConfigPayload;
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

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/control-center?workspaceId=${workspaceId}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "request failed");
      setData(j as PayloadShape);
      setError(null);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const patchConfig = useCallback(
    async (
      app: string,
      typeSource: string,
      patch: Partial<{
        killed: boolean;
        killedReason: string | null;
        dailyCapCents: number | null;
        monthlyCapCents: number | null;
        alertThresholdPct: number | null;
        hardBlock: boolean;
      }>,
    ) => {
      if (!workspaceId) return;
      const res = await fetch(`/api/admin/control-center/config?workspaceId=${workspaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app, typeSource, ...patch }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || "Failed to update");
        return;
      }
      await refresh();
    },
    [workspaceId, refresh],
  );

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
                  <ServiceRowView key={row.id} row={row} onPatch={patchConfig} />
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
              These appear in ai_usage but aren&apos;t in the registry. Add them to{" "}
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

function ServiceRowView({
  row,
  onPatch,
}: {
  row: ServiceRow;
  onPatch: (
    app: string,
    typeSource: string,
    patch: Partial<{
      killed: boolean;
      killedReason: string | null;
      dailyCapCents: number | null;
      monthlyCapCents: number | null;
      alertThresholdPct: number | null;
      hardBlock: boolean;
    }>,
  ) => Promise<void>;
}) {
  const sb = SCHEDULE_BADGE[row.schedule.type];
  const cronText =
    row.schedule.type === "cron" && row.schedule.cronExpression
      ? describeCron(row.schedule.cronExpression)
      : null;
  const killed = row.config.killed;
  const overCap = row.config.overDailyCap || row.config.overMonthlyCap;

  return (
    <div
      className={cn(
        "grid grid-cols-12 gap-4 px-4 py-3 items-start transition-colors",
        killed && "bg-red-500/5",
      )}
    >
      {/* Label + description */}
      <div className="col-span-5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("font-medium text-sm", killed && "text-red-700 line-through decoration-red-500/40")}>
            {row.label}
          </span>
          {killed && (
            <Badge variant="outline" className="text-[10px] gap-1 border-red-500/40 text-red-700 bg-red-500/10">
              <StopCircle className="h-3 w-3" />
              KILLED
            </Badge>
          )}
          {!killed && overCap && (
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 text-amber-700 bg-amber-500/10">
              <AlertTriangle className="h-3 w-3" />
              OVER CAP
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{row.description}</p>
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
      <div className="col-span-3 grid grid-cols-3 gap-2 text-xs tabular-nums">
        <Metric label="Today" value={formatCost(row.metrics.costTodayCents)} sub={`${row.metrics.callsToday} calls`} />
        <Metric label="7d" value={formatCost(row.metrics.cost7dCents)} sub={`${row.metrics.calls7d} calls`} />
        <Metric label="30d" value={formatCost(row.metrics.cost30dCents)} sub={`${formatNumber(row.metrics.calls30d)} calls`} />
      </div>

      {/* Controls */}
      <div className="col-span-1 flex items-start justify-end gap-1">
        <Button
          size="icon"
          variant={killed ? "default" : "ghost"}
          className={cn("h-7 w-7", killed && "bg-red-600 hover:bg-red-700 text-white")}
          title={killed ? "Resume service" : "Stop service (kill switch)"}
          onClick={() =>
            onPatch(row.app, row.typeSource, killed
              ? { killed: false, killedReason: null }
              : { killed: true, killedReason: "Stopped from Control Centre" })
          }
        >
          {killed ? <PlayCircle className="h-4 w-4" /> : <StopCircle className="h-4 w-4" />}
        </Button>
        <CapsPopover row={row} onPatch={onPatch} />
      </div>
    </div>
  );
}

function CapsPopover({
  row,
  onPatch,
}: {
  row: ServiceRow;
  onPatch: (
    app: string,
    typeSource: string,
    patch: Partial<{
      dailyCapCents: number | null;
      monthlyCapCents: number | null;
      alertThresholdPct: number | null;
      hardBlock: boolean;
    }>,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [daily, setDaily] = useState(
    row.config.dailyCapCents != null ? (row.config.dailyCapCents / 100).toString() : "",
  );
  const [monthly, setMonthly] = useState(
    row.config.monthlyCapCents != null ? (row.config.monthlyCapCents / 100).toString() : "",
  );
  const [alert, setAlert] = useState(
    row.config.alertThresholdPct != null ? row.config.alertThresholdPct.toString() : "",
  );
  const [hardBlock, setHardBlock] = useState(row.config.hardBlock);
  const [saving, setSaving] = useState(false);

  const hasCaps = row.config.dailyCapCents != null || row.config.monthlyCapCents != null;

  async function save() {
    setSaving(true);
    try {
      await onPatch(row.app, row.typeSource, {
        dailyCapCents: daily.trim() === "" ? null : Math.round(parseFloat(daily) * 100),
        monthlyCapCents: monthly.trim() === "" ? null : Math.round(parseFloat(monthly) * 100),
        alertThresholdPct: alert.trim() === "" ? null : parseInt(alert, 10),
        hardBlock,
      });
      toast.success("Caps updated");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant={hasCaps ? "secondary" : "ghost"}
          className="h-7 w-7"
          title="Spend caps"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold">Spend caps</h4>
            <p className="text-xs text-muted-foreground">
              Enforced at every LLM call. Leave blank for no cap.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`d-${row.id}`} className="text-xs">
              Daily cap (USD)
            </Label>
            <Input
              id={`d-${row.id}`}
              type="number"
              step="0.01"
              min="0"
              value={daily}
              onChange={(e) => setDaily(e.target.value)}
              placeholder="e.g. 50"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`m-${row.id}`} className="text-xs">
              Monthly cap (USD)
            </Label>
            <Input
              id={`m-${row.id}`}
              type="number"
              step="0.01"
              min="0"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              placeholder="e.g. 500"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`a-${row.id}`} className="text-xs">
              Alert at % of cap
            </Label>
            <Input
              id={`a-${row.id}`}
              type="number"
              min="0"
              max="100"
              value={alert}
              onChange={(e) => setAlert(e.target.value)}
              placeholder="e.g. 80"
              className="h-8 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={hardBlock}
              onChange={(e) => setHardBlock(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Hard block when cap reached (not just alert)</span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
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

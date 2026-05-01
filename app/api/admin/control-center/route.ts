import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { intelligenceDb } from "@/lib/supabase-intelligence";
import { verifyWorkspaceMembership } from "@/lib/permissions";
import {
  SERVICE_REGISTRY,
  ServiceEntry,
} from "@/lib/admin/service-registry";

interface ServiceMetrics {
  cost30dCents: number;
  cost7dCents: number;
  costTodayCents: number;
  calls30d: number;
  calls7d: number;
  callsToday: number;
  /** top 3 models by cost over the last 30 days */
  topModels: { model: string; cost30dCents: number }[];
}

export interface ServiceConfig {
  killed: boolean;
  killedReason: string | null;
  killedAt: string | null;
  dailyCapCents: number | null;
  monthlyCapCents: number | null;
  alertThresholdPct: number | null;
  hardBlock: boolean;
  /** computed: true if monthly_cap_cents set AND current month spend ≥ cap */
  overMonthlyCap: boolean;
  /** computed: true if daily_cap_cents set AND last-24h spend ≥ cap */
  overDailyCap: boolean;
}

export interface ServiceRow extends ServiceEntry {
  metrics: ServiceMetrics;
  config: ServiceConfig;
}

const ZERO_METRICS: ServiceMetrics = {
  cost30dCents: 0,
  cost7dCents: 0,
  costTodayCents: 0,
  calls30d: 0,
  calls7d: 0,
  callsToday: 0,
  topModels: [],
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  const userId = parseInt(session.user.id, 10);
  const memberRole = await verifyWorkspaceMembership(userId, workspaceId);
  if (!memberRole || (memberRole !== "owner" && memberRole !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [usageRes, configRes] = await Promise.all([
    intelligenceDb
      .from("ai_usage")
      .select("type_app, type_source, name_model, units_cost_tenths, date_created")
      .gte("date_created", thirtyDaysAgo.toISOString()),
    intelligenceDb.from("service_config").select("*"),
  ]);
  if (usageRes.error) {
    return NextResponse.json({ error: usageRes.error.message }, { status: 500 });
  }
  if (configRes.error) {
    return NextResponse.json({ error: configRes.error.message }, { status: 500 });
  }
  const rows = (usageRes.data ?? []) as Array<{
    type_app: string;
    type_source: string;
    name_model: string;
    units_cost_tenths: number;
    date_created: string;
  }>;
  const configRows = (configRes.data ?? []) as Array<{
    app: string;
    type_source: string;
    killed: boolean;
    killed_reason: string | null;
    killed_at: string | null;
    daily_cap_cents: string | number | null;
    monthly_cap_cents: string | number | null;
    alert_threshold_pct: number | null;
    hard_block: boolean;
  }>;
  const configByKey = new Map<string, (typeof configRows)[number]>();
  for (const c of configRows) {
    configByKey.set(`${c.app}::${c.type_source}`, c);
  }
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Aggregate per (app, type_source). Track daily / monthly buckets too —
  // the cap logic in service_config is per-day-rolling and per-month-to-date.
  const bucket = new Map<
    string,
    ServiceMetrics & { _models: Map<string, number>; spendDailyCents: number; spendMonthlyCents: number }
  >();
  const key = (app: string, src: string) => `${app}::${src}`;

  for (const r of rows) {
    const k = key(r.type_app, r.type_source);
    let m = bucket.get(k);
    if (!m) {
      m = { ...ZERO_METRICS, _models: new Map(), spendDailyCents: 0, spendMonthlyCents: 0 };
      bucket.set(k, m);
    }
    const cents = (r.units_cost_tenths || 0) / 10;
    const d = new Date(r.date_created);
    m.cost30dCents += cents;
    m.calls30d += 1;
    if (d >= sevenDaysAgo) {
      m.cost7dCents += cents;
      m.calls7d += 1;
    }
    if (d >= todayStart) {
      m.costTodayCents += cents;
      m.callsToday += 1;
    }
    if (d >= dayAgo) m.spendDailyCents += cents;
    if (d >= monthStart) m.spendMonthlyCents += cents;
    if (r.name_model) {
      m._models.set(
        r.name_model,
        (m._models.get(r.name_model) || 0) + cents,
      );
    }
  }

  const buildConfig = (
    app: string,
    typeSource: string,
    spendDailyCents: number,
    spendMonthlyCents: number,
  ): ServiceConfig => {
    const c = configByKey.get(`${app}::${typeSource}`);
    if (!c) {
      return {
        killed: false,
        killedReason: null,
        killedAt: null,
        dailyCapCents: null,
        monthlyCapCents: null,
        alertThresholdPct: null,
        hardBlock: true,
        overDailyCap: false,
        overMonthlyCap: false,
      };
    }
    const dailyCap = c.daily_cap_cents == null ? null : Number(c.daily_cap_cents);
    const monthlyCap = c.monthly_cap_cents == null ? null : Number(c.monthly_cap_cents);
    return {
      killed: c.killed,
      killedReason: c.killed_reason,
      killedAt: c.killed_at,
      dailyCapCents: dailyCap,
      monthlyCapCents: monthlyCap,
      alertThresholdPct: c.alert_threshold_pct,
      hardBlock: c.hard_block,
      overDailyCap: dailyCap != null && spendDailyCents >= dailyCap,
      overMonthlyCap: monthlyCap != null && spendMonthlyCents >= monthlyCap,
    };
  };

  const services: ServiceRow[] = SERVICE_REGISTRY.map((entry) => {
    const m = bucket.get(key(entry.app, entry.typeSource));
    if (!m) {
      return {
        ...entry,
        metrics: ZERO_METRICS,
        config: buildConfig(entry.app, entry.typeSource, 0, 0),
      };
    }
    const topModels = Array.from(m._models.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([model, cost30dCents]) => ({
        model,
        cost30dCents: Math.round(cost30dCents * 100) / 100,
      }));
    return {
      ...entry,
      metrics: {
        cost30dCents: Math.round(m.cost30dCents * 100) / 100,
        cost7dCents: Math.round(m.cost7dCents * 100) / 100,
        costTodayCents: Math.round(m.costTodayCents * 100) / 100,
        calls30d: m.calls30d,
        calls7d: m.calls7d,
        callsToday: m.callsToday,
        topModels,
      },
      config: buildConfig(entry.app, entry.typeSource, m.spendDailyCents, m.spendMonthlyCents),
    };
  });

  // Surface "unregistered" services — type_sources in the data that aren't in the registry.
  // These are real LLM calls we don't have metadata for; flag so the registry can be updated.
  const registered = new Set(SERVICE_REGISTRY.map((s) => key(s.app, s.typeSource)));
  const unregistered: { typeApp: string; typeSource: string; cost30dCents: number; calls30d: number }[] = [];
  bucket.forEach((m, k) => {
    if (registered.has(k)) return;
    const [typeApp, typeSource] = k.split("::");
    unregistered.push({
      typeApp,
      typeSource,
      cost30dCents: Math.round(m.cost30dCents * 100) / 100,
      calls30d: m.calls30d,
    });
  });
  unregistered.sort((a, b) => b.cost30dCents - a.cost30dCents);

  return NextResponse.json({ services, unregistered });
}

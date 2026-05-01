/**
 * Runtime checks against intelligence.service_config — the AI Control Centre's
 * source of truth for kill switches and budget caps.
 *
 * Mirrors the helper in authorityon-ai/lib/llm/service-control.ts so all three
 * apps gate the same way.
 *
 * Fail-open: if Supabase is unreachable we ALLOW the call. Caches are kept
 * short (30s config / 60s spend) to keep hot loops cheap.
 */

import { intelligenceDb } from "@/lib/supabase-intelligence";

export interface ServiceConfigRow {
  app: string;
  type_source: string;
  killed: boolean;
  killed_reason: string | null;
  daily_cap_cents: number | null;
  monthly_cap_cents: number | null;
  alert_threshold_pct: number | null;
  hard_block: boolean;
}

export class ServiceControlError extends Error {
  constructor(
    public readonly reason: "killed" | "budget_exceeded",
    public readonly app: string,
    public readonly typeSource: string,
    message: string,
  ) {
    super(message);
    this.name = "ServiceControlError";
  }
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CONFIG_TTL_MS = 30_000;
const SPEND_TTL_MS = 60_000;

const configCache = new Map<string, CacheEntry<ServiceConfigRow | null>>();
const spendCache = new Map<string, CacheEntry<{ daily: number; monthly: number }>>();

const k = (app: string, src: string) => `${app}::${src}`;

async function getConfig(app: string, source: string): Promise<ServiceConfigRow | null> {
  const key = k(app, source);
  const cached = configCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const { data, error } = await intelligenceDb
      .from("service_config")
      .select("*")
      .eq("app", app)
      .eq("type_source", source)
      .maybeSingle();
    if (error) throw error;
    const row = (data as ServiceConfigRow | null) ?? null;
    configCache.set(key, { value: row, expiresAt: Date.now() + CONFIG_TTL_MS });
    return row;
  } catch (error) {
    console.warn(
      `[service-control] config lookup failed for ${app}/${source}; failing open:`,
      error instanceof Error ? error.message : error,
    );
    configCache.set(key, { value: null, expiresAt: Date.now() + 5_000 });
    return null;
  }
}

async function getRecentSpendCents(
  app: string,
  source: string,
): Promise<{ daily: number; monthly: number }> {
  const key = k(app, source);
  const cached = spendCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  try {
    const { data, error } = await intelligenceDb
      .from("ai_usage")
      .select("units_cost_tenths, date_created")
      .eq("type_app", app)
      .eq("type_source", source)
      .gte("date_created", monthStart.toISOString());
    if (error) throw error;
    let monthly = 0;
    let daily = 0;
    for (const r of data ?? []) {
      const cents = ((r as { units_cost_tenths?: number }).units_cost_tenths ?? 0) / 10;
      monthly += cents;
      const created = new Date((r as { date_created: string }).date_created);
      if (created >= dayAgo) daily += cents;
    }
    const result = { daily, monthly };
    spendCache.set(key, { value: result, expiresAt: Date.now() + SPEND_TTL_MS });
    return result;
  } catch (error) {
    console.warn(
      `[service-control] spend lookup failed for ${app}/${source}; treating as 0:`,
      error instanceof Error ? error.message : error,
    );
    return { daily: 0, monthly: 0 };
  }
}

export async function assertNotKilled(app: string, source: string): Promise<void> {
  const cfg = await getConfig(app, source);
  if (cfg?.killed) {
    throw new ServiceControlError(
      "killed",
      app,
      source,
      `Service ${app}/${source} is killed via Control Centre${cfg.killed_reason ? `: ${cfg.killed_reason}` : ""}`,
    );
  }
}

export async function isOverHardCap(app: string, source: string): Promise<boolean> {
  const cfg = await getConfig(app, source);
  if (!cfg) return false;
  if (!cfg.hard_block) return false;
  if (cfg.daily_cap_cents == null && cfg.monthly_cap_cents == null) return false;

  const spend = await getRecentSpendCents(app, source);

  if (cfg.daily_cap_cents != null && spend.daily >= cfg.daily_cap_cents) {
    return true;
  }
  if (cfg.monthly_cap_cents != null && spend.monthly >= cfg.monthly_cap_cents) {
    return true;
  }
  return false;
}

export async function assertServiceAllowed(app: string, source: string): Promise<void> {
  await assertNotKilled(app, source);
  if (await isOverHardCap(app, source)) {
    throw new ServiceControlError(
      "budget_exceeded",
      app,
      source,
      `Service ${app}/${source} blocked: spend cap reached`,
    );
  }
}

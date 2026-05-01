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

// ── Model overrides ────────────────────────────────────────────────────────
const overrideCache = new Map<string, CacheEntry<string | null>>();

export async function resolveModelOverride(
  app: string,
  source: string,
  provider: string,
): Promise<string | null> {
  const key = `${app}::${source}::${provider}`;
  const cached = overrideCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const { data, error } = await intelligenceDb
      .from("model_overrides")
      .select("model")
      .eq("app", app)
      .eq("type_source", source)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;
    const model = (data as { model?: string } | null)?.model ?? null;
    overrideCache.set(key, { value: model, expiresAt: Date.now() + CONFIG_TTL_MS });
    return model;
  } catch (error) {
    console.warn(
      `[service-control] model-override lookup failed for ${app}/${source}/${provider}; falling back:`,
      error instanceof Error ? error.message : error,
    );
    overrideCache.set(key, { value: null, expiresAt: Date.now() + 5_000 });
    return null;
  }
}

// ── Schedule gating ────────────────────────────────────────────────────────

export interface ScheduleDecision {
  ok: boolean;
  reason?: "schedule_disabled" | "not_due" | "killed";
  nextRunAt?: string;
}

export async function shouldRunNow(app: string, source: string): Promise<ScheduleDecision> {
  const cfg = await getConfig(app, source);
  if (!cfg) return { ok: true };
  if (cfg.killed) return { ok: false, reason: "killed" };
  const c = cfg as ServiceConfigRow & {
    schedule_enabled?: boolean;
    schedule_interval_minutes?: number | null;
    schedule_last_run_at?: string | null;
  };
  if (c.schedule_enabled === false) return { ok: false, reason: "schedule_disabled" };
  const interval = c.schedule_interval_minutes;
  if (interval && c.schedule_last_run_at) {
    const last = new Date(c.schedule_last_run_at).getTime();
    const due = last + interval * 60_000;
    if (Date.now() < due) {
      return { ok: false, reason: "not_due", nextRunAt: new Date(due).toISOString() };
    }
  }
  return { ok: true };
}

// ── Per-provider global caps ──────────────────────────────────────────────

interface ProviderCapRow {
  provider: string;
  daily_cap_cents: number | null;
  monthly_cap_cents: number | null;
  alert_threshold_pct: number | null;
  hard_block: boolean;
}

const providerCapCache = new Map<string, CacheEntry<ProviderCapRow | null>>();
const providerSpendCache = new Map<string, CacheEntry<{ daily: number; monthly: number }>>();

function modelToProvider(model: string): string {
  if (model.startsWith("claude-")) return "claude";
  if (model.startsWith("gpt-") || model.startsWith("o4-") || model.startsWith("text-embedding")) return "openai";
  if (model.startsWith("gemini-") && model.includes("pro")) return "gemini-pro";
  if (model.startsWith("gemini-")) return "gemini";
  if (model.startsWith("mistral-") || model.startsWith("ministral-")) return "mistral";
  if (model.startsWith("grok-4")) return "grok-4";
  if (model.startsWith("grok-")) return "grok";
  if (model.startsWith("sonar")) return "perplexity";
  return "other";
}

async function getProviderCap(provider: string): Promise<ProviderCapRow | null> {
  const cached = providerCapCache.get(provider);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const { data, error } = await intelligenceDb
      .from("provider_caps")
      .select("*")
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;
    const row = (data as ProviderCapRow | null) ?? null;
    providerCapCache.set(provider, { value: row, expiresAt: Date.now() + CONFIG_TTL_MS });
    return row;
  } catch (error) {
    console.warn(
      `[service-control] provider-cap lookup failed for ${provider}; failing open:`,
      error instanceof Error ? error.message : error,
    );
    providerCapCache.set(provider, { value: null, expiresAt: Date.now() + 5_000 });
    return null;
  }
}

async function getProviderSpendCents(
  provider: string,
): Promise<{ daily: number; monthly: number }> {
  const cached = providerSpendCache.get(provider);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    const { data, error } = await intelligenceDb
      .from("ai_usage")
      .select("name_model, units_cost_tenths, date_created")
      .gte("date_created", monthStart.toISOString());
    if (error) throw error;
    let monthly = 0;
    let daily = 0;
    for (const r of data ?? []) {
      const row = r as { name_model: string; units_cost_tenths?: number; date_created: string };
      if (modelToProvider(row.name_model) !== provider) continue;
      const cents = (row.units_cost_tenths ?? 0) / 10;
      monthly += cents;
      if (new Date(row.date_created) >= dayAgo) daily += cents;
    }
    const result = { daily, monthly };
    providerSpendCache.set(provider, { value: result, expiresAt: Date.now() + SPEND_TTL_MS });
    return result;
  } catch (error) {
    console.warn(
      `[service-control] provider-spend lookup failed for ${provider}; treating as 0:`,
      error instanceof Error ? error.message : error,
    );
    return { daily: 0, monthly: 0 };
  }
}

export async function isOverProviderCap(provider: string): Promise<boolean> {
  const cfg = await getProviderCap(provider);
  if (!cfg || !cfg.hard_block) return false;
  if (cfg.daily_cap_cents == null && cfg.monthly_cap_cents == null) return false;
  const spend = await getProviderSpendCents(provider);
  if (cfg.daily_cap_cents != null && spend.daily >= cfg.daily_cap_cents) return true;
  if (cfg.monthly_cap_cents != null && spend.monthly >= cfg.monthly_cap_cents) return true;
  return false;
}

export async function assertCallAllowed(
  app: string,
  source: string,
  provider: string,
): Promise<void> {
  await assertServiceAllowed(app, source);
  if (await isOverProviderCap(provider)) {
    throw new ServiceControlError(
      "budget_exceeded",
      app,
      source,
      `Provider ${provider} blocked: global spend cap reached`,
    );
  }
}

export async function markScheduleRan(app: string, source: string): Promise<void> {
  try {
    await intelligenceDb.from("service_config").upsert(
      {
        app,
        type_source: source,
        schedule_last_run_at: new Date().toISOString(),
      },
      { onConflict: "app,type_source" },
    );
    configCache.delete(`${app}::${source}`);
  } catch (error) {
    console.warn(
      `[service-control] failed to update schedule_last_run_at for ${app}/${source}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

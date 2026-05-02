-- AI Control Centre: per-service kill switches and budget caps.
--
-- One row per (app, type_source). All three apps (engine, authorityon,
-- meetingbrain) read this table at runtime to decide whether to fire
-- an LLM call.

CREATE TABLE IF NOT EXISTS intelligence.service_config (
  app text NOT NULL,
  type_source text NOT NULL,

  -- Kill switch
  killed boolean NOT NULL DEFAULT false,
  killed_at timestamptz,
  killed_reason text,

  -- Budget caps (cents). NULL = unlimited.
  -- Daily window = rolling 24h ending now. Monthly = calendar month-to-date.
  daily_cap_cents numeric,
  monthly_cap_cents numeric,

  -- 0..100. Alert fired (and recorded in service_alerts) when current spend
  -- crosses this fraction of either cap. NULL = no alert.
  alert_threshold_pct integer,

  -- When true, exceeding the cap blocks new calls (returns budget_exceeded).
  -- When false, the cap is advisory — just alerts.
  hard_block boolean NOT NULL DEFAULT true,

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,

  PRIMARY KEY (app, type_source)
);

CREATE INDEX IF NOT EXISTS idx_service_config_killed
  ON intelligence.service_config(app, type_source) WHERE killed = true;

-- Append-only log of budget alerts and kills, for the Control Centre history view.
CREATE TABLE IF NOT EXISTS intelligence.service_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app text NOT NULL,
  type_source text NOT NULL,
  kind text NOT NULL,                     -- 'kill_on' | 'kill_off' | 'cap_alert' | 'cap_block'
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_alerts_recent
  ON intelligence.service_alerts(created_at DESC);

-- Grants: tables created via the postgres pooler are owned by intelligence_app,
-- so the default ACLs (which fire only when postgres creates a table) don't
-- apply. Explicitly grant the Supabase REST roles.
GRANT ALL ON intelligence.service_config TO service_role, intelligence, authenticated;
GRANT ALL ON intelligence.service_alerts TO service_role, intelligence, authenticated;

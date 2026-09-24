-- AI Control Centre: global per-provider spend caps.
--
-- Sits above the per-service caps in service_config. A call is blocked if
-- EITHER the per-service cap is hit OR the per-provider cap is hit. This
-- is the lever that prevents another "CHF 800 on Gemini" surprise across
-- all services that talk to that provider.
--
-- Provider keys match what's used in model_overrides:
--   claude / openai / gemini / gemini-pro / mistral / grok / grok-4 / perplexity

CREATE TABLE IF NOT EXISTS intelligence.provider_caps (
  provider text PRIMARY KEY,
  daily_cap_cents numeric,
  monthly_cap_cents numeric,
  alert_threshold_pct integer,
  hard_block boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

GRANT ALL ON intelligence.provider_caps TO service_role, intelligence, authenticated;

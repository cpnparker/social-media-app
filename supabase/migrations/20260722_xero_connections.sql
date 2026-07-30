-- Xero integration (Phase 1: read-only finance tool for EngineAI).
-- One connection per workspace; tokens are only ever touched server-side via
-- the service-role client (RLS enabled, no policies = deny-all for anon).
-- OAuth app setup: developer.xero.com → env XERO_CLIENT_ID / XERO_CLIENT_SECRET
-- (+ optional XERO_REDIRECT_URI override).

CREATE TABLE IF NOT EXISTS intelligence.xero_connections (
  id_connection uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace text NOT NULL UNIQUE,
  tenant_id text NOT NULL,            -- Xero organisation (tenant) id
  name_tenant text,                   -- organisation display name
  token_access text NOT NULL,         -- ~30 min lifetime
  token_refresh text NOT NULL,        -- rolling 60-day refresh token
  date_expires timestamptz NOT NULL,  -- access token expiry
  scopes text,
  user_connected integer,             -- Engine user who authorised
  date_created timestamptz NOT NULL DEFAULT now(),
  date_updated timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE intelligence.xero_connections ENABLE ROW LEVEL SECURITY;

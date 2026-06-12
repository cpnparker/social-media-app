-- ============================================================
-- RFP Notification System Migration
-- Run in Supabase SQL Editor (safe to re-run)
-- ============================================================

-- ── 1. Add columns to rfp_notification_settings ──

ALTER TABLE intelligence.rfp_notification_settings
  ADD COLUMN IF NOT EXISTS type_frequency text NOT NULL DEFAULT 'off';

ALTER TABLE intelligence.rfp_notification_settings
  ADD COLUMN IF NOT EXISTS units_digest_day integer NOT NULL DEFAULT 1;

ALTER TABLE intelligence.rfp_notification_settings
  ADD COLUMN IF NOT EXISTS date_last_digest timestamptz;

-- Migrate existing enabled users to realtime (preserves current behaviour)
UPDATE intelligence.rfp_notification_settings
  SET type_frequency = 'realtime'
  WHERE flag_enabled = 1 AND type_frequency = 'off';

-- ── 2. URL verification columns on opportunities ──

ALTER TABLE intelligence.rfp_opportunities
  ADD COLUMN IF NOT EXISTS type_url_confidence text DEFAULT NULL;
ALTER TABLE intelligence.rfp_opportunities
  ADD COLUMN IF NOT EXISTS name_portal text DEFAULT NULL;
ALTER TABLE intelligence.rfp_opportunities
  ADD COLUMN IF NOT EXISTS url_portal_search text DEFAULT NULL;

-- ── 3. Digest Queue table ──

CREATE TABLE IF NOT EXISTS intelligence.rfp_digest_queue (
  id_queue uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace text NOT NULL,
  id_scan uuid REFERENCES intelligence.rfp_scan_log(id_scan) ON DELETE CASCADE,
  name_search text NOT NULL,
  title text NOT NULL,
  organisation_name text NOT NULL,
  date_deadline timestamptz,
  document_scope text,
  units_relevance_score integer NOT NULL DEFAULT 0,
  url_source text,
  flag_processed smallint NOT NULL DEFAULT 0,
  date_created timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfp_digest_queue_ws
  ON intelligence.rfp_digest_queue (id_workspace, flag_processed, date_created);

ALTER TABLE intelligence.rfp_digest_queue ENABLE ROW LEVEL SECURITY;
-- RLS enabled with no permissive policies = anon/public key fully blocked.
-- Service-role key (used by cron jobs) bypasses RLS, so it can still read/write.

-- ── 4. Remove overly permissive policy on rfp_scan_log ──
-- The "Service can manage scan logs" policy allowed any anon key holder to
-- read/write all scan logs. Service-role key already bypasses RLS.

DROP POLICY IF EXISTS "Service can manage scan logs" ON intelligence.rfp_scan_log;
DROP POLICY IF EXISTS "Service can manage digest queue" ON intelligence.rfp_digest_queue;

-- ============================================================
-- RFP Tool tables (intelligence schema)
-- Run in Supabase SQL Editor
-- ============================================================

-- ────────────────────────────────────────────────
-- 1. Access flag
-- ────────────────────────────────────────────────

ALTER TABLE intelligence.users_access
  ADD COLUMN IF NOT EXISTS flag_access_rfptool smallint NOT NULL DEFAULT 0;

-- ────────────────────────────────────────────────
-- 2. RFP Opportunities (discovered or manually added)
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intelligence.rfp_opportunities (
  id_opportunity uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace text NOT NULL,
  title text NOT NULL,
  organisation_name text NOT NULL,
  date_deadline timestamptz,
  document_scope text,
  tags_sectors jsonb DEFAULT '[]',
  name_region text,
  document_value text,
  url_source text,
  units_relevance_score integer,
  type_status text NOT NULL DEFAULT 'discovered',
  document_notes text,
  document_ai_reasoning text,
  user_created integer NOT NULL,
  date_created timestamptz DEFAULT now(),
  date_updated timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfp_opportunities_ws
  ON intelligence.rfp_opportunities(id_workspace, type_status);
CREATE INDEX IF NOT EXISTS idx_rfp_opportunities_deadline
  ON intelligence.rfp_opportunities(id_workspace, date_deadline);

-- ────────────────────────────────────────────────
-- 3. RFP Document Library
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intelligence.rfp_documents (
  id_document uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace text NOT NULL,
  type_document text NOT NULL,
  name_file text NOT NULL,
  url_file text NOT NULL,
  units_file_size integer NOT NULL,
  type_mime text NOT NULL,
  document_extracted_text text,
  document_summary text,
  meta_sections jsonb,
  type_extraction_status text NOT NULL DEFAULT 'pending',
  user_uploaded integer NOT NULL,
  date_created timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfp_documents_ws
  ON intelligence.rfp_documents(id_workspace, type_document);

-- ────────────────────────────────────────────────
-- 4. RFP Responses (draft responses being built)
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intelligence.rfp_responses (
  id_response uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace text NOT NULL,
  id_opportunity uuid REFERENCES intelligence.rfp_opportunities(id_opportunity) ON DELETE SET NULL,
  title text NOT NULL,
  type_status text NOT NULL DEFAULT 'draft',
  config_win_themes jsonb DEFAULT '[]',
  config_company_profile jsonb,
  document_sections jsonb DEFAULT '[]',
  user_created integer NOT NULL,
  date_created timestamptz DEFAULT now(),
  date_updated timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfp_responses_ws
  ON intelligence.rfp_responses(id_workspace, date_updated DESC);

-- ────────────────────────────────────────────────
-- 5. Link table: documents ↔ responses
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intelligence.rfp_response_documents (
  id_response uuid NOT NULL REFERENCES intelligence.rfp_responses(id_response) ON DELETE CASCADE,
  id_document uuid NOT NULL REFERENCES intelligence.rfp_documents(id_document) ON DELETE CASCADE,
  PRIMARY KEY (id_response, id_document)
);

-- ============================================================
-- 6. Row Level Security
--    The app uses the service-role key (bypasses RLS), so these
--    policies act as a safety net — they block direct access via
--    the anon/public key or Supabase client-side SDK.
-- ============================================================

-- rfp_opportunities
ALTER TABLE intelligence.rfp_opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can view opportunities" ON intelligence.rfp_opportunities;
CREATE POLICY "Workspace members can view opportunities"
  ON intelligence.rfp_opportunities FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_opportunities.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can insert opportunities" ON intelligence.rfp_opportunities;
CREATE POLICY "Workspace members can insert opportunities"
  ON intelligence.rfp_opportunities FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_opportunities.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can update opportunities" ON intelligence.rfp_opportunities;
CREATE POLICY "Workspace members can update opportunities"
  ON intelligence.rfp_opportunities FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_opportunities.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can delete opportunities" ON intelligence.rfp_opportunities;
CREATE POLICY "Workspace members can delete opportunities"
  ON intelligence.rfp_opportunities FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_opportunities.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

-- rfp_documents
ALTER TABLE intelligence.rfp_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can view documents" ON intelligence.rfp_documents;
CREATE POLICY "Workspace members can view documents"
  ON intelligence.rfp_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_documents.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can insert documents" ON intelligence.rfp_documents;
CREATE POLICY "Workspace members can insert documents"
  ON intelligence.rfp_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_documents.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can delete documents" ON intelligence.rfp_documents;
CREATE POLICY "Workspace members can delete documents"
  ON intelligence.rfp_documents FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_documents.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

-- rfp_responses
ALTER TABLE intelligence.rfp_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can view responses" ON intelligence.rfp_responses;
CREATE POLICY "Workspace members can view responses"
  ON intelligence.rfp_responses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_responses.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can insert responses" ON intelligence.rfp_responses;
CREATE POLICY "Workspace members can insert responses"
  ON intelligence.rfp_responses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_responses.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can update responses" ON intelligence.rfp_responses;
CREATE POLICY "Workspace members can update responses"
  ON intelligence.rfp_responses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_responses.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can delete responses" ON intelligence.rfp_responses;
CREATE POLICY "Workspace members can delete responses"
  ON intelligence.rfp_responses FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_responses.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

-- ────────────────────────────────────────────────
-- 7. Migrations (safe to re-run)
-- ────────────────────────────────────────────────

-- User assignment on responses
ALTER TABLE intelligence.rfp_responses ADD COLUMN IF NOT EXISTS id_user_assigned integer;
ALTER TABLE intelligence.rfp_responses ADD COLUMN IF NOT EXISTS name_user_assigned text;

-- Multiple deadline milestones on opportunities
ALTER TABLE intelligence.rfp_opportunities ADD COLUMN IF NOT EXISTS config_deadlines jsonb DEFAULT '[]'::jsonb;

-- rfp_response_documents
ALTER TABLE intelligence.rfp_response_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can view response-document links" ON intelligence.rfp_response_documents;
CREATE POLICY "Workspace members can view response-document links"
  ON intelligence.rfp_response_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.rfp_responses r
      JOIN intelligence.workspace_members wm
        ON wm.workspace_id::text = r.id_workspace
      WHERE r.id_response = rfp_response_documents.id_response
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can manage response-document links" ON intelligence.rfp_response_documents;
CREATE POLICY "Workspace members can manage response-document links"
  ON intelligence.rfp_response_documents FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.rfp_responses r
      JOIN intelligence.workspace_members wm
        ON wm.workspace_id::text = r.id_workspace
      WHERE r.id_response = rfp_response_documents.id_response
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

-- ─────────────────────────────────────────────
-- Search history (shared across workspace)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intelligence.rfp_searches (
  id_search uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace text NOT NULL,
  query text,
  config_search jsonb DEFAULT '{}'::jsonb,
  type_provider text NOT NULL DEFAULT 'anthropic',
  results jsonb DEFAULT '[]'::jsonb,
  document_summary text,
  units_result_count integer DEFAULT 0,
  user_created integer NOT NULL,
  name_user_created text,
  date_created timestamptz DEFAULT now()
);

ALTER TABLE intelligence.rfp_searches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can view searches" ON intelligence.rfp_searches;
CREATE POLICY "Workspace members can view searches"
  ON intelligence.rfp_searches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_searches.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can insert searches" ON intelligence.rfp_searches;
CREATE POLICY "Workspace members can insert searches"
  ON intelligence.rfp_searches FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_searches.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

-- ────────────────────────────────────────────────
-- 7. Saved Search Configurations (with optional scheduling)
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intelligence.rfp_saved_searches (
  id_saved_search uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace text NOT NULL,
  name text NOT NULL,
  query text,
  config_search jsonb NOT NULL DEFAULT '{}'::jsonb,
  type_provider text NOT NULL DEFAULT 'anthropic',
  type_schedule text DEFAULT NULL,
  config_schedule jsonb DEFAULT '{}'::jsonb,
  flag_schedule_enabled smallint NOT NULL DEFAULT 0,
  date_last_run timestamptz,
  date_next_run timestamptz,
  user_created integer NOT NULL,
  name_user_created text,
  date_created timestamptz NOT NULL DEFAULT now(),
  date_updated timestamptz
);

CREATE INDEX IF NOT EXISTS idx_rfp_saved_searches_workspace
  ON intelligence.rfp_saved_searches (id_workspace);

CREATE INDEX IF NOT EXISTS idx_rfp_saved_searches_next_run
  ON intelligence.rfp_saved_searches (date_next_run)
  WHERE flag_schedule_enabled = 1;

ALTER TABLE intelligence.rfp_saved_searches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can view saved searches" ON intelligence.rfp_saved_searches;
CREATE POLICY "Workspace members can view saved searches"
  ON intelligence.rfp_saved_searches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_saved_searches.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can insert saved searches" ON intelligence.rfp_saved_searches;
CREATE POLICY "Workspace members can insert saved searches"
  ON intelligence.rfp_saved_searches FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_saved_searches.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can update saved searches" ON intelligence.rfp_saved_searches;
CREATE POLICY "Workspace members can update saved searches"
  ON intelligence.rfp_saved_searches FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_saved_searches.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can delete saved searches" ON intelligence.rfp_saved_searches;
CREATE POLICY "Workspace members can delete saved searches"
  ON intelligence.rfp_saved_searches FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_saved_searches.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

-- ────────────────────────────────────────────────
-- 8. Notification Settings (per-user preferences)
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intelligence.rfp_notification_settings (
  id_setting uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace text NOT NULL,
  user_target integer NOT NULL,
  flag_enabled smallint NOT NULL DEFAULT 1,
  units_min_relevance integer NOT NULL DEFAULT 70,
  date_created timestamptz NOT NULL DEFAULT now(),
  date_updated timestamptz,
  UNIQUE (id_workspace, user_target)
);

ALTER TABLE intelligence.rfp_notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can view notification settings" ON intelligence.rfp_notification_settings;
CREATE POLICY "Workspace members can view notification settings"
  ON intelligence.rfp_notification_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_notification_settings.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Users can manage own notification settings" ON intelligence.rfp_notification_settings;
CREATE POLICY "Users can manage own notification settings"
  ON intelligence.rfp_notification_settings FOR ALL
  USING (
    user_target = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
  );

-- ────────────────────────────────────────────────
-- 9. Scan Log (audit trail of scheduled scans)
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intelligence.rfp_scan_log (
  id_scan uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_saved_search uuid NOT NULL REFERENCES intelligence.rfp_saved_searches(id_saved_search) ON DELETE CASCADE,
  id_workspace text NOT NULL,
  type_status text NOT NULL DEFAULT 'running',
  units_total_found integer DEFAULT 0,
  units_new_found integer DEFAULT 0,
  units_notified integer DEFAULT 0,
  results jsonb DEFAULT '[]'::jsonb,
  document_error text,
  date_started timestamptz NOT NULL DEFAULT now(),
  date_completed timestamptz
);

CREATE INDEX IF NOT EXISTS idx_rfp_scan_log_search
  ON intelligence.rfp_scan_log (id_saved_search);

ALTER TABLE intelligence.rfp_scan_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can view scan logs" ON intelligence.rfp_scan_log;
CREATE POLICY "Workspace members can view scan logs"
  ON intelligence.rfp_scan_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_scan_log.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

-- Service-role key bypasses RLS, so no open policy needed for cron writes.
-- Only workspace members can SELECT scan logs via the anon key.

-- ────────────────────────────────────────────────
-- 10. URL Verification metadata on opportunities
-- ────────────────────────────────────────────────

ALTER TABLE intelligence.rfp_opportunities
  ADD COLUMN IF NOT EXISTS type_url_confidence text DEFAULT NULL;
ALTER TABLE intelligence.rfp_opportunities
  ADD COLUMN IF NOT EXISTS name_portal text DEFAULT NULL;
ALTER TABLE intelligence.rfp_opportunities
  ADD COLUMN IF NOT EXISTS url_portal_search text DEFAULT NULL;

-- ────────────────────────────────────────────────
-- 11. Notification frequency & digest support
-- ────────────────────────────────────────────────

-- Frequency mode: 'realtime' | 'daily' | 'weekly' | 'off'
ALTER TABLE intelligence.rfp_notification_settings
  ADD COLUMN IF NOT EXISTS type_frequency text NOT NULL DEFAULT 'off';

-- Day of week for weekly digest (1=Mon..7=Sun)
ALTER TABLE intelligence.rfp_notification_settings
  ADD COLUMN IF NOT EXISTS units_digest_day integer NOT NULL DEFAULT 1;

-- Track when the last digest was sent for each user
ALTER TABLE intelligence.rfp_notification_settings
  ADD COLUMN IF NOT EXISTS date_last_digest timestamptz;

-- Migrate existing enabled users to realtime (preserves current behaviour)
UPDATE intelligence.rfp_notification_settings
  SET type_frequency = 'realtime'
  WHERE flag_enabled = 1 AND type_frequency = 'off';

-- ────────────────────────────────────────────────
-- 12. Digest Queue (populated by scan cron, consumed by digest cron)
-- ────────────────────────────────────────────────

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

-- Service-role key bypasses RLS, so no open policy needed for cron writes.
-- With RLS enabled and no permissive policies, anon/public key access is fully blocked.

-- ────────────────────────────────────────────────
-- 13. Company Profile (per-workspace, editable, AI-enhanced)
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intelligence.rfp_company_profiles (
  id_profile uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace text NOT NULL UNIQUE,
  document_overview text,
  document_services text,
  document_sectors text,
  document_differentiators text,
  document_target_rfps text,
  config_win_themes jsonb DEFAULT '[]'::jsonb,
  url_website text,
  url_linkedin text,
  user_updated integer,
  date_created timestamptz DEFAULT now(),
  date_updated timestamptz DEFAULT now()
);

ALTER TABLE intelligence.rfp_company_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can view company profile" ON intelligence.rfp_company_profiles;
CREATE POLICY "Workspace members can view company profile"
  ON intelligence.rfp_company_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_company_profiles.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

DROP POLICY IF EXISTS "Workspace members can manage company profile" ON intelligence.rfp_company_profiles;
CREATE POLICY "Workspace members can manage company profile"
  ON intelligence.rfp_company_profiles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_company_profiles.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

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

CREATE POLICY "Workspace members can view opportunities"
  ON intelligence.rfp_opportunities FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_opportunities.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

CREATE POLICY "Workspace members can insert opportunities"
  ON intelligence.rfp_opportunities FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_opportunities.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

CREATE POLICY "Workspace members can update opportunities"
  ON intelligence.rfp_opportunities FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_opportunities.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

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

CREATE POLICY "Workspace members can view documents"
  ON intelligence.rfp_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_documents.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

CREATE POLICY "Workspace members can insert documents"
  ON intelligence.rfp_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_documents.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

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

CREATE POLICY "Workspace members can view responses"
  ON intelligence.rfp_responses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_responses.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

CREATE POLICY "Workspace members can insert responses"
  ON intelligence.rfp_responses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_responses.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

CREATE POLICY "Workspace members can update responses"
  ON intelligence.rfp_responses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM intelligence.workspace_members wm
      WHERE wm.workspace_id::text = rfp_responses.id_workspace
        AND wm.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::int
    )
  );

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

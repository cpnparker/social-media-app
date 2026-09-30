-- Design Mode: schema additions for /engineai/design.
--
-- Adds:
--   1. type_conversation_mode on ai_conversations (general | design)
--   2. visual_identity jsonb on ai_client_context (structured brand rules)
--   3. ai_design_assets table — single source of truth for everything generated,
--      imported, or licensed during a design session.

-- ── 1. type_conversation_mode ──
ALTER TABLE intelligence.ai_conversations
  ADD COLUMN IF NOT EXISTS type_conversation_mode text NOT NULL DEFAULT 'general';

COMMENT ON COLUMN intelligence.ai_conversations.type_conversation_mode IS
  'general = normal chat; design = /engineai/design surface (visual/video creative work).';

CREATE INDEX IF NOT EXISTS idx_ai_conversations_mode
  ON intelligence.ai_conversations(id_workspace, type_conversation_mode, date_created DESC);

-- ── 2. visual_identity on ai_client_context ──
-- Structured brand rules for deterministic prompt augmentation. Populated by the
-- daily client-context cron in addition to the prose document_context summary.
-- Shape:
--   {
--     "primary_colors": ["#0033A0", "#FFFFFF"],
--     "secondary_colors": [...],
--     "typography": { "headline": "...", "body": "..." },
--     "tone_visual": ["confident", "editorial"],
--     "do": ["..."], "dont": ["..."],
--     "logo_urls": [], "reference_image_urls": []
--   }
ALTER TABLE intelligence.ai_client_context
  ADD COLUMN IF NOT EXISTS visual_identity jsonb;

COMMENT ON COLUMN intelligence.ai_client_context.visual_identity IS
  'Structured visual brand rules extracted from styleguides. Used by Design mode to ground image/video generation.';

-- ── 3. ai_design_assets ──
CREATE TABLE IF NOT EXISTS intelligence.ai_design_assets (
  id_asset           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_conversation    uuid REFERENCES intelligence.ai_conversations(id_conversation) ON DELETE SET NULL,
  id_workspace       uuid NOT NULL,
  id_client          integer,                                       -- public.clients(id_client)
  user_created       integer NOT NULL,                              -- public.users(id_user)

  type_asset         text NOT NULL,                                 -- image | video | document | artlist_video
  source             text NOT NULL,                                 -- dalle | grok_imagine | runway | artlist | upload | chart
  blob_path          text NOT NULL,                                 -- Vercel Blob private path
  blob_url           text NOT NULL,                                 -- /api/media/file?path=... proxy URL
  thumbnail_path     text,                                          -- poster frame path for videos
  thumbnail_url      text,                                          -- proxy URL for thumbnail
  prompt             text,                                          -- prompt that produced it (null for uploads / artlist)
  parent_id          uuid REFERENCES intelligence.ai_design_assets(id_asset) ON DELETE SET NULL,  -- for variations / image→video
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,            -- model, duration_sec, width, height, license_terms, etc.

  flag_pinned        smallint NOT NULL DEFAULT 0,                   -- 1 = pinned to storyboard strip
  flag_archived      smallint NOT NULL DEFAULT 0,
  date_created       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_design_assets_conv
  ON intelligence.ai_design_assets(id_conversation, date_created DESC);
CREATE INDEX IF NOT EXISTS idx_ai_design_assets_client
  ON intelligence.ai_design_assets(id_workspace, id_client, date_created DESC)
  WHERE flag_archived = 0;
CREATE INDEX IF NOT EXISTS idx_ai_design_assets_user
  ON intelligence.ai_design_assets(user_created, date_created DESC);

COMMENT ON TABLE intelligence.ai_design_assets IS
  'All assets generated or imported in Design mode. One row per image/video/document/Artlist clip.';

ALTER TABLE intelligence.ai_design_assets ENABLE ROW LEVEL SECURITY;

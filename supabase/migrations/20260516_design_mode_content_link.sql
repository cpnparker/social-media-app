-- Design Mode v2 — link assets directly to content items.
--
-- A design session can be scoped to a specific content piece via
-- /engineai/design?content=N. Every asset generated in that session
-- gets id_content set automatically so the content detail page can
-- query its design assets directly.

ALTER TABLE intelligence.ai_design_assets
  ADD COLUMN IF NOT EXISTS id_content integer;

COMMENT ON COLUMN intelligence.ai_design_assets.id_content IS
  'public.content(id_content). Set when the asset was generated for a specific content piece in Design mode.';

CREATE INDEX IF NOT EXISTS idx_ai_design_assets_content
  ON intelligence.ai_design_assets(id_content, date_created DESC)
  WHERE id_content IS NOT NULL AND flag_archived = 0;

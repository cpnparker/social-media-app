-- Track skipped files and total asset count for client context processing.
-- Allows the UI to show users which files were not processed and why.

ALTER TABLE intelligence.ai_client_context
  ADD COLUMN IF NOT EXISTS document_skipped_files jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS units_asset_total integer DEFAULT 0;

COMMENT ON COLUMN intelligence.ai_client_context.document_skipped_files IS 'Per-file: [{id_asset, name, reason}] — files that could not be processed';
COMMENT ON COLUMN intelligence.ai_client_context.units_asset_total IS 'Total number of client assets (processed + skipped)';

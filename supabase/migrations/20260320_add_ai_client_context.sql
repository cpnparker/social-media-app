-- Processed client context from asset files (PDFs, DOCX, etc.).
-- One row per workspace+client, updated by the client-context cron job.
-- Contains an AI-consolidated profile synthesised from all client asset documents.

CREATE TABLE IF NOT EXISTS intelligence.ai_client_context (
  id_context              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace            uuid NOT NULL,
  id_client               integer NOT NULL,
  document_context        text NOT NULL,           -- consolidated AI summary (~1500 tokens)
  document_file_summaries jsonb DEFAULT '[]',      -- per-file: [{id_asset, name, type, summary, chars_extracted}]
  units_asset_count       integer DEFAULT 0,
  date_last_processed     timestamptz NOT NULL DEFAULT now(),
  date_created            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_client_context_unique
  ON intelligence.ai_client_context(id_workspace, id_client);

CREATE INDEX IF NOT EXISTS idx_ai_client_context_client
  ON intelligence.ai_client_context(id_client);

-- Enable RLS — service role key bypasses this.
ALTER TABLE intelligence.ai_client_context ENABLE ROW LEVEL SECURITY;

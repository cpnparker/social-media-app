-- EngineAI Notebook
-- =================
-- Run in the Supabase SQL Editor (Engine project).
--
-- A scrapbook beside the chat: users highlight part of a response (or keep a
-- whole prompt/answer), annotate it, and the entry links back to the message it
-- came from. Notebook contents reach the model through a `search_notebook` tool
-- plus a one-line index in the system prompt — NOT by writing ai_memories rows.
-- (ai_memories is capped at 50 per user per workspace and every active row is
-- rendered into every system prompt; auto-promotion would exhaust the cap and
-- inflate every turn. Entries are promoted to a real memory one at a time, by
-- explicit user action, through the existing memories POST contract.)
--
-- PRIVACY — the load-bearing rule. `document_quote` is copied out of a
-- conversation, so an entry is only ever as shareable as the thread it came
-- from. A capture taken from a private thread stays visible to its author even
-- inside a team notebook. The API enforces this on read; the columns below
-- exist so it CAN be enforced: id_conversation is retained for the audience
-- lookup, and user_created records the author independently of the notebook's
-- own visibility.

-- ─── Notebooks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.ai_notebooks (
  id_notebook uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace text NOT NULL,
  user_created integer NOT NULL,
  name_title text NOT NULL DEFAULT 'Notebook',
  document_description text,
  type_visibility text NOT NULL DEFAULT 'private', -- private | team
  flag_archived integer NOT NULL DEFAULT 0,
  date_created timestamptz NOT NULL DEFAULT now(),
  date_updated timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_notebooks_visibility_chk CHECK (type_visibility IN ('private', 'team'))
);

CREATE INDEX IF NOT EXISTS idx_ai_notebooks_owner
  ON intelligence.ai_notebooks(id_workspace, user_created)
  WHERE flag_archived = 0;
CREATE INDEX IF NOT EXISTS idx_ai_notebooks_team
  ON intelligence.ai_notebooks(id_workspace)
  WHERE type_visibility = 'team' AND flag_archived = 0;

-- ─── Entries ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.ai_notebook_entries (
  id_entry uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_notebook uuid NOT NULL REFERENCES intelligence.ai_notebooks(id_notebook) ON DELETE CASCADE,
  id_workspace text NOT NULL,
  user_created integer NOT NULL,
  type_entry text NOT NULL DEFAULT 'highlight', -- highlight | answer | prompt | note
  document_quote text NOT NULL,                 -- the captured text
  document_note text,                           -- the user's own annotation
  -- Source. id_conversation drives the audience ceiling and the deep link;
  -- ON DELETE SET NULL so deleting a thread doesn't destroy the scrapbook.
  id_conversation uuid REFERENCES intelligence.ai_conversations(id_conversation) ON DELETE SET NULL,
  -- Deliberately NO foreign key: messages can be hard-deleted (retry, edit,
  -- reap of dead pending rows) and an entry must outlive its source message.
  -- A dangling id_message simply means the deep link no longer resolves.
  id_message uuid,
  -- Snapshot of the thread title at capture time, so an entry still reads
  -- sensibly after the conversation is gone and id_conversation is NULL.
  name_source_title text,
  -- Stamped at INSERT from the source thread's visibility, and it is a FLOOR,
  -- never re-derived. Two holes it closes:
  --   1. id_conversation is SET NULL when a thread is deleted, so a live-only
  --      check would read "no source → shareable" and a private capture would
  --      become team-visible the moment its thread was deleted.
  --   2. The notebook's AI composer can save an answer derived from private
  --      entries as a `note`, which has no source conversation at all.
  -- Reads apply BOTH this flag and a live lookup of the source thread, so a
  -- thread later turned private still demotes its captures.
  flag_private_source integer NOT NULL DEFAULT 0,
  id_client integer,
  config_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  units_order integer NOT NULL DEFAULT 0,
  -- Explicit promotion to a real memory (never automatic).
  flag_memory integer NOT NULL DEFAULT 0,
  id_memory uuid,
  date_created timestamptz NOT NULL DEFAULT now(),
  date_updated timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_notebook_entries_type_chk
    CHECK (type_entry IN ('highlight', 'answer', 'prompt', 'note'))
);

CREATE INDEX IF NOT EXISTS idx_ai_notebook_entries_notebook
  ON intelligence.ai_notebook_entries(id_notebook, units_order, date_created DESC);
CREATE INDEX IF NOT EXISTS idx_ai_notebook_entries_owner
  ON intelligence.ai_notebook_entries(id_workspace, user_created);
-- The audience ceiling is applied per entry by source thread, so reads filter
-- on id_conversation constantly.
CREATE INDEX IF NOT EXISTS idx_ai_notebook_entries_source
  ON intelligence.ai_notebook_entries(id_conversation);

-- search_notebook does ILIKE '%term%' over quote + note. pg_trgm makes that an
-- index scan instead of a sequential one; if the extension isn't available the
-- tool still works, just linearly, so this block is allowed to fail silently.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS idx_ai_notebook_entries_quote_trgm
    ON intelligence.ai_notebook_entries USING gin (document_quote gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_ai_notebook_entries_note_trgm
    ON intelligence.ai_notebook_entries USING gin (document_note gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm unavailable — search_notebook will fall back to a sequential ILIKE';
END $$;

COMMENT ON TABLE intelligence.ai_notebooks IS
  'EngineAI Notebook: user scrapbooks. type_visibility private|team; team notebooks still hide entries captured from private threads from everyone but their author.';
COMMENT ON COLUMN intelligence.ai_notebook_entries.id_message IS
  'Source ai_messages row. Intentionally not a foreign key — messages can be hard-deleted and the entry must survive; a dangling id just means the deep link no longer resolves.';
COMMENT ON COLUMN intelligence.ai_notebook_entries.flag_private_source IS
  'Stamped at insert from the source thread visibility (or 1 for AI answers derived from private entries). A floor, never re-derived: without it, deleting the source thread nulls id_conversation and a private capture would read as shareable.';
COMMENT ON COLUMN intelligence.ai_notebook_entries.flag_memory IS
  'Set only by explicit user promotion via /api/ai/notebook/entries/[id]/promote, which delegates to the memories POST contract (50-cap, scope validation, admin entitlement).';

ALTER TABLE intelligence.ai_notebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.ai_notebook_entries ENABLE ROW LEVEL SECURITY;

-- Sanity check — expect both tables, and 0 rows:
-- SELECT
--   (SELECT count(*) FROM intelligence.ai_notebooks)        AS notebooks,
--   (SELECT count(*) FROM intelligence.ai_notebook_entries) AS entries;

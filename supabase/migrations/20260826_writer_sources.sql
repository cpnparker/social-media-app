-- Writer, Ship 3 — background documents, and which surface a document belongs to.
--
-- RUN BY HAND in the Supabase SQL editor for project dcwodczzdeltxlyepxmc.
-- Safe to run twice.

-- ── 1. Background documents ────────────────────────────────────────────────
--
-- WHY THIS TABLE IS THE POINT. The Writer and the Optimiser merged because
-- there was nowhere to put background material: the only way to bring a
-- document in was the IMPORT path, and import mints a document TO BE SCORED.
-- So "attach the brief I was given" and "assess this article" became the same
-- gesture, and the two tools collapsed onto one list. Without this table they
-- would re-merge the moment anyone needed to attach a reference.
--
-- A source is NOT a document. It is never edited, never scored, never appears
-- in the content list; it is material the writing draws on. That is why it
-- lives here rather than as another optimizer_sessions row with a flag.
CREATE TABLE IF NOT EXISTS intelligence.optimizer_sources (
  id_source        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_session       uuid NOT NULL REFERENCES intelligence.optimizer_sessions(id_session) ON DELETE CASCADE,
  -- CASCADE deliberately: a source has no meaning without the piece it was
  -- attached to, and leaving orphans behind would leave client material in the
  -- database with nothing pointing at it and nobody's screen showing it.
  type_source      text NOT NULL,
  name_title       text NOT NULL DEFAULT '',
  document_source_ref text,
  document_text    text NOT NULL DEFAULT '',
  units_words      integer NOT NULL DEFAULT 0,
  -- Fetched from a URL: quotable and checkable, never obeyed. The prompt frames
  -- these as third-party text so instructions inside them are data, not orders.
  flag_untrusted   smallint NOT NULL DEFAULT 0,
  user_created     integer,
  date_created     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE intelligence.optimizer_sources
  DROP CONSTRAINT IF EXISTS optimizer_sources_type_chk;
ALTER TABLE intelligence.optimizer_sources
  ADD CONSTRAINT optimizer_sources_type_chk
  CHECK (type_source IN ('pasted', 'file', 'gdoc-link', 'url'));

CREATE INDEX IF NOT EXISTS idx_optimizer_sources_session
  ON intelligence.optimizer_sources(id_session, date_created);

COMMENT ON TABLE intelligence.optimizer_sources IS
  'Background material a piece is written FROM: a commissioning brief, an interview, research, the client''s own material. Never edited, never scored, never listed as content — the absence of this table is why the Writer and the Optimiser merged.';
COMMENT ON COLUMN intelligence.optimizer_sources.flag_untrusted IS
  'Set for anything fetched from a URL. Such text may be quoted and checked against, never obeyed: instructions inside it are data.';

-- ── 2. Which surface a document belongs to ─────────────────────────────────
--
-- Sidebar rows currently route by PROVENANCE — generated or chat-born opens in
-- the Writer, everything else in the Optimiser — which is a guess that goes
-- wrong the moment somebody moves a piece between tools.
--
-- type_status cannot serve this: every autosave writes 'refining', in BOTH
-- surfaces, so it records when a document was last touched and never by whom.
--
-- Backfilled from provenance, which is the best information that exists for
-- rows created before the column: generated and chat-born were written here.
ALTER TABLE intelligence.optimizer_sessions
  ADD COLUMN IF NOT EXISTS type_surface text NOT NULL DEFAULT 'optimizer';

ALTER TABLE intelligence.optimizer_sessions
  DROP CONSTRAINT IF EXISTS optimizer_sessions_surface_chk;
ALTER TABLE intelligence.optimizer_sessions
  ADD CONSTRAINT optimizer_sessions_surface_chk
  CHECK (type_surface IN ('writer', 'optimizer'));

UPDATE intelligence.optimizer_sessions
   SET type_surface = 'writer'
 WHERE type_surface = 'optimizer'
   AND type_source IN ('generated', 'chat');

COMMENT ON COLUMN intelligence.optimizer_sessions.type_surface IS
  'Which tool this document belongs to: the Writer produces it, the Optimiser assesses it. Decides where a sidebar row opens. Backfilled from type_source, which was the guess it replaces.';

-- ── Sanity check ───────────────────────────────────────────────────────────
-- Expect every row classified, and generated/chat rows as 'writer'.
-- SELECT type_surface, type_source, count(*)
--   FROM intelligence.optimizer_sessions GROUP BY 1, 2 ORDER BY 1, 2;

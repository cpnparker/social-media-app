-- Writing Studio, Ship 3 — a piece can be born from a chat answer.
--
-- RUN BY HAND in the Supabase SQL editor for project dcwodczzdeltxlyepxmc.
-- Safe to run twice.
--
-- Two changes, and the second is the one that matters.

-- ── 1. 'chat' becomes a legitimate origin ───────────────────────────────────
-- DROP-then-ADD because the constraint already exists and ADD alone would fail.
-- The 20260821 migration writes this same CHECK in three places (the CREATE
-- TABLE, its idempotent ALTER, and the tail) — this is now the newest
-- definition and the one the import route must agree with.
ALTER TABLE intelligence.optimizer_sessions
  DROP CONSTRAINT IF EXISTS optimizer_sessions_source_chk;
ALTER TABLE intelligence.optimizer_sessions
  ADD CONSTRAINT optimizer_sessions_source_chk
  CHECK (type_source IN ('generated', 'pasted', 'gdoc', 'gdoc-link', 'url', 'engine', 'file', 'chat'));

-- ── 2. A privacy floor that travels with the piece ──────────────────────────
--
-- THE PROBLEM THIS SOLVES. A conversation can be incognito, or private to one
-- person, and it can contain material from connectors whose processor contract
-- restricts it to a single vendor. A piece created from such a thread inherits
-- that text — but optimizer_sessions has only type_visibility, which the owner
-- may flip to 'team' at any time. Without a floor, "start a piece from this
-- answer" becomes a one-click route from a private thread to a team-visible
-- document, and nothing in the schema would notice.
--
-- The notebook solved this with flag_private_source. Same idea, same name.
-- 1 = born from a private or restricted source: the piece may never be made
-- team-visible, and the PATCH route refuses the change rather than the UI
-- merely hiding it.
--
-- Defaults to 0 because every existing piece was created from an import or a
-- brief, neither of which carries a thread's privacy.
ALTER TABLE intelligence.optimizer_sessions
  ADD COLUMN IF NOT EXISTS flag_private_source smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN intelligence.optimizer_sessions.flag_private_source IS
  'Set to 1 when the piece was created from a source whose privacy must survive the copy — an incognito or private conversation, or one carrying processor-restricted material. A piece with this set can never be flipped to team visibility; the PATCH route refuses it.';

-- ── Sanity check ────────────────────────────────────────────────────────────
-- Expect: flag_private_source present, every existing row 0, and the source
-- CHECK listing eight values including 'chat'.
-- SELECT count(*) AS rows, sum(flag_private_source) AS private_source
--   FROM intelligence.optimizer_sessions;

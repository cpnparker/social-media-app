-- Writing Studio, Stage 1 — content types.
--
-- RUN BY HAND in the Supabase SQL editor for project dcwodczzdeltxlyepxmc,
-- like every migration in this repo. Safe to run twice.
--
-- WHY EXPLICIT ALTERs AND NOT A CHANGED CREATE TABLE:
-- `CREATE TABLE IF NOT EXISTS` does exactly nothing when the table exists, so a
-- column added to a CREATE block above ships to nobody. The 20260821 migration
-- learned this the hard way and wrote the rule down at its own line 286; this
-- follows it.
--
-- WHAT type_content IS, AND IS NOT:
-- It is the KIND of document — article, report, and one more the product does
-- not name. It is NOT type_format, which is the sub-shape within a kind
-- (explainer, listicle, comparison). Both exist because "a listicle" and "a
-- report" are answers to different questions, and collapsing them would mean a
-- report could be an explainer.

-- ── 1. The column ───────────────────────────────────────────────────────────
-- Defaulted, NOT NULL. Every pre-existing session is an article, because until
-- today an article is the only thing the studio could make.
ALTER TABLE intelligence.optimizer_sessions
  ADD COLUMN IF NOT EXISTS type_content text NOT NULL DEFAULT 'article';

-- ── 2. The constraint ───────────────────────────────────────────────────────
-- Dropped first so re-running this file after adding a fourth type is a matter
-- of editing one list, not hand-unpicking a failed ADD.
ALTER TABLE intelligence.optimizer_sessions
  DROP CONSTRAINT IF EXISTS optimizer_sessions_content_chk;
ALTER TABLE intelligence.optimizer_sessions
  ADD CONSTRAINT optimizer_sessions_content_chk
  CHECK (type_content IN ('article', 'report', 'cv'));

-- ── 3. type_status gains 'generating' ───────────────────────────────────────
-- Finish-section and finish-document hold a conditional claim exactly as assess
-- does, because they put the same order of money at risk and two concurrent
-- clicks would otherwise both bill. A new status value needs the CHECK widened
-- FIRST or every claim fails with 23514 and the feature is locked shut — the
-- failure mode that made 'covering' unusable for coverage's in-flight claim.
ALTER TABLE intelligence.optimizer_sessions
  DROP CONSTRAINT IF EXISTS optimizer_sessions_status_chk;
ALTER TABLE intelligence.optimizer_sessions
  ADD CONSTRAINT optimizer_sessions_status_chk
  CHECK (type_status IN ('brief', 'drafting', 'draft_ready', 'assessing', 'generating', 'refining', 'finalised'));

-- ── 4. Comments ─────────────────────────────────────────────────────────────
COMMENT ON COLUMN intelligence.optimizer_sessions.type_content IS
  'The KIND of document: article, report, or one further value the product deliberately never names in any UI string. Distinct from type_format, which is the sub-shape within a kind. Drives pillar weights, which analyses may run, and which chrome renders.';

-- ── Sanity check (expect: 3 rows, all counts > 0 only for article at first) ──
-- SELECT type_content, count(*) FROM intelligence.optimizer_sessions GROUP BY 1 ORDER BY 1;

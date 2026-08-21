-- Content Optimizer
-- =================
-- Run in the Supabase SQL Editor (Engine project).
--
-- A three-phase writing studio for content optimised for AI search: brief and
-- draft, assess and refine against an evidence-graded rubric, finalise with a
-- score. Spec: docs/content-optimizer-spec.md. The deterministic scorer that
-- produces the numbers stored here is lib/optimizer/engine.ts.
--
-- TWO LOAD-BEARING RULES, both of which look like over-engineering until the
-- day they are missing:
--
-- 1. EVERY ASSESSMENT STORES ITS RUBRIC VERSION. Weights and tiers change —
--    that is the whole point of the Pulse-signal updater in spec §7 — and a
--    score is meaningless without the rubric that produced it. Without the
--    stamp, re-tuning a tier silently rewrites the history of every client
--    report ever run, and the Phase 3 waterfall ("what moved the score")
--    starts attributing changes to edits that never happened.
--
-- 2. FINDINGS ANCHOR BY QUOTE, NOT BY OFFSET. document_quote plus its prefix
--    and suffix are re-matched against the current draft on load. Character
--    offsets rot the moment the writer edits anything above the span, and a
--    stale offset does not fail loudly — it silently highlights, and then
--    silently REWRITES, the wrong sentence.

-- ── 1. users_access.flag_access_optimizer ──────────────────────────────────
-- Follows the Gmail precedent (20260724_gmail_access.sql): NOT NULL DEFAULT 0
-- and read as `= 1` explicitly. Elsewhere an absent users_access row has been
-- treated as allowed; for a tool that generates billable AI content on a
-- client's behalf that convention would mean everyone, so this fails closed.
ALTER TABLE intelligence.users_access
  ADD COLUMN IF NOT EXISTS flag_access_optimizer integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN intelligence.users_access.flag_access_optimizer IS
  'Content Optimizer access. Read as = 1 explicitly and in its own select — an absent row and a query error both deny.';

-- ── 1b. users_access.data_pinned_articles ─────────────────────────────────
-- Article pins, alongside the conversation and client pins already here.
-- Its own column rather than sharing data_pinned_conversations: both hold
-- uuids, so a mixed array would still "work", right up until a report asks how
-- many conversations someone has pinned.
ALTER TABLE intelligence.users_access
  ADD COLUMN IF NOT EXISTS data_pinned_articles jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ── 2. optimizer_sessions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.optimizer_sessions (
  id_session       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace     text NOT NULL,
  user_created     integer NOT NULL,          -- public.users(id_user)
  id_client        integer,                   -- public.clients(id_client); null = TCE's own content
  name_title       text NOT NULL DEFAULT 'Untitled piece',
  type_status      text NOT NULL DEFAULT 'brief',
  type_format      text NOT NULL DEFAULT 'explainer',
  type_platform    text NOT NULL DEFAULT 'balanced',
  config_brief     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The client canon AS IT WAS when the draft was generated. Snapshotted, not
  -- referenced: the canon is refreshed on a schedule, and an assessment that
  -- silently re-grounds itself against facts the writer never saw is not
  -- reproducible. See optimizer_client_canon below for the live copy.
  config_canon     jsonb NOT NULL DEFAULT '{}'::jsonb,
  name_rubric_version text NOT NULL DEFAULT '1.0.0',
  -- Same vocabulary as ai_conversations and design_sessions, deliberately.
  -- The sidebar's Private/Team tabs filter on STRICT EQUALITY, so a row with no
  -- visibility value is invisible in both tabs — an article without this column
  -- could never appear in the list at all.
  type_visibility  text NOT NULL DEFAULT 'private',
  -- Where the content came in from, so the studio can say so and the writer
  -- knows whether edits here touch an original elsewhere (they never do).
  type_source      text NOT NULL DEFAULT 'generated',
  document_source_ref text,
  date_created     timestamptz NOT NULL DEFAULT now(),
  date_updated     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT optimizer_sessions_visibility_chk
    CHECK (type_visibility IN ('private', 'team')),
  CONSTRAINT optimizer_sessions_source_chk
    CHECK (type_source IN ('generated', 'pasted', 'gdoc', 'gdoc-link', 'engine')),
  CONSTRAINT optimizer_sessions_status_chk
    CHECK (type_status IN ('brief', 'drafting', 'draft_ready', 'assessing', 'refining', 'finalised')),
  -- Set when a judge pass claims this session, cleared when it finishes. A
  -- platform timeout can kill a request between claim and release, so the
  -- claim carries its own timestamp and is treated as stale after a few
  -- minutes — otherwise one dead lambda strands the session permanently and
  -- the writer can never assess again.
  date_assessing   timestamptz,
  CONSTRAINT optimizer_sessions_platform_chk
    CHECK (type_platform IN ('balanced', 'chatgpt', 'aio', 'perplexity'))
);

CREATE INDEX IF NOT EXISTS idx_optimizer_sessions_owner
  ON intelligence.optimizer_sessions(id_workspace, user_created, date_updated DESC);
-- The studio's client filter and the "what have we written for X" report both
-- hit this; id_client is nullable so the index is partial.
CREATE INDEX IF NOT EXISTS idx_optimizer_sessions_client
  ON intelligence.optimizer_sessions(id_workspace, id_client)
  WHERE id_client IS NOT NULL;
-- Team articles are visible to the whole workspace, so the sidebar reads them
-- without the owner predicate.
CREATE INDEX IF NOT EXISTS idx_optimizer_sessions_team
  ON intelligence.optimizer_sessions(id_workspace, date_updated DESC)
  WHERE type_visibility = 'team';

-- ── 3. optimizer_drafts ────────────────────────────────────────────────────
-- Every generation and every finalise snapshots a version. Cheap, and it is
-- what makes the Phase 3 before/after attribution a fact rather than a claim.
CREATE TABLE IF NOT EXISTS intelligence.optimizer_drafts (
  id_draft         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_session       uuid NOT NULL REFERENCES intelligence.optimizer_sessions(id_session) ON DELETE CASCADE,
  units_version    integer NOT NULL DEFAULT 1,
  document_body    text NOT NULL DEFAULT '',
  units_words      integer NOT NULL DEFAULT 0,
  date_created     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_optimizer_drafts_session
  ON intelligence.optimizer_drafts(id_session, units_version DESC);

-- Both writers read the current max version and then insert, so two concurrent
-- saves can compute the same next version and both succeed. This makes the
-- second one fail loudly instead of silently creating a duplicate version that
-- the Phase 3 waterfall would then read as two different snapshots.
CREATE UNIQUE INDEX IF NOT EXISTS idx_optimizer_drafts_version_unique
  ON intelligence.optimizer_drafts(id_session, units_version);

-- ── 4. optimizer_assessments ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.optimizer_assessments (
  id_assessment    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_session       uuid NOT NULL REFERENCES intelligence.optimizer_sessions(id_session) ON DELETE CASCADE,
  -- ON DELETE SET NULL, not CASCADE: an assessment is the historical record of
  -- a score the client may already have been shown. It must outlive the draft
  -- version it graded.
  id_draft         uuid REFERENCES intelligence.optimizer_drafts(id_draft) ON DELETE SET NULL,
  type_kind        text NOT NULL DEFAULT 'deterministic',
  units_overall    numeric(5,2) NOT NULL DEFAULT 0,
  units_retrievability numeric(5,2) NOT NULL DEFAULT 0,
  units_citability numeric(5,2) NOT NULL DEFAULT 0,
  name_grade       text NOT NULL DEFAULT 'F',
  config_pillars   jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Hash of everything the judge saw (draft text, queries, brand, rubric and
  -- prompt versions, model). Its own column and its own index because it is
  -- looked up by equality on every Assess: fetching the N most recent rows and
  -- matching in the application MISSES a valid entry older than N, so an
  -- identical input that was already paid for gets judged and billed a second
  -- time. That is a correctness and cost bug, not a scale concern.
  name_memo_key    text NOT NULL DEFAULT '',
  name_rubric_version text NOT NULL,
  date_created     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT optimizer_assessments_kind_chk
    CHECK (type_kind IN ('deterministic', 'full'))
);

CREATE INDEX IF NOT EXISTS idx_optimizer_assessments_session
  ON intelligence.optimizer_assessments(id_session, date_created DESC);
CREATE INDEX IF NOT EXISTS idx_optimizer_assessments_memo
  ON intelligence.optimizer_assessments(id_session, name_memo_key)
  WHERE name_memo_key <> '';

-- ── 5. optimizer_findings ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.optimizer_findings (
  id_finding       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_assessment    uuid NOT NULL REFERENCES intelligence.optimizer_assessments(id_assessment) ON DELETE CASCADE,
  name_criterion   text NOT NULL,
  name_pillar      text NOT NULL,
  type_severity    text NOT NULL DEFAULT 'medium',
  name_evidence    text NOT NULL DEFAULT 'C',
  -- The anchor. Quote plus context, never offsets — see rule 2 in the header.
  document_quote   text NOT NULL DEFAULT '',
  document_prefix  text NOT NULL DEFAULT '',
  document_suffix  text NOT NULL DEFAULT '',
  document_explanation text NOT NULL DEFAULT '',
  document_suggestion  text NOT NULL DEFAULT '',
  units_est_lift   integer NOT NULL DEFAULT 0,
  type_status      text NOT NULL DEFAULT 'open',
  -- Stable hash of the finding's shape, so the same advice can be recognised
  -- across sessions and clients. This is what the v1.5 learning loop
  -- aggregates on; without it, "which suggestions actually get applied" is
  -- unanswerable.
  name_fingerprint text NOT NULL DEFAULT '',
  date_created     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT optimizer_findings_severity_chk
    CHECK (type_severity IN ('high', 'medium', 'low')),
  CONSTRAINT optimizer_findings_status_chk
    CHECK (type_status IN ('open', 'applied', 'edited', 'dismissed', 'orphaned')),
  CONSTRAINT optimizer_findings_evidence_chk
    CHECK (name_evidence IN ('A', 'A-', 'B', 'B/C', 'C', 'D'))
);

CREATE INDEX IF NOT EXISTS idx_optimizer_findings_assessment
  ON intelligence.optimizer_findings(id_assessment, type_status);
CREATE INDEX IF NOT EXISTS idx_optimizer_findings_fingerprint
  ON intelligence.optimizer_findings(name_fingerprint)
  WHERE name_fingerprint <> '';

-- ── 6. optimizer_feedback ──────────────────────────────────────────────────
-- The learning-loop signal table (spec §8). One row per finding fingerprint,
-- aggregated across every client: which advice gets applied, and what it was
-- worth when it was. Ported in design from AuthorityOn's RecommendationSignal.
CREATE TABLE IF NOT EXISTS intelligence.optimizer_feedback (
  name_fingerprint text PRIMARY KEY,
  name_criterion   text NOT NULL,
  units_applied    integer NOT NULL DEFAULT 0,
  units_dismissed  integer NOT NULL DEFAULT 0,
  units_edited     integer NOT NULL DEFAULT 0,
  units_avg_lift   numeric(6,2) NOT NULL DEFAULT 0,
  date_updated     timestamptz NOT NULL DEFAULT now()
);

-- ── 7. optimizer_client_canon ──────────────────────────────────────────────
-- Per-client grounding, assembled from the Engine record, the extracted client
-- asset profile (intelligence.ai_client_context) and workspace-shared client
-- meetings. Every fact carries its source and the date it was true, because a
-- writer asked to trust a fact needs to know where it came from.
--
-- NOTE ON SOURCES: config_facts tags each fact engine|assets|meetings|
-- authorityon|manual. As of this migration there is NO AuthorityOn connection
-- from this repo — that tag is a declared future producer (spec §7), not a
-- live one, and nothing should imply otherwise in the UI until it exists.
--
-- PRIVACY: only workspace-shared CLIENT meetings may feed a canon. Personal
-- MeetingBrain reports (my_tasks, meetings, upcoming_meetings, search_meetings)
-- are one person's private data and must never reach a shared client fact
-- sheet, which is visible to everyone with access to that client.
CREATE TABLE IF NOT EXISTS intelligence.optimizer_client_canon (
  id_canon         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace     text NOT NULL,
  id_client        integer NOT NULL,          -- public.clients(id_client)
  config_facts     jsonb NOT NULL DEFAULT '[]'::jsonb,
  config_queries   jsonb NOT NULL DEFAULT '[]'::jsonb,
  document_voice   text NOT NULL DEFAULT '',
  date_refreshed   timestamptz NOT NULL DEFAULT now(),
  date_updated     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_optimizer_canon_unique
  ON intelligence.optimizer_client_canon(id_workspace, id_client);

-- ── Comments ───────────────────────────────────────────────────────────────

COMMENT ON TABLE intelligence.optimizer_sessions IS
  'Content Optimizer: one writing session. config_canon is a SNAPSHOT of the client canon at generation time so assessments stay reproducible; the live canon is optimizer_client_canon.';
COMMENT ON COLUMN intelligence.optimizer_sessions.name_rubric_version IS
  'The rubric version this session was scored under. Re-scoring against a newer rubric is an explicit act, never a silent drift in a client-visible number.';
COMMENT ON COLUMN intelligence.optimizer_sessions.type_platform IS
  'Target-platform lens. Shifts pillar weights within a bounded range — ChatGPT favours definitional/entity-rich writing, Perplexity favours freshness over polish, AI Overviews retain the most overlap with classic organic ranking.';

COMMENT ON TABLE intelligence.optimizer_drafts IS
  'Versioned draft bodies. Every generation and every finalise appends a version, which is what makes the Phase 3 before/after waterfall exact rather than estimated.';

COMMENT ON TABLE intelligence.optimizer_assessments IS
  'A scoring run. type_kind deterministic = the free engine-only pass that runs while typing; full = deterministic blended with the LLM judge.';
COMMENT ON COLUMN intelligence.optimizer_assessments.units_retrievability IS
  'Will an engine fetch this at all. Reported separately from citability because optimising prose for extraction can measurably REDUCE retrieval, and a single headline number would hide exactly that trade-off.';
COMMENT ON COLUMN intelligence.optimizer_assessments.id_draft IS
  'SET NULL rather than CASCADE: an assessment may already have been shown to a client and must outlive the draft version it graded.';

COMMENT ON TABLE intelligence.optimizer_findings IS
  'One issue found in a draft, anchored by quote + surrounding context. Offsets are deliberately not stored — they rot on any edit above the span, and a stale offset silently rewrites the wrong sentence.';
COMMENT ON COLUMN intelligence.optimizer_findings.type_status IS
  'orphaned = the quote could no longer be located in the current draft. Kept and shown without a highlight rather than dropped: the finding is still true, only its anchor is lost.';
COMMENT ON COLUMN intelligence.optimizer_findings.name_evidence IS
  'How strong the research behind this check is: A causal, B large-N observational, C mechanistic, D house doctrine. Shown to the writer, and to clients, so the rubric can be defended and re-weighted honestly.';

COMMENT ON TABLE intelligence.optimizer_feedback IS
  'Cross-client aggregate of which suggestions writers actually apply and what they were worth. Feeds the judge prompt so the tool''s advice improves with use.';

COMMENT ON TABLE intelligence.optimizer_client_canon IS
  'Per-client grounding for drafts and entity checks. Facts are source-tagged (engine|assets|meetings|manual; authorityon is declared but has no producer yet). Only workspace-shared client meetings may contribute — personal MeetingBrain data must never reach a shared client fact sheet.';

-- ── 7b. Columns and constraints added AFTER the tables first shipped ───────
--
-- READ THIS BEFORE ASSUMING THIS FILE IS IDEMPOTENT. It is not, on its own.
-- `CREATE TABLE IF NOT EXISTS` does exactly nothing when the table already
-- exists — including for columns added to the definition above afterwards. A
-- database that ran an earlier copy of this file therefore ends up with the
-- tables present and the newer columns absent, and re-running the file reports
-- Success while changing nothing. That state was found live on 2026-08-21:
-- all six tables existed, and type_visibility, type_source, document_source_ref,
-- date_assessing and name_memo_key did not.
--
-- It is not a cosmetic gap. PostgREST fails an ENTIRE select when it names one
-- unknown column, so the sidebar's article list returns nothing at all and
-- reads as "there are no articles" rather than as a missing migration.
--
-- So: every column and constraint added after the initial ship is repeated
-- here as an explicit ALTER. Anything added to a CREATE TABLE above from now
-- on must be added here too.

ALTER TABLE intelligence.optimizer_sessions
  ADD COLUMN IF NOT EXISTS type_visibility text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS type_source text NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS document_source_ref text,
  ADD COLUMN IF NOT EXISTS date_assessing timestamptz;

ALTER TABLE intelligence.optimizer_assessments
  ADD COLUMN IF NOT EXISTS name_memo_key text NOT NULL DEFAULT '';

-- Dropped and recreated rather than added conditionally: a constraint created
-- by an earlier copy of this file carries that copy's value list, and the
-- failure mode is a runtime constraint violation on the one import path nobody
-- tested. scripts/verify-optimizer-import.ts asserts these lists against the
-- route's, so they cannot drift silently — but only if what is DEPLOYED matches
-- the file, which is what these statements guarantee.
ALTER TABLE intelligence.optimizer_sessions
  DROP CONSTRAINT IF EXISTS optimizer_sessions_visibility_chk,
  DROP CONSTRAINT IF EXISTS optimizer_sessions_source_chk,
  DROP CONSTRAINT IF EXISTS optimizer_sessions_status_chk,
  DROP CONSTRAINT IF EXISTS optimizer_sessions_platform_chk;

ALTER TABLE intelligence.optimizer_sessions
  ADD CONSTRAINT optimizer_sessions_visibility_chk
    CHECK (type_visibility IN ('private', 'team')),
  ADD CONSTRAINT optimizer_sessions_source_chk
    CHECK (type_source IN ('generated', 'pasted', 'gdoc', 'gdoc-link', 'engine')),
  ADD CONSTRAINT optimizer_sessions_status_chk
    CHECK (type_status IN ('brief', 'drafting', 'draft_ready', 'assessing', 'refining', 'finalised')),
  ADD CONSTRAINT optimizer_sessions_platform_chk
    CHECK (type_platform IN ('balanced', 'chatgpt', 'aio', 'perplexity'));

-- These two are partial indexes on columns that did not exist in the first
-- copy, so CREATE INDEX IF NOT EXISTS above would have thrown rather than been
-- skipped. Repeated here, after the columns are guaranteed to exist.
CREATE INDEX IF NOT EXISTS idx_optimizer_sessions_team
  ON intelligence.optimizer_sessions(id_workspace, date_updated DESC)
  WHERE type_visibility = 'team';
CREATE INDEX IF NOT EXISTS idx_optimizer_assessments_memo
  ON intelligence.optimizer_assessments(id_session, name_memo_key)
  WHERE name_memo_key <> '';

-- ── 8. Control Centre row ──────────────────────────────────────────────────
-- assertServiceAllowed('engine','optimizer') reads this row. Without it
-- getConfig returns null, assertNotKilled is a no-op and the kill switch in
-- the generate route guards nothing — the guard is written, the data it needs
-- does not exist. Seeded live (not killed, no cap) so an operator has a row to
-- click the moment the feature is switched on.
INSERT INTO intelligence.service_config (app, type_source, killed)
VALUES ('engine', 'optimizer', false)
ON CONFLICT (app, type_source) DO NOTHING;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Enabled with no policies, as everywhere else in this schema. The service-role
-- client bypasses RLS, so this is a deny-all backstop against a leaked anon
-- key; the API route is the actual access control.
ALTER TABLE intelligence.optimizer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.optimizer_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.optimizer_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.optimizer_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.optimizer_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.optimizer_client_canon ENABLE ROW LEVEL SECURITY;

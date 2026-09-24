-- Episodic memory: what was WORKED ON, and when.
--
-- Target: the EngineAI Supabase project (schemas public + intelligence +
-- meetingbrain). Run in the SQL Editor.
--
-- WHY A NEW TABLE, not a sixth type_category on intelligence.ai_memories.
-- All five existing categories — preference, fact, instruction, style,
-- client_insight — record what is TRUE. None records what HAPPENED, and the
-- retrieval signal for "what was I doing last Tuesday" is a DATE, which the
-- memory path has no predicate for. Four concrete incompatibilities, each
-- checked against the code rather than assumed:
--
--   1. DECAY WOULD DELETE THEM. lib/ai/memory-consolidation.ts archives rows
--      below decayed strength 0.10, and every read path filters flag_active=1.
--      An inferred memory starts at 0.7 with a 14-day half-life and crosses
--      that at roughly 39 days. An episode from March is still a true record
--      of March — it does not become false by ageing.
--   2. THE 50-ROW CAP counts all categories together. A year of episodes would
--      evict the semantic memory the system already does well.
--   3. CONSOLIDATION WOULD MERGE DISTINCT EVENTS. Similar rows are collapsed
--      on Jaccard overlap; two Siemens conversations a week apart share most
--      of their vocabulary. The record of the 6th would be rewritten in place
--      by the 13th, leaving a console.log as the only trace — the exact silent
--      overwrite this codebase keeps being bitten by.
--   4. The 500-char content ceiling is enforced in three places.
--
-- Supabase's linter will flag CREATE TABLE. This is purely additive: a new
-- table, no changes to existing ones, nothing backfilled.

CREATE TABLE IF NOT EXISTS intelligence.ai_episodes (
  id_episode              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace            uuid NOT NULL,           -- public.workspaces(id_workspace)
  user_episode            integer NOT NULL,        -- public.users(id_user) — the actor, never null

  -- NOT NULL and load-bearing. An episode that cannot say where it came from
  -- cannot be shown with provenance, and an unattributable claim about a
  -- user's own past week is worse than no claim. ON DELETE CASCADE so deleting
  -- a conversation deletes its episodes — the user's expectation when they
  -- remove a thread.
  id_conversation_source  uuid NOT NULL
                            REFERENCES intelligence.ai_conversations(id_conversation)
                            ON DELETE CASCADE,

  date_episode            date NOT NULL,           -- the day the work happened, not when written
  information_episode     text NOT NULL,           -- what was done
  information_open        text,                    -- what was left unresolved
  type_status             text NOT NULL DEFAULT 'unknown',   -- open | unknown | resolved
  data_entities           text[] NOT NULL DEFAULT '{}',      -- clients, people, artefacts
  count_turns             integer NOT NULL DEFAULT 1,
  type_source             text NOT NULL DEFAULT 'inferred',  -- inferred | user_marked | corrected

  -- Bi-temporal rather than destructive. A superseded episode is marked, never
  -- overwritten, so "you were waiting on Gabi" can be shown as true ON THE 13TH
  -- even after it stopped being true. Overwriting is how a memory system starts
  -- asserting stale things as current.
  date_invalidated        timestamptz,
  id_superseded_by        uuid,

  date_created            timestamptz NOT NULL DEFAULT now(),
  date_updated            timestamptz NOT NULL DEFAULT now(),

  -- One episode per person per conversation per day. A long working day in one
  -- thread updates its episode rather than producing twenty near-identical rows.
  CONSTRAINT ai_episodes_one_per_day UNIQUE (user_episode, id_conversation_source, date_episode)
);

-- The main read: this user's recent episodes, newest first, live ones only.
CREATE INDEX IF NOT EXISTS idx_episodes_user_date
  ON intelligence.ai_episodes (user_episode, date_episode DESC)
  WHERE date_invalidated IS NULL;

-- "What happened with Siemens" — entity lookup without a full scan.
CREATE INDEX IF NOT EXISTS idx_episodes_entities
  ON intelligence.ai_episodes USING GIN (data_entities);

COMMENT ON TABLE intelligence.ai_episodes IS
  'Episodic memory: what a user worked on and when. Distinct from ai_memories, which holds what is TRUE about them. Episodes are never decayed, merged or overwritten — superseded ones are marked via date_invalidated. Private to user_episode: never surfaced in a thread with more than one reader.';


-- ── Sanity check ──
SELECT
  count(*)                                              AS episodes,
  count(DISTINCT user_episode)                          AS users,
  count(*) FILTER (WHERE date_invalidated IS NOT NULL)  AS superseded,
  min(date_episode)                                     AS earliest,
  max(date_episode)                                     AS latest
FROM intelligence.ai_episodes;

-- Expect all zeros and nulls on a fresh install. Episodes accumulate from the
-- next conversation turn onward; nothing is backfilled, because the material
-- to build them from is the conversation itself.

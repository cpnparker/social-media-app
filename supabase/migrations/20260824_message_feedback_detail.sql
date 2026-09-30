-- Make thumbs-down worth reviewing: a reason, a rater, and a snapshot.
--
-- WHAT IS WRONG WITH THE CURRENT CAPTURE. All of it is one smallint on the
-- message row (20260610_message_feedback.sql, twelve lines). That produces
-- exactly one bit, and three consequences:
--
--  1. NOT DIAGNOSABLE. Of the three thumbs-down on record, two could only be
--     explained because the user happened to argue with the model afterwards
--     and the argument survived as ordinary message text. The third — a
--     handover summary — has a two-message conversation, no correction, and
--     nothing recording what was wrong with it. It cannot be diagnosed at all.
--  2. NOT ATTRIBUTABLE. There is no rater column, so the rating is
--     last-writer-wins by anyone with access and nothing says who.
--  3. NOT DURABLE. ai_messages cascades when its conversation is deleted, so
--     the flag is a pointer into a row that can vanish, taking the evidence
--     with it. The notebook learned this and wrote it down in
--     20260728_notebook.sql:109-110.
--
-- Hence a SEPARATE TABLE with NO foreign key. A FK with ON DELETE CASCADE
-- would reintroduce (3) exactly; a FK without one would block conversation
-- deletion, which is worse. The id columns are deliberately loose pointers,
-- and the snapshot columns mean a deleted conversation still leaves a
-- reviewable record of what went wrong.
--
-- APPEND-ONLY. One row per rating event rather than an upsert, so a user
-- changing their mind is visible as a change rather than overwriting the
-- evidence. ai_messages.rating_message stays as the UI's current-state column;
-- THIS TABLE is the record.
--
-- WHAT IS DELIBERATELY NOT HERE: retrieved context, prompt bodies, and tool
-- RESULTS. Flagged conversations can contain mailbox and personal data that is
-- contract-restricted to a single processor, and copying it into an audit table
-- widens that footprint for no diagnostic gain. Tool NAMES and row counts carry
-- no third-party text and answer the question that actually matters — "was a
-- tool that could have answered simply never called" — so there is room for
-- them here once the four provider chains record them.
--
-- SAFE TO RUN: creates one new table and two indexes. Nothing is altered,
-- nothing is dropped, no existing row is rewritten. Supabase's destructive-
-- operations linter flags nothing here.

CREATE TABLE IF NOT EXISTS intelligence.ai_message_feedback (
  id_feedback      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_created     timestamptz NOT NULL DEFAULT now(),

  -- Loose pointers, NOT foreign keys. See the note above.
  id_message       uuid,
  id_conversation  uuid,
  id_workspace     uuid,

  user_rated       integer NOT NULL,
  rating           smallint NOT NULL CHECK (rating IN (1, -1)),

  -- One tap. A longer form at this volume would destroy the channel, and an
  -- unanswered reason must still count as a flag — hence nullable.
  type_reason      text CHECK (type_reason IN (
                     'wrong_facts', 'wrong_datetime', 'made_it_up',
                     'missed_data', 'ignored_request', 'tone_format'
                   )),
  note_reason      text CHECK (note_reason IS NULL OR char_length(note_reason) <= 200),

  -- The model that ANSWERED, not the one the route chose. Before 2026-08-24
  -- those differed silently on four fallback paths, so any per-model reading
  -- of older data is unsound.
  name_model       text,

  -- Snapshots, so the record outlives the conversation.
  document_answer  text,
  document_asked   text
);

CREATE INDEX IF NOT EXISTS idx_message_feedback_recent
  ON intelligence.ai_message_feedback (date_created DESC);
CREATE INDEX IF NOT EXISTS idx_message_feedback_negative
  ON intelligence.ai_message_feedback (rating, date_created DESC);

COMMENT ON TABLE intelligence.ai_message_feedback IS
  'Durable, attributable, append-only record of thumbs up/down with a reason. ai_messages.rating_message remains the UI current-state column; this table is the record.';

-- Sanity check. Expect one table, 13 columns, and two indexes.
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'intelligence' AND table_name = 'ai_message_feedback') AS columns,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'intelligence' AND tablename = 'ai_message_feedback') AS indexes;

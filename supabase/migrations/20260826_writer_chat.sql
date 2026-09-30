-- Writer, Ship 4 — the conversation about a draft, kept with the draft.
--
-- RUN BY HAND in the Supabase SQL editor for project dcwodczzdeltxlyepxmc.
-- Safe to run twice.
--
-- WHY ON THE SESSION AND NOT IN ai_conversations. A chat thread is a place you
-- go; this is a property of a document. It has no life without the draft, it is
-- never listed in the rail as a conversation, and it must not appear among a
-- writer's chats — a document with twelve questions asked about it would
-- otherwise bury every real thread they have.
--
-- Capped in the route, not here: a jsonb column will happily store a megabyte,
-- and the reason to keep it small is that the recent turns ride in the prompt.
ALTER TABLE intelligence.optimizer_sessions
  ADD COLUMN IF NOT EXISTS config_chat jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN intelligence.optimizer_sessions.config_chat IS
  'The writing conversation about this draft: [{role, content, at}]. A property of the document, not a thread — it is never listed among the writer''s conversations. Trimmed by the route so the recent turns stay affordable in the prompt.';

-- Expect: every row present, most with '[]'.
-- SELECT count(*) AS rows, count(*) FILTER (WHERE config_chat <> '[]'::jsonb) AS with_chat
--   FROM intelligence.optimizer_sessions;

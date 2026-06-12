-- EngineAI: per-message user feedback (thumbs up / down).
--
-- rating_message: 1 = thumbs up, -1 = thumbs down, NULL = no rating.
-- Stored on the message row itself — one rating per message (last writer
-- wins; in practice the rater is the conversation participant).

ALTER TABLE intelligence.ai_messages
  ADD COLUMN IF NOT EXISTS rating_message smallint
  CHECK (rating_message IN (1, -1));

COMMENT ON COLUMN intelligence.ai_messages.rating_message IS
  'User feedback on assistant messages: 1 = helpful, -1 = not helpful, NULL = unrated';

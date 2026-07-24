-- Add status_message column to intelligence.ai_messages for fire-and-forget response tracking.
-- Values: 'pending' (assistant row created, response still streaming/generating),
--         'complete' (response fully saved),
--         'failed' (generation errored or was orphaned).
-- Existing rows default to 'complete'.

ALTER TABLE intelligence.ai_messages
  ADD COLUMN IF NOT EXISTS status_message text NOT NULL DEFAULT 'complete';

-- Index to quickly find pending messages (for orphan cleanup + sidebar indicators).
CREATE INDEX IF NOT EXISTS idx_ai_messages_pending
  ON intelligence.ai_messages(id_conversation)
  WHERE status_message = 'pending';

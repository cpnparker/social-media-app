-- Dedicated table for client-linked meetings (privacy by architecture)
-- Only domain-matched meetings enter this table — personal meetings never do.
-- One row per meeting per client, deduplicated by meeting_id.
CREATE TABLE IF NOT EXISTS intelligence.ai_client_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace uuid NOT NULL,
  id_client integer NOT NULL,
  meeting_id text NOT NULL,              -- MeetingBrain meeting ID (for dedup)
  meeting_title text NOT NULL,
  meeting_date timestamptz NOT NULL,
  meeting_summary text,                  -- executive summary (client-safe)
  key_topics text,                       -- JSON array of topics
  next_steps text,                       -- action items
  attendees_external text,               -- client-side attendees only (names, no emails)
  synced_by_email text,                  -- which user's scan linked this meeting
  date_created timestamptz NOT NULL DEFAULT now()
);

-- Unique: one row per meeting per client per workspace
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_client_meetings_unique
  ON intelligence.ai_client_meetings(id_workspace, id_client, meeting_id);

-- Fast lookups by client
CREATE INDEX IF NOT EXISTS idx_ai_client_meetings_client
  ON intelligence.ai_client_meetings(id_workspace, id_client, meeting_date DESC);

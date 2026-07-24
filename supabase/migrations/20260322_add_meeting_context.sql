-- Add meeting context from MeetingBrain to client AI context
-- Meetings are linked to clients by matching attendee email domains
-- to client website domains (link_website field)
ALTER TABLE intelligence.ai_client_context
  ADD COLUMN IF NOT EXISTS meeting_context text,
  ADD COLUMN IF NOT EXISTS meeting_context_updated_at timestamptz;

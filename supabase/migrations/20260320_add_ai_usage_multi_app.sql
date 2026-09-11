-- Add multi-app support to ai_usage table
-- Allows MeetingBrain and AuthorityOn to dual-write usage alongside Engine

-- App identifier column (engine, meetingbrain, authorityon)
ALTER TABLE intelligence.ai_usage
  ADD COLUMN IF NOT EXISTS type_app text NOT NULL DEFAULT 'engine';

-- External user ID for apps using NextAuth string IDs
ALTER TABLE intelligence.ai_usage
  ADD COLUMN IF NOT EXISTS user_id_external text;

-- Display name stored at write time (avoids cross-DB user lookups)
ALTER TABLE intelligence.ai_usage
  ADD COLUMN IF NOT EXISTS user_name_external text;

-- Make workspace nullable (meetingbrain/authorityon have no workspace concept)
ALTER TABLE intelligence.ai_usage
  ALTER COLUMN id_workspace DROP NOT NULL;

-- Make integer user_usage nullable (meetingbrain/authorityon use string user IDs)
ALTER TABLE intelligence.ai_usage
  ALTER COLUMN user_usage DROP NOT NULL,
  ALTER COLUMN user_usage SET DEFAULT 0;

-- Index for app-scoped queries
CREATE INDEX IF NOT EXISTS idx_ai_usage_app
  ON intelligence.ai_usage(type_app, date_created DESC);

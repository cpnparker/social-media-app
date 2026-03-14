-- Cross-app context: external apps (e.g. MeetingBrain) push pre-formatted
-- context here for injection into EngineGPT system prompts.
-- One row per user per source per type, upserted on each sync.

CREATE TABLE IF NOT EXISTS intelligence.user_app_context (
  id_context          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace        uuid NOT NULL,
  user_target         integer NOT NULL,
  name_source         text NOT NULL,           -- 'meetingbrain'
  type_context        text NOT NULL,           -- 'tasks' | 'meetings'
  information_content text NOT NULL,           -- pre-formatted context text
  date_updated        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_app_context_unique
  ON intelligence.user_app_context(id_workspace, user_target, name_source, type_context);

CREATE INDEX IF NOT EXISTS idx_user_app_context_user
  ON intelligence.user_app_context(user_target, name_source);

-- Enable RLS to block anon/public access.
-- Both apps use the service role key which bypasses RLS.
ALTER TABLE intelligence.user_app_context ENABLE ROW LEVEL SECURITY;

-- EngineAI Recurring Prompts (Phase 1): scheduled prompt runs grounded in
-- workspace data. See docs/recurring-prompts-plan.md.
--
-- Adds:
--   1. 'scheduled' value documented on ai_conversations.type_conversation_mode
--      (each task owns ONE persistent conversation; runs append messages).
--   2. ai_scheduled_prompts — the standing tasks.
--   3. ai_scheduled_runs — per-run history (the reliability-transparency
--      differentiator: delivered | no_change | partial | failed | skipped).

COMMENT ON COLUMN intelligence.ai_conversations.type_conversation_mode IS
  'general = normal chat; design = /engineai/design surface; meeting = EngineAI Live; scheduled = recurring-prompt task thread.';

CREATE TABLE IF NOT EXISTS intelligence.ai_scheduled_prompts (
  id_prompt uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace text NOT NULL,
  user_created integer NOT NULL,
  email_user text,                          -- delivery address (owner's email)
  name_title text NOT NULL,
  document_prompt text NOT NULL,            -- the standing prompt, written as a user message
  type_task text NOT NULL DEFAULT 'digest', -- digest | monitor (monitor = Phase 3)
  name_model text NOT NULL DEFAULT 'auto',
  id_client integer,                        -- optional client scope
  config_context jsonb,                     -- contextConfig overrides (webSearch etc.)
  -- Schedule (deterministic; time math lives in lib/scheduled/schedule.ts)
  type_schedule text NOT NULL DEFAULT 'daily',  -- daily | weekdays | weekly | monthly
  config_schedule jsonb NOT NULL DEFAULT '{}',  -- { hour, minute, dayOfWeek(1-7), dayOfMonth(1-28), tz }
  date_next_run timestamptz,
  date_last_run timestamptz,
  -- Delivery
  flag_email integer NOT NULL DEFAULT 1,
  id_conversation uuid REFERENCES intelligence.ai_conversations(id_conversation) ON DELETE SET NULL,
  -- Lifecycle / reliability
  flag_enabled integer NOT NULL DEFAULT 1,
  units_consecutive_failures integer NOT NULL DEFAULT 0,
  units_consecutive_ignored integer NOT NULL DEFAULT 0,
  document_last_snapshot jsonb,             -- monitor diff state (Phase 3)
  date_created timestamptz NOT NULL DEFAULT now(),
  date_updated timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_scheduled_prompts_due
  ON intelligence.ai_scheduled_prompts(date_next_run)
  WHERE flag_enabled = 1;
CREATE INDEX IF NOT EXISTS idx_ai_scheduled_prompts_workspace
  ON intelligence.ai_scheduled_prompts(id_workspace, user_created);

CREATE TABLE IF NOT EXISTS intelligence.ai_scheduled_runs (
  id_run uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_prompt uuid NOT NULL REFERENCES intelligence.ai_scheduled_prompts(id_prompt) ON DELETE CASCADE,
  type_status text NOT NULL DEFAULT 'running', -- running | delivered | no_change | partial | failed | skipped
  id_message uuid,                             -- the ai_messages row holding the output
  units_input integer,
  units_output integer,
  units_duration_ms integer,
  document_error text,
  flag_opened integer NOT NULL DEFAULT 0,      -- deep-link/open tracking (anti-abandonment)
  date_run timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_scheduled_runs_prompt
  ON intelligence.ai_scheduled_runs(id_prompt, date_run DESC);

ALTER TABLE intelligence.ai_scheduled_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence.ai_scheduled_runs ENABLE ROW LEVEL SECURITY;

-- Design Mode v2 — saved prompts library.
--
-- Per-user reusable prompt library. Designers save the prompts they like,
-- then drop them onto shots in any future session. Workspace-scoped so
-- the team can also share a curated pool when set to flag_team.

CREATE TABLE IF NOT EXISTS intelligence.design_saved_prompts (
  id_prompt        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace     uuid NOT NULL,
  user_created     integer NOT NULL,                      -- public.users(id_user)
  name_prompt      text NOT NULL,
  prompt_text      text NOT NULL,
  model_hint       text,                                  -- suggested model id, e.g. 'gen4.5'
  tags             text[],
  use_count        integer NOT NULL DEFAULT 0,
  last_used_at     timestamptz,
  flag_team        smallint NOT NULL DEFAULT 0,           -- 1 = visible to whole workspace
  date_created     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_design_saved_prompts_user
  ON intelligence.design_saved_prompts(user_created, date_created DESC);
CREATE INDEX IF NOT EXISTS idx_design_saved_prompts_workspace_team
  ON intelligence.design_saved_prompts(id_workspace, date_created DESC)
  WHERE flag_team = 1;

ALTER TABLE intelligence.design_saved_prompts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE intelligence.design_saved_prompts IS
  'Reusable prompt library for Design Mode v2. Per-user; can be promoted to team-shared via flag_team.';

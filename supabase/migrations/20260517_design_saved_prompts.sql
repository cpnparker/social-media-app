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

-- ─────────────────────────── RLS policies ───────────────────────────
-- The Node API calls this table with the service-role key, which bypasses
-- RLS entirely; primary enforcement (verifyWorkspaceMembership, creator
-- checks) lives in the route handlers. These policies are defense-in-depth
-- — they mirror the API's access model so a leaked anon/authenticated key
-- cannot exfiltrate or mutate the table directly.
--
-- Identity contract (if/when a non-service-role caller is used):
--   SELECT set_config('app.current_user_id',      $1::text, true);  -- integer
--   SELECT set_config('app.current_workspace_id', $2::text, true);  -- uuid
-- These GUCs must be set before each query. If unset, NULLIF returns NULL
-- and every policy short-circuits to deny (= same as the table having no
-- policies at all).

-- SELECT — own prompts, plus team-shared prompts in the current workspace.
CREATE POLICY "design_saved_prompts_select"
  ON intelligence.design_saved_prompts
  FOR SELECT
  USING (
    user_created = NULLIF(current_setting('app.current_user_id', true), '')::integer
    OR (
      flag_team = 1
      AND id_workspace = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  );

-- INSERT — only as yourself, only into the workspace you're acting in.
CREATE POLICY "design_saved_prompts_insert"
  ON intelligence.design_saved_prompts
  FOR INSERT
  WITH CHECK (
    user_created = NULLIF(current_setting('app.current_user_id', true), '')::integer
    AND id_workspace = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
  );

-- UPDATE — owner can edit; anyone in the workspace can bump use_count on
-- team prompts (the use-count bump endpoint is intentionally open within a
-- workspace; the API doesn't column-gate the update, so we don't either).
-- Non-owners cannot toggle flag_team or rename someone else's prompt
-- because the API never exposes that path.
CREATE POLICY "design_saved_prompts_update"
  ON intelligence.design_saved_prompts
  FOR UPDATE
  USING (
    user_created = NULLIF(current_setting('app.current_user_id', true), '')::integer
    OR (
      flag_team = 1
      AND id_workspace = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  )
  WITH CHECK (
    user_created = NULLIF(current_setting('app.current_user_id', true), '')::integer
    OR (
      flag_team = 1
      AND id_workspace = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    )
  );

-- DELETE — creator only.
CREATE POLICY "design_saved_prompts_delete"
  ON intelligence.design_saved_prompts
  FOR DELETE
  USING (
    user_created = NULLIF(current_setting('app.current_user_id', true), '')::integer
  );

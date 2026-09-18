-- Create workspaces and workspace_members tables in the intelligence schema.
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor).
--
-- These tables were previously in Neon (Drizzle) and need to exist in Supabase
-- for the app's workspace membership system to work.

-- 1. Workspaces table
CREATE TABLE IF NOT EXISTS intelligence.workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  plan        text NOT NULL DEFAULT 'free',
  late_api_key text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Workspace members table
CREATE TABLE IF NOT EXISTS intelligence.workspace_members (
  id            serial PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES intelligence.workspaces(id) ON DELETE CASCADE,
  user_id       integer NOT NULL,
  role          text NOT NULL DEFAULT 'viewer',
  invited_at    timestamptz NOT NULL DEFAULT now(),
  joined_at     timestamptz,
  UNIQUE(workspace_id, user_id)
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id
  ON intelligence.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id
  ON intelligence.workspace_members(workspace_id);

-- 4. Grant access to PostgREST roles (required for Supabase REST API)
GRANT ALL ON intelligence.workspaces TO service_role;
GRANT ALL ON intelligence.workspace_members TO service_role;
GRANT SELECT ON intelligence.workspaces TO authenticated;
GRANT SELECT ON intelligence.workspace_members TO authenticated;
GRANT SELECT ON intelligence.workspaces TO anon;
GRANT SELECT ON intelligence.workspace_members TO anon;

-- Grant sequence access for the serial id column
GRANT USAGE, SELECT ON SEQUENCE intelligence.workspace_members_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE intelligence.workspace_members_id_seq TO authenticated;

-- 5. Notify PostgREST to refresh its schema cache
NOTIFY pgrst, 'reload schema';

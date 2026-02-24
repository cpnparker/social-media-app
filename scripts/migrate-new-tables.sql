-- =============================================================
-- Migration: Create new tables for The Content Engine
-- Run this in the Supabase SQL Editor
-- =============================================================

-- 1. Add new columns to existing users table
-- -----------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS hashed_password TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'google';
ALTER TABLE users ADD COLUMN IF NOT EXISTS url_avatar TEXT;

-- 2. Workspaces
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  late_api_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Workspace Members
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_members_unique ON workspace_members(workspace_id, user_id);

-- 4. Teams
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_workspace ON teams(workspace_id);

-- 5. Team Members
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_unique ON team_members(team_id, user_id);

-- 6. Team Accounts (social accounts linked to teams)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS team_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  late_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  display_name TEXT NOT NULL,
  username TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_accounts_team ON team_accounts(team_id);

-- 7. Customer Accounts (social accounts linked to clients)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS customer_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id INTEGER NOT NULL,
  late_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  display_name TEXT NOT NULL,
  username TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_accounts_customer ON customer_accounts(customer_id);

-- 8. Profile Links (link-in-bio feature)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS profile_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_links_workspace ON profile_links(workspace_id);

-- 9. Promo Drafts (AI-generated promotional content)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS promo_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_object_id TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  content TEXT NOT NULL,
  media_urls JSONB,
  status TEXT NOT NULL DEFAULT 'draft',
  generated_by_ai BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promo_drafts_content ON promo_drafts(content_object_id);
CREATE INDEX IF NOT EXISTS idx_promo_drafts_workspace ON promo_drafts(workspace_id);

-- 10. Content Performance (engagement analytics)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS content_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_object_id TEXT NOT NULL,
  total_impressions INTEGER NOT NULL DEFAULT 0,
  total_reactions INTEGER NOT NULL DEFAULT 0,
  total_comments INTEGER NOT NULL DEFAULT 0,
  total_shares INTEGER NOT NULL DEFAULT 0,
  total_clicks INTEGER NOT NULL DEFAULT 0,
  replay_count INTEGER NOT NULL DEFAULT 0,
  last_fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_performance_content ON content_performance(content_object_id);

-- 11. Workspace Performance Model (ML/analytics model data)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_performance_model (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  topic_performance_map JSONB NOT NULL DEFAULT '{}',
  format_performance_map JSONB NOT NULL DEFAULT '{}',
  best_posting_windows JSONB NOT NULL DEFAULT '{}',
  average_engagement_baseline NUMERIC NOT NULL DEFAULT 0,
  high_performance_threshold NUMERIC NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wpm_workspace ON workspace_performance_model(workspace_id);

-- 12. Content Assets (files/documents attached to content or ideas)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS content_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'document',
  file_size INTEGER,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_assets_entity ON content_assets(entity_type, entity_id);

-- =============================================================
-- Done! All new tables created.
-- =============================================================

-- =============================================================
-- Migration 0010: Add performance indexes and unique constraints
-- Addresses missing indexes across all Neon/Drizzle tables
-- =============================================================

-- ── AI Conversations ──
CREATE INDEX IF NOT EXISTS idx_ai_conversations_workspace_created
  ON ai_conversations(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_created_by
  ON ai_conversations(created_by);

-- ── AI Messages ──
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created
  ON ai_messages(conversation_id, created_at ASC);

-- ── AI Usage ──
CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace_created
  ON ai_usage(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user
  ON ai_usage(user_id);

-- ── AI Memories ──
CREATE INDEX IF NOT EXISTS idx_ai_memories_workspace_user
  ON ai_memories(workspace_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ai_memories_workspace_scope
  ON ai_memories(workspace_id, scope);

-- ── AI Roles ──
CREATE INDEX IF NOT EXISTS idx_ai_roles_workspace
  ON ai_roles(workspace_id);

-- ── AI Conversation Shares ──
CREATE INDEX IF NOT EXISTS idx_ai_conversation_shares_conversation_user
  ON ai_conversation_shares(conversation_id, user_id);

-- ── Workspace Members ──
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace
  ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON workspace_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_members_unique
  ON workspace_members(workspace_id, user_id);

-- ── User Access ──
CREATE INDEX IF NOT EXISTS idx_user_access_workspace_user
  ON user_access(workspace_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_access_unique
  ON user_access(workspace_id, user_id);

-- ── Team Members ──
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_unique
  ON team_members(team_id, user_id);

-- ── Customer Members ──
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_members_unique
  ON customer_members(customer_id, user_id);

-- ── Posts ──
CREATE INDEX IF NOT EXISTS idx_posts_workspace
  ON posts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_by
  ON posts(created_by);
CREATE INDEX IF NOT EXISTS idx_posts_customer
  ON posts(customer_id);

-- ── Post Results ──
CREATE INDEX IF NOT EXISTS idx_post_results_post
  ON post_results(post_id);

-- ── Customers ──
CREATE INDEX IF NOT EXISTS idx_customers_workspace
  ON customers(workspace_id);

-- ── Contracts ──
CREATE INDEX IF NOT EXISTS idx_contracts_workspace
  ON contracts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_contracts_customer
  ON contracts(customer_id);

-- ── Content Unit Definitions ──
CREATE INDEX IF NOT EXISTS idx_cu_definitions_workspace
  ON content_unit_definitions(workspace_id);

-- ── Ideas ──
CREATE INDEX IF NOT EXISTS idx_ideas_workspace
  ON ideas(workspace_id);

-- ── Content Objects ──
CREATE INDEX IF NOT EXISTS idx_content_objects_workspace
  ON content_objects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_content_objects_idea
  ON content_objects(idea_id);

-- ── Production Tasks ──
CREATE INDEX IF NOT EXISTS idx_production_tasks_workspace
  ON production_tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_production_tasks_content_object
  ON production_tasks(content_object_id);

-- ── Activity Log ──
CREATE INDEX IF NOT EXISTS idx_activity_log_workspace
  ON activity_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created
  ON activity_log(created_at DESC);

-- ── Labels ──
CREATE INDEX IF NOT EXISTS idx_labels_workspace
  ON labels(workspace_id);

-- ── Teams ──
CREATE INDEX IF NOT EXISTS idx_teams_workspace
  ON teams(workspace_id);

-- ── Profiles ──
CREATE INDEX IF NOT EXISTS idx_profiles_workspace
  ON profiles(workspace_id);

-- ── Social Accounts ──
CREATE INDEX IF NOT EXISTS idx_social_accounts_profile
  ON social_accounts(profile_id);

-- ── Content Assets ──
CREATE INDEX IF NOT EXISTS idx_content_assets_entity
  ON content_assets(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_content_assets_workspace
  ON content_assets(workspace_id);

-- ── Promo Drafts ──
CREATE INDEX IF NOT EXISTS idx_promo_drafts_workspace
  ON promo_drafts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_promo_drafts_content_object
  ON promo_drafts(content_object_id);

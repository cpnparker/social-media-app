-- =============================================================
-- Intelligence Schema: EngineGPT tables
-- Run this in Supabase SQL Editor
-- Column naming follows public schema conventions:
--   PKs/FKs: id_<entity>  |  Users: user_<role>
--   Dates: date_<event>   |  Flags: flag_<state> (smallint)
-- =============================================================

-- ── 0. Expose intelligence schema via PostgREST ──
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, operations, intelligence';
NOTIFY pgrst, 'reload config';

-- ── 1. ai_conversations ──
CREATE TABLE IF NOT EXISTS intelligence.ai_conversations (
  date_created      timestamptz NOT NULL DEFAULT now(),
  date_updated      timestamptz NOT NULL DEFAULT now(),
  flag_incognito    smallint NOT NULL DEFAULT 0,
  id_client         integer, -- public.clients(id_client)
  id_content        integer, -- public.content(id_content)
  id_conversation   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace      uuid NOT NULL, -- public.workspaces(id_workspace)
  name_conversation text NOT NULL DEFAULT 'New Conversation',
  name_model        text NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  type_visibility   text NOT NULL DEFAULT 'private',
  user_created      integer NOT NULL -- public.users(id_user)
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_ws_date
  ON intelligence.ai_conversations(id_workspace, date_created DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_created
  ON intelligence.ai_conversations(user_created);

-- ── 2. ai_messages ──
CREATE TABLE IF NOT EXISTS intelligence.ai_messages (
  attachments       jsonb,
  date_created      timestamptz NOT NULL DEFAULT now(),
  document_message  text NOT NULL,
  id_conversation   uuid NOT NULL REFERENCES intelligence.ai_conversations(id_conversation) ON DELETE CASCADE,
  id_message        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_model        text,
  role_message      text NOT NULL,
  user_created      integer -- public.users(id_user)
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conv_date
  ON intelligence.ai_messages(id_conversation, date_created ASC);

-- ── 3. ai_conversation_shares ──
CREATE TABLE IF NOT EXISTS intelligence.ai_conversation_shares (
  date_created      timestamptz NOT NULL DEFAULT now(),
  id_conversation   uuid NOT NULL REFERENCES intelligence.ai_conversations(id_conversation) ON DELETE CASCADE,
  id_share          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_permission   text NOT NULL DEFAULT 'view',
  user_recipient    integer NOT NULL, -- public.users(id_user)
  user_shared       integer NOT NULL -- public.users(id_user)
);

CREATE INDEX IF NOT EXISTS idx_ai_shares_conv_user
  ON intelligence.ai_conversation_shares(id_conversation, user_recipient);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_shares_unique
  ON intelligence.ai_conversation_shares(id_conversation, user_recipient);

-- ── 4. ai_roles ──
CREATE TABLE IF NOT EXISTS intelligence.ai_roles (
  date_created             timestamptz NOT NULL DEFAULT now(),
  date_updated             timestamptz NOT NULL DEFAULT now(),
  flag_active              smallint NOT NULL DEFAULT 1,
  flag_default             smallint NOT NULL DEFAULT 0,
  id_role                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace             uuid NOT NULL, -- public.workspaces(id_workspace)
  information_description  text NOT NULL,
  information_instructions text NOT NULL,
  name_icon                text NOT NULL DEFAULT '🤖',
  name_role                text NOT NULL,
  order_sort               integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ai_roles_workspace
  ON intelligence.ai_roles(id_workspace);

-- ── 5. ai_memories ──
CREATE TABLE IF NOT EXISTS intelligence.ai_memories (
  date_created           timestamptz NOT NULL DEFAULT now(),
  date_updated           timestamptz NOT NULL DEFAULT now(),
  flag_active            smallint NOT NULL DEFAULT 1,
  id_conversation_source uuid REFERENCES intelligence.ai_conversations(id_conversation) ON DELETE SET NULL,
  id_memory              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace           uuid NOT NULL, -- public.workspaces(id_workspace)
  information_content    text NOT NULL,
  type_category          text NOT NULL DEFAULT 'fact',
  type_scope             text NOT NULL DEFAULT 'private',
  user_memory            integer -- public.users(id_user)
);

CREATE INDEX IF NOT EXISTS idx_ai_memories_ws_user
  ON intelligence.ai_memories(id_workspace, user_memory);
CREATE INDEX IF NOT EXISTS idx_ai_memories_ws_scope
  ON intelligence.ai_memories(id_workspace, type_scope);

-- ── 6. ai_usage ──
CREATE TABLE IF NOT EXISTS intelligence.ai_usage (
  date_created      timestamptz NOT NULL DEFAULT now(),
  id_conversation   uuid REFERENCES intelligence.ai_conversations(id_conversation) ON DELETE SET NULL,
  id_usage          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace      uuid NOT NULL, -- public.workspaces(id_workspace)
  name_model        text NOT NULL,
  type_source       text NOT NULL,
  units_cost_tenths integer NOT NULL DEFAULT 0,
  units_input       integer NOT NULL DEFAULT 0,
  units_output      integer NOT NULL DEFAULT 0,
  user_usage        integer NOT NULL -- public.users(id_user)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_ws_date
  ON intelligence.ai_usage(id_workspace, date_created DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user
  ON intelligence.ai_usage(user_usage);

-- ── 7. users_access ──
CREATE TABLE IF NOT EXISTS intelligence.users_access (
  date_updated           timestamptz NOT NULL DEFAULT now(),
  flag_access_admin      smallint NOT NULL DEFAULT 0,
  flag_access_engine     smallint NOT NULL DEFAULT 1,
  flag_access_enginegpt  smallint NOT NULL DEFAULT 1,
  flag_access_operations smallint NOT NULL DEFAULT 0,
  id_access              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace           uuid NOT NULL, -- public.workspaces(id_workspace)
  user_target            integer NOT NULL -- public.users(id_user)
);

CREATE INDEX IF NOT EXISTS idx_users_access_ws_user
  ON intelligence.users_access(id_workspace, user_target);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_access_unique
  ON intelligence.users_access(id_workspace, user_target);

-- ── 8. ai_settings ──
CREATE TABLE IF NOT EXISTS intelligence.ai_settings (
  config_context                  jsonb DEFAULT '{"contracts": true, "contentPipeline": true, "socialPresence": true}'::jsonb,
  date_created                    timestamptz NOT NULL DEFAULT now(),
  date_updated                    timestamptz NOT NULL DEFAULT now(),
  flag_debug                      smallint DEFAULT 0,
  id_setting                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace                    uuid NOT NULL UNIQUE, -- public.workspaces(id_workspace)
  information_cu_description      text,
  information_format_descriptions jsonb,
  information_type_instructions   jsonb,
  name_model                      text DEFAULT 'claude-sonnet-4-20250514',
  units_max_tokens                integer DEFAULT 4096
);

-- =============================================================
-- 9. Permissions: intelligence role
-- =============================================================
CREATE ROLE intelligence NOLOGIN;

GRANT USAGE ON SCHEMA public TO intelligence;
GRANT USAGE ON SCHEMA intelligence TO intelligence;

-- PUBLIC schema: read-only on all current and future tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO intelligence;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO intelligence;

-- INTELLIGENCE schema: full CRUD on all current and future tables
GRANT ALL ON ALL TABLES IN SCHEMA intelligence TO intelligence;
GRANT ALL ON ALL SEQUENCES IN SCHEMA intelligence TO intelligence;
ALTER DEFAULT PRIVILEGES IN SCHEMA intelligence
  GRANT ALL ON TABLES TO intelligence;
ALTER DEFAULT PRIVILEGES IN SCHEMA intelligence
  GRANT ALL ON SEQUENCES TO intelligence;

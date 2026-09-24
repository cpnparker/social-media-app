-- Design Mode v2 — parallel service to the EngineAI text chat.
--
-- This migration introduces a dedicated data model for the editor surface at
-- /design: sessions, shots (with versions + references), timeline tracks +
-- clips, brand kit snapshots, brand certificates, sharing, and publish jobs.
--
-- All tables sit alongside ai_conversations (not inside). Shares the same
-- ai_design_assets store from v1 — we just add id_shot / id_version columns
-- so generated assets link back to their shot/version.

-- ── 1. design_sessions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.design_sessions (
  id_session              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_workspace            uuid NOT NULL,
  id_client               integer,                                      -- public.clients(id_client)
  id_content              integer,                                      -- public.content(id_content)
  user_created            integer NOT NULL,

  name_session            text NOT NULL DEFAULT 'Untitled session',
  type_visibility         text NOT NULL DEFAULT 'private',              -- 'private' | 'team'
  flag_incognito          smallint NOT NULL DEFAULT 0,
  type_timeline_shape     text NOT NULL DEFAULT 'tracks',               -- 'tracks' | 'storyboard' | 'graph'
  id_brand_kit_snapshot   uuid,                                         -- FK → design_brand_kits
  current_shot_id         uuid,                                         -- FK → design_shots (set FK below after design_shots exists)

  date_created            timestamptz NOT NULL DEFAULT now(),
  date_updated            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_design_sessions_ws_date
  ON intelligence.design_sessions(id_workspace, date_updated DESC);
CREATE INDEX IF NOT EXISTS idx_design_sessions_user
  ON intelligence.design_sessions(user_created);
CREATE INDEX IF NOT EXISTS idx_design_sessions_client
  ON intelligence.design_sessions(id_client) WHERE id_client IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_design_sessions_content
  ON intelligence.design_sessions(id_content) WHERE id_content IS NOT NULL;

ALTER TABLE intelligence.design_sessions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE intelligence.design_sessions IS 'Design Mode v2 editor sessions. Parallel to ai_conversations.';

-- ── 2. design_brand_kits ───────────────────────────────────────────────────
-- Snapshot of ai_client_context.visual_identity taken at session start so
-- brand changes don't retro-break completed work.
CREATE TABLE IF NOT EXISTS intelligence.design_brand_kits (
  id_brand_kit            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_client               integer NOT NULL,
  version_tag             text NOT NULL DEFAULT 'auto · v1',
  visual_identity         jsonb NOT NULL,                               -- snapshot of palette/typography/dos/donts/etc.
  date_created            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_design_brand_kits_client
  ON intelligence.design_brand_kits(id_client, date_created DESC);

ALTER TABLE intelligence.design_brand_kits ENABLE ROW LEVEL SECURITY;

-- Add FK from design_sessions.id_brand_kit_snapshot
ALTER TABLE intelligence.design_sessions
  ADD CONSTRAINT fk_design_sessions_brand_kit
  FOREIGN KEY (id_brand_kit_snapshot)
  REFERENCES intelligence.design_brand_kits(id_brand_kit) ON DELETE SET NULL;

-- ── 3. design_shots ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.design_shots (
  id_shot                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_session              uuid NOT NULL REFERENCES intelligence.design_sessions(id_session) ON DELETE CASCADE,
  idx                     integer NOT NULL DEFAULT 0,                   -- shot order within the session

  name_shot               text NOT NULL DEFAULT 'Untitled shot',
  name_beat               text,                                         -- 'Foundation' / 'Conviction' / 'Horizon' / 'Return' etc.
  duration_sec            numeric(6,2) NOT NULL DEFAULT 5.0,

  model_id                text,                                         -- 'higgsfield' / 'runway-g4' / 'veo-3' / etc.
  model_note              text,

  status                  text NOT NULL DEFAULT 'queued',               -- 'queued' | 'generating' | 'review' | 'approved' | 'drift'
  flag_on_brand           smallint NOT NULL DEFAULT 1,

  prompt                  text,
  prompt_overrides        jsonb DEFAULT '{}'::jsonb,
  seed_value              text,
  seed_locked_from_shot_id uuid REFERENCES intelligence.design_shots(id_shot) ON DELETE SET NULL,
  note                    text,

  current_version_id      uuid,                                         -- FK → design_shot_versions (set below)

  date_created            timestamptz NOT NULL DEFAULT now(),
  date_updated            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_design_shots_session_idx
  ON intelligence.design_shots(id_session, idx);
CREATE INDEX IF NOT EXISTS idx_design_shots_session_status
  ON intelligence.design_shots(id_session, status);

ALTER TABLE intelligence.design_shots ENABLE ROW LEVEL SECURITY;

-- Add FK from design_sessions.current_shot_id (deferred — needed shots first)
ALTER TABLE intelligence.design_sessions
  ADD CONSTRAINT fk_design_sessions_current_shot
  FOREIGN KEY (current_shot_id)
  REFERENCES intelligence.design_shots(id_shot) ON DELETE SET NULL;

-- ── 4. design_shot_versions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.design_shot_versions (
  id_version              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_shot                 uuid NOT NULL REFERENCES intelligence.design_shots(id_shot) ON DELETE CASCADE,
  idx                     integer NOT NULL DEFAULT 1,

  id_asset                uuid,                                         -- → intelligence.ai_design_assets(id_asset). SET NULL on delete.
  prompt_used             text,                                         -- final prompt incl. brand augmentation
  model_id                text,
  metadata                jsonb DEFAULT '{}'::jsonb,                    -- duration, ratio, model_meta, brand_check result

  date_created            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_design_shot_versions_shot
  ON intelligence.design_shot_versions(id_shot, idx);

ALTER TABLE intelligence.design_shot_versions ENABLE ROW LEVEL SECURITY;

-- Add FK from design_shots.current_version_id
ALTER TABLE intelligence.design_shots
  ADD CONSTRAINT fk_design_shots_current_version
  FOREIGN KEY (current_version_id)
  REFERENCES intelligence.design_shot_versions(id_version) ON DELETE SET NULL;

-- ── 5. design_shot_references ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.design_shot_references (
  id_reference            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_shot                 uuid NOT NULL REFERENCES intelligence.design_shots(id_shot) ON DELETE CASCADE,
  idx                     integer NOT NULL DEFAULT 0,

  id_asset                uuid,                                         -- canvas asset reference
  external_url            text,                                         -- uploaded file
  seed_locked             smallint NOT NULL DEFAULT 0,
  caption                 text,

  date_created            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_design_shot_references_shot
  ON intelligence.design_shot_references(id_shot, idx);

ALTER TABLE intelligence.design_shot_references ENABLE ROW LEVEL SECURITY;

-- ── 6. design_tracks ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.design_tracks (
  id_track                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_session              uuid NOT NULL REFERENCES intelligence.design_sessions(id_session) ON DELETE CASCADE,
  kind                    text NOT NULL,                                -- 'title' | 'video' | 'overlay' | 'voice' | 'music' | 'ambience'
  idx                     integer NOT NULL DEFAULT 0,
  label                   text NOT NULL DEFAULT 'Track',
  date_created            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_design_tracks_session
  ON intelligence.design_tracks(id_session, idx);

ALTER TABLE intelligence.design_tracks ENABLE ROW LEVEL SECURITY;

-- ── 7. design_track_clips ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.design_track_clips (
  id_clip                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_track                uuid NOT NULL REFERENCES intelligence.design_tracks(id_track) ON DELETE CASCADE,

  id_shot                 uuid REFERENCES intelligence.design_shots(id_shot) ON DELETE SET NULL,
  id_asset                uuid,                                         -- direct asset link for audio/titles
  start_sec               numeric(8,3) NOT NULL DEFAULT 0,
  duration_sec            numeric(8,3) NOT NULL DEFAULT 0,
  in_offset_sec           numeric(8,3) NOT NULL DEFAULT 0,
  out_offset_sec          numeric(8,3) NOT NULL DEFAULT 0,
  metadata                jsonb DEFAULT '{}'::jsonb,                    -- title text, fades, etc.

  date_created            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_design_track_clips_track
  ON intelligence.design_track_clips(id_track, start_sec);

ALTER TABLE intelligence.design_track_clips ENABLE ROW LEVEL SECURITY;

-- ── 8. design_brand_certificates ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.design_brand_certificates (
  id_certificate          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_session              uuid REFERENCES intelligence.design_sessions(id_session) ON DELETE CASCADE,
  id_version              uuid REFERENCES intelligence.design_shot_versions(id_version) ON DELETE CASCADE,
  results                 jsonb NOT NULL DEFAULT '[]'::jsonb,            -- [{ rule, status: 'pass'|'warn'|'fail', value, threshold, detail }]
  date_created            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_design_brand_certs_session
  ON intelligence.design_brand_certificates(id_session, date_created DESC);
CREATE INDEX IF NOT EXISTS idx_design_brand_certs_version
  ON intelligence.design_brand_certificates(id_version);

ALTER TABLE intelligence.design_brand_certificates ENABLE ROW LEVEL SECURITY;

-- ── 9. design_shares ───────────────────────────────────────────────────────
-- Mirror of ai_shares for design_sessions. Same shape so checkSessionAccess
-- can mirror checkConversationAccess.
CREATE TABLE IF NOT EXISTS intelligence.design_shares (
  id_share                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_session              uuid NOT NULL REFERENCES intelligence.design_sessions(id_session) ON DELETE CASCADE,
  user_recipient          integer NOT NULL,
  user_shared             integer NOT NULL,                              -- owner who created share
  type_permission         text NOT NULL DEFAULT 'view',                  -- 'view' | 'collaborate'
  date_created            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id_session, user_recipient)
);

CREATE INDEX IF NOT EXISTS idx_design_shares_recipient
  ON intelligence.design_shares(user_recipient);

ALTER TABLE intelligence.design_shares ENABLE ROW LEVEL SECURITY;

-- ── 10. design_publish_jobs ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence.design_publish_jobs (
  id_job                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_session              uuid NOT NULL REFERENCES intelligence.design_sessions(id_session) ON DELETE CASCADE,
  id_content              integer,                                      -- target content item — assets attach here
  user_created            integer NOT NULL,

  formats                 jsonb NOT NULL DEFAULT '[]'::jsonb,            -- [{ ratio: '9:16', kind: 'story', primary: true }, ...]
  caption                 text,
  status                  text NOT NULL DEFAULT 'queued',                -- 'queued' | 'rendering' | 'uploaded' | 'posted' | 'failed'
  output_assets           jsonb DEFAULT '[]'::jsonb,                     -- [{ format, blob_url, id_asset, id_content_asset }]
  error                   text,

  date_created            timestamptz NOT NULL DEFAULT now(),
  date_completed          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_design_publish_jobs_session
  ON intelligence.design_publish_jobs(id_session, date_created DESC);
CREATE INDEX IF NOT EXISTS idx_design_publish_jobs_status
  ON intelligence.design_publish_jobs(status) WHERE status NOT IN ('posted','failed');

ALTER TABLE intelligence.design_publish_jobs ENABLE ROW LEVEL SECURITY;

-- ── 11. Extend ai_design_assets ────────────────────────────────────────────
-- Link generated/imported assets back to a shot + version so the canvas and
-- inspector can resolve which version each asset belongs to.
ALTER TABLE intelligence.ai_design_assets
  ADD COLUMN IF NOT EXISTS id_shot uuid,
  ADD COLUMN IF NOT EXISTS id_version uuid;

CREATE INDEX IF NOT EXISTS idx_ai_design_assets_shot
  ON intelligence.ai_design_assets(id_shot) WHERE id_shot IS NOT NULL;

COMMENT ON COLUMN intelligence.ai_design_assets.id_shot IS 'When set, links the asset to a design_shots row (Design Mode v2).';
COMMENT ON COLUMN intelligence.ai_design_assets.id_version IS 'When set, links the asset to a specific design_shot_versions row.';

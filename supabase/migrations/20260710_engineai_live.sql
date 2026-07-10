-- EngineAI Live: schema additions for the second-screen meeting copilot.
--
-- Adds:
--   1. 'meeting' value documented on ai_conversations.type_conversation_mode
--   2. ai_meeting_sessions — one row per live session; the NOT NULL consent
--      columns make the attestation gate structurally unskippable and double
--      as the consent audit log (nFADP liability lands on individuals — this
--      table is the paper trail).
--   3. ai_meeting_cards — compiled deck cards + live trigger log in one.
--      NOTE: there is deliberately NO utterance/transcript table. The raw
--      transcript is ephemeral (companion-window memory only) by design —
--      "process, don't record".
--   4. users_access.flag_access_engineai_live — per-user enablement toggle.

-- ── 1. conversation mode ──
COMMENT ON COLUMN intelligence.ai_conversations.type_conversation_mode IS
  'general = normal chat; design = /engineai/design surface; meeting = EngineAI Live second-screen meeting session.';

-- ── 2. meeting sessions + consent audit log ──
CREATE TABLE IF NOT EXISTS intelligence.ai_meeting_sessions (
  id_session uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_conversation uuid NOT NULL REFERENCES intelligence.ai_conversations(id_conversation) ON DELETE CASCADE,
  id_workspace text NOT NULL,
  id_client integer,
  mb_meeting_id text,
  name_title text,
  type_meeting text NOT NULL DEFAULT 'general', -- client_checkin | sales | general
  status_session text NOT NULL DEFAULT 'live',  -- live | paused | ended | discarded
  -- Consent attestation: capture cannot start without this row, and the row
  -- cannot exist without these values.
  consent_attested_at timestamptz NOT NULL,
  consent_attested_by integer NOT NULL,
  consent_method text NOT NULL DEFAULT 'verbal', -- verbal | calendar_note | both
  consent_wording_version text NOT NULL DEFAULT 'v1',
  capture_device text,
  date_started timestamptz NOT NULL DEFAULT now(),
  date_ended timestamptz,
  duration_seconds integer
);

CREATE INDEX IF NOT EXISTS idx_ai_meeting_sessions_workspace
  ON intelligence.ai_meeting_sessions(id_workspace, date_started DESC);
CREATE INDEX IF NOT EXISTS idx_ai_meeting_sessions_conversation
  ON intelligence.ai_meeting_sessions(id_conversation);

COMMENT ON TABLE intelligence.ai_meeting_sessions IS
  'EngineAI Live sessions. consent_* columns are the consent audit log — NOT NULL by design so attestation is structurally unskippable. No transcript is ever persisted (ephemeral by design).';

-- ── 3. cards + trigger log ──
CREATE TABLE IF NOT EXISTS intelligence.ai_meeting_cards (
  id_card uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_session uuid NOT NULL REFERENCES intelligence.ai_meeting_sessions(id_session) ON DELETE CASCADE,
  kind_card text NOT NULL,           -- deck_contract | deck_pipeline | deck_last_meeting | deck_people | scope_guard | commitment_memory | content_receipts | commercial_context | catch_up | flag_moment | ask_anything
  source_card text NOT NULL,         -- deck | t1 | t2 | user
  name_title text NOT NULL,
  document_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Receipt is REQUIRED: "no ungrounded cards" as a schema constraint.
  -- Shape: { quote?: string, utterance_ts_ms?: number, record_type?: string, record_id?: string, meeting_title?: string, meeting_date?: string }
  document_receipt jsonb NOT NULL,
  trigger_pattern text,              -- which T1 pattern or T2 label fired
  state_card text NOT NULL DEFAULT 'compiled', -- compiled | shown | expired | dismissed | pinned | suppressed
  latency_ms integer,                -- trigger→shown end-to-end
  feedback smallint,                 -- 1 = 👍, -1 = 👎 (post-call trigger log)
  date_created timestamptz NOT NULL DEFAULT now(),
  date_shown timestamptz,
  date_resolved timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_meeting_cards_session
  ON intelligence.ai_meeting_cards(id_session, date_created);

COMMENT ON TABLE intelligence.ai_meeting_cards IS
  'EngineAI Live cards: compiled deck rows + every live trigger event (incl. suppressions). This is the relevance-tuning ground-truth dataset. Receipts hold at most one-line quotes — never transcript passages.';

-- ── 4. per-user enablement flag ──
ALTER TABLE intelligence.users_access
  ADD COLUMN IF NOT EXISTS flag_access_engineai_live integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN intelligence.users_access.flag_access_engineai_live IS
  'EngineAI Live (second-screen meeting copilot) enablement. Default off; admins flip per user in Settings → Users.';

-- Per-user Gmail access for EngineAI
-- ==================================
-- Run in the Supabase SQL Editor (Engine project).
--
-- Gates the `query_gmail` chat tool, mirroring flag_access_finance.
--
-- DEFAULT 0 and NOT NULL, deliberately. Elsewhere in this codebase an ABSENT
-- users_access row has been treated as "allowed" (see the shares route), and
-- /api/me/preferences will INSERT a row with flags switched on. For a mailbox
-- that convention would mean everyone, so the reader checks `= 1` explicitly
-- and this column can never be silently null.
--
-- NOTE this is only ONE of the four gates. A user also needs: an interactive
-- chat turn (not a scheduled run, Live, or voice), a solo conversation
-- (not team, not shared), an approved model, AND their own opt-in on the
-- MeetingBrain side (users.gmail_query_enabled) which lives next to the
-- Google token.

ALTER TABLE intelligence.users_access
  ADD COLUMN IF NOT EXISTS flag_access_gmail integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN intelligence.users_access.flag_access_gmail IS
  'User may search their OWN Gmail from EngineAI chat. Default 0. Also requires users.gmail_query_enabled in MeetingBrain, a solo conversation, and an interactive chat turn.';

-- Grant yourself access (edit the id), then confirm:
-- UPDATE intelligence.users_access SET flag_access_gmail = 1
--   WHERE user_target = (SELECT id_user FROM public.users WHERE email_user = 'chris@thecontentengine.com');
-- SELECT user_target, flag_access_finance, flag_access_gmail FROM intelligence.users_access ORDER BY user_target;

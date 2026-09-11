-- Per-meeting visibility for MeetingBrain.
--
-- Target: the EngineAI Supabase project (schemas public + intelligence +
-- meetingbrain). Run in the SQL Editor.
--
-- Design and measurements: docs/meetingbrain-meeting-visibility-spec.md
--
-- ADDITIVE ONLY. This creates one table and one function. It does NOT touch
-- get_client_meetings, get_meeting_details or search_meetings. Nothing calls
-- the new function until EngineAI is pointed at it, so this script is inert on
-- its own and reversible by dropping both objects.
--
-- (An earlier version of this header justified that by saying the existing
-- bodies are not in the repo. That was wrong — get_client_meetings is in
-- scripts/fix-get-client-meetings-rpc.sql. Staying additive is still the right
-- call, for the ordinary reason that a separate function can be verified and
-- rolled back independently of one that is already serving traffic.)
--
-- Worth knowing when reading the rule below: attendees is stored as a JSON
-- ARRAY STRING and the deployed RPC parses it with jsonb_array_elements,
-- reading a->>'email'. This function instead regex-matches addresses out of
-- the raw text, which is deliberate — it also catches rows whose attendees
-- field is not valid JSON, which the deployed function's `LIKE '[%'` gate
-- silently drops.
--
-- WHAT THE RULE IS (decided 17 Aug 2026):
--   client attendee, any size        -> team     (client beats 1:1)
--   internal only, 3+ attendees      -> team
--   internal only, 1-2 attendees     -> private
--   vendor / other external          -> private
--   no attendee data                 -> private
--
-- The PERSONNEL carve-out (internal 3+ that discusses redundancy, departures,
-- pay, performance stays private) is deliberately NOT implemented here. It
-- lives in one place, lib/ai/providers.ts isPersonnelSensitive(), and a second
-- copy in SQL would drift from it the first time either changed. This function
-- returns the shape classification and the fields the screen needs; EngineAI
-- applies the carve-out on top.
--
-- Expected effect, measured against the live corpus by
-- scripts/model-meeting-visibility-rule.ts:
--   1,257 events team (410 client + 847 internal 3+), 4,622 private.
-- That is roughly a 9x expansion of what the whole company can read, since
-- get_client_meetings returns 140 today. Verify the count before pointing
-- anything at it.


-- ── 1. Deliberate exceptions to the rule ──
-- Absent row means the rule applies. Ships empty, so a half-finished rollout
-- exposes nothing.
--
-- Keyed on calendar_event_id, NOT on processed_meeting.id: one meeting can be
-- recorded by several people — 1,183 of 5,879 events (20%) are — and
-- get_meeting_details serves the RICHEST sibling row. A per-row override would
-- be set on one row, read back as set, and silently bypassed via another.
CREATE TABLE IF NOT EXISTS meetingbrain.meeting_visibility_override (
  calendar_event_id   text PRIMARY KEY,
  visibility          text NOT NULL CHECK (visibility IN ('private', 'team')),
  reason              text,
  set_by              integer NOT NULL,
  date_created        timestamptz NOT NULL DEFAULT now(),
  date_updated        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE meetingbrain.meeting_visibility_override IS
  'Deliberate human exceptions to the derived visibility rule. Absent row means the rule applies. NEVER written by automation: a classifier that can overwrite a human decision is worse than no classifier.';


-- ── 2. The rule ──
-- Returns one row per CALENDAR EVENT with its derived visibility.
--
-- Attendees are unioned across every recorder of the same event before the
-- rule is applied. Judging each processed_meeting row separately classifies
-- the same meeting two different ways when two people recorded it, and 20% of
-- events have more than one recorder.
--
-- SECURITY: this reports on the CORPUS, not on one caller's access. It returns
-- no transcript, no summary and no attendee identities — only the event id,
-- the classification, the reason and the counts EngineAI needs to apply the
-- personnel carve-out. Callers still fetch content through the existing
-- per-user RPCs, which is what enforces "you may read your own meetings".
CREATE OR REPLACE FUNCTION meetingbrain.get_meeting_visibility(
  p_internal_domain text,
  p_client_domains  text[]
)
RETURNS TABLE (
  calendar_event_id text,
  visibility        text,
  reason            text,
  attendee_count    integer,
  has_client        boolean,
  is_overridden     boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH addrs AS (
    -- One row per (event, distinct attendee ADDRESS). regexp_matches with 'g'
    -- expands the attendee text into its addresses; a NULL or empty field
    -- yields no rows, which is exactly the "no attendee data" case.
    --
    -- The address is carried, not just the domain, and the DISTINCT is on the
    -- address. An earlier version selected DISTINCT on the domain alone, which
    -- collapsed three colleagues at the same company into ONE row: every
    -- internal group meeting counted as a single attendee and fell to
    -- 'private'. It compiled and ran perfectly while mis-sorting 847 meetings
    -- — the whole reason this file is tested against real rows and not just
    -- parsed.
    SELECT DISTINCT
      pm.calendar_event_id,
      lower(m[1])                     AS addr,
      lower(split_part(m[1], '@', 2)) AS domain
    FROM meetingbrain.processed_meeting pm
    CROSS JOIN LATERAL regexp_matches(
      coalesce(pm.attendees, ''),
      '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})',
      'g'
    ) AS m
    WHERE pm.calendar_event_id IS NOT NULL
  ),
  events AS (
    SELECT DISTINCT pm.calendar_event_id
    FROM meetingbrain.processed_meeting pm
    WHERE pm.calendar_event_id IS NOT NULL
  ),
  shaped AS (
    SELECT
      e.calendar_event_id,
      count(a.addr)::integer AS attendee_count,   -- distinct ADDRESSES, not domains
      bool_or(a.domain = ANY(p_client_domains)) AS has_client,
      -- An external party who is neither us nor a registered client: a vendor,
      -- a recruiter, a candidate. Never opened by the rule.
      bool_or(
        a.domain <> lower(p_internal_domain)
        AND NOT (a.domain = ANY(p_client_domains))
      ) AS has_other_external
    FROM events e
    LEFT JOIN addrs a ON a.calendar_event_id = e.calendar_event_id
    GROUP BY e.calendar_event_id
  )
  SELECT
    s.calendar_event_id,
    COALESCE(
      o.visibility,
      CASE
        WHEN s.attendee_count = 0                    THEN 'private'
        WHEN COALESCE(s.has_client, false)           THEN 'team'
        WHEN COALESCE(s.has_other_external, false)   THEN 'private'
        WHEN s.attendee_count >= 3                   THEN 'team'
        ELSE 'private'
      END
    ) AS visibility,
    CASE
      WHEN o.visibility IS NOT NULL                THEN 'override'
      WHEN s.attendee_count = 0                    THEN 'no_attendee_data'
      WHEN COALESCE(s.has_client, false)           THEN 'client_attendee'
      WHEN COALESCE(s.has_other_external, false)   THEN 'external_non_client'
      WHEN s.attendee_count >= 3                   THEN 'internal_group'
      ELSE 'internal_small'
    END AS reason,
    s.attendee_count,
    COALESCE(s.has_client, false) AS has_client,
    (o.visibility IS NOT NULL) AS is_overridden
  FROM shaped s
  LEFT JOIN meetingbrain.meeting_visibility_override o
         ON o.calendar_event_id = s.calendar_event_id;
$$;

COMMENT ON FUNCTION meetingbrain.get_meeting_visibility(text, text[]) IS
  'Derived per-event visibility. Computed at read time and never materialised, so a corrected attendee list takes effect immediately and there is no backfill to mis-scope. Returns no meeting content. The personnel carve-out is applied by EngineAI, not here, so the keyword screen has exactly one implementation.';


-- ── 3. Sanity check ──
-- Run with the SAME domain list EngineAI uses. NEVER pass an empty
-- p_client_domains: with no client domains nothing can classify as a client
-- meeting, and the numbers below will be wrong in the safe direction but still
-- wrong. (get_client_meetings has the opposite and more dangerous behaviour on
-- an empty allowlist — it widens.)
--
-- SELECT visibility, reason, count(*)
-- FROM meetingbrain.get_meeting_visibility(
--        'thecontentengine.com',
--        ARRAY(SELECT ...your 77 client domains...)
--      )
-- GROUP BY visibility, reason
-- ORDER BY visibility, count(*) DESC;
--
-- EXPECTED, from the live corpus on 17 Aug 2026 (before the personnel
-- carve-out, which EngineAI applies afterwards and which moves 129 events from
-- team to private):
--   team    client_attendee        410
--   team    internal_group         976
--   private internal_small       1,268
--   private external_non_client    181
--   private no_attendee_data     3,044
--
-- If team totals in the thousands, the client-domain list almost certainly
-- includes thecontentengine.com — it IS registered as a client website
-- (app_clients.id_client 2), and including it classifies every internal
-- meeting as client work. EngineAI's loadClientDomains filters it; a
-- hand-written list must too.

SELECT
  count(*)                                              AS override_rows,
  count(*) FILTER (WHERE visibility = 'team')           AS forced_team,
  count(*) FILTER (WHERE visibility = 'private')        AS forced_private
FROM meetingbrain.meeting_visibility_override;

-- Expect 0, 0, 0 on a fresh install. Overrides are created by people, one at a
-- time, and never by a backfill.

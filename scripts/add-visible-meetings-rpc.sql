-- The client_meetings report, widened to the derived visibility rule.
--
-- Target: the EngineAI Supabase project. Run in the SQL Editor.
-- Requires scripts/add-meeting-visibility.sql to have been run first.
--
-- WHAT CHANGES. get_client_meetings shares a meeting only when it has an
-- attendee at a registered client domain — 142 meetings. This shares anything
-- the rule classifies as `team`, which adds internal group meetings.
--
-- MEASURED AFTER DEPLOYMENT: 532 meetings (142 client + 390 internal group),
-- of which EngineAI's personnel carve-out withholds 97, so 435 reach the
-- model. A 3.1x expansion.
--
-- NOT the ~1,150 an earlier version of this comment predicted. That figure was
-- the count of EVENTS the rule classifies `team` (1,266), and this function is
-- deliberately narrower: the summary and JSON-attendee gates below drop 734 of
-- them. The caveat was written three paragraphs down and then not applied to
-- the number — the two are five lines apart in the same file.
--
-- The 734 are mostly unprocessed meetings with no summary yet, so the shared
-- set grows toward 1,266 as MeetingBrain processes more. This is not a static
-- number and a sanity check that treats it as one will drift into a false
-- alarm.
--
-- A NEW FUNCTION, not a replacement. get_client_meetings keeps working
-- untouched, EngineAI falls back to it if this is absent, and rolling back is
-- dropping one object rather than restoring a definition from git. The two can
-- also be compared side by side on live data, which is the only way to see
-- what the widening actually did.
--
-- THREE PRIVACY PROPERTIES CARRIED OVER DELIBERATELY from get_client_meetings.
-- Widening WHICH meetings are shared must not quietly widen WHAT is shared
-- about them:
--
--   1. external_attendees returns EXTERNAL names only. Internal team members'
--      names and addresses are never returned, and free-mail addresses are
--      excluded from the name list too. For an internal team meeting this is
--      simply empty — the title and summary carry the value, and the attendee
--      list is not the part the team needs.
--   2. `attendees LIKE '[%'` is kept. jsonb_array_elements ERRORS on text that
--      is not a JSON array, so dropping this gate would not widen the report,
--      it would break it. Note this makes the function slightly NARROWER than
--      the visibility rule, which classifies non-JSON rows too — narrower is
--      the safe direction.
--   3. `summary IS NOT NULL` is kept. A meeting with no summary has nothing to
--      report, and unprocessed rows should not appear in a shared list.
--
-- THE PERSONNEL CARVE-OUT IS NOT HERE. It lives in EngineAI
-- (lib/ai/providers.ts isPersonnelSensitive) so the keyword screen has exactly
-- one implementation. This function therefore returns personnel-sensitive
-- internal meetings, and EngineAI DROPS them before the model sees them. That
-- split is safe only because EngineAI is the sole caller — if anything else
-- ever calls this, the carve-out must move into SQL or be duplicated
-- deliberately, not by accident.

CREATE OR REPLACE FUNCTION meetingbrain.get_visible_meetings(
  p_internal_domain text,
  p_client_domains  text[] DEFAULT NULL,
  p_since           timestamptz DEFAULT NULL,
  p_limit           int DEFAULT 100
)
RETURNS TABLE(
  meeting_id         text,
  meeting_title      text,
  meeting_date       timestamptz,
  summary            text,
  key_topics         text,
  next_steps         text,
  external_attendees text,
  visibility_reason  text,   -- client_attendee | internal_group | override
  is_client_meeting  boolean
) AS $$
  WITH vis AS (
    SELECT calendar_event_id, reason, has_client
    FROM meetingbrain.get_meeting_visibility(p_internal_domain, p_client_domains)
    WHERE visibility = 'team'
  ),
  candidate AS (
    SELECT
      pm.id,
      pm.calendar_event_id,
      pm.meeting_title,
      pm.meeting_date,
      COALESCE(
        NULLIF(pm.summary, ''),
        (CASE WHEN pm.external_summary IS NOT NULL
              THEN (pm.external_summary::jsonb ->> 'executiveSummary')
              ELSE NULL END)
      ) AS summary,
      pm.key_topics,
      pm.next_steps,
      pm.tasks_extracted,
      pm.transcript,
      pm.local_transcript,
      pm.attendees,
      v.reason,
      v.has_client
    FROM meetingbrain.processed_meeting pm
    JOIN vis v ON v.calendar_event_id = pm.calendar_event_id
    WHERE pm.attendees IS NOT NULL
      AND pm.attendees LIKE '[%'
      AND pm.summary IS NOT NULL
      AND (p_since IS NULL OR pm.meeting_date >= p_since)
  ),
  deduped AS (
    -- Same richest-record preference as get_client_meetings: one row per real
    -- meeting, not one per recorder.
    SELECT DISTINCT ON (calendar_event_id) *
    FROM candidate
    ORDER BY
      calendar_event_id,
      (CASE WHEN summary IS NOT NULL THEN 1 ELSE 0 END) DESC,
      (CASE WHEN transcript IS NOT NULL OR local_transcript IS NOT NULL THEN 1 ELSE 0 END) DESC,
      tasks_extracted DESC
  )
  SELECT
    d.id AS meeting_id,
    d.meeting_title,
    d.meeting_date,
    d.summary,
    d.key_topics,
    d.next_steps,
    -- EXTERNAL names only, exactly as before. Empty for an internal meeting.
    (
      SELECT string_agg(DISTINCT (a->>'name'), ', ')
      FROM jsonb_array_elements(d.attendees::jsonb) a
      WHERE position('@' IN (a->>'email')) > 0
        AND lower(split_part(a->>'email', '@', 2)) <> lower(p_internal_domain)
        AND lower(split_part(a->>'email', '@', 2)) NOT IN
          ('gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','me.com','aol.com','proton.me','protonmail.com')
    ) AS external_attendees,
    d.reason AS visibility_reason,
    COALESCE(d.has_client, false) AS is_client_meeting
  FROM deduped d
  ORDER BY d.meeting_date DESC
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION meetingbrain.get_visible_meetings(text, text[], timestamptz, int) IS
  'Meetings the whole workspace may read, per the derived visibility rule. Widens get_client_meetings from client-only to client + internal group. Returns EXTERNAL attendee names only, never internal ones. Does NOT apply the personnel carve-out — EngineAI does that, so the keyword screen has one implementation; any other caller must apply it too.';

NOTIFY pgrst, 'reload schema';


-- ── Sanity check ──
-- Run with the SAME domain list EngineAI uses, and compare the two functions
-- side by side. This is the number the expansion is, so look at it before
-- pointing anything at the new function.
--
-- SELECT 'get_client_meetings' AS fn, count(*) FROM meetingbrain.get_client_meetings(
--          'thecontentengine.com', ARRAY[...client domains...], NULL, 100000)
-- UNION ALL
-- SELECT 'get_visible_meetings', count(*) FROM meetingbrain.get_visible_meetings(
--          'thecontentengine.com', ARRAY[...client domains...], NULL, 100000);
--
-- MEASURED on 17 Aug 2026: 142 and 532. The second figure is before EngineAI's
-- personnel carve-out, which withholds a further 97.
--
-- It should grow slowly as unprocessed meetings acquire summaries. If it is in
-- the THOUSANDS, the client-domain list almost certainly includes
-- thecontentengine.com, which IS registered as a client website
-- (app_clients.id_client 2) and makes every internal meeting look like client
-- work.

-- Fix the dead RPC path for the EngineAI client_meetings report.
-- Run this in the Supabase SQL Editor (project dcwodczzdeltxlyepxmc).
--
-- WHY: lib/ai/providers.ts calls meetingbrain.get_client_meetings with
-- FOUR named args (p_internal_domain, p_client_domains, p_since, p_limit),
-- but the deployed function still has the original THREE-arg signature
-- (p_internal_domain, p_since, p_limit) — the updated definition in
-- meetingbrain/scripts/create-enginegpt-rpc.sql (commit 01be8f4,
-- 2026-06-01, "gate on registered-client domains") was never run against
-- the database. PostgREST therefore can't resolve the 4-named-arg call and
-- every request 404s ("Could not find the function ... in the schema
-- cache"), sending the report to the stale ai_client_meetings fallback.
--
-- The DROP is required: CREATE OR REPLACE cannot change a parameter list,
-- so without it the CREATE below would add a second overload next to the
-- old 3-arg function, and any future call that omits optional args would
-- become ambiguous. Nothing else calls the 3-arg version (only
-- lib/ai/providers.ts uses this RPC, and it always passes all four args).

DROP FUNCTION IF EXISTS meetingbrain.get_client_meetings(text, timestamptz, int);

-- Definition below is copied verbatim from
-- meetingbrain/scripts/create-enginegpt-rpc.sql (section 4).
--
-- PRIVACY MODEL (matches the old synced table exactly):
--   * Inclusion gate: a meeting is a "client meeting" only if it has an
--     attendee whose email domain is in p_client_domains — the list of
--     REGISTERED Engine client website domains. This deliberately keeps
--     personal / vendor / non-client external meetings OUT of this
--     workspace-shared report. If p_client_domains is NULL/empty, the gate
--     falls back to "any non-internal, non-free-mail external attendee".
--   * Names returned: external attendees only — anyone whose domain differs
--     from the workspace internal domain and isn't a free-mail provider.
--     Internal team members' names/emails are NEVER returned.
-- Deduplicates by calendar_event_id, preferring the richest record.
CREATE OR REPLACE FUNCTION meetingbrain.get_client_meetings(
  p_internal_domain text,
  p_client_domains text[] DEFAULT NULL,
  p_since timestamptz DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS TABLE(
  meeting_id text,
  meeting_title text,
  meeting_date timestamptz,
  summary text,
  key_topics text,
  next_steps text,
  external_attendees text
) AS $$
  WITH candidate AS (
    SELECT
      pm.id,
      pm.calendar_event_id,
      pm.meeting_title,
      pm.meeting_date,
      COALESCE(
        NULLIF(pm.summary, ''),
        -- fall back to the external_summary executiveSummary if present
        (CASE WHEN pm.external_summary IS NOT NULL
              THEN (pm.external_summary::jsonb ->> 'executiveSummary')
              ELSE NULL END)
      ) AS summary,
      pm.key_topics,
      pm.next_steps,
      pm.tasks_extracted,
      pm.transcript,
      pm.local_transcript,
      pm.attendees
    FROM meetingbrain.processed_meeting pm
    WHERE pm.attendees IS NOT NULL
      AND pm.attendees LIKE '[%'                       -- valid JSON array
      AND pm.summary IS NOT NULL
      AND (p_since IS NULL OR pm.meeting_date >= p_since)
      -- Inclusion gate: has an attendee from a registered client domain
      -- (or, if no client list supplied, any non-internal external attendee).
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(pm.attendees::jsonb) a
        WHERE position('@' IN (a->>'email')) > 0
          AND lower(split_part(a->>'email', '@', 2)) <> lower(p_internal_domain)
          AND (
            CASE
              WHEN p_client_domains IS NULL OR array_length(p_client_domains, 1) IS NULL
                THEN lower(split_part(a->>'email', '@', 2)) NOT IN
                  ('gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','me.com','aol.com','proton.me','protonmail.com')
              ELSE lower(split_part(a->>'email', '@', 2)) = ANY(p_client_domains)
            END
          )
      )
  ),
  deduped AS (
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
    -- External attendee names only (privacy: skip internal + free-mail)
    (
      SELECT string_agg(DISTINCT (a->>'name'), ', ')
      FROM jsonb_array_elements(d.attendees::jsonb) a
      WHERE position('@' IN (a->>'email')) > 0
        AND lower(split_part(a->>'email', '@', 2)) <> lower(p_internal_domain)
        AND lower(split_part(a->>'email', '@', 2)) NOT IN
          ('gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','me.com','aol.com','proton.me','protonmail.com')
    ) AS external_attendees
  FROM deduped d
  ORDER BY d.meeting_date DESC
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;

-- Supabase reloads the PostgREST schema cache automatically on DDL, but a
-- manual nudge is harmless and makes the fix take effect immediately.
NOTIFY pgrst, 'reload schema';

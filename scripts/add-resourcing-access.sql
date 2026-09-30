-- Airtable resourcing access flag.
-- Target: the SOCIAL MEDIA APP / EngineAI Supabase project (the one holding
-- schemas public + intelligence + meetingbrain). Run in the SQL Editor.
--
-- Until this runs, `flag_access_resourcing` does not exist, every read of it
-- returns null, and query_resourcing is registered for nobody. That is the
-- intended pre-migration state: the feature is dark, and nothing else breaks,
-- because the flag is read in its own PostgREST select rather than folded into
-- the query that also resolves finance and mail.
--
-- Supabase's linter will warn that ALTER TABLE is a destructive operation.
-- It is additive here — one new column defaulting to 0, i.e. denied — but
-- read the confirmation dialog rather than clicking through it.

-- ── 1. The column ──
-- smallint NOT NULL DEFAULT 0, matching every other flag on this table
-- (create-intelligence-schema.sql:122-125). The default is what makes it
-- fail closed: existing rows become "denied" rather than null. Postgres
-- stores a non-volatile default as metadata, so this does not rewrite the
-- table.
ALTER TABLE intelligence.users_access
  ADD COLUMN IF NOT EXISTS flag_access_resourcing smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN intelligence.users_access.flag_access_resourcing IS
  'Per-user access to the Airtable operations & resourcing base via the query_resourcing chat tool. 1 = granted. Unlike finance, this is NOT additionally gated on thread visibility: capacity is a team conversation. Money fields stay behind flag_access_finance.';

-- ── 2. Sanity check: the column exists and nobody has it yet ──
SELECT
  count(*)                                              AS access_rows,
  count(*) FILTER (WHERE flag_access_resourcing = 1)     AS granted,
  count(*) FILTER (WHERE flag_access_finance    = 1)     AS finance_granted_unchanged
FROM intelligence.users_access;

-- Expect: access_rows = your current row count, granted = 0,
-- and finance_granted_unchanged EXACTLY as it was before this ran.
-- If finance moved, stop — nothing here should have touched it.


-- ── 3. Grant it. Pick ONE of the following. ──

-- 3a. Just you, to try it first. Replace the address if you use another.
--
-- UPDATE intelligence.users_access ua
--    SET flag_access_resourcing = 1
--   FROM public.users u
--  WHERE u.id_user = ua.user_target
--    AND lower(u.email_user) = 'chris@thecontentengine.com';

-- 3b. Everyone who already has Operations access. This is the closest
--     existing analogue — the people who look at CU and delivery dashboards
--     are the people who ask about capacity — and it grants nobody new a
--     surface they did not already have in some form.
--
-- UPDATE intelligence.users_access
--    SET flag_access_resourcing = 1
--  WHERE flag_access_operations = 1;

-- 3c. Every live TCE staff member. Widest of the three. Note this includes
--     people with no Engine_IDs value in Airtable, who will see the roster
--     and the plan but no Engine delivery figures against their own name.
--
-- UPDATE intelligence.users_access ua
--    SET flag_access_resourcing = 1
--   FROM public.users u
--  WHERE u.id_user = ua.user_target
--    AND u.date_deleted IS NULL
--    AND lower(u.email_user) LIKE '%@thecontentengine.com';


-- ── 4. Confirm the grant ──
SELECT u.name_user, u.email_user, ua.flag_access_resourcing
  FROM intelligence.users_access ua
  JOIN public.users u ON u.id_user = ua.user_target
 WHERE ua.flag_access_resourcing = 1
 ORDER BY u.name_user;

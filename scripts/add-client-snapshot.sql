-- Per-client intelligence snapshot, written nightly by the refresh job.
--
-- Target: the EngineAI Supabase project. Run in the SQL Editor.
--
-- WHY A SNAPSHOT AT ALL (spec §8). Airtable allows 5 req/s per base with a
-- 220 ms enforced gap, and the response cache is per-lambda-instance. Ten
-- people opening the client list at 09:00 on Tuesday across three cold
-- instances would blow that limit immediately. One writer, many readers,
-- permanently: the pages read this table and never touch Airtable at request
-- time.
--
-- WHAT IS STORED, AND WHAT IS DELIBERATELY NOT:
--
--   * SOURCE VALUES, never computed bands. A signal like "behind pace" is
--     derived on READ from the numbers below. Storing the band freezes a
--     judgement made against thresholds that will change, and leaves no way
--     to see why it fired.
--   * NULL means "not recorded" and is distinct from 0 everywhere. Every
--     numeric column is nullable for exactly this reason.
--   * Per-source status, so a page can say "Airtable was unreachable at
--     03:14" instead of rendering an empty column that reads as "nothing due".
--
-- EMAIL. information_email_summary holds a SUMMARY of correspondence with this
-- client, drawn from one mailbox (the operator's) and readable by every member
-- of the workspace. That is a deliberate decision taken by Chris on 17 Aug
-- 2026, with the alternative — per-viewer, live, nothing stored — explicitly
-- declined. Three engineering constraints follow from it and are enforced in
-- the job rather than here:
--   1. only mail whose counterparty sits on a CONFIRMED client domain is ever
--      read, so personal correspondence cannot reach this column;
--   2. summaries only, never raw bodies, and email addresses are stripped;
--   3. summarisation runs on Claude only — the mailbox processor terms are
--      Anthropic's, and that is true regardless of who reads the output.

CREATE TABLE IF NOT EXISTS intelligence.ai_client_summary_snapshot (
  id_snapshot             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_client               integer NOT NULL,
  id_workspace            uuid,

  -- ── Identity (Engine) ──
  name_client             text,
  information_industry    text,
  link_website            text,
  name_account_manager_engine   text,
  name_account_manager_airtable text,
  flag_am_disagrees       smallint NOT NULL DEFAULT 0,

  -- ── The plan (Airtable) ──
  count_contracts_live    integer,
  units_contracted        numeric,
  units_remaining         numeric,
  date_soonest_end        date,
  days_soonest_end        integer,
  value_contracted_chf    numeric,          -- read only by finance viewers
  data_contracts          jsonb,            -- per-contract detail, as fetched

  -- ── The actual (Engine) ──
  units_delivered_12m     numeric,
  data_delivery_by_month  jsonb,            -- [{month, cu}], for the bar chart
  count_in_flight         integer,
  count_spiked            integer,
  date_last_delivered     date,
  flag_ever_had_tasks     smallint,
  -- Live contracts whose start date has not arrived. Zero delivery against
  -- these is the plan working, not a shortfall, and the two are
  -- indistinguishable from the numbers alone.
  count_not_started       integer,
  date_starts_on          date,

  -- ── The relationship (MeetingBrain) ──
  count_meetings_90d      integer,
  date_last_meeting       date,
  data_recent_meetings    jsonb,            -- [{date, title, summary}] — addresses stripped
  flag_no_domain          smallint NOT NULL DEFAULT 0,   -- cannot match, ≠ no meetings

  -- ── The correspondence (mailbox) ──
  information_email_summary text,
  date_last_email           date,
  count_emails_90d          integer,
  flag_email_available      smallint NOT NULL DEFAULT 0,  -- 0 = not read, ≠ none found

  -- ── Provenance. Every panel shows its own age; our cache gets the same
  --    rule we apply to Airtable's. ──
  data_sources            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {source: {ok, at, note}}
  date_refreshed          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_client_summary_snapshot_one_per_client UNIQUE (id_client)
);

CREATE INDEX IF NOT EXISTS idx_client_snapshot_refreshed
  ON intelligence.ai_client_summary_snapshot (date_refreshed DESC);

COMMENT ON TABLE intelligence.ai_client_summary_snapshot IS
  'Nightly per-client intelligence for the CRM pages. One writer (the refresh cron), many readers. Stores SOURCE VALUES, never computed signal bands — those are derived on read so a threshold change does not require a rewrite. NULL means not recorded and is never interchangeable with 0. information_email_summary is drawn from one operator mailbox and is workspace-readable by explicit decision; the job restricts it to confirmed client domains and stores summaries only.';


-- ── Run log ──
-- One row per refresh, so a page can distinguish "no clients changed" from
-- "the job has not run since Tuesday", and so a partial run is visible rather
-- than being inferred from stale rows.
CREATE TABLE IF NOT EXISTS intelligence.ai_client_summary_run (
  id_run          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_started    timestamptz NOT NULL DEFAULT now(),
  date_finished   timestamptz,
  count_clients   integer,
  count_errors    integer NOT NULL DEFAULT 0,
  data_sources    jsonb NOT NULL DEFAULT '{}'::jsonb,
  information_error text
);

CREATE INDEX IF NOT EXISTS idx_client_summary_run_started
  ON intelligence.ai_client_summary_run (date_started DESC);


-- ── Sanity check ──
SELECT
  (SELECT count(*) FROM intelligence.ai_client_summary_snapshot) AS snapshot_rows,
  (SELECT count(*) FROM intelligence.ai_client_summary_run)      AS runs,
  (SELECT max(date_refreshed) FROM intelligence.ai_client_summary_snapshot) AS newest;

-- Expect 0, 0, null on a fresh install. The pages fall back to reading live
-- until the first run completes, so nothing breaks in the meantime.

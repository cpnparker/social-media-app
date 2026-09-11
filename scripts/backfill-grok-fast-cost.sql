-- Correct three months of understated cost on the retired Grok fast model.
--
-- Target: the EngineAI / social-media-app Supabase project (schemas public +
-- intelligence + meetingbrain). Run in the SQL Editor.
--
-- WHY. xAI retired grok-4-1-fast-reasoning and grok-4-1-fast-non-reasoning on
-- 15 May 2026. The slugs kept resolving — requests redirect to grok-4.3 and are
-- billed at grok-4.3 rates — so nothing failed and nothing surfaced, while
-- lib/ai/model-costs.ts went on recording $0.20/$0.50 for calls actually
-- charged $1.25/$2.50. Every ai_usage row for that model since understates
-- input by 6.25x and output by 5x. The rates were fixed forward on 2026-08-14
-- (commit f7a8701); these are the rows written before that.
--
-- The model is the workhorse — memory extraction, conversation summaries,
-- client-context extraction, meeting triggers and digests, and every route in
-- app/api/ai/route.ts — so this is not a rounding error in the usage reporting.
--
-- units_cost_tenths is TENTHS OF A CENT, matching calculateCostTenths():
--   round( input/1e6 * inputPer1M * 10  +  output/1e6 * outputPer1M * 10 )
-- with rates in cents per 1M tokens. At grok-4.3's $1.25/$2.50 that is
--   round( units_input * 0.00125 + units_output * 0.0025 ).
--
-- Supabase's linter will flag the UPDATE as destructive. It rewrites one
-- column on a bounded set of rows and is idempotent — running it twice yields
-- the same values, because the target is computed from the token counts rather
-- than from the current cost. Read the dialog anyway.

-- ── 1. Scope and impact, BEFORE changing anything ──
-- Run this alone first. If affected_rows is 0, stop: either the backfill has
-- already run or the model names differ from what is assumed here.
SELECT
  name_model,
  count(*)                                   AS affected_rows,
  min(date_created)::date                    AS first_row,
  max(date_created)::date                    AS last_row,
  sum(units_cost_tenths)                     AS recorded_tenths,
  sum(round(units_input * 0.00125 + units_output * 0.0025)) AS correct_tenths,
  round(
    (sum(round(units_input * 0.00125 + units_output * 0.0025))
     - sum(units_cost_tenths)) / 1000.0, 2
  )                                          AS understated_usd
FROM intelligence.ai_usage
WHERE name_model IN ('grok-4-1-fast', 'grok-4-1-fast-non-reasoning')
  AND date_created >= '2026-05-15'
GROUP BY name_model
ORDER BY name_model;

-- Expect recorded_tenths to be roughly a fifth of correct_tenths. If the two
-- are already equal, this has run before — do not run step 2.


-- ── 2. The correction ──
-- Deliberately bounded by date: rows BEFORE 15 May 2026 were genuinely billed
-- at the old rate, because the model had not been retired yet. Correcting
-- those would introduce the opposite error.
--
-- UPDATE intelligence.ai_usage
--    SET units_cost_tenths = round(units_input * 0.00125 + units_output * 0.0025)
--  WHERE name_model IN ('grok-4-1-fast', 'grok-4-1-fast-non-reasoning')
--    AND date_created >= '2026-05-15';


-- ── 3. Confirm ──
-- recorded_tenths should now equal correct_tenths, and no OTHER model should
-- have moved — the second row set is the guard against a mis-scoped WHERE.
--
-- RUN 17 AUG 2026. It worked: 71,103 of 71,337 in-scope rows match exactly,
-- and every historical day is clean. But the two totals did NOT come out equal,
-- and the residual is the interesting part rather than a rounding artefact:
--
--   recorded 446,553   correct 448,012   gap 1,459 tenths ($1.46)
--
-- All 234 mismatching rows are dated 14 Aug onward and are STILL ARRIVING —
-- the newest was written the same morning this was checked. They carry
-- type_source 'dashboard', 'email', 'slack', 'meeting' and 'dedup', none of
-- which exist in this repository: EngineAI writes 'client-context',
-- 'memory-*', 'summary-*', 'engineai-meeting' and 'episode-extract'.
--
-- So they are MeetingBrain's, written into this shared table by a SECOND
-- codebase with its OWN copy of the rate table — one that still prices the
-- retired grok fast slug at $0.20/$0.50. The 14 Aug start is exactly when
-- EngineAI's forward fix (f7a8701) landed: from that day the two systems
-- disagree, and only one of them was corrected.
--
-- A backfill cannot fix this. It corrects history up to the moment it runs,
-- and the writer keeps producing understated rows afterwards. MeetingBrain's
-- rate table has to be corrected in MeetingBrain, and this script re-run once
-- afterwards to mop up the rows written in between. Until then MeetingBrain's
-- own cost reporting understates by about 8.4% (15,935 recorded against 17,404
-- correct, across 2,950 rows since 1 Aug).
SELECT
  'grok fast (corrected)' AS scope,
  sum(units_cost_tenths)  AS recorded_tenths,
  sum(round(units_input * 0.00125 + units_output * 0.0025)) AS correct_tenths
FROM intelligence.ai_usage
WHERE name_model IN ('grok-4-1-fast', 'grok-4-1-fast-non-reasoning')
  AND date_created >= '2026-05-15'
UNION ALL
SELECT
  'everything else (must be untouched)',
  sum(units_cost_tenths),
  NULL
FROM intelligence.ai_usage
WHERE name_model NOT IN ('grok-4-1-fast', 'grok-4-1-fast-non-reasoning');


-- ── 4. Who is still writing understated rows? ──
-- Run this any time. Every row it returns is a writer that has NOT been fixed:
-- the cost it recorded disagrees with what the token counts imply at grok-4.3
-- rates. An empty result means every system writing to this table agrees.
--
-- Ordered by how recent the newest bad row is, because that is the question —
-- not "was there ever a discrepancy" but "is one still being created".
SELECT
  type_source,
  count(*)                                                        AS wrong_rows,
  max(date_created)                                               AS newest_wrong_row,
  sum(round(units_input * 0.00125 + units_output * 0.0025)
      - units_cost_tenths)                                        AS understated_tenths
FROM intelligence.ai_usage
WHERE name_model IN ('grok-4-1-fast', 'grok-4-1-fast-non-reasoning')
  AND date_created >= '2026-05-15'
  AND units_cost_tenths
      IS DISTINCT FROM round(units_input * 0.00125 + units_output * 0.0025)
GROUP BY type_source
ORDER BY newest_wrong_row DESC;

-- As of 17 Aug 2026 this returns dashboard / email / slack / meeting / dedup —
-- all MeetingBrain. When MeetingBrain's rate table is corrected, re-run step 2
-- once to mop up, then this query should come back empty and stay empty.

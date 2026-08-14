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

-- Rounds per turn: the number the E1 prompt-cache fix is measured by.
--
-- RUN BY HAND in the Supabase SQL editor for project dcwodczzdeltxlyepxmc,
-- schema `intelligence`, like every migration in this repo. Safe to run twice.
--
-- WHY. A chat turn is not one model call. lib/ai/providers.ts runs a tool loop
-- of up to MAX_TOOL_ROUNDS = 8 requests plus a forced final pass, and every one
-- of them re-sends the whole conversation and every tool result so far. ONE
-- ledger row is written per TURN (app/api/ai/conversations/[id]/messages/
-- route.ts), so the column that would say how many requests that row paid for
-- has never existed. Without it the same units_input can come from one enormous
-- request or from eight small ones — and prompt caching only helps the second,
-- so the saving could neither be sized before the change nor verified after it.
--
-- NULLABLE, WITH NO DEFAULT, deliberately. units_cache_read / units_cache_write
-- default to 0 because 0 is a truthful count for a provider that does not
-- cache. Zero rounds is not a thing that can happen. A row written by a build
-- that predates the plumbing, or by a leg that threw before its first request,
-- must read "not measured" rather than "measured, and it was none" — so every
-- query below says WHERE units_rounds IS NOT NULL, which is the point.
--
-- NO BACKFILL IS POSSIBLE. Round counts were never written anywhere durable —
-- only to the per-round console lines, which Vercel keeps for days — so history
-- stays blank and only rows written after the app deploy carry a count.
--
-- SAFE TO RUN: one nullable column, no default, no rewrite of existing rows, no
-- constraint change, nothing dropped. Supabase's linter flags no destructive
-- operation here. The app also tolerates this migration NOT having been run:
-- the insert retries without the column on PGRST204/42703 rather than losing
-- the whole row, because losing the row would lose the measurement the column
-- exists to take.

ALTER TABLE intelligence.ai_usage
  ADD COLUMN IF NOT EXISTS units_rounds integer;

COMMENT ON COLUMN intelligence.ai_usage.units_rounds IS
  'Provider requests made for this turn by the model in name_model: tool-loop rounds plus the forced final pass. NULL = not measured (rows before 2026-09, or a leg that threw before its first request). Never 0. UNDERCOUNTS A FALLBACK TURN: when a provider throws, the requests it had already made unwind with the exception, so the row carries only the answering leg (units_input has the same limitation). A fallen-back turn is therefore indistinguishable here from a genuine one-request turn — the logs say which, via "[AI] ... falling back to".';

-- ── Sanity check 1: the column exists, nullable, no default. ──────────────
-- Expect exactly ONE row:  units_rounds | integer | YES | (null)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'intelligence'
  AND table_name   = 'ai_usage'
  AND column_name  = 'units_rounds';

-- ── Sanity check 2: run a day AFTER the app deploy. ───────────────────────
-- Expect turns_with_a_count to equal turns for rows written since the deploy,
-- and avg_rounds to be greater than 1. If turns_with_a_count is 0 while turns
-- is not, the app is still on the pre-migration build or the retry is
-- swallowing a real error — look for "[Usage] units_rounds is not in the schema
-- yet" in the logs before touching anything else.
SELECT
  name_model,
  count(*)                                AS turns,
  count(units_rounds)                     AS turns_with_a_count,
  round(avg(units_rounds)::numeric, 2)    AS avg_rounds,
  max(units_rounds)                       AS max_rounds,
  round(avg(units_input)::numeric)        AS avg_uncached_input,
  round(avg(units_cache_read)::numeric)   AS avg_cache_read,
  round(avg(units_cache_write)::numeric)  AS avg_cache_write,
  round(sum(units_cost_tenths) / 10.0, 2) AS cost_usd
FROM intelligence.ai_usage
WHERE type_source = 'enginegpt'
  AND date_created >= now() - interval '7 days'
GROUP BY name_model
ORDER BY turns DESC;

-- ── Sanity check 3: the distribution, which is what decides E1's payoff. ──
-- A turn that made ONE request is the only shape the fix costs money on
-- (+25% on its message bytes); every other shape saves. Run this before and
-- after the E1 deploy on the same window width.
--
-- READ THE units_rounds = 1 BUCKET AS AN UPPER BOUND. A turn whose first
-- provider threw and was answered by a fallback leg reports only that leg's
-- requests, so an xAI failure answered by Sonnet 5 lands here looking like a
-- genuine single-request turn. Those are the rows the +25% argument turns on,
-- so before acting on this bucket, count "falling back to" in the same window's
-- logs (`vercel logs --query "falling back to"`, non-streaming) and treat that
-- count as the number of rows in it that are not what they appear.
SELECT
  units_rounds,
  count(*)                                         AS turns,
  round(avg(units_input)::numeric)                 AS avg_uncached_input,
  round(avg(units_cache_read)::numeric)            AS avg_cache_read,
  round(avg(units_cache_write)::numeric)           AS avg_cache_write,
  round(avg(units_cost_tenths)::numeric / 10.0, 4) AS avg_cost_usd
FROM intelligence.ai_usage
WHERE type_source = 'enginegpt'
  AND name_model LIKE 'claude-%'
  AND units_rounds IS NOT NULL
  AND date_created >= now() - interval '7 days'
GROUP BY units_rounds
ORDER BY units_rounds;

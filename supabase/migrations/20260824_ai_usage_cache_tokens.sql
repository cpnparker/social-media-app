-- Persist the cache token counts that ai_usage already PRICES but throws away.
--
-- Over the 30 days to 2026-08-24, the enginegpt/claude-sonnet-5 line cost
-- $110.93. Its two token columns account for $65.40 of that:
--
--   units_input  30,299,263 x $2/1M  = $60.60
--   units_output    480,468 x $10/1M = $ 4.80
--
-- The missing $45.53 — 41% of the largest line on the bill — is cache read and
-- cache write. Both are measured (Anthropic returns cache_read_input_tokens and
-- cache_creation_input_tokens), both are passed to calculateCostTenths, and both
-- are then dropped on the floor: the insert in
-- app/api/ai/conversations/[id]/messages/route.ts writes units_input,
-- units_output and units_cost_tenths and nothing else.
--
-- So the ledger's TOTAL is right and its BREAKDOWN cannot be reconstructed. That
-- matters more than it sounds. A cache write costs 1.25x input and a read costs
-- 0.1x, so a prefix that is rewritten every turn and never read back is strictly
-- worse than not caching at all — and today that failure and a perfectly healthy
-- cache produce the same row. This repo has already shipped two cache
-- invalidation bugs of exactly that shape.
--
-- There is no backfill. The numbers were computed and discarded, so history
-- stays unattributable; only rows written after this can be broken down.
--
-- SAFE TO RUN: two nullable columns with defaults, no rewrite of existing rows,
-- no constraint changes, nothing dropped. Supabase's linter flags no destructive
-- operation here.

ALTER TABLE intelligence.ai_usage
  ADD COLUMN IF NOT EXISTS units_cache_read  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS units_cache_write integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN intelligence.ai_usage.units_cache_read IS
  'Prompt-cache read tokens. Billed at cachedInputPer1M (~0.1x input). 0 for providers that do not report it.';
COMMENT ON COLUMN intelligence.ai_usage.units_cache_write IS
  'Prompt-cache creation tokens. Billed at input x cacheWriteMultiplier (1.25x on Anthropic). Written but never read back = pure waste.';

-- Sanity check. Expect two rows, both integer, both NOT NULL, both default 0.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'intelligence'
  AND table_name = 'ai_usage'
  AND column_name IN ('units_cache_read', 'units_cache_write')
ORDER BY column_name;

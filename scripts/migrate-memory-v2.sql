-- =============================================================
-- Memory System V2: Add reinforcement, decay & source tracking
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- =============================================================

-- 1. Add new columns (safe to re-run — IF NOT EXISTS)
ALTER TABLE intelligence.ai_memories
  ADD COLUMN IF NOT EXISTS score_strength     real NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS count_reinforced   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS date_last_accessed timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS type_source        text NOT NULL DEFAULT 'inferred';

-- 2. Backfill: set date_last_accessed = date_updated for existing memories
UPDATE intelligence.ai_memories
  SET date_last_accessed = COALESCE(date_updated, date_created)
  WHERE date_last_accessed = date_created;

-- 3. Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'intelligence' AND table_name = 'ai_memories'
ORDER BY ordinal_position;

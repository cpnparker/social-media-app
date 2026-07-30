-- AI Control Centre Phase 4: per-service schedule config.
--
-- Vercel registers cron entries at deploy time, so we can't change cron
-- expressions live. Instead each cron handler fires at whatever interval
-- vercel.json says, then asks this table whether the service is due:
--   - schedule_enabled = false      → handler skips
--   - schedule_interval_minutes set → handler runs only if
--                                     now - last_run_at >= interval
-- The handler updates last_run_at when it runs.
--
-- This lets the Control Centre tune how often a service runs (within the
-- bound of the underlying vercel.json cadence) without a redeploy.

ALTER TABLE intelligence.service_config
  ADD COLUMN IF NOT EXISTS schedule_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS schedule_interval_minutes integer,
  ADD COLUMN IF NOT EXISTS schedule_last_run_at timestamptz;

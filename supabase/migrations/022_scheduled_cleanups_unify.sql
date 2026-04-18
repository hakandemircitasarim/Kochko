-- scheduled_cleanups schema unification (Spec 18.2)
-- Client services (privacy, audit-log) have been writing {resource_type, resource_id,
-- scheduled_at, status} but migration 010 defined {cleanup_type, target_table,
-- target_id, scheduled_for, executed_at}. The writes were silently failing on
-- missing columns. This migration adds the missing columns used by services so
-- past writes are recoverable, and we document the unified write path going forward.

-- Widen target_id to TEXT so it can hold storage paths / URLs (originally UUID NOT NULL)
ALTER TABLE scheduled_cleanups ALTER COLUMN target_id DROP NOT NULL;

-- Add the service-facing column aliases
ALTER TABLE scheduled_cleanups ADD COLUMN IF NOT EXISTS resource_type TEXT;
ALTER TABLE scheduled_cleanups ADD COLUMN IF NOT EXISTS resource_id TEXT;
ALTER TABLE scheduled_cleanups ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE scheduled_cleanups ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed'));
ALTER TABLE scheduled_cleanups ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Backfill scheduled_at from scheduled_for if missing
UPDATE scheduled_cleanups
SET scheduled_at = scheduled_for
WHERE scheduled_at IS NULL AND scheduled_for IS NOT NULL;

-- New index on due rows for cron efficiency
CREATE INDEX IF NOT EXISTS idx_scheduled_cleanups_due
  ON scheduled_cleanups(scheduled_at) WHERE status = 'pending';

-- Enable pg_cron + pg_net already done in migration 014; schedule the cleanup runner.
-- Calls an edge function `cleanup-scheduled` that marks rows done after deleting
-- storage objects + DB targets.
SELECT cron.schedule(
  'kochko-photo-cleanup',
  '*/15 * * * *',  -- every 15 minutes
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/cleanup-scheduled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

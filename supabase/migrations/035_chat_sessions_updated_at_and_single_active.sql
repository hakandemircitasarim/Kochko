-- Migration 035: chat_sessions.updated_at + single active session per user
--
-- Bug 1: chat_sessions had no updated_at column, yet:
--   - app/(tabs)/chat.tsx:82 read s.updated_at to auto-close 24h-inactive sessions
--     (always undefined → fell back to started_at → closed active sessions)
--   - supabase/migrations/014_cron_jobs.sql:91 ran UPDATE ... WHERE updated_at < ...
--     (column does not exist → cron silently failed)
--
-- Bug 2: chat_sessions had a partial index on is_active but no UNIQUE constraint.
-- storeMessages() uses .maybeSingle() to find the active session; if two rows
-- exist the query errors or returns the wrong row. Same bug goals had in 033.

-- 1. Add updated_at column with default so existing rows get a sensible value.
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Backfill — prefer ended_at for closed sessions, started_at otherwise.
UPDATE chat_sessions
SET updated_at = COALESCE(ended_at, started_at, NOW())
WHERE updated_at = started_at  -- only untouched rows
   OR updated_at IS NULL;

-- 3. Trigger: whenever a chat_messages row is inserted, bump the parent
--    session's updated_at so the 24h-inactive cleanup works correctly.
CREATE OR REPLACE FUNCTION bump_chat_session_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    UPDATE chat_sessions
    SET updated_at = NOW()
    WHERE id = NEW.session_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_messages_bump_session ON chat_messages;
CREATE TRIGGER trg_chat_messages_bump_session
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION bump_chat_session_updated_at();

-- 4. Collapse duplicate active sessions — keep the most recently updated one,
--    close the rest. Mirrors the pattern from migration 033 for goals.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY updated_at DESC, started_at DESC, id DESC
         ) AS rn
  FROM chat_sessions
  WHERE is_active = true
)
UPDATE chat_sessions
SET is_active = false,
    ended_at = COALESCE(ended_at, NOW())
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 5. Partial unique index enforces one active session per user at the DB layer.
--    Drop the older non-unique index first to avoid keeping two indexes on the
--    same predicate.
DROP INDEX IF EXISTS idx_chat_sessions_active;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_chat_sessions_one_active_per_user
  ON chat_sessions(user_id) WHERE is_active = true;

NOTIFY pgrst, 'reload schema';

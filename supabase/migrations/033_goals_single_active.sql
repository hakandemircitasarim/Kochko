-- Migration 033: Enforce one active goal per user
-- Bug: users ended up with 2 goals where is_active=true after repeated
-- onboarding chats; then maybeSingle() errored, set_goal validation failed
-- silently, and the handoff card never appeared.
-- Fix: deactivate older active rows, keep only the most recent as active,
-- then add a partial unique index to prevent future duplicates.

-- 1. Deactivate all but the most recent active goal per user.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
  FROM goals
  WHERE is_active = true
)
UPDATE goals
SET is_active = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Partial unique index prevents future duplicates at the DB layer.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_goals_one_active_per_user
  ON goals(user_id) WHERE is_active = true;

NOTIFY pgrst, 'reload schema';

-- Migration 032: Free-tier counters for plan approvals and daily message cap
-- Part of MASTER_PLAN Phase 0. See docs/MASTER_PLAN.md §4.7.
-- Plans: 1 diet + 1 workout approved lifetime free. Messages: onboarding
-- unlimited, otherwise 50/day resetting at the user's local midnight.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plans_used_free JSONB DEFAULT '{"diet": 0, "workout": 0}'::jsonb;
COMMENT ON COLUMN profiles.plans_used_free IS
  'Counts of plans APPROVED (promoted to active) while on free tier. Incremented in plan.service.approveDraft. Compared against the free quota.';

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_msg_count JSONB DEFAULT '{"date": null, "count": 0}'::jsonb;
COMMENT ON COLUMN profiles.daily_msg_count IS
  'Tracks free-tier daily message usage. Rate limiter reads and increments. Date key uses user local day_boundary_hour (see src/lib/day-boundary.ts).';

-- Backfill plans_used_free from existing active plans so pre-migration users
-- are not double-charged. Grouping by plan_type handles the case where a user
-- has an active diet AND workout plan already.
UPDATE profiles p
SET plans_used_free = jsonb_build_object(
  'diet',    COALESCE((SELECT count(*) FROM weekly_plans wp WHERE wp.user_id = p.id AND wp.plan_type = 'diet'    AND wp.status = 'active'), 0),
  'workout', COALESCE((SELECT count(*) FROM weekly_plans wp WHERE wp.user_id = p.id AND wp.plan_type = 'workout' AND wp.status = 'active'), 0)
)
WHERE plans_used_free = '{"diet": 0, "workout": 0}'::jsonb;

NOTIFY pgrst, 'reload schema';

-- Migration 030: Plan versioning (draft / active / archived)
-- Part of MASTER_PLAN Phase 0. See docs/MASTER_PLAN.md §4.3.
-- Adds status, plan_type, lineage, archive reasons, revisions log, and the
-- profile snapshot taken at approval time (drives drift detection §4.8).

-- 1. Add columns (idempotent)
ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS plan_type TEXT;
ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES weekly_plans(id);
ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS archived_reason TEXT;
ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS user_revisions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS approval_snapshot JSONB;

-- 2. Backfill existing rows: anything with an approval timestamp is 'active',
--    everything else is treated as an old draft and goes straight to 'archived'
--    so we don't lock users out with conflicting partial-unique indexes.
UPDATE weekly_plans
SET status = CASE WHEN approved_at IS NOT NULL THEN 'active' ELSE 'archived' END
WHERE status IS NULL;

-- Default plan_type is 'diet' (only diet plans existed before this migration).
UPDATE weekly_plans SET plan_type = 'diet' WHERE plan_type IS NULL;

-- 3. Enforce check constraints now that data is clean.
ALTER TABLE weekly_plans
  DROP CONSTRAINT IF EXISTS weekly_plans_status_check,
  ADD CONSTRAINT weekly_plans_status_check CHECK (status IN ('draft', 'active', 'archived'));

ALTER TABLE weekly_plans
  DROP CONSTRAINT IF EXISTS weekly_plans_plan_type_check,
  ADD CONSTRAINT weekly_plans_plan_type_check CHECK (plan_type IN ('diet', 'workout'));

ALTER TABLE weekly_plans
  DROP CONSTRAINT IF EXISTS weekly_plans_archived_reason_check,
  ADD CONSTRAINT weekly_plans_archived_reason_check
    CHECK (archived_reason IS NULL OR archived_reason IN (
      'superseded', 'user_discarded', 'alternative_rejected', 'plan_drift'
    ));

ALTER TABLE weekly_plans ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE weekly_plans ALTER COLUMN status SET NOT NULL;
ALTER TABLE weekly_plans ALTER COLUMN plan_type SET DEFAULT 'diet';
ALTER TABLE weekly_plans ALTER COLUMN plan_type SET NOT NULL;

-- 4. Drop the old (user_id, week_start) UNIQUE — with drafts + weekly plans this
--    no longer holds. Replace with partial unique indexes per (user, plan_type, status).
ALTER TABLE weekly_plans DROP CONSTRAINT IF EXISTS weekly_plans_user_id_week_start_key;

DROP INDEX IF EXISTS uniq_active_plan_per_type;
CREATE UNIQUE INDEX uniq_active_plan_per_type
  ON weekly_plans(user_id, plan_type)
  WHERE status = 'active';

DROP INDEX IF EXISTS uniq_draft_plan_per_type;
CREATE UNIQUE INDEX uniq_draft_plan_per_type
  ON weekly_plans(user_id, plan_type)
  WHERE status = 'draft';

-- Helpful query indexes.
CREATE INDEX IF NOT EXISTS idx_weekly_plans_status ON weekly_plans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_archived
  ON weekly_plans(user_id, plan_type, approved_at DESC)
  WHERE status = 'archived';

NOTIFY pgrst, 'reload schema';

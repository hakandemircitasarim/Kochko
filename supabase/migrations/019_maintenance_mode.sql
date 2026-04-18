-- Maintenance mode tracking (Spec 6.3)
-- When a user reaches their goal weight, we enter maintenance mode and
-- gradually raise calories toward TDEE (reverse diet). Tolerance band of
-- +/-1.5kg is monitored; if exceeded for 2+ weeks, AI proactively suggests
-- a mini cut which sets profiles.periodic_state='mini_cut'.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS maintenance_start_date DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS maintenance_target_weight_kg DECIMAL(5,2);

-- Multi-phase goal gradual transition (Spec 6.7 — "Gecisler ani degil kademeli")
-- When auto-advance fires between phases, we record the start date and the
-- origin calorie ranges so ai-plan can interpolate day-by-day over 7 days.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phase_transition_start_date DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phase_transition_from_rest_min SMALLINT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phase_transition_from_rest_max SMALLINT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phase_transition_to_rest_min SMALLINT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phase_transition_to_rest_max SMALLINT;

-- Goals table: allow AI-suggested non-weight goals (water, sleep, steps).
-- Check current type enum: if CHECK constraint restrictive, widen it.
DO $$
BEGIN
  -- Drop any CHECK constraint on goal_type if present
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'goals' AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%goal_type%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE goals DROP CONSTRAINT ' || constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'goals' AND constraint_type = 'CHECK'
        AND constraint_name LIKE '%goal_type%'
      LIMIT 1
    );
  END IF;
END $$;

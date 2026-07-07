-- 088: belief_events — append-only, bitemporal BELIEF LOG + plan staleness (target-arch step 11/12).
--
-- The memory spine that "correct once, propagate everywhere" stands on. Every change to a durable
-- belief about the user (dietary restriction, allergen, dislike, goal, injury, weight…) is appended
-- here with its provenance and BOTH times: record-time (created_at = when we learned it) and
-- valid-time (effective_from = when it is true in the world). That bitemporality is what separates
-- "I always weighed 92 (fix the record)" from "I now weigh 92 (new value from today)". Nothing is
-- mutated or deleted — the log is the history.
--
-- Paired with a stale_reason marker on weekly_plans: when a belief changes that the ACTIVE plan
-- violates (declared vegetarian but the plan has chicken), repair propagation flags the plan so the
-- coach surfaces it and the next generation honours the new belief — closing the "I told it I'm
-- vegetarian but it suggested chicken next week" gap.

CREATE TABLE IF NOT EXISTS belief_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  belief_key     text NOT NULL,                     -- 'dietary_restriction' | 'allergen' | 'dislike' | 'goal' | 'injury' | 'weight' | ...
  subject        text,                              -- the specific belief: 'vegan', 'süt', 'brokoli', 'knee'
  operation      text NOT NULL CHECK (operation IN ('set','retract','correct','confirm')),
  old_value      jsonb,
  new_value      jsonb,
  source         text NOT NULL DEFAULT 'user_stated' CHECK (source IN ('user_stated','onboarding','imported','inferred','confirmed')),
  temporal_scope text NOT NULL DEFAULT 'prospective' CHECK (temporal_scope IN ('prospective','retroactive')),
  effective_from date,                              -- valid-time (null = effective now / record-time)
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now() -- record-time (append-only)
);
CREATE INDEX IF NOT EXISTS idx_belief_events_user_key ON belief_events (user_id, belief_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_belief_events_user_time ON belief_events (user_id, created_at DESC);

ALTER TABLE belief_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='belief_events' AND policyname='be_sel') THEN
    CREATE POLICY be_sel ON belief_events FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- Plan staleness: set when a belief change invalidates the active plan; cleared on regeneration.
ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS stale_reason text;

SELECT 'belief_events + weekly_plans.stale_reason ready' AS status;

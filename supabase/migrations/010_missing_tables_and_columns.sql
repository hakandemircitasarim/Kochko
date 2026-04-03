-- Migration 010: Missing tables and columns identified by feature audit
-- Fixes: B2 (repair_history), B3 (scheduled_cleanups), B4 (deletion_requested_at),
--         B6 (saved_recipes columns), pregnancy_trimester

-- B2: repair_history table for chat correction learning (Spec 5.32)
CREATE TABLE IF NOT EXISTS repair_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  repair_type TEXT NOT NULL CHECK (repair_type IN ('correction', 'undo', 'delete', 'portion_update')),
  original_text TEXT,
  corrected_text TEXT,
  food_name TEXT,
  original_value JSONB,
  corrected_value JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repair_history_user ON repair_history(user_id, food_name);
CREATE INDEX IF NOT EXISTS idx_repair_history_food ON repair_history(food_name, created_at DESC);

-- B3: scheduled_cleanups table for KVKK photo retention (Spec 18.2)
CREATE TABLE IF NOT EXISTS scheduled_cleanups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cleanup_type TEXT NOT NULL CHECK (cleanup_type IN ('photo', 'export', 'temp_data')),
  target_table TEXT NOT NULL,
  target_id UUID NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_cleanups_pending
  ON scheduled_cleanups(scheduled_for) WHERE executed_at IS NULL;

-- B4: Account deletion request column (Spec 18.1 — KVKK/GDPR 30-day grace)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

-- B6: saved_recipes missing columns used by recipes.service.ts
ALTER TABLE saved_recipes ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE;
ALTER TABLE saved_recipes ADD COLUMN IF NOT EXISTS use_count INTEGER DEFAULT 0;

-- Pregnancy trimester for dynamic calorie adjustment (Spec 9.2)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pregnancy_trimester SMALLINT CHECK (pregnancy_trimester BETWEEN 1 AND 3);

-- Migration 011: Missing columns, RLS policies, and schema fixes
-- Covers: B1 (monthly_reports schema mismatch), RLS for repair_history & scheduled_cleanups

-- ============================================================
-- B1: monthly_reports missing columns
-- 004_plans_and_reports.sql defines monthly_reports with some columns,
-- but application code writes additional columns not yet in the schema.
-- ============================================================
ALTER TABLE monthly_reports ADD COLUMN IF NOT EXISTS weight_start NUMERIC;
ALTER TABLE monthly_reports ADD COLUMN IF NOT EXISTS weight_end NUMERIC;
ALTER TABLE monthly_reports ADD COLUMN IF NOT EXISTS weight_change NUMERIC;
ALTER TABLE monthly_reports ADD COLUMN IF NOT EXISTS total_days_logged INTEGER;
ALTER TABLE monthly_reports ADD COLUMN IF NOT EXISTS ai_monthly_note TEXT;

-- behavior_patterns alias: 004 created "behavioral_patterns" but code may use "behavior_patterns"
ALTER TABLE monthly_reports ADD COLUMN IF NOT EXISTS behavior_patterns JSONB;

-- ============================================================
-- RLS policies missing from 010 for repair_history & scheduled_cleanups
-- ============================================================
ALTER TABLE repair_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own repair_history"
  ON repair_history FOR ALL
  USING (auth.uid() = user_id);

ALTER TABLE scheduled_cleanups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own cleanups"
  ON scheduled_cleanups FOR ALL
  USING (auth.uid() = user_id);

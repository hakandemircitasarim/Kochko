-- Migration 031: Structured preference columns for plan feedback loop
-- Part of MASTER_PLAN Phase 0. See docs/MASTER_PLAN.md §4.6.
-- Replaces ad-hoc free-text with JSONB structures so AI can capture nuance
-- ("sabahları yumurta sevmem" vs "hiç yumurta yemem").

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS disliked_foods JSONB DEFAULT '[]'::jsonb;
COMMENT ON COLUMN profiles.disliked_foods IS
  'Array of {item, context, severity, learned_at}. context can be meal name (breakfast/lunch/dinner/snack) or null for all. severity: mild|strong.';

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferred_foods JSONB DEFAULT '[]'::jsonb;
COMMENT ON COLUMN profiles.preferred_foods IS
  'Array of {item, context, learned_at}. Same shape as disliked_foods minus severity.';

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS budget_constraints JSONB DEFAULT '{}'::jsonb;
COMMENT ON COLUMN profiles.budget_constraints IS
  'Object like {seafood: "too_expensive", imported: "avoid", organic: "unaffordable"}. Free-form keys, values from a small enum.';

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan_feedback_notes TEXT;
COMMENT ON COLUMN profiles.plan_feedback_notes IS
  'Free-form running notes AI writes over time from plan-chat negotiations. Not user-facing directly (surfaces via Kochkos Hakkinda Bildikleri).';

NOTIFY pgrst, 'reload schema';

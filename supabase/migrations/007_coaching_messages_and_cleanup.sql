-- Migration 007: Additional indexes and RLS policies for tables defined in 001-004
-- NOTE: Tables already exist in earlier migrations. This adds missing indexes only.

-- Performance indexes (if not already created)
CREATE INDEX IF NOT EXISTS idx_coaching_messages_user ON coaching_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_challenges_user_active ON challenges(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_commitments_pending ON user_commitments(user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_meal_templates_user ON meal_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_recipes_user ON saved_recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_venues_user ON user_venues(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_user ON ai_feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_user ON weekly_plans(user_id, week_start DESC);

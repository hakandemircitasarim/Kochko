-- Migration 006: Additional columns for new features
-- Adds columns needed by recent implementations

-- Profile extensions for premium, notifications, TDEE, theme
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS premium_expires_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_used boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_token text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_token_platform text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notification_prefs jsonb DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tdee_calculated integer;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tdee_last_weight numeric(5,1);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tdee_last_date date;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weekly_calorie_budget integer;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS step_target integer DEFAULT 10000;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS theme_mode text DEFAULT 'system';

-- Daily metrics extensions for recovery
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS muscle_soreness integer;
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS recovery_score integer;
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS stress_note text;

-- Daily plans extensions for versioning and approval
ALTER TABLE daily_plans ADD COLUMN IF NOT EXISTS version integer DEFAULT 1;
ALTER TABLE daily_plans ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Chat messages extensions for tracking
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS model_version text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS token_count integer;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS actions_executed jsonb;

-- progress_photos already exists in migration 002
-- Add pose_type column if not present (002 may not have it)
ALTER TABLE progress_photos ADD COLUMN IF NOT EXISTS pose_type text DEFAULT 'on';

-- Index for daily_plans versioning
CREATE INDEX IF NOT EXISTS idx_daily_plans_version ON daily_plans(user_id, date, version DESC);

-- Soft delete support: exclude deleted profiles from queries
CREATE INDEX IF NOT EXISTS idx_profiles_not_deleted ON profiles(id) WHERE deleted_at IS NULL;

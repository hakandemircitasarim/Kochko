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

-- Progress photos table
CREATE TABLE IF NOT EXISTS progress_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  photo_uri text NOT NULL,
  pose_type text DEFAULT 'on',
  taken_at timestamptz DEFAULT now(),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- RLS for progress_photos
ALTER TABLE progress_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own photos" ON progress_photos
  FOR ALL USING (auth.uid() = user_id);

-- Index for daily_plans versioning
CREATE INDEX IF NOT EXISTS idx_daily_plans_version ON daily_plans(user_id, date, version DESC);

-- Soft delete support: exclude deleted profiles from queries
CREATE INDEX IF NOT EXISTS idx_profiles_not_deleted ON profiles(id) WHERE deleted_at IS NULL;

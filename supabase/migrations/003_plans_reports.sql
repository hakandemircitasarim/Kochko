-- Daily plans (AI generated)
CREATE TABLE daily_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  calorie_target_min SMALLINT NOT NULL,
  calorie_target_max SMALLINT NOT NULL,
  protein_target_g SMALLINT NOT NULL,
  focus_message TEXT NOT NULL,
  meal_suggestions JSONB NOT NULL DEFAULT '[]',
  snack_strategy TEXT,
  workout_plan JSONB NOT NULL DEFAULT '{}',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_daily_plans_user_date ON daily_plans(user_id, date);

-- Daily reports (AI generated end-of-day)
CREATE TABLE daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  compliance_score SMALLINT NOT NULL CHECK (compliance_score BETWEEN 0 AND 100),
  calorie_actual SMALLINT DEFAULT 0,
  calorie_target_met BOOLEAN DEFAULT FALSE,
  protein_actual SMALLINT DEFAULT 0,
  protein_target_met BOOLEAN DEFAULT FALSE,
  workout_completed BOOLEAN DEFAULT FALSE,
  sleep_impact TEXT,
  water_impact TEXT,
  deviation_reason TEXT,
  tomorrow_action TEXT NOT NULL,
  full_report TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_daily_reports_user_date ON daily_reports(user_id, date);

-- Weekly reports
CREATE TABLE weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  weight_trend JSONB NOT NULL DEFAULT '[]',
  avg_compliance SMALLINT DEFAULT 0,
  top_deviation TEXT,
  next_week_strategy TEXT NOT NULL,
  plan_revision JSONB DEFAULT '{}',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);

CREATE INDEX idx_weekly_reports_user ON weekly_reports(user_id, week_start);

-- Coaching messages
CREATE TABLE coaching_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message_type TEXT CHECK (message_type IN ('daily_main', 'micro', 'report', 'weekly')) NOT NULL,
  content TEXT NOT NULL,
  trigger TEXT,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_coaching_messages_user ON coaching_messages(user_id, created_at);
CREATE INDEX idx_coaching_unread ON coaching_messages(user_id, read) WHERE read = FALSE;

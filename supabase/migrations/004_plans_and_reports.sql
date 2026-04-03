-- Migration 004: Plans, reports, challenges
-- Matches spec sections: 7, 8, 13

-- Daily plans (Spec 7.1)
CREATE TABLE daily_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  plan_type TEXT CHECK (plan_type IN ('training', 'rest')) DEFAULT 'rest',

  -- Calorie targets (Spec 2.4)
  calorie_target_min SMALLINT NOT NULL,
  calorie_target_max SMALLINT NOT NULL,
  protein_target_g SMALLINT NOT NULL,
  carbs_target_g SMALLINT,
  fat_target_g SMALLINT,
  water_target_liters DECIMAL(3,1),

  -- Content
  focus_message TEXT, -- "bugünün tek kritik odağı" (Spec 7.1)
  meal_suggestions JSONB NOT NULL DEFAULT '[]',
  -- [{meal_type, options: [{name, description, calories, protein_g, carbs_g, fat_g}]}]
  snack_strategy TEXT,
  workout_plan JSONB DEFAULT '{}',
  -- {warmup, main: [], cooldown, duration_min, rpe, heart_rate_zone, strength_targets: [{exercise, sets, reps, weight_kg}]}

  -- Weekly budget context (Spec 2.6)
  weekly_budget_total SMALLINT,
  weekly_budget_consumed SMALLINT,
  weekly_budget_remaining SMALLINT,

  -- Status
  version SMALLINT DEFAULT 1, -- plan versioning (Spec 7.4)
  status TEXT CHECK (status IN ('draft', 'approved', 'modified', 'rejected')) DEFAULT 'draft',
  approved_at TIMESTAMPTZ,

  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date, version)
);

CREATE INDEX idx_daily_plans_user_date ON daily_plans(user_id, date);

-- Weekly plans / menus (Spec 7.3)
CREATE TABLE weekly_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  plan_data JSONB NOT NULL, -- 7 days of meal suggestions
  shopping_list JSONB DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);

CREATE INDEX idx_weekly_plans_user ON weekly_plans(user_id, week_start);

-- Daily reports (Spec 8.1)
CREATE TABLE daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,

  compliance_score SMALLINT NOT NULL CHECK (compliance_score BETWEEN 0 AND 100),

  -- Actuals
  calorie_actual SMALLINT DEFAULT 0,
  protein_actual SMALLINT DEFAULT 0,
  carbs_actual SMALLINT DEFAULT 0,
  fat_actual SMALLINT DEFAULT 0,
  alcohol_calories SMALLINT DEFAULT 0, -- separate line (Spec 8.1)

  -- Targets met
  calorie_target_met BOOLEAN DEFAULT FALSE,
  protein_target_met BOOLEAN DEFAULT FALSE,
  workout_completed BOOLEAN DEFAULT FALSE,
  water_target_met BOOLEAN DEFAULT FALSE,
  steps_actual INT,

  -- Analysis
  sleep_impact TEXT,
  water_impact TEXT,
  deviation_reason TEXT, -- 'stress', 'hunger', 'eating_out', 'unplanned_snack', 'social', 'alcohol'

  -- Weekly budget (Spec 2.6)
  weekly_budget_status TEXT, -- "Haftalık bütçede 800 kcal marjın var"

  -- Action
  tomorrow_action TEXT NOT NULL,
  full_report TEXT NOT NULL,

  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_daily_reports_user_date ON daily_reports(user_id, date);

-- Weekly reports (Spec 8.2)
CREATE TABLE weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,

  weight_trend JSONB NOT NULL DEFAULT '[]',
  avg_compliance SMALLINT DEFAULT 0,
  weekly_budget_compliance BOOLEAN,
  top_deviation TEXT,
  best_day DATE,
  worst_day DATE,

  -- Trends
  protein_trend JSONB DEFAULT '[]',
  water_trend JSONB DEFAULT '[]',
  sleep_trend JSONB DEFAULT '[]',
  alcohol_total_calories SMALLINT DEFAULT 0,

  -- Strength (Spec 7.5)
  strength_summary TEXT,

  -- AI learning note (Spec 5.19)
  ai_learning_note TEXT,

  -- Strategy
  next_week_strategy TEXT NOT NULL,
  plan_revision JSONB DEFAULT '{}',

  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);

CREATE INDEX idx_weekly_reports_user ON weekly_reports(user_id, week_start);

-- Monthly reports (Spec 8.3)
CREATE TABLE monthly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,
  full_report JSONB DEFAULT '{}',
  avg_compliance SMALLINT,
  weight_change_kg NUMERIC(5,2),
  trend_direction TEXT CHECK (trend_direction IN ('losing', 'gaining', 'stable', 'fluctuating')),
  monthly_summary TEXT,
  risk_signals JSONB DEFAULT '[]',
  behavioral_patterns JSONB DEFAULT '[]',
  top_achievement TEXT,
  deviation_distribution JSONB DEFAULT '{}',
  next_month_focus TEXT,
  weight_trend JSONB DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, month_start)
);

-- Challenges (Spec 13.5)
CREATE TABLE challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  challenge_type TEXT CHECK (challenge_type IN ('system', 'custom')) DEFAULT 'system',
  target JSONB NOT NULL, -- {metric: 'steps', goal: 10000, period: 'daily', duration_days: 30}
  status TEXT CHECK (status IN ('active', 'paused', 'completed', 'abandoned')) DEFAULT 'active',
  progress JSONB DEFAULT '[]', -- [{date, value, met: boolean}]
  started_at TIMESTAMPTZ DEFAULT NOW(),
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_challenges_user ON challenges(user_id, status);

-- Achievements / milestones (Spec 13.1-13.3)
CREATE TABLE achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_type TEXT NOT NULL, -- 'first_kg', 'five_kg', 'half_goal', 'streak_7', 'streak_30', 'streak_100', 'goal_reached', 'maintenance_1m', 'pr'
  title TEXT NOT NULL,
  description TEXT,
  achieved_at TIMESTAMPTZ DEFAULT NOW(),
  shared BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_achievements_user ON achievements(user_id);

-- Saved recipes (Spec 7.7)
CREATE TABLE saved_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT, -- 'breakfast', 'lunch', 'dinner', 'snack', 'dessert'
  ingredients JSONB NOT NULL, -- [{name, amount, unit}]
  instructions TEXT NOT NULL,
  total_calories SMALLINT,
  total_protein SMALLINT,
  prep_time_min SMALLINT,
  cook_time_min SMALLINT,
  servings SMALLINT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recipes_user ON saved_recipes(user_id);

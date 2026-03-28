-- KOCHKO DATABASE SCHEMA v10
-- Migration 001: Core user and profile tables
-- Matches spec sections: 1.1-1.4, 2.1-2.8

-- Profiles (extends Supabase Auth)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Physical (Spec 2.1)
  height_cm SMALLINT,
  weight_kg DECIMAL(5,2),
  birth_year SMALLINT,
  gender TEXT CHECK (gender IN ('male', 'female', 'other')),
  body_fat_pct DECIMAL(4,1),
  muscle_mass_pct DECIMAL(4,1),
  waist_cm DECIMAL(5,1),
  hip_cm DECIMAL(5,1),
  chest_cm DECIMAL(5,1),
  thigh_cm DECIMAL(5,1),

  -- Nutrition preferences (Spec 2.1)
  cooking_skill TEXT CHECK (cooking_skill IN ('none', 'basic', 'good')) DEFAULT 'basic',
  budget_level TEXT CHECK (budget_level IN ('low', 'medium', 'high')) DEFAULT 'medium',
  diet_mode TEXT CHECK (diet_mode IN ('standard', 'low_carb', 'keto', 'high_protein')) DEFAULT 'standard',
  alcohol_frequency TEXT CHECK (alcohol_frequency IN ('never', 'rare', 'weekly', 'frequent')) DEFAULT 'never',
  portion_language TEXT CHECK (portion_language IN ('grams', 'household')) DEFAULT 'household',
  unit_system TEXT CHECK (unit_system IN ('metric', 'imperial')) DEFAULT 'metric',

  -- IF / Intermittent Fasting (Spec 2.1)
  if_active BOOLEAN DEFAULT FALSE,
  if_window TEXT, -- '16:8', '18:6', '20:4', 'custom'
  if_eating_start TIME, -- e.g. 12:00
  if_eating_end TIME,   -- e.g. 20:00

  -- Meal prep (Spec 2.1)
  meal_prep_active BOOLEAN DEFAULT FALSE,
  meal_prep_days TEXT[], -- e.g. ['sunday']

  -- Lifestyle (Spec 2.1)
  activity_level TEXT CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')) DEFAULT 'sedentary',
  sleep_time TIME,
  wake_time TIME,
  work_start TIME,
  work_end TIME,
  occupation TEXT,
  meal_count_preference SMALLINT DEFAULT 3,

  -- Exercise (Spec 2.1)
  equipment_access TEXT CHECK (equipment_access IN ('home', 'gym', 'both')) DEFAULT 'home',
  training_style TEXT CHECK (training_style IN ('cardio', 'strength', 'mixed')) DEFAULT 'mixed',

  -- Coach tone (Spec 4.2)
  coach_tone TEXT CHECK (coach_tone IN ('strict', 'balanced', 'gentle')) DEFAULT 'balanced',

  -- Timezone (Spec 2.5)
  home_timezone TEXT DEFAULT 'Europe/Istanbul',
  active_timezone TEXT DEFAULT 'Europe/Istanbul',

  -- Day boundary (Spec 2.8)
  day_boundary_hour SMALLINT DEFAULT 4, -- 04:00

  -- Menstrual cycle (Spec 2.1, optional)
  menstrual_tracking BOOLEAN DEFAULT FALSE,
  menstrual_cycle_length SMALLINT, -- days
  menstrual_last_period_start DATE,

  -- TDEE (Spec 2.4)
  tdee_calculated SMALLINT, -- last calculated TDEE
  tdee_calculated_at TIMESTAMPTZ,
  tdee_activity_multiplier DECIMAL(3,2), -- dynamically refined
  calorie_range_training_min SMALLINT,
  calorie_range_training_max SMALLINT,
  calorie_range_rest_min SMALLINT,
  calorie_range_rest_max SMALLINT,

  -- Macros (Spec 2.1)
  macro_protein_pct SMALLINT DEFAULT 30,
  macro_carb_pct SMALLINT DEFAULT 40,
  macro_fat_pct SMALLINT DEFAULT 30,
  protein_per_kg DECIMAL(3,1), -- calculated: 1.6-2.2

  -- Water (Spec 2.7)
  water_target_liters DECIMAL(3,1), -- auto-calculated or user override

  -- Periodic state (Spec 9)
  periodic_state TEXT, -- 'ramadan', 'holiday', 'illness', 'pregnancy', 'injury', 'travel', etc.
  periodic_state_start DATE,
  periodic_state_end DATE,

  -- System
  onboarding_completed BOOLEAN DEFAULT FALSE,
  profile_completion_pct SMALLINT DEFAULT 0,
  premium BOOLEAN DEFAULT FALSE,
  premium_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Goals (Spec 6.1-6.7)
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  goal_type TEXT NOT NULL CHECK (goal_type IN ('lose_weight', 'gain_weight', 'gain_muscle', 'health', 'maintain', 'conditioning')),
  target_weight_kg DECIMAL(5,2),
  target_weeks SMALLINT,
  priority TEXT CHECK (priority IN ('fast', 'sustainable', 'strength', 'muscle', 'health')) DEFAULT 'sustainable',
  restriction_mode TEXT CHECK (restriction_mode IN ('sustainable', 'aggressive')) DEFAULT 'sustainable',
  weekly_rate DECIMAL(3,2), -- kg/week target
  is_active BOOLEAN DEFAULT TRUE,
  phase_order SMALLINT DEFAULT 1, -- for multi-phase goals (Spec 6.7)
  phase_label TEXT, -- 'cut', 'bulk', 'maintain', 'mini_cut'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_goals_user_active ON goals(user_id, is_active) WHERE is_active = TRUE;

-- Health events (Spec 2.1)
CREATE TABLE health_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'surgery', 'injury', 'illness', 'medication', 'allergy'
  description TEXT NOT NULL,
  event_date DATE,
  is_ongoing BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_health_events_user ON health_events(user_id);

-- Food preferences (Spec 2.1)
CREATE TABLE food_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  food_name TEXT NOT NULL,
  preference TEXT NOT NULL CHECK (preference IN ('love', 'like', 'can_cook', 'dislike', 'never')),
  is_allergen BOOLEAN DEFAULT FALSE,
  allergen_severity TEXT CHECK (allergen_severity IN ('mild', 'moderate', 'severe')), -- severe = anaphylaxis risk
  UNIQUE(user_id, food_name)
);

CREATE INDEX idx_food_prefs_user ON food_preferences(user_id);

-- Favorite meal templates (Spec 3.4)
CREATE TABLE meal_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- "Kahvaltı klasiğim"
  items JSONB NOT NULL, -- [{name, portion, calories, protein_g, carbs_g, fat_g}]
  total_calories SMALLINT,
  total_protein SMALLINT,
  use_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_meal_templates_user ON meal_templates(user_id);

-- Frequent restaurants/venues (Spec 2.1)
CREATE TABLE user_venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  venue_name TEXT NOT NULL,
  venue_type TEXT, -- 'restaurant', 'cafeteria', 'fast_food', 'cafe'
  learned_items JSONB DEFAULT '[]', -- [{name, calories, protein_g, confirmed: bool}]
  visit_count INT DEFAULT 1,
  UNIQUE(user_id, venue_name)
);

CREATE INDEX idx_user_venues_user ON user_venues(user_id);

-- Weight history milestones (Spec 2.1)
CREATE TABLE weight_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  age_at_time SMALLINT,
  weight_kg DECIMAL(5,2) NOT NULL,
  note TEXT,
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX idx_weight_history_user ON weight_history(user_id, recorded_at);

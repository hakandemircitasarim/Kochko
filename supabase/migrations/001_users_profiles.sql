-- Profiles table (extends Supabase Auth users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  height_cm SMALLINT,
  weight_kg DECIMAL(5,2),
  birth_year SMALLINT,
  gender TEXT CHECK (gender IN ('male', 'female', 'other')),
  activity_level TEXT CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active')),
  equipment_access TEXT CHECK (equipment_access IN ('home', 'gym', 'both')) DEFAULT 'home',
  restriction_mode TEXT CHECK (restriction_mode IN ('sustainable', 'aggressive')) DEFAULT 'sustainable',
  cooking_skill TEXT CHECK (cooking_skill IN ('none', 'basic', 'good')) DEFAULT 'basic',
  budget_level TEXT CHECK (budget_level IN ('low', 'medium', 'high')) DEFAULT 'medium',
  sleep_time TIME,
  wake_time TIME,
  work_start TIME,
  work_end TIME,
  meal_count_preference SMALLINT DEFAULT 3,
  night_eating_risk BOOLEAN DEFAULT FALSE,
  sweet_craving_risk BOOLEAN DEFAULT FALSE,
  water_habit TEXT CHECK (water_habit IN ('low', 'moderate', 'good')) DEFAULT 'moderate',
  important_notes TEXT,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  premium BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Goals table
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_weight_kg DECIMAL(5,2) NOT NULL,
  target_weeks SMALLINT NOT NULL DEFAULT 12,
  priority TEXT CHECK (priority IN ('fast_loss', 'sustainable', 'strength', 'muscle', 'health')) DEFAULT 'sustainable',
  weekly_loss_rate DECIMAL(3,2) DEFAULT 0.5,
  daily_calorie_min SMALLINT DEFAULT 1400,
  daily_calorie_max SMALLINT DEFAULT 1800,
  daily_protein_min SMALLINT DEFAULT 100,
  daily_steps_target INT DEFAULT 8000,
  daily_water_target DECIMAL(3,1) DEFAULT 2.0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_goals_user ON goals(user_id);
CREATE INDEX idx_goals_active ON goals(user_id, is_active) WHERE is_active = TRUE;

-- Weight history (past weight milestones)
CREATE TABLE weight_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  age_at_time SMALLINT,
  weight_kg DECIMAL(5,2) NOT NULL,
  note TEXT,
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX idx_weight_history_user ON weight_history(user_id, recorded_at);

-- Health events (surgery, injury, etc.)
CREATE TABLE health_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  event_date DATE NOT NULL
);

CREATE INDEX idx_health_events_user ON health_events(user_id);

-- Food preferences
CREATE TABLE food_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  food_name TEXT NOT NULL,
  preference TEXT CHECK (preference IN ('love', 'like', 'dislike', 'never')) NOT NULL,
  intolerance BOOLEAN DEFAULT FALSE,
  UNIQUE(user_id, food_name)
);

CREATE INDEX idx_food_prefs_user ON food_preferences(user_id);

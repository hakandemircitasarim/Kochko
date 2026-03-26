-- Meal logs
CREATE TABLE meal_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  raw_input TEXT NOT NULL,
  meal_type TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')) NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_meal_logs_user_date ON meal_logs(user_id, logged_at);

-- Meal log items (parsed from raw_input by AI)
CREATE TABLE meal_log_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_log_id UUID NOT NULL REFERENCES meal_logs(id) ON DELETE CASCADE,
  food_name TEXT NOT NULL,
  portion_text TEXT NOT NULL,
  portion_grams DECIMAL(7,1),
  calories SMALLINT NOT NULL DEFAULT 0,
  protein_g DECIMAL(5,1) NOT NULL DEFAULT 0,
  carbs_g DECIMAL(5,1) NOT NULL DEFAULT 0,
  fat_g DECIMAL(5,1) NOT NULL DEFAULT 0,
  user_corrected BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_meal_items_log ON meal_log_items(meal_log_id);

-- Workout logs
CREATE TABLE workout_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  raw_input TEXT NOT NULL,
  workout_type TEXT NOT NULL DEFAULT '',
  duration_min SMALLINT NOT NULL DEFAULT 0,
  intensity TEXT CHECK (intensity IN ('low', 'moderate', 'high')) DEFAULT 'moderate',
  calories_burned SMALLINT DEFAULT 0,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_workout_logs_user_date ON workout_logs(user_id, logged_at);

-- Daily metrics (weight, water, sleep, steps, mood)
CREATE TABLE daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  weight_kg DECIMAL(5,2),
  water_liters DECIMAL(3,1) DEFAULT 0,
  sleep_hours DECIMAL(3,1),
  steps INT,
  mood_note TEXT,
  synced BOOLEAN DEFAULT TRUE,
  UNIQUE(user_id, date)
);

CREATE INDEX idx_daily_metrics_user_date ON daily_metrics(user_id, date);

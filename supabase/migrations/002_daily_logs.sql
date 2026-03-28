-- Migration 002: All daily logging tables
-- Matches spec sections: 3.1-3.5

-- Meal logs (Spec 3.1)
CREATE TABLE meal_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  raw_input TEXT NOT NULL,
  input_method TEXT CHECK (input_method IN ('text', 'photo', 'barcode', 'voice', 'template', 'ai_chat')) DEFAULT 'text',
  meal_type TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')) NOT NULL,
  cooking_method TEXT, -- 'boiled', 'grilled', 'fried', 'baked', 'raw'
  confidence TEXT CHECK (confidence IN ('high', 'medium', 'low')) DEFAULT 'medium',
  template_id UUID REFERENCES meal_templates(id),
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  logged_for_date DATE NOT NULL DEFAULT CURRENT_DATE, -- supports batch entry (Spec 3.1)
  is_deleted BOOLEAN DEFAULT FALSE, -- soft delete with 10s undo (Spec 3.2)
  deleted_at TIMESTAMPTZ,
  synced BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_meal_logs_user_date ON meal_logs(user_id, logged_for_date);

-- Meal log items (parsed by AI)
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
  alcohol_g DECIMAL(5,1) DEFAULT 0, -- Spec 3.1 alkol kaydı
  data_source TEXT CHECK (data_source IN ('ai_estimate', 'barcode', 'user_correction', 'venue_memory', 'template')) DEFAULT 'ai_estimate',
  user_corrected BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_meal_items_log ON meal_log_items(meal_log_id);

-- Workout logs (Spec 3.1)
CREATE TABLE workout_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  raw_input TEXT NOT NULL,
  workout_type TEXT CHECK (workout_type IN ('cardio', 'strength', 'flexibility', 'sports', 'mixed')) DEFAULT 'mixed',
  duration_min SMALLINT NOT NULL DEFAULT 0,
  intensity TEXT CHECK (intensity IN ('low', 'moderate', 'high')) DEFAULT 'moderate',
  calories_burned SMALLINT DEFAULT 0,
  rpe SMALLINT CHECK (rpe BETWEEN 1 AND 10), -- rate of perceived exertion
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  logged_for_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_deleted BOOLEAN DEFAULT FALSE,
  synced BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_workout_logs_user_date ON workout_logs(user_id, logged_for_date);

-- Strength training sets (Spec 7.5)
CREATE TABLE strength_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_log_id UUID NOT NULL REFERENCES workout_logs(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL, -- 'squat', 'bench_press', 'deadlift', etc.
  set_number SMALLINT NOT NULL,
  reps SMALLINT NOT NULL,
  weight_kg DECIMAL(5,1),
  is_pr BOOLEAN DEFAULT FALSE, -- personal record flag
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_strength_sets_workout ON strength_sets(workout_log_id);

-- Daily metrics (Spec 3.1)
CREATE TABLE daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  weight_kg DECIMAL(5,2),
  water_liters DECIMAL(3,1) DEFAULT 0,
  sleep_hours DECIMAL(3,1),
  sleep_quality TEXT CHECK (sleep_quality IN ('good', 'ok', 'bad')),
  sleep_time TIME,
  wake_time TIME,
  steps INT,
  steps_source TEXT CHECK (steps_source IN ('manual', 'phone', 'wearable')) DEFAULT 'manual',
  mood_score SMALLINT CHECK (mood_score BETWEEN 1 AND 5),
  mood_note TEXT,
  stress_note TEXT,
  recovery_score SMALLINT CHECK (recovery_score BETWEEN 1 AND 5), -- Spec 3.1 toparlanma
  muscle_soreness TEXT CHECK (muscle_soreness IN ('none', 'light', 'moderate', 'severe')),
  synced BOOLEAN DEFAULT TRUE,
  UNIQUE(user_id, date)
);

CREATE INDEX idx_daily_metrics_user_date ON daily_metrics(user_id, date);

-- Supplement logs (Spec 3.1)
CREATE TABLE supplement_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  supplement_name TEXT NOT NULL, -- 'protein_powder', 'creatine', 'vitamin_d', 'omega3', 'bcaa'
  amount TEXT, -- '1 scoop', '5g', '1 tablet'
  calories SMALLINT DEFAULT 0,
  protein_g DECIMAL(5,1) DEFAULT 0,
  carbs_g DECIMAL(5,1) DEFAULT 0,
  fat_g DECIMAL(5,1) DEFAULT 0,
  logged_at TIMESTAMPTZ DEFAULT NOW(),
  logged_for_date DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX idx_supplement_logs_user ON supplement_logs(user_id, logged_for_date);

-- Lab values (Spec 2.1, 3.1)
CREATE TABLE lab_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parameter_name TEXT NOT NULL,
  value DECIMAL(10,3) NOT NULL,
  unit TEXT NOT NULL,
  reference_min DECIMAL(10,3),
  reference_max DECIMAL(10,3),
  measured_at DATE NOT NULL,
  is_out_of_range BOOLEAN GENERATED ALWAYS AS (
    (reference_min IS NOT NULL AND value < reference_min) OR
    (reference_max IS NOT NULL AND value > reference_max)
  ) STORED
);

CREATE INDEX idx_lab_values_user ON lab_values(user_id, measured_at);

-- Progress photos (Spec 3.1 - stored locally, metadata only in DB)
CREATE TABLE progress_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  photo_date DATE NOT NULL,
  angle TEXT CHECK (angle IN ('front', 'side', 'back')),
  storage_path TEXT NOT NULL, -- encrypted storage reference
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_progress_photos_user ON progress_photos(user_id, photo_date);

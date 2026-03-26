-- Lab values (optional clinical data)
CREATE TABLE lab_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parameter_name TEXT NOT NULL,
  value DECIMAL(10,3) NOT NULL,
  unit TEXT NOT NULL,
  reference_min DECIMAL(10,3),
  reference_max DECIMAL(10,3),
  measured_at DATE NOT NULL
);

CREATE INDEX idx_lab_values_user ON lab_values(user_id, measured_at);
CREATE INDEX idx_lab_values_param ON lab_values(user_id, parameter_name);

-- User food scores (AI learning from behavior)
CREATE TABLE user_food_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  food_name TEXT NOT NULL,
  times_suggested INT DEFAULT 0,
  times_followed INT DEFAULT 0,
  preference_score DECIMAL(3,2) DEFAULT 0.50,
  UNIQUE(user_id, food_name)
);

CREATE INDEX idx_food_scores_user ON user_food_scores(user_id);

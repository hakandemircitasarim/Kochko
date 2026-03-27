-- Commitments & reminders (things user said they'd do, AI needs to follow up)
CREATE TABLE user_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  commitment TEXT NOT NULL,       -- "Pazartesi salona baslayacagim"
  follow_up_at TIMESTAMPTZ,       -- when to ask about it
  status TEXT CHECK (status IN ('pending', 'followed_up', 'completed', 'abandoned')) DEFAULT 'pending',
  source_chat_id UUID,            -- which chat message created this
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_commitments_user ON user_commitments(user_id, status);
CREATE INDEX idx_commitments_followup ON user_commitments(follow_up_at) WHERE status = 'pending';

-- Behavior patterns (AI-detected recurring patterns)
CREATE TABLE user_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  pattern_type TEXT NOT NULL,     -- 'night_eating', 'weekend_binge', 'stress_eating', 'skipping_meals', 'exercise_avoidance'
  description TEXT NOT NULL,      -- "Her Cuma aksami fast food yiyor"
  trigger_context TEXT,           -- "is stresi, hafta sonu baslangici"
  frequency TEXT,                 -- "haftada 2-3 kez"
  intervention TEXT,              -- "Cuma oglenden sonra hatirlatma gonder"
  confidence DECIMAL(3,2) DEFAULT 0.60,
  active BOOLEAN DEFAULT TRUE,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  last_occurred TIMESTAMPTZ
);

CREATE INDEX idx_patterns_user ON user_patterns(user_id, active);

-- RLS
ALTER TABLE user_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY commitments_select ON user_commitments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY patterns_select ON user_patterns FOR SELECT USING (auth.uid() = user_id);

-- Migration 003: AI memory system and chat
-- Matches spec section 5.1 (Katmanlı Hafıza Mimarisi)

-- Chat messages (Katman 4 - aktif sohbet)
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id UUID NOT NULL, -- groups messages into sessions
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  task_mode TEXT, -- which AI mode generated this: 'register', 'plan', 'coaching', 'analyst', 'recipe', 'simulation', etc.
  has_photo BOOLEAN DEFAULT FALSE,
  actions_executed JSONB, -- actions that were executed from this message
  token_count SMALLINT, -- track token usage per message
  model_version TEXT, -- AI model version used (Spec 5.25)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_user ON chat_messages(user_id, created_at);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at);

-- Chat sessions (for search and management, Spec 5.17)
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT, -- auto-generated summary
  topic_tags TEXT[], -- for search
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  message_count INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE -- only 1 active per user (Spec 1.3)
);

CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id, started_at);
CREATE INDEX idx_chat_sessions_active ON chat_sessions(user_id, is_active) WHERE is_active = TRUE;

-- AI Summary (Katman 2 - AI'ın öğrendiği kullanıcı özeti, Spec 5.1)
-- This is THE core differentiator
CREATE TABLE ai_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- General user summary (free text, AI-written)
  general_summary TEXT DEFAULT '',

  -- Detected patterns (Spec 5.7)
  behavioral_patterns JSONB DEFAULT '[]',
  -- [{type, description, trigger, frequency, intervention, confidence, last_occurred, detected_at}]

  -- Coaching strategy notes
  coaching_notes TEXT DEFAULT '',

  -- Portion calibration (Spec 5.23)
  portion_calibration JSONB DEFAULT '{}',
  -- {plate_size: 'large', '1_tabak_pilav': 200, '1_dilim_ekmek': 35, ...}

  -- Strength records (1RM, Spec 7.5)
  strength_records JSONB DEFAULT '{}',
  -- {squat: {1rm: 100, last_weight: 85, last_reps: 8}, ...}

  -- Persona/segment (Spec 5.15)
  user_persona TEXT, -- 'weekday_disciplined', 'data_driven', 'motivation_dependent', etc.

  -- Nutrition literacy level (Spec 5.24)
  nutrition_literacy TEXT CHECK (nutrition_literacy IN ('low', 'medium', 'high')) DEFAULT 'medium',

  -- Communication tone learning
  learned_tone_preference TEXT, -- AI's observation of what works

  -- Micro-nutrient risk signals (Spec 5.16)
  micro_nutrient_risks JSONB DEFAULT '[]',
  -- [{nutrient, risk_level, reasoning, suggested_action}]

  -- Alcohol pattern (Spec 5.7)
  alcohol_pattern TEXT,

  -- Caffeine-sleep correlation (Spec 5.20)
  caffeine_sleep_notes TEXT,

  -- Social eating patterns
  social_eating_notes TEXT,

  -- Habit progress (Spec 5.21)
  habit_progress JSONB DEFAULT '[]',
  -- [{habit, status, started_at, streak, stacked_on}]

  -- Features introduced (Spec 5.33, progressive disclosure)
  features_introduced TEXT[] DEFAULT '{}',

  -- Chat repair frequency
  repair_frequency TEXT DEFAULT 'low', -- low/medium/high

  -- TDEE calculation note
  tdee_notes TEXT,

  -- Weekly budget performance pattern
  weekly_budget_pattern TEXT,

  -- Supplement notes
  supplement_notes TEXT,

  -- Recovery pattern
  recovery_pattern TEXT,

  -- Seasonal preferences
  seasonal_notes TEXT,

  -- Menstrual pattern notes
  menstrual_notes TEXT,

  -- Last TDEE calculation details
  last_tdee_weight DECIMAL(5,2),
  last_tdee_date DATE,

  -- Token usage tracking
  token_size_estimate INT DEFAULT 0, -- approximate tokens this summary takes
  max_token_budget INT DEFAULT 13000, -- Katman 2 budget (Spec 5.1)

  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User commitments / promises (Spec: taahhüt takibi)
CREATE TABLE user_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  commitment TEXT NOT NULL,
  follow_up_at TIMESTAMPTZ,
  status TEXT CHECK (status IN ('pending', 'followed_up', 'completed', 'abandoned')) DEFAULT 'pending',
  source_message_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_commitments_user ON user_commitments(user_id, status);
CREATE INDEX idx_commitments_followup ON user_commitments(follow_up_at) WHERE status = 'pending';

-- Coaching messages / proactive nudges (Spec 5.3, 10.1)
CREATE TABLE coaching_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  trigger_type TEXT NOT NULL, -- 'morning_plan', 'meal_reminder', 'night_risk', 'commitment', 'pattern', 'milestone', 'reengagement', etc.
  priority TEXT CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
  read BOOLEAN DEFAULT FALSE,
  push_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_coaching_user ON coaching_messages(user_id, created_at);
CREATE INDEX idx_coaching_unread ON coaching_messages(user_id, read) WHERE read = FALSE;

-- User feedback on AI suggestions (Spec 5.8)
CREATE TABLE ai_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL, -- 'meal_suggestion', 'workout_plan', 'coaching_message', 'recipe'
  context_id UUID, -- reference to the plan/message/recipe
  feedback TEXT CHECK (feedback IN ('helpful', 'not_for_me')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_feedback_user ON ai_feedback(user_id);

-- Chat messages (conversation history)
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_user ON chat_messages(user_id, created_at);

-- User insights (AI-extracted knowledge about the user)
-- This is the CORE differentiator - persistent, structured memory
CREATE TABLE user_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  -- categories: physical, dietary, behavioral, psychological,
  -- lifestyle, medical, preference, goal, social, exercise
  insight TEXT NOT NULL,
  confidence DECIMAL(3,2) DEFAULT 0.80,
  source TEXT, -- 'onboarding', 'chat', 'log_pattern', 'correction'
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_insights_user ON user_insights(user_id, active);
CREATE INDEX idx_user_insights_category ON user_insights(user_id, category);

-- RLS
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_select ON chat_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY chat_insert ON chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY insights_select ON user_insights FOR SELECT USING (auth.uid() = user_id);
-- insights are written by Edge Functions with service key

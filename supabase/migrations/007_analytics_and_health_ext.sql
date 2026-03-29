-- Migration 007: Analytics events + health events extensions
-- Spec 24 (Success Criteria) + Spec 2.1 (Health events body part)

-- Analytics events (Spec 24)
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL, -- auth, log, ai, feature, navigation, premium, guardrail, engagement
  action TEXT NOT NULL,
  label TEXT,
  value NUMERIC,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analytics_user ON analytics_events(user_id);
CREATE INDEX idx_analytics_category ON analytics_events(category, action);
CREATE INDEX idx_analytics_date ON analytics_events(created_at);

-- RLS: users can only see their own events
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own analytics"
  ON analytics_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own analytics"
  ON analytics_events FOR SELECT
  USING (auth.uid() = user_id);

-- Health events extensions (Spec 2.1)
ALTER TABLE health_events ADD COLUMN IF NOT EXISTS affected_body_part TEXT;
ALTER TABLE health_events ADD COLUMN IF NOT EXISTS exercise_restriction BOOLEAN DEFAULT FALSE;

-- Migration 007: Coaching messages table and missing elements

-- Coaching messages for proactive AI nudges (Spec 10.1)
CREATE TABLE IF NOT EXISTS coaching_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content text NOT NULL,
  trigger_type text DEFAULT 'proactive',
  priority text DEFAULT 'medium',
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE coaching_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own coaching messages" ON coaching_messages
  FOR SELECT USING (auth.uid() = user_id);

-- Weekly plans table for meal prep and weekly menu (Spec 7.3)
CREATE TABLE IF NOT EXISTS weekly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  week_start date NOT NULL,
  meal_plan jsonb DEFAULT '[]',
  shopping_list jsonb DEFAULT '[]',
  status text DEFAULT 'draft',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE weekly_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own weekly plans" ON weekly_plans
  FOR ALL USING (auth.uid() = user_id);

-- User venues for restaurant memory (Spec 2.1)
CREATE TABLE IF NOT EXISTS user_venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  venue_name text NOT NULL,
  venue_type text DEFAULT 'restaurant',
  visit_count integer DEFAULT 1,
  learned_items jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, venue_name)
);

ALTER TABLE user_venues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own venues" ON user_venues
  FOR ALL USING (auth.uid() = user_id);

-- Challenges table (Spec 13.5)
CREATE TABLE IF NOT EXISTS challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  challenge_name text NOT NULL,
  challenge_type text DEFAULT 'system',
  target_days integer DEFAULT 7,
  completed_days integer DEFAULT 0,
  status text DEFAULT 'active',
  started_at timestamptz DEFAULT now(),
  paused_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own challenges" ON challenges
  FOR ALL USING (auth.uid() = user_id);

-- AI Feedback table (Spec 5.7)
CREATE TABLE IF NOT EXISTS ai_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  message_id uuid,
  context_type text NOT NULL,
  context_id text,
  feedback_type text NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own feedback" ON ai_feedback
  FOR ALL USING (auth.uid() = user_id);

-- User commitments tracking (Spec 5.5)
CREATE TABLE IF NOT EXISTS user_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  commitment text NOT NULL,
  follow_up_at timestamptz,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE user_commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own commitments" ON user_commitments
  FOR ALL USING (auth.uid() = user_id);

-- Meal templates (Spec 3.4)
CREATE TABLE IF NOT EXISTS meal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  items text NOT NULL,
  total_calories integer DEFAULT 0,
  total_protein_g numeric(6,1) DEFAULT 0,
  use_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE meal_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own templates" ON meal_templates
  FOR ALL USING (auth.uid() = user_id);

-- Saved recipes (Spec 7.7)
CREATE TABLE IF NOT EXISTS saved_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  category text DEFAULT 'dinner',
  ingredients jsonb DEFAULT '[]',
  instructions text DEFAULT '',
  total_calories integer DEFAULT 0,
  total_protein_g numeric(6,1) DEFAULT 0,
  prep_time_min integer DEFAULT 0,
  servings integer DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE saved_recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own recipes" ON saved_recipes
  FOR ALL USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_coaching_messages_user ON coaching_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_challenges_user_active ON challenges(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_commitments_pending ON user_commitments(user_id) WHERE status = 'pending';

-- Enable Row Level Security on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_log_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaching_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_food_scores ENABLE ROW LEVEL SECURITY;

-- Profiles: users can only read/update their own profile
CREATE POLICY profiles_select ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (auth.uid() = id);

-- Goals: full CRUD on own data
CREATE POLICY goals_select ON goals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY goals_insert ON goals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY goals_update ON goals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY goals_delete ON goals FOR DELETE USING (auth.uid() = user_id);

-- Weight history
CREATE POLICY weight_history_select ON weight_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY weight_history_insert ON weight_history FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY weight_history_update ON weight_history FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY weight_history_delete ON weight_history FOR DELETE USING (auth.uid() = user_id);

-- Health events
CREATE POLICY health_events_select ON health_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY health_events_insert ON health_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY health_events_update ON health_events FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY health_events_delete ON health_events FOR DELETE USING (auth.uid() = user_id);

-- Food preferences
CREATE POLICY food_prefs_select ON food_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY food_prefs_insert ON food_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY food_prefs_update ON food_preferences FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY food_prefs_delete ON food_preferences FOR DELETE USING (auth.uid() = user_id);

-- Meal logs
CREATE POLICY meal_logs_select ON meal_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY meal_logs_insert ON meal_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY meal_logs_update ON meal_logs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY meal_logs_delete ON meal_logs FOR DELETE USING (auth.uid() = user_id);

-- Meal log items: access through meal_logs ownership
CREATE POLICY meal_items_select ON meal_log_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM meal_logs WHERE meal_logs.id = meal_log_items.meal_log_id AND meal_logs.user_id = auth.uid()));
CREATE POLICY meal_items_insert ON meal_log_items FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM meal_logs WHERE meal_logs.id = meal_log_items.meal_log_id AND meal_logs.user_id = auth.uid()));
CREATE POLICY meal_items_update ON meal_log_items FOR UPDATE
  USING (EXISTS (SELECT 1 FROM meal_logs WHERE meal_logs.id = meal_log_items.meal_log_id AND meal_logs.user_id = auth.uid()));
CREATE POLICY meal_items_delete ON meal_log_items FOR DELETE
  USING (EXISTS (SELECT 1 FROM meal_logs WHERE meal_logs.id = meal_log_items.meal_log_id AND meal_logs.user_id = auth.uid()));

-- Workout logs
CREATE POLICY workout_logs_select ON workout_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY workout_logs_insert ON workout_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY workout_logs_update ON workout_logs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY workout_logs_delete ON workout_logs FOR DELETE USING (auth.uid() = user_id);

-- Daily metrics
CREATE POLICY daily_metrics_select ON daily_metrics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY daily_metrics_insert ON daily_metrics FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY daily_metrics_update ON daily_metrics FOR UPDATE USING (auth.uid() = user_id);

-- Daily plans (read-only for user, written by Edge Functions with service key)
CREATE POLICY daily_plans_select ON daily_plans FOR SELECT USING (auth.uid() = user_id);

-- Daily reports (read-only for user)
CREATE POLICY daily_reports_select ON daily_reports FOR SELECT USING (auth.uid() = user_id);

-- Weekly reports (read-only for user)
CREATE POLICY weekly_reports_select ON weekly_reports FOR SELECT USING (auth.uid() = user_id);

-- Coaching messages (read + update read flag)
CREATE POLICY coaching_select ON coaching_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY coaching_update ON coaching_messages FOR UPDATE USING (auth.uid() = user_id);

-- Lab values
CREATE POLICY lab_values_select ON lab_values FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY lab_values_insert ON lab_values FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY lab_values_update ON lab_values FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY lab_values_delete ON lab_values FOR DELETE USING (auth.uid() = user_id);

-- User food scores (read-only for user, written by Edge Functions)
CREATE POLICY food_scores_select ON user_food_scores FOR SELECT USING (auth.uid() = user_id);

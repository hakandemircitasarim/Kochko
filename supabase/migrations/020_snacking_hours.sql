-- Snacking hour pattern (Spec 14.2)
-- Weekly extractor populates this array with top 1-2 peak hours (0-23)
-- when user snacks most. ai-proactive then schedules a pre-emptive nudge
-- ~15 minutes before that hour.

ALTER TABLE ai_summary ADD COLUMN IF NOT EXISTS snacking_hours JSONB DEFAULT '[]';

-- Patch ai_summary_merge so passing snacking_hours via patch writes the array
CREATE OR REPLACE FUNCTION ai_summary_merge(p_user_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO ai_summary (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM 1 FROM ai_summary WHERE user_id = p_user_id FOR UPDATE;

  UPDATE ai_summary SET
    general_summary        = COALESCE(p_patch->>'general_summary',        general_summary),
    coaching_notes         = COALESCE(p_patch->>'coaching_notes',         coaching_notes),
    user_persona           = COALESCE(p_patch->>'user_persona',           user_persona),
    nutrition_literacy     = COALESCE(p_patch->>'nutrition_literacy',     nutrition_literacy),
    learned_tone_preference = COALESCE(p_patch->>'learned_tone_preference', learned_tone_preference),
    alcohol_pattern        = COALESCE(p_patch->>'alcohol_pattern',        alcohol_pattern),
    caffeine_sleep_notes   = COALESCE(p_patch->>'caffeine_sleep_notes',   caffeine_sleep_notes),
    seasonal_notes         = COALESCE(p_patch->>'seasonal_notes',         seasonal_notes),
    social_eating_notes    = COALESCE(p_patch->>'social_eating_notes',    social_eating_notes),

    portion_calibration    = COALESCE(portion_calibration,    '{}'::jsonb) || COALESCE(p_patch->'portion_calibration',    '{}'::jsonb),
    strength_records       = COALESCE(strength_records,       '{}'::jsonb) || COALESCE(p_patch->'strength_records',       '{}'::jsonb),
    micro_nutrient_risks   = COALESCE(micro_nutrient_risks,   '{}'::jsonb) || COALESCE(p_patch->'micro_nutrient_risks',   '{}'::jsonb),
    supplement_notes       = COALESCE(supplement_notes,       '{}'::jsonb) || COALESCE(p_patch->'supplement_notes',       '{}'::jsonb),
    extraction_checkpoint  = COALESCE(extraction_checkpoint,  '{}'::jsonb) || COALESCE(p_patch->'extraction_checkpoint',  '{}'::jsonb),

    behavioral_patterns    = COALESCE(p_patch->'behavioral_patterns',    behavioral_patterns),
    habit_progress         = COALESCE(p_patch->'habit_progress',         habit_progress),
    learned_meal_times     = COALESCE(p_patch->'learned_meal_times',     learned_meal_times),
    features_introduced    = COALESCE(p_patch->'features_introduced',    features_introduced),
    onboarding_tasks_completed = COALESCE(p_patch->'onboarding_tasks_completed', onboarding_tasks_completed),
    snacking_hours         = COALESCE(p_patch->'snacking_hours',         snacking_hours),

    updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$;

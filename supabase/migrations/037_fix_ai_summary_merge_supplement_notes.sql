-- 037: Fix ai_summary_merge — supplement_notes is a TEXT column, but the function
-- merged it as jsonb (`COALESCE(supplement_notes,'{}'::jsonb) || ...`). Postgres
-- rejects `COALESCE(text, jsonb)` with 42804 at plan time, so the ENTIRE UPDATE —
-- and thus EVERY ai_summary_merge() call — threw. That silently killed the whole
-- Layer-2 persistent-memory write path (updateLayer2). Treat supplement_notes as
-- the text scalar it is, matching the other text columns. (The 4 genuinely-jsonb
-- columns — portion_calibration, strength_records, micro_nutrient_risks,
-- extraction_checkpoint — keep the jsonb merge.)

CREATE OR REPLACE FUNCTION public.ai_summary_merge(p_user_id uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    supplement_notes       = COALESCE(p_patch->>'supplement_notes',       supplement_notes),

    portion_calibration    = COALESCE(portion_calibration,    '{}'::jsonb) || COALESCE(p_patch->'portion_calibration',    '{}'::jsonb),
    strength_records       = COALESCE(strength_records,       '{}'::jsonb) || COALESCE(p_patch->'strength_records',       '{}'::jsonb),
    micro_nutrient_risks   = COALESCE(micro_nutrient_risks,   '{}'::jsonb) || COALESCE(p_patch->'micro_nutrient_risks',   '{}'::jsonb),
    extraction_checkpoint  = COALESCE(extraction_checkpoint,  '{}'::jsonb) || COALESCE(p_patch->'extraction_checkpoint',  '{}'::jsonb),

    behavioral_patterns    = COALESCE(p_patch->'behavioral_patterns',    behavioral_patterns),
    habit_progress         = COALESCE(p_patch->'habit_progress',         habit_progress),
    learned_meal_times     = COALESCE(p_patch->'learned_meal_times',     learned_meal_times),
    snacking_hours         = COALESCE(p_patch->'snacking_hours',         snacking_hours),

    -- text[] columns: a jsonb-array patch must be converted to text[]; the old
    -- `COALESCE(p_patch->'X'::jsonb, X::text[])` also 42804'd. Keep existing when
    -- the patch key is absent or not an array.
    features_introduced = CASE
      WHEN jsonb_typeof(p_patch->'features_introduced') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'features_introduced'))
      ELSE features_introduced END,
    onboarding_tasks_completed = CASE
      WHEN jsonb_typeof(p_patch->'onboarding_tasks_completed') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'onboarding_tasks_completed'))
      ELSE onboarding_tasks_completed END,

    updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$function$;

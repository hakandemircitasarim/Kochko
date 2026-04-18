-- Atomic merge function for ai_summary table to prevent race conditions
-- during concurrent Layer 2 memory updates from ai-chat, ai-plan, ai-report,
-- ai-proactive, ai-extractor edge functions.
--
-- Why: updateLayer2 previously did check-then-write in JS; parallel invocations
-- could lose writes when top-level JSONB columns were overwritten.
--
-- This function:
--   - Uses SELECT FOR UPDATE to serialize concurrent updates per user
--   - Scalar fields: last-write-wins (acceptable for summaries/persona)
--   - JSONB object fields: deep merge via || operator
--   - JSONB array fields: provided as-is (caller must dedupe if needed)

CREATE OR REPLACE FUNCTION ai_summary_merge(p_user_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create row if missing (idempotent)
  INSERT INTO ai_summary (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock row to serialize concurrent merges
  PERFORM 1 FROM ai_summary WHERE user_id = p_user_id FOR UPDATE;

  UPDATE ai_summary SET
    -- Scalar / text fields: overwrite when patch provides key
    general_summary        = COALESCE(p_patch->>'general_summary',        general_summary),
    coaching_notes         = COALESCE(p_patch->>'coaching_notes',         coaching_notes),
    user_persona           = COALESCE(p_patch->>'user_persona',           user_persona),
    nutrition_literacy     = COALESCE(p_patch->>'nutrition_literacy',     nutrition_literacy),
    learned_tone_preference = COALESCE(p_patch->>'learned_tone_preference', learned_tone_preference),
    alcohol_pattern        = COALESCE(p_patch->>'alcohol_pattern',        alcohol_pattern),
    caffeine_sleep_notes   = COALESCE(p_patch->>'caffeine_sleep_notes',   caffeine_sleep_notes),
    seasonal_notes         = COALESCE(p_patch->>'seasonal_notes',         seasonal_notes),
    social_eating_notes    = COALESCE(p_patch->>'social_eating_notes',    social_eating_notes),

    -- JSONB object fields: deep merge (patch wins on key conflicts)
    portion_calibration    = COALESCE(portion_calibration,    '{}'::jsonb) || COALESCE(p_patch->'portion_calibration',    '{}'::jsonb),
    strength_records       = COALESCE(strength_records,       '{}'::jsonb) || COALESCE(p_patch->'strength_records',       '{}'::jsonb),
    micro_nutrient_risks   = COALESCE(micro_nutrient_risks,   '{}'::jsonb) || COALESCE(p_patch->'micro_nutrient_risks',   '{}'::jsonb),
    supplement_notes       = COALESCE(supplement_notes,       '{}'::jsonb) || COALESCE(p_patch->'supplement_notes',       '{}'::jsonb),
    extraction_checkpoint  = COALESCE(extraction_checkpoint,  '{}'::jsonb) || COALESCE(p_patch->'extraction_checkpoint',  '{}'::jsonb),

    -- JSONB array fields: replace (caller responsible for dedup);
    -- dedicated append helpers below for true concurrent-safe append.
    behavioral_patterns    = COALESCE(p_patch->'behavioral_patterns',    behavioral_patterns),
    habit_progress         = COALESCE(p_patch->'habit_progress',         habit_progress),
    learned_meal_times     = COALESCE(p_patch->'learned_meal_times',     learned_meal_times),
    features_introduced    = COALESCE(p_patch->'features_introduced',    features_introduced),
    onboarding_tasks_completed = COALESCE(p_patch->'onboarding_tasks_completed', onboarding_tasks_completed),

    updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$;

-- Atomic append for behavioral_patterns (avoids read-modify-write race).
-- Callers pass only NEW patterns; function appends and caps at 20 entries.
CREATE OR REPLACE FUNCTION ai_summary_append_patterns(p_user_id uuid, p_new_patterns jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_combined jsonb;
  v_length int;
BEGIN
  -- Ensure row exists
  INSERT INTO ai_summary (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Build concatenated array then cap to last 20 entries
  SELECT COALESCE(behavioral_patterns, '[]'::jsonb) || COALESCE(p_new_patterns, '[]'::jsonb)
    INTO v_combined
    FROM ai_summary WHERE user_id = p_user_id FOR UPDATE;

  v_length := jsonb_array_length(v_combined);

  IF v_length > 20 THEN
    SELECT jsonb_agg(elem ORDER BY idx) INTO v_combined
    FROM (
      SELECT elem, idx FROM jsonb_array_elements(v_combined) WITH ORDINALITY AS t(elem, idx)
      ORDER BY idx DESC LIMIT 20
    ) sub;
  END IF;

  UPDATE ai_summary
  SET behavioral_patterns = v_combined, updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ai_summary_merge(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ai_summary_append_patterns(uuid, jsonb) TO authenticated, service_role;

-- 099: stop ai_summary_merge appending {} to array values — and clean what it left behind.
--
-- FOUND LIVE (2026-07-26 emulator drive — the F0/A0 gate doing its job): the memory-mirror screen
-- showed 25 chips reading "undefined riski — silmek için uzun bas". The chain:
--
--   1. ai_summary.micro_nutrient_risks is an ARRAY value ('[]' default, 003:71) with NO writer
--      anywhere in the codebase.
--   2. ai_summary_merge handled it (and 3 siblings) with
--        COALESCE(col,'{}') || COALESCE(p_patch->'col','{}')
--      When a patch does not carry the key — i.e. on EVERY updateLayer2 call — the right side is
--      '{}', and in Postgres `array || object` APPENDS the object as an element.
--   3. So every merge quietly appended one {} to the array: 16 of 18 users carried [{},{},...].
--      The client maps r.nutrient over those → one phantom "undefined riski" chip per historical
--      merge call.
--
-- The audit's inert-wiring class in its purest form: a reader with no writer, kept warm by a merge
-- operator whose semantics silently differ by JSON type. portion_calibration / strength_records /
-- extraction_checkpoint escape only because their writers always send OBJECTS (object || object =
-- key-merge) — the latent bug is theirs too, so they get the same key-presence guard.
--
-- THE CHANGE IS FOUR LINES. Everything else below is VERBATIM the live definition (including the
-- FOR UPDATE row lock, tdee_notes and onboarding_tasks_completed) — an earlier draft of this
-- migration rewrote the whole function from memory and silently dropped three columns; comparing
-- against pg_get_functiondef caught it. Replace-from-memory is exactly how this repo loses wires.
--
-- DOWN: re-apply the function body from migration 045 (or pg_get_functiondef of the previous
-- version); the data cleanup is one-way but removes only literal '{}' elements.

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
    -- 045: önceden ölü olan Layer-2 sinyalleri
    recovery_pattern       = COALESCE(p_patch->>'recovery_pattern',       recovery_pattern),
    menstrual_notes        = COALESCE(p_patch->>'menstrual_notes',        menstrual_notes),
    weekly_budget_pattern  = COALESCE(p_patch->>'weekly_budget_pattern',  weekly_budget_pattern),
    tdee_notes             = COALESCE(p_patch->>'tdee_notes',             tdee_notes),

    -- 099 FIX: touch these ONLY when the patch carries the key. The unconditional '{}' right-hand
    -- side appended one {} per merge to any array-shaped value.
    portion_calibration    = CASE WHEN p_patch ? 'portion_calibration'   THEN COALESCE(portion_calibration,   '{}'::jsonb) || (p_patch->'portion_calibration')   ELSE portion_calibration   END,
    strength_records       = CASE WHEN p_patch ? 'strength_records'      THEN COALESCE(strength_records,      '{}'::jsonb) || (p_patch->'strength_records')      ELSE strength_records      END,
    micro_nutrient_risks   = CASE WHEN p_patch ? 'micro_nutrient_risks'  THEN p_patch->'micro_nutrient_risks'  ELSE micro_nutrient_risks  END,
    extraction_checkpoint  = CASE WHEN p_patch ? 'extraction_checkpoint' THEN COALESCE(extraction_checkpoint, '{}'::jsonb) || (p_patch->'extraction_checkpoint') ELSE extraction_checkpoint END,

    behavioral_patterns    = COALESCE(p_patch->'behavioral_patterns',    behavioral_patterns),
    habit_progress         = COALESCE(p_patch->'habit_progress',         habit_progress),
    learned_meal_times     = COALESCE(p_patch->'learned_meal_times',     learned_meal_times),
    snacking_hours         = COALESCE(p_patch->'snacking_hours',         snacking_hours),

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

-- DATA CLEANUP: strip the phantom {} elements accumulated so far. Anything real (none exists
-- today — the column has no writer) survives the filter.
UPDATE ai_summary
SET micro_nutrient_risks = COALESCE(
  (SELECT jsonb_agg(e) FROM jsonb_array_elements(micro_nutrient_risks::jsonb) e WHERE e <> '{}'::jsonb),
  '[]'::jsonb
)
WHERE jsonb_typeof(micro_nutrient_risks::jsonb) = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(micro_nutrient_risks::jsonb) e WHERE e = '{}'::jsonb);

SELECT '099 merge array-append fixed + phantom rows cleaned' AS status;

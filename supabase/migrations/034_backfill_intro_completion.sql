-- Migration 034: Backfill introduce_yourself completion for users who completed it
-- before the validation fix in Phase 1.
-- Condition: profile has all 4 core fields (height_cm, weight_kg, birth_year, gender)
-- AND ai_summary.onboarding_tasks_completed doesn't yet include it.

INSERT INTO ai_summary (user_id, onboarding_tasks_completed)
SELECT p.id, ARRAY['introduce_yourself']
FROM profiles p
LEFT JOIN ai_summary s ON s.user_id = p.id
WHERE p.height_cm IS NOT NULL
  AND p.weight_kg IS NOT NULL
  AND p.birth_year IS NOT NULL
  AND p.gender IS NOT NULL
  AND s.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- For users who already have an ai_summary row but don't have the task key.
UPDATE ai_summary s
SET onboarding_tasks_completed =
  CASE
    WHEN onboarding_tasks_completed IS NULL THEN ARRAY['introduce_yourself']
    WHEN NOT ('introduce_yourself' = ANY(onboarding_tasks_completed)) THEN
      onboarding_tasks_completed || ARRAY['introduce_yourself']
    ELSE onboarding_tasks_completed
  END
FROM profiles p
WHERE p.id = s.user_id
  AND p.height_cm IS NOT NULL
  AND p.weight_kg IS NOT NULL
  AND p.birth_year IS NOT NULL
  AND p.gender IS NOT NULL
  AND (onboarding_tasks_completed IS NULL OR NOT ('introduce_yourself' = ANY(onboarding_tasks_completed)));

-- Same backfill pattern for set_goal: users with an active goal row get credit.
UPDATE ai_summary s
SET onboarding_tasks_completed =
  CASE
    WHEN onboarding_tasks_completed IS NULL THEN ARRAY['set_goal']
    WHEN NOT ('set_goal' = ANY(onboarding_tasks_completed)) THEN
      onboarding_tasks_completed || ARRAY['set_goal']
    ELSE onboarding_tasks_completed
  END
FROM goals g
WHERE g.user_id = s.user_id
  AND g.is_active = true
  AND g.goal_type IS NOT NULL
  AND (onboarding_tasks_completed IS NULL OR NOT ('set_goal' = ANY(onboarding_tasks_completed)));

NOTIFY pgrst, 'reload schema';

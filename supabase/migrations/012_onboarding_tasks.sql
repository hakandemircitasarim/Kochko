-- Add onboarding_tasks_completed column to ai_summary
-- Tracks which onboarding conversation tasks the user has completed
ALTER TABLE ai_summary
ADD COLUMN IF NOT EXISTS onboarding_tasks_completed TEXT[] DEFAULT '{}';

-- Weekly plan approval workflow (Spec 7.3)
-- User can approve the AI-generated weekly menu or request modifications.
-- approved_at is set when user confirms; modification_request holds the
-- free-text reason when user taps "Şunu değiştir" so the next regeneration
-- knows what to change.

ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS modification_request TEXT;
ALTER TABLE weekly_plans ADD COLUMN IF NOT EXISTS revision_count SMALLINT DEFAULT 0;

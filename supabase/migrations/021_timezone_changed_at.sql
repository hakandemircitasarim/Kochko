-- Jet lag grace tracking (Spec 15.1)
-- Server records the timestamp when a user's active_timezone changes so the
-- AI context can scope the "48h grace" window precisely instead of firing
-- whenever offset >= 2. Before this, grace was sticky forever.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timezone_changed_at TIMESTAMPTZ;

-- Active session registry (Spec 16.4 multi-device management)
-- Each device/app instance writes a row on startup with basic info. Users can
-- view + remotely terminate these from the account-security screen.
--
-- Note: This is a lightweight app-session registry — NOT Supabase auth.sessions.
-- Deleting a row here does NOT sign the device out of Supabase; for remote
-- logout we invalidate the local push_token and the client polls this row;
-- on missing row, the client signs out on next foreground.

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_info TEXT NOT NULL DEFAULT 'Bilinmeyen cihaz',
  app_version TEXT,
  push_token TEXT,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
  ON user_sessions(user_id, last_active_at DESC);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_sessions_sel ON user_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_sessions_ins ON user_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_sessions_upd ON user_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY user_sessions_del ON user_sessions FOR DELETE USING (auth.uid() = user_id);

-- Prune rows inactive >30 days: cron daily
SELECT cron.schedule(
  'kochko-user-sessions-prune',
  '0 4 * * *',
  $$
  DELETE FROM user_sessions WHERE last_active_at < NOW() - INTERVAL '30 days';
  $$
);

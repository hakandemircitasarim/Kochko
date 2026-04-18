-- Account hard-delete cron (Spec 18.1 KVKK/GDPR 30-day grace)
-- When profiles.deletion_requested_at is set >30 days ago and not cancelled,
-- daily cron hard-deletes: profile (CASCADE wipes logs/chats/summaries/photos via FKs),
-- all auth.users row so email/password is cleared from Supabase auth.

-- Postgres function: find expired grace rows, delete them + return count.
CREATE OR REPLACE FUNCTION execute_pending_account_deletions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_user UUID;
  v_count INTEGER := 0;
BEGIN
  FOR v_expired_user IN
    SELECT id FROM profiles
    WHERE deletion_requested_at IS NOT NULL
      AND deletion_requested_at < NOW() - INTERVAL '30 days'
  LOOP
    -- DELETE from profiles cascades to all user-owned rows via FK ON DELETE CASCADE
    DELETE FROM profiles WHERE id = v_expired_user;

    -- Also remove the auth.users row (Supabase auth schema) so email can be re-registered.
    -- Requires DELETE privilege on auth.users for the function owner.
    DELETE FROM auth.users WHERE id = v_expired_user;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Daily cron at 03:00 UTC (06:00 TR) — off-peak for any accidental last-minute cancellations
SELECT cron.schedule(
  'kochko-account-hard-delete',
  '0 3 * * *',
  $$
  SELECT execute_pending_account_deletions();
  $$
);

GRANT EXECUTE ON FUNCTION execute_pending_account_deletions() TO service_role;

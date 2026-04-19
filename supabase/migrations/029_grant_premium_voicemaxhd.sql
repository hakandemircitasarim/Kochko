-- One-shot: grant lifetime premium to voicemaxhd@gmail.com (developer/test account).
-- expires_at = NULL means never expires (trigger checks: expires_at IS NULL OR expires_at > NOW()).
-- ON CONFLICT avoids breaking re-runs; idx_subscriptions_user_active is unique per active user.

INSERT INTO subscriptions (user_id, tier, status, provider, started_at, expires_at)
SELECT u.id, 'lifetime', 'active', 'manual', NOW(), NULL
FROM auth.users u
WHERE u.email = 'voicemaxhd@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.user_id = u.id
      AND s.status IN ('active', 'trial', 'grace_period')
  );

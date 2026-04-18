-- Premium subscriptions registry (Spec 19.0)
-- Stores authoritative subscription state from RevenueCat webhooks. The
-- `profiles.premium` boolean is kept in sync via trigger so existing code paths
-- that read it keep working, but this table is the source of truth.

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('free', 'trial', 'monthly', 'yearly', 'lifetime')),
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'cancelled', 'grace_period', 'paused')),
  provider TEXT CHECK (provider IN ('revenuecat', 'app_store', 'play_store', 'stripe', 'manual')),
  provider_user_id TEXT,
  product_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  renewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  raw_receipt JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_active
  ON subscriptions(user_id) WHERE status IN ('active', 'trial', 'grace_period');
CREATE INDEX IF NOT EXISTS idx_subscriptions_expires ON subscriptions(expires_at);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_sel ON subscriptions FOR SELECT USING (auth.uid() = user_id);
-- Inserts/updates via service role only (RevenueCat webhook / server code)

-- Keep profiles.premium in sync with active subscription rows (trigger)
CREATE OR REPLACE FUNCTION sync_profile_premium()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_premium BOOLEAN;
  v_expires TIMESTAMPTZ;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM subscriptions
    WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
      AND status IN ('active', 'grace_period')
      AND tier IN ('trial', 'monthly', 'yearly', 'lifetime')
      AND (expires_at IS NULL OR expires_at > NOW())
  ) INTO v_premium;

  SELECT MAX(expires_at) INTO v_expires
  FROM subscriptions
  WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
    AND status IN ('active', 'grace_period');

  UPDATE profiles
  SET premium = v_premium, premium_expires_at = v_expires
  WHERE id = COALESCE(NEW.user_id, OLD.user_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tg_sync_profile_premium ON subscriptions;
CREATE TRIGGER tg_sync_profile_premium
  AFTER INSERT OR UPDATE OR DELETE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION sync_profile_premium();

-- Nightly expiry flip: expired subs → 'expired', premium=false
CREATE OR REPLACE FUNCTION expire_stale_subscriptions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE subscriptions
  SET status = 'expired', updated_at = NOW()
  WHERE status IN ('active', 'grace_period')
    AND expires_at IS NOT NULL
    AND expires_at < NOW() - INTERVAL '1 day';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

SELECT cron.schedule(
  'kochko-subscription-expire',
  '15 3 * * *', -- daily at 03:15 UTC
  $$ SELECT expire_stale_subscriptions(); $$
);

GRANT EXECUTE ON FUNCTION expire_stale_subscriptions() TO service_role;

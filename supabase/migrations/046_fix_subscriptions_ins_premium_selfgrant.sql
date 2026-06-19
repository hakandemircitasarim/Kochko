-- 046: subscriptions INSERT politikası premium kendi-kendine-verme açığını kapat (CRITICAL)
--
-- 045'te eklenen subscriptions_ins politikası yalnız user_id'yi kontrol ediyordu;
-- tier/status/expires_at/provider serbestti. Herhangi bir authenticated kullanıcı
-- {tier:'lifetime', status:'active', expires_at:'2099-...'} insert edip
-- tg_sync_profile_premium trigger'ı üzerinden profiles.premium=true yapabiliyordu
-- (ücretsiz ÖMÜR BOYU premium). 038 koruması bunu engellemiyor çünkü trigger
-- SECURITY DEFINER (current_user='postgres').
--
-- Çözüm: client INSERT'ini YALNIZ deneme (trial) satırına daralt — ücretli tier'lar
-- ve uzak-gelecek expiry yasak. Ücretli abonelikler yalnız ödeme sağlayıcısı/webhook
-- (service_role, RLS'i baypas eder) tarafından yazılır. startTrialIfEligible() bu
-- politikayla çalışmaya devam eder.
--
-- NOT: app/settings/premium.tsx'in dev-mode "satın al" düğmesi (manual+monthly/yearly
-- insert) artık RLS ile bloklanır — bu DOĞRU davranıştır (gerçek IAP gelene kadar
-- premium yalnız service_role ile verilir; test hesabı zaten premium). Mevcut
-- manual/lifetime satırlarına dokunulmaz (politika yalnız YENİ insert'leri etkiler).
DROP POLICY IF EXISTS subscriptions_ins ON public.subscriptions;
CREATE POLICY subscriptions_ins ON public.subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND tier = 'trial'
    AND status = 'active'
    AND provider = 'manual'
    AND expires_at IS NOT NULL
    AND expires_at <= now() + interval '8 days'
  );

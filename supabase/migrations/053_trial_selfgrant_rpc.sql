-- 053: Sınırsız ücretsiz premium açığını kapat — trial self-grant (HIGH/gelir-engelleyici)
--
-- AMAÇ: Canlı subscriptions_ins WITH CHECK politikası profiles.trial_used kontrolü
-- YAPMIYOR; tek koruma idx_subscriptions_user_active kısmi UNIQUE index'i ('expired'
-- kapsam dışı). Deneme bitince index boşalır → PostgREST üzerinden her 8 günde yeni
-- trial satırı INSERT edilip tg_sync_profile_premium ile sınırsız ücretsiz premium
-- elde edilebilir. trial_used gate'i yalnız client'ta ve INSERT'le ATOMİK değildi.
--
-- ÇÖZÜM (iki katmanlı):
--   (1) Doğrudan trial INSERT politikasını KALDIR (client artık trial INSERT yapmaz).
--   (2) start_trial_if_eligible(uid) SECURITY DEFINER RPC: tek transaction'da profiles
--       satırını FOR UPDATE kilitle, trial_used ise reddet, aktif sub varsa reddet,
--       aksi halde trial satırı INSERT + profiles.trial_used=true UPDATE birlikte yap.
--   (3) Defense-in-depth: subscriptions BEFORE INSERT trigger — trial reuse'u DB'de bloke et.
--
-- Idempotent: DROP POLICY/TRIGGER IF EXISTS + CREATE OR REPLACE FUNCTION.
-- Geri-alma: trigger+function DROP, eski subscriptions_ins politikasını yeniden CREATE.

-- FIX (audit DB/HIGH — trial INSERT politikası trial_used kontrolü yapmıyor: sınırsız self-grant)
DROP POLICY IF EXISTS subscriptions_ins ON public.subscriptions;

CREATE OR REPLACE FUNCTION public.start_trial_if_eligible(uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  used boolean;
  act  int;
BEGIN
  -- Yalnız kullanıcı kendi denemesini başlatabilir.
  IF uid <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Satırı kilitle: trial_used kontrolü + işaretleme yarış-durumsuz olsun.
  SELECT trial_used INTO used FROM public.profiles WHERE id = uid FOR UPDATE;
  IF used THEN
    RETURN jsonb_build_object('started', false, 'reason', 'trial_already_used');
  END IF;

  -- Zaten aktif/deneme/grace bir abonelik varsa yeni deneme açma.
  SELECT count(*) INTO act
  FROM public.subscriptions
  WHERE user_id = uid AND status IN ('active', 'trial', 'grace_period');
  IF act > 0 THEN
    RETURN jsonb_build_object('started', false, 'reason', 'already_active');
  END IF;

  INSERT INTO public.subscriptions (user_id, tier, status, provider, started_at, expires_at)
    VALUES (uid, 'trial', 'active', 'manual', now(), now() + interval '7 days');
  UPDATE public.profiles SET trial_used = true WHERE id = uid;

  RETURN jsonb_build_object('started', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_trial_if_eligible(uuid) TO authenticated;

-- Defense-in-depth: kullanılmış denemeyi DB seviyesinde de engelle (service_role webhook'ları
-- ücretli tier yazdığından yalnız tier='trial' kapsanır).
CREATE OR REPLACE FUNCTION public.tg_block_trial_reuse()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tier = 'trial'
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id AND trial_used) THEN
    RAISE EXCEPTION 'trial_already_used';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_trial_reuse ON public.subscriptions;
CREATE TRIGGER trg_block_trial_reuse
  BEFORE INSERT ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_trial_reuse();

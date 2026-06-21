-- 072: SECURITY DEFINER execute-grant sertleştirmesi (CRITICAL/HIGH — audit 2026-06-21 DB-FUN-01/02)
--
-- AMAÇ: 057 ve 053'teki SECURITY DEFINER RPC'ler PostgreSQL'in default PUBLIC EXECUTE
-- grant'ini REVOKE ETMEDİĞİ için anon/authenticated rolleri bunları PostgREST /rpc/ ucu
-- üzerinden DOĞRUDAN çağırabiliyor. Fonksiyonlar p_user/uid parametresine güvenip onu
-- auth.uid() ile (doğru biçimde) karşılaştırmadığından ve SECURITY DEFINER olarak RLS'i
-- bypass ettiğinden:
--   * set_active_goal / project_daily_plans / promote_weekly_plan → herhangi bir kullanıcı
--     p_user'a BAŞKASININ id'sini geçip o kullanıcının hedeflerini/günlük planlarını
--     silebilir/ezebilir (çapraz-kullanıcı veri imhası — CRITICAL DB-FUN-01).
--   * start_trial_if_eligible → guard'ı `uid <> auth.uid()`; anon'da auth.uid()=NULL olduğundan
--     `uid <> NULL` = NULL (falsy) → guard bypass; anon keyfi kullanıcıya trial verebilir/yakabilir
--     (kimliksiz trial-grant — HIGH DB-FUN-02).
--
-- Canlı ACL doğrulaması (audit anı): dördünün de proacl'ında `=X` (PUBLIC) + anon=X + authenticated=X.
-- Çağıran doğrulaması (grep): üç atomik-yazım RPC'sini YALNIZ ai-chat supabaseAdmin (service_role)
-- çağırıyor; start_trial_if_eligible'ı subscription.service.ts (authenticated client) çağırıyor.
--
-- ÇÖZÜM:
--   (1) Üç server-side-only RPC: REVOKE EXECUTE FROM PUBLIC, anon, authenticated (service_role kalır).
--   (2) start_trial_if_eligible: authenticated korunur AMA PUBLIC+anon revoke edilir VE NULL-bypass
--       guard'ı düzeltilir (auth.uid() IS NULL açıkça reddedilir).
--
-- Idempotent: REVOKE yoksa no-op; CREATE OR REPLACE FUNCTION. Geri-alma: aşağıdaki REVOKE'ları
-- GRANT'a çevir (eski gevşek durum — ÖNERİLMEZ).

-- (1) Server-side-only atomik yazım RPC'leri — yalnız service_role çağırabilsin
REVOKE EXECUTE ON FUNCTION public.set_active_goal(uuid, jsonb)                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.project_daily_plans(uuid, date, date, jsonb)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promote_weekly_plan(uuid, text, uuid, jsonb)       FROM PUBLIC, anon, authenticated;

-- service_role grant'ini garantiye al (057'de vardı; idempotent tekrar)
GRANT EXECUTE ON FUNCTION public.set_active_goal(uuid, jsonb)                         TO service_role;
GRANT EXECUTE ON FUNCTION public.project_daily_plans(uuid, date, date, jsonb)         TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_weekly_plan(uuid, text, uuid, jsonb)         TO service_role;

-- (2) start_trial_if_eligible: NULL-bypass guard düzeltmesi + PUBLIC/anon revoke (authenticated kalır)
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
  -- FIX (audit DB-FUN-02): auth.uid() NULL iken `uid <> auth.uid()` = NULL (falsy) olduğundan
  -- anon guard'ı bypass ediyordu. NULL kimliği açıkça reddet — yalnız kullanıcı kendi denemesini açar.
  IF auth.uid() IS NULL OR uid <> auth.uid() THEN
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

REVOKE EXECUTE ON FUNCTION public.start_trial_if_eligible(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_trial_if_eligible(uuid) TO authenticated;

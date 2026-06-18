-- 045: Gece otonom denetim turunun DB-katmanı düzeltmeleri (2026-06-19)
-- 8-boyutlu canlı denetimde adversarial olarak doğrulanan 21 bulgunun DB kısmı.

-- ── (1, CRITICAL) subscriptions: client INSERT politikası yoktu → 7 günlük deneme
--     HİÇ başlamıyordu. startTrialIfEligible() (onboarding sonu) trial satırını
--     insert ederken RLS 403 veriyor, fonksiyon trial_used=true set etmeden dönüyor,
--     tg_sync_profile_premium hiç tetiklenmiyordu. 14 onboarding'i biten kullanıcının
--     0'ında trial vardı. RevenueCat yenileme yolu service-role olduğundan UPDATE
--     gerekmez; yalnız kullanıcının kendi satırını eklemesine izin ver.
DROP POLICY IF EXISTS subscriptions_ins ON public.subscriptions;
CREATE POLICY subscriptions_ins ON public.subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ── (2, CRITICAL) ai_summary_merge / ai_summary_append_patterns SECURITY DEFINER
--     fonksiyonları p_user_id'yi keyfi alıyor, auth.uid() kontrolü yok ve EXECUTE
--     anon+authenticated'a açıktı → herhangi bir kullanıcı başkasının AI hafızasını
--     (persona, coaching_notes, behavioral_patterns...) rpc ile EZEBİLİRDİ. Bu
--     fonksiyonlar yalnız edge function'lardan service-role ile çağrılıyor; client
--     erişimini tamamen kaldır (service_role grant'ı korunur).
-- NOT: fonksiyon EXECUTE'u varsayılan olarak PUBLIC'e grant'lidir; yalnız anon/
-- authenticated'tan revoke yetmez (PUBLIC grant'ı kalır). PUBLIC'ten revoke edip
-- service_role'e açıkça yeniden grant ver.
REVOKE EXECUTE ON FUNCTION public.ai_summary_merge(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_summary_append_patterns(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_summary_merge(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_summary_append_patterns(uuid, jsonb) TO service_role;

-- ── (3, HIGH) ai_summary'de UPDATE politikası yoktu → client KVKK "unutma"/koç-hafıza
--     temizleme (privacy.service resetAISummary/deleteAISummaryNote, coach-memory
--     "KVKK Madde 17" butonu) RLS ile SESSİZCE 0 satır etkiliyor (PostgREST 403 değil
--     başarı dönüyor), kullanıcı sildim sanıyordu — KVKK Madde 17 ihlali. Kullanıcının
--     yalnız kendi satırını güncellemesine izin ver.
DROP POLICY IF EXISTS ai_summary_upd ON public.ai_summary;
CREATE POLICY ai_summary_upd ON public.ai_summary
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── (16, LOW) is_owner: şemadaki tek SET search_path'siz SECURITY DEFINER fonksiyon;
--     sömürülebilir değil ama diğer tüm definer fonksiyonlarla tutarlılık için sabitle.
ALTER FUNCTION public.is_owner(uuid) SET search_path = public;

-- ── (10, MEDIUM) Layer-2 sinyalleri recovery_pattern / menstrual_notes /
--     weekly_budget_pattern / tdee_notes buildLayer2'de OKUNUYOR ama merge RPC
--     whitelist'inde yoktu → bir yazıcı bunları emit etse bile COALESCE'a düşmediği
--     için sessizce kaybolurdu. Whitelist'e ekle (deterministik yazıcılar ai-proactive/
--     ai-chat'e eklendi: recovery_pattern + weekly_budget_pattern + tdee_notes).
CREATE OR REPLACE FUNCTION public.ai_summary_merge(p_user_id uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO ai_summary (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM 1 FROM ai_summary WHERE user_id = p_user_id FOR UPDATE;

  UPDATE ai_summary SET
    general_summary        = COALESCE(p_patch->>'general_summary',        general_summary),
    coaching_notes         = COALESCE(p_patch->>'coaching_notes',         coaching_notes),
    user_persona           = COALESCE(p_patch->>'user_persona',           user_persona),
    nutrition_literacy     = COALESCE(p_patch->>'nutrition_literacy',     nutrition_literacy),
    learned_tone_preference = COALESCE(p_patch->>'learned_tone_preference', learned_tone_preference),
    alcohol_pattern        = COALESCE(p_patch->>'alcohol_pattern',        alcohol_pattern),
    caffeine_sleep_notes   = COALESCE(p_patch->>'caffeine_sleep_notes',   caffeine_sleep_notes),
    seasonal_notes         = COALESCE(p_patch->>'seasonal_notes',         seasonal_notes),
    social_eating_notes    = COALESCE(p_patch->>'social_eating_notes',    social_eating_notes),
    supplement_notes       = COALESCE(p_patch->>'supplement_notes',       supplement_notes),
    -- 045: önceden ölü olan Layer-2 sinyalleri
    recovery_pattern       = COALESCE(p_patch->>'recovery_pattern',       recovery_pattern),
    menstrual_notes        = COALESCE(p_patch->>'menstrual_notes',        menstrual_notes),
    weekly_budget_pattern  = COALESCE(p_patch->>'weekly_budget_pattern',  weekly_budget_pattern),
    tdee_notes             = COALESCE(p_patch->>'tdee_notes',             tdee_notes),

    portion_calibration    = COALESCE(portion_calibration,    '{}'::jsonb) || COALESCE(p_patch->'portion_calibration',    '{}'::jsonb),
    strength_records       = COALESCE(strength_records,       '{}'::jsonb) || COALESCE(p_patch->'strength_records',       '{}'::jsonb),
    micro_nutrient_risks   = COALESCE(micro_nutrient_risks,   '{}'::jsonb) || COALESCE(p_patch->'micro_nutrient_risks',   '{}'::jsonb),
    extraction_checkpoint  = COALESCE(extraction_checkpoint,  '{}'::jsonb) || COALESCE(p_patch->'extraction_checkpoint',  '{}'::jsonb),

    behavioral_patterns    = COALESCE(p_patch->'behavioral_patterns',    behavioral_patterns),
    habit_progress         = COALESCE(p_patch->'habit_progress',         habit_progress),
    learned_meal_times     = COALESCE(p_patch->'learned_meal_times',     learned_meal_times),
    snacking_hours         = COALESCE(p_patch->'snacking_hours',         snacking_hours),

    features_introduced = CASE
      WHEN jsonb_typeof(p_patch->'features_introduced') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'features_introduced'))
      ELSE features_introduced END,
    onboarding_tasks_completed = CASE
      WHEN jsonb_typeof(p_patch->'onboarding_tasks_completed') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'onboarding_tasks_completed'))
      ELSE onboarding_tasks_completed END,

    updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$function$;

-- merge yeniden tanımlandığı için EXECUTE grant'larını yeniden temizle (CREATE OR
-- REPLACE mevcut grant'ları korur ama emniyet için tekrar PUBLIC'ten revoke et).
REVOKE EXECUTE ON FUNCTION public.ai_summary_merge(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_summary_merge(uuid, jsonb) TO service_role;

-- 077: DB MEDIUM/LOW sertleştirme (audit 2026-06-21 — DB-FK-01 / DB-FUN-03 / DB-PRM-02 / DB-MIG-01)
--
-- NOT: Bu bulgular audit'te geçmiş migration dosyalarına atfedilmişti; geçmiş (uygulanmış)
-- migration'ları düzenlemek canlıyı DEĞİŞTİRMEZ. Canlı-etkili düzeltmeler YENİ migration olarak burada.

-- DB-FK-01 (LOW): user_commitments.source_message_id'ye FK yoktu → chat_message silinince dangling
-- referans riski. Kolon şu an ölü (0 satır, hiçbir yazıcı yok) ama latent boşluk. ON DELETE SET NULL
-- (CASCADE DEĞİL — chat mesajı silinince commitment kalmalı, yalnız anlamsız link düşmeli).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_commitments'::regclass
      AND conname = 'user_commitments_source_message_id_fkey'
  ) THEN
    ALTER TABLE public.user_commitments
      ADD CONSTRAINT user_commitments_source_message_id_fkey
      FOREIGN KEY (source_message_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL;
  END IF;
END $$;

-- DB-FUN-03 (LOW): promote_weekly_plan subtype lookup'ını AYNI kullanıcıya kapsamla — yabancı bir
-- draft'ın sızdırılan plan_subtype'ı p_user'ın hangi aktif planının arşivleneceğini seçemesin
-- (subtype oracle). Draft p_user'a ait değilse hiç çalışma (RETURN NULL). (Etki zaten mig 072
-- REVOKE'uyla kapı altında — bu defense-in-depth.)
CREATE OR REPLACE FUNCTION public.promote_weekly_plan(p_user uuid, p_plan_type text, p_draft_id uuid, p_snapshot jsonb DEFAULT NULL::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_subtype text;
BEGIN
  -- FIX (audit DB-FUN-03): user-scoped subtype lookup + bail if the draft isn't p_user's.
  SELECT plan_subtype INTO v_subtype FROM public.weekly_plans WHERE id = p_draft_id AND user_id = p_user;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Yalnız AYNI alt-türdeki aktif satırı arşivle (core promote → menü satırına dokunma).
  UPDATE public.weekly_plans
  SET status = 'archived', archived_reason = 'superseded', superseded_by = p_draft_id
  WHERE user_id = p_user
    AND plan_type = p_plan_type
    AND status = 'active'
    AND COALESCE(plan_subtype, 'core') = COALESCE(v_subtype, 'core');

  UPDATE public.weekly_plans
  SET status = 'active', approved_at = now(), approval_snapshot = p_snapshot
  WHERE id = p_draft_id AND user_id = p_user
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- CREATE OR REPLACE grant'ları korur; yine de mig 072'nin kilidini garantiye al.
REVOKE EXECUTE ON FUNCTION public.promote_weekly_plan(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promote_weekly_plan(uuid, text, uuid, jsonb) TO service_role;

-- DB-PRM-02 (LOW): profiles.daily_msg_count ölü + yanıltıcı yorumlu + entitlement-koruması dışı
-- (client serbestçe yazabiliyordu). Hiçbir tüketici okumuyor/yazmıyor (grep + canlı doğrulandı);
-- yetkili günlük cap chat_messages satır-sayımıyla hesaplanıyor (shared/rate-limit.ts). Düşür.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS daily_msg_count;

-- DB-MIG-01 (MEDIUM): migration 014'ün 3 öksüz ai-proactive job'ı hiç unschedule edilmemişti →
-- temiz DB reset'te 4 proaktif job (3 eski header'sız + yeni saatlik) oluşurdu. Koşullu unschedule
-- ile zincir tek 'kochko-proactive-hourly'ye yakınsar (canlıda zaten yoklar → no-op, replay-safe).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='kochko-proactive-morning')   THEN PERFORM cron.unschedule('kochko-proactive-morning');   END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='kochko-proactive-afternoon') THEN PERFORM cron.unschedule('kochko-proactive-afternoon'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='kochko-proactive-evening')   THEN PERFORM cron.unschedule('kochko-proactive-evening');   END IF;
END $$;

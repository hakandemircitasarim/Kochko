-- 111: ai_turn_log v2 — aşama başına satır, karar ve gölge yükleri + 30 günlük saklama.
--
-- NEDEN (AI_MIMARI_V2 §3.2 T9, §7.4, §10 Faz 1-2): v2 turu Stage A (anla), onarım, Stage B (konuş),
-- sınıflandırıcı ve yargıç gibi AŞAMALARDAN oluşur. Gölgede (Faz 2) Stage A kararı v1'in gerçekten
-- uyguladığı aksiyonlarla karşılaştırılır; v1/v2 güvenlik ihlal oranları pipeline'a göre bölünür.
-- Bunların hepsi tek tabloda, aynı turn_id ile bağlı satırlardır.
--
-- SÜTUNLAR (hepsi eklemeli, NULL'a izinli; eski yazıcı/okuyucu etkilenmez):
--   pipeline       'v1' | 'v2' | 'v2_shadow'   (scenarios.mjs ve v2-shadow-diff bunu böler)
--   stage          'understand' | 'repair' | 'coach' | 'plan' | 'classifier' | 'judge' | 'tripwire' |
--                  'undo_fast' | 'commit'  (CHECK yok: yeni aşama migrasyon istemesin; TS tipi sınırlar)
--   turn_id        turn_writes / chat_messages ile aynı tur kimliği
--   schema_version kayıt şemasının sürümü ('kochko_understand_v1' …)
--   decision       Stage A kararı (strict json_schema çıktısı) — SAĞLIK VERİSİ, 30 gün
--   issues         validator bulguları [{code, path, outcome: commit|flag|ask|reject}] — 30 gün
--   repaired       tek onarım çağrısı yapıldı mı
--   v1_actions     gölgede v1'in uyguladığı aksiyonlar (karşılaştırma için) — 30 gün
--   turn_input     YALNIZ test hesapları / rıza: o turun TurnInput anlık görüntüsü (fixture adayı) — 30 gün
--   payload_purged_at saklama süpürmesinin yükü sildiği an (satır maliyet/gecikme için kalır)
--
-- SAKLAMA (sahip kararı 2026-10-06: karar/gölge kayıtları 30 gün): v2_retention_sweep() her gece
-- decision/issues/v1_actions/turn_input yüklerini NULL'lar (token/gecikme sayıları kalır), hesabı
-- silinmiş kullanıcıların (user_id NULL) yükünü HEMEN siler, süresi dolan bekletmeleri 'expired'
-- yapar ve 30 günden eski kapanmış bekletmeleri siler. pg_cron yoksa (dal veritabanı) zamanlama atlanır
-- ve NOTICE düşer; fonksiyon elle çağrılabilir.
--
-- DOWN:
--   SELECT cron.unschedule('kochko-v2-retention');  -- varsa
--   DROP FUNCTION IF EXISTS public.v2_retention_sweep(integer);
--   DROP INDEX IF EXISTS idx_ai_turn_log_turn, idx_ai_turn_log_pipeline, idx_ai_turn_log_payload_retention;
--   ALTER TABLE ai_turn_log DROP COLUMN IF EXISTS pipeline, DROP COLUMN IF EXISTS stage, DROP COLUMN IF EXISTS turn_id,
--     DROP COLUMN IF EXISTS schema_version, DROP COLUMN IF EXISTS decision, DROP COLUMN IF EXISTS issues,
--     DROP COLUMN IF EXISTS repaired, DROP COLUMN IF EXISTS v1_actions, DROP COLUMN IF EXISTS turn_input,
--     DROP COLUMN IF EXISTS payload_purged_at;

ALTER TABLE public.ai_turn_log ADD COLUMN IF NOT EXISTS pipeline          text;
ALTER TABLE public.ai_turn_log ADD COLUMN IF NOT EXISTS stage             text;
ALTER TABLE public.ai_turn_log ADD COLUMN IF NOT EXISTS turn_id           uuid;
ALTER TABLE public.ai_turn_log ADD COLUMN IF NOT EXISTS schema_version    text;
ALTER TABLE public.ai_turn_log ADD COLUMN IF NOT EXISTS decision          jsonb;
ALTER TABLE public.ai_turn_log ADD COLUMN IF NOT EXISTS issues            jsonb;
ALTER TABLE public.ai_turn_log ADD COLUMN IF NOT EXISTS repaired          boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_turn_log ADD COLUMN IF NOT EXISTS v1_actions        jsonb;
ALTER TABLE public.ai_turn_log ADD COLUMN IF NOT EXISTS turn_input        jsonb;
ALTER TABLE public.ai_turn_log ADD COLUMN IF NOT EXISTS payload_purged_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_turn_log'::regclass
                 AND conname = 'ai_turn_log_pipeline_check') THEN
    ALTER TABLE public.ai_turn_log
      ADD CONSTRAINT ai_turn_log_pipeline_check CHECK (pipeline IS NULL OR pipeline IN ('v1', 'v2', 'v2_shadow'));
  END IF;
END $$;

-- "Bu turun bütün aşamaları" — gölge farkı ve hata ayıklama sorgusu.
CREATE INDEX IF NOT EXISTS idx_ai_turn_log_turn     ON public.ai_turn_log (turn_id) WHERE turn_id IS NOT NULL;
-- Kohort karşılaştırması (v1 vs v2) — Faz 3 adım kapıları.
CREATE INDEX IF NOT EXISTS idx_ai_turn_log_pipeline ON public.ai_turn_log (pipeline, created_at DESC) WHERE pipeline IS NOT NULL;
-- Süpürmenin bakacağı satırlar: yükü olan ve henüz temizlenmemiş olanlar (temizlendikçe küçülür).
CREATE INDEX IF NOT EXISTS idx_ai_turn_log_payload_retention ON public.ai_turn_log (created_at)
  WHERE payload_purged_at IS NULL
    AND (decision IS NOT NULL OR issues IS NOT NULL OR v1_actions IS NOT NULL OR turn_input IS NOT NULL);

COMMENT ON COLUMN public.ai_turn_log.pipeline   IS 'v1 | v2 | v2_shadow — kohort karşılaştırması (AI_MIMARI_V2 §7.4, §10).';
COMMENT ON COLUMN public.ai_turn_log.stage      IS 'understand | repair | coach | plan | classifier | judge | tripwire | undo_fast | commit.';
COMMENT ON COLUMN public.ai_turn_log.decision   IS 'Stage A kararı (strict şema). Sağlık verisi: 30 gün sonra v2_retention_sweep siler.';
COMMENT ON COLUMN public.ai_turn_log.issues     IS 'Validator bulguları [{code, path, outcome}]. 30 gün.';
COMMENT ON COLUMN public.ai_turn_log.v1_actions IS 'Gölgede v1''in uyguladığı aksiyonlar. 30 gün.';
COMMENT ON COLUMN public.ai_turn_log.turn_input IS 'YALNIZ test hesabı/rıza: TurnInput anlık görüntüsü (eval fixture adayı). 30 gün.';

-- ─── Saklama süpürmesi ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.v2_retention_sweep(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cut     timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  v_purged  integer;
  v_expired integer;
  v_deleted integer;
BEGIN
  UPDATE ai_turn_log
  SET decision = NULL, issues = NULL, v1_actions = NULL, turn_input = NULL, payload_purged_at = now()
  WHERE payload_purged_at IS NULL
    AND (decision IS NOT NULL OR issues IS NOT NULL OR v1_actions IS NOT NULL OR turn_input IS NOT NULL)
    -- Hesabı silinen kullanıcının (085: ON DELETE SET NULL) karar yükü beklemeden gider.
    AND (created_at < v_cut OR user_id IS NULL);
  GET DIAGNOSTICS v_purged = ROW_COUNT;

  UPDATE pending_writes
  SET status = 'expired', resolved_at = now(), resolution_note = coalesce(resolution_note, 'expired')
  WHERE status = 'pending' AND expires_at < now();
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  DELETE FROM pending_writes WHERE status <> 'pending' AND coalesce(resolved_at, created_at) < v_cut;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('turn_log_payloads_purged', v_purged, 'holds_expired', v_expired,
                            'holds_deleted', v_deleted, 'cutoff', v_cut);
END $$;

REVOKE ALL ON FUNCTION public.v2_retention_sweep(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2_retention_sweep(integer) TO service_role;

-- Her gece 03:40 UTC (06:40 TR). cron.schedule aynı adla upsert eder (075 kalıbı).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('kochko-v2-retention', '40 3 * * *', $cron$SELECT public.v2_retention_sweep(30)$cron$);
  ELSE
    RAISE NOTICE '111: pg_cron yok — v2_retention_sweep(30) zamanlanmadı, elle çağrılmalı';
  END IF;
END $$;

SELECT '111 ai_turn_log v2 + retention applied' AS status;

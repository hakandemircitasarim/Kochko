-- 066: monthly_reports mükerrer/ölü kolonları DÜŞÜR (NIT — yazıcı yalnız kanonik adları dolduruyor)
--
-- AMAÇ: monthly_reports tablosu iki migration neslinin kalıntısını taşıyor. Migration 004
-- kanonik kolonları (behavioral_patterns, weight_change_kg) tanımladı; migration 011 ise
-- eski/mükerrer adları ekledi (behavior_patterns, weight_change, weight_start, weight_end,
-- total_days_logged, ai_monthly_note). Tek yazıcı (supabase/functions/ai-report/index.ts:482-498
-- upsert) YALNIZ kanonik adları yazar → 011-kaynaklı kolonlar HER ZAMAN NULL kalır. Bu migration
-- o ölü kolonları düşürür (veri kaybı yok — hepsi NULL).
--
-- CANLI-KANIT (node TEMP/q.mjs ile salt-okunur):
--   SELECT count(*) total,
--     count(behavior_patterns), count(weight_change), count(weight_start),
--     count(weight_end), count(total_days_logged), count(ai_monthly_note)
--   FROM monthly_reports;
--   => total=2; behavior_patterns=0, weight_change=0, weight_start=0, weight_end=0,
--      total_days_logged=0, ai_monthly_note=0   (TÜMÜ NULL — ölü)
--   Kanonikler dolu: behavioral_patterns=2, weight_change_kg=1.
-- KOD-KANIT (grep, src + supabase/functions):
--   ai-report/index.ts upsert YALNIZ behavioral_patterns + weight_change_kg yazar.
--   Hiçbir TS/Edge dosyası monthly_reports'tan behavior_patterns / weight_change /
--   weight_start / weight_end / total_days_logged / ai_monthly_note OKUMAZ
--   (monthly.tsx & export.service & ai-report .select('*') kullanır ama yalnız kanonik
--    alanları MonthlyAIReport interface'inden tüketir; NULL ölü kolonlar yok sayılır).
--   NOT: app/reports/monthly.tsx:147 yorumundaki "weight_start/weight_end" weekly_reports'a
--        aittir (monthly_reports'a değil) — yanlış pozitif değil.
--
-- preApplyCheck (uygulamadan önce çalıştır; her birinin 0 dönmesi gerekir):
--   SELECT count(behavior_patterns)+count(weight_change)+count(weight_start)
--        + count(weight_end)+count(total_days_logged)+count(ai_monthly_note) AS dead_nonnull
--   FROM monthly_reports;   -- beklenen: 0
--   Eğer > 0 ise (out-of-band yazıcı eklenmiş olabilir) UYGULAMA, önce araştır.
--
-- safety: destructive-verified-dead (canlı 0-nonnull + kod-okuyucu yok ile teyitli)
-- Idempotent: DROP COLUMN IF EXISTS.
-- DOWN: ALTER TABLE monthly_reports ADD COLUMN IF EXISTS <kolon> <tip>;  (veri zaten yoktu)

DO $$
DECLARE
  v_dead_nonnull bigint;
BEGIN
  -- Güvenlik: ölü kabul edilen kolonlarda gerçekten hiç veri olmadığını runtime'da da doğrula.
  -- (Kolonlar yoksa to_regclass/format ile çalışmaz; bu yüzden information_schema'dan kontrol.)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='monthly_reports'
               AND column_name='behavior_patterns') THEN
    EXECUTE $q$
      SELECT
        count(behavior_patterns) + count(weight_change) + count(weight_start)
      + count(weight_end) + count(total_days_logged) + count(ai_monthly_note)
      FROM public.monthly_reports
    $q$ INTO v_dead_nonnull;
    RAISE NOTICE '[066] monthly_reports ölü-kolon non-null toplamı = % (0 bekleniyor)', v_dead_nonnull;
    IF v_dead_nonnull > 0 THEN
      RAISE EXCEPTION '[066] ABORT: ölü kabul edilen kolonlarda % non-null değer var — DROP iptal edildi, araştır.', v_dead_nonnull;
    END IF;
  ELSE
    RAISE NOTICE '[066] ölü kolonlar zaten yok — no-op.';
  END IF;
END $$;

ALTER TABLE public.monthly_reports DROP COLUMN IF EXISTS behavior_patterns;
ALTER TABLE public.monthly_reports DROP COLUMN IF EXISTS weight_change;
ALTER TABLE public.monthly_reports DROP COLUMN IF EXISTS weight_start;
ALTER TABLE public.monthly_reports DROP COLUMN IF EXISTS weight_end;
ALTER TABLE public.monthly_reports DROP COLUMN IF EXISTS total_days_logged;
ALTER TABLE public.monthly_reports DROP COLUMN IF EXISTS ai_monthly_note;

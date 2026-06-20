-- 055: weekly_menu izolasyonu — legacy ai-plan menüsü chat-onaylı aktif diyeti EZMESİN (CRITICAL)
--
-- AMAÇ: ai-plan/index.ts generateWeeklyPlan, weekly_plans'taki tek (plan_type='diet'
-- AND status='active') satırı bulup plan_data'yı DÜZ DİZİ menü ({date,meals:[{name,calories}]})
-- ile UPDATE ediyor. Oysa chat plan_diet yolu AYNI satıra OBJE yazar
-- ({targets:{...}, days:[{day_index, meals:[{items,total_kcal}]}], version}). Legacy
-- UPDATE sonrası plan-projection.ts dietPlanData.targets'ı undefined görür → calorie
-- floor 1000, protein 0 (dashboard "kalan kalori" bozulur). Tek aktif diyet satırı iki
-- uyumsuz tüketici (projeksiyon vs menü ekranı) tarafından paylaşılıyor.
--
-- ÇÖZÜM: weekly_plans'a plan_subtype kolonu ekle. Chat-onaylı "core" diyet planı
-- plan_subtype=NULL kalır; legacy haftalık menü plan_subtype='weekly_menu' ayrı satırda
-- yazılır. Partial unique index'i COALESCE(plan_subtype,'core') ile yeniden tanımla ki
-- 'core' ve 'weekly_menu' satırları aynı anda active kalabilsin.
--
-- VERİ-ONARIM (corrections.md "Düzeltme 5"): şema izolasyonu tek başına yetmez —
-- hâlihazırda legacy menü tarafından EZİLMİŞ (plan_data düz dizi olan) active diyet
-- satırlarını 'weekly_menu' olarak işaretle ki obje-şekilli chat satırından ayrışsınlar.
-- Düz dizi = legacy menü; obje (targets/day_index içeren) = chat-onaylı core. Migration
-- öncesi dry-run etki-sayımı RAISE NOTICE ile loglanır.
--
-- Idempotent + geri-alınabilir.
-- DOWN: DROP INDEX uniq_active_plan_per_type; CREATE UNIQUE INDEX ... (user_id, plan_type)
--       WHERE status='active'; ALTER TABLE weekly_plans DROP COLUMN plan_subtype;

-- FIX (audit AI/CRITICAL — legacy ai-plan menüsü chat-onaylı aktif diyeti uyumsuz şekille eziyor)
ALTER TABLE public.weekly_plans ADD COLUMN IF NOT EXISTS plan_subtype text;

-- Dry-run etki-sayımı: kaç legacy-menü (düz dizi) active diyet satırı izole edilecek.
DO $$
DECLARE
  affected int;
BEGIN
  SELECT count(*) INTO affected
  FROM public.weekly_plans
  WHERE plan_type = 'diet'
    AND status = 'active'
    AND plan_subtype IS NULL
    AND jsonb_typeof(plan_data) = 'array';
  RAISE NOTICE '[055_weekly_menu_isolation] legacy-menu (flat-array) active diet rows to isolate: %', affected;
END $$;

-- Veri-onarım: legacy menü (plan_data düz DİZİ) olan active diyet satırlarını izole et.
-- Chat-onaylı core plan plan_data'sı OBJE'dir → bu UPDATE'e takılmaz, NULL kalır.
UPDATE public.weekly_plans
SET plan_subtype = 'weekly_menu'
WHERE plan_type = 'diet'
  AND status = 'active'
  AND plan_subtype IS NULL
  AND jsonb_typeof(plan_data) = 'array';

-- Partial unique index'i alt-tür-farkında hale getir: 'core' diyet ve 'weekly_menu'
-- satırları aynı anda active kalabilsin (eskisi user_id+plan_type üzerinde çakışırdı).
DROP INDEX IF EXISTS uniq_active_plan_per_type;
CREATE UNIQUE INDEX uniq_active_plan_per_type
  ON public.weekly_plans (user_id, plan_type, COALESCE(plan_subtype, 'core'))
  WHERE status = 'active';

-- 073: daily_plans.weekly_budget_* smallint→integer (HIGH — audit 2026-06-21 AI-PLN-01)
--
-- AMAÇ: weekly_budget_total = gunluk kalori hedefi × 7. Bulk / agir-yeme haftalarinda gunluk
-- ~4700+ kcal → 7 gun = 33000+ > smallint max (32767). chat→daily_plans projeksiyonu
-- (project_daily_plans RPC, jsonb_populate_recordset ile daily_plans satirlarini yazar) o
-- degeri smallint kolona koyamayinca 22003 (numeric_value_out_of_range) verir; project_daily_plans
-- tek tx'te DELETE+INSERT yaptigindan TUM hafta silinir ama yeniden yazilamaz → dashboard bosalir.
-- Haftalik kalori butceleri smallint'e mantiksal olarak sigmaz.
--
-- ÇÖZÜM: uc weekly_budget kolonunu integer'a genislet. smallint ⊂ integer oldugundan veri kaybi
-- yok; mevcut degerler aynen korunur. Idempotent: ALTER ... TYPE integer zaten integer'sa hata vermez.
-- Geri-alma: ALTER ... TYPE smallint (taşan satirlar varsa basarisiz olur — onerilmez).

ALTER TABLE public.daily_plans
  ALTER COLUMN weekly_budget_total     TYPE integer,
  ALTER COLUMN weekly_budget_consumed  TYPE integer,
  ALTER COLUMN weekly_budget_remaining TYPE integer;

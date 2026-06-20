-- 052: ai_summary phantom kolonlar (ADD COLUMN IF NOT EXISTS)
--
-- AMAÇ: ai_summary.learned_meal_times (+ snacking_hours, extraction_checkpoint,
-- onboarding_tasks_completed) kolonları canlıda MEVCUT ama hiçbir migration eklemiyor
-- (003 CREATE TABLE bunları içermiyor; out-of-band eklenmişler). Migration 015'teki
-- ai_summary_merge fonksiyonu learned_meal_times=COALESCE(...) referans veriyor →
-- temiz/fresh-install bir DB'de 015 "column does not exist" ile patlar ve Layer-2
-- hafıza yazma yolu hiç kurulamaz. Aynı risk snacking_hours (020) için de geçerli.
--
-- Tipler ve default'lar CANLI şemadan birebir alındı (q.mjs information_schema teyidi):
--   learned_meal_times        jsonb   DEFAULT '{}'::jsonb
--   snacking_hours            jsonb   DEFAULT '[]'::jsonb
--   extraction_checkpoint     jsonb   DEFAULT '{}'::jsonb
--   onboarding_tasks_completed text[] DEFAULT '{}'::text[]
--
-- Tamamen idempotent (ADD COLUMN IF NOT EXISTS) → canlıda NO-OP, temiz DB'de zinciri tamir eder.
-- Geri-alma yalnız dev (veri kaybı riski): DROP COLUMN IF EXISTS.

-- FIX (audit DB/MEDIUM — ai_summary phantom kolonlar hiçbir migration'da yok ama ai_summary_merge referans veriyor)
ALTER TABLE public.ai_summary ADD COLUMN IF NOT EXISTS learned_meal_times jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_summary ADD COLUMN IF NOT EXISTS snacking_hours jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.ai_summary ADD COLUMN IF NOT EXISTS extraction_checkpoint jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_summary ADD COLUMN IF NOT EXISTS onboarding_tasks_completed text[] DEFAULT '{}'::text[];

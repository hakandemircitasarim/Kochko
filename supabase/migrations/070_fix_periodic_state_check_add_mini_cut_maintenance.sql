-- 070: profiles_periodic_state_check'i düzelt — mini_cut + maintenance ekle (063 fixup, CRITICAL)
--
-- SORUN: Migration 063, profiles.periodic_state CHECK'ini src/types/database.ts'teki 10-değerli
-- (ESKİ) PeriodicState listesinden türetti. Ancak canonical liste edge'de:
--   supabase/functions/shared/periodic-config.ts → 12 değer (ek: 'mini_cut', 'maintenance').
-- Bu iki durum mini_cut_start / maintenance_start AI aksiyonları tarafından profiles.periodic_state'e
-- YAZILIYOR. 063'ün dar CHECK'i bu yazımları '23514 check_violation' ile REDDEDER → üretimde
-- mini-cut/maintenance dönemi başlatma KIRILIR. (Düşmanca regresyon-incelemesi CRITICAL bulgusu.)
--
-- ÇÖZÜM: constraint'i DROP edip 12 değerle yeniden ekle. Mevcut veride hepsi NULL (canlı teyit:
-- profiles.periodic_state GROUP BY → {null:27}), dolayısıyla genişletme hiçbir satırı kırmaz.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + koşullu ADD. Geri-alma: 063'teki 10-değerli sürüm.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_periodic_state_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_periodic_state_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_periodic_state_check
      CHECK (periodic_state IS NULL OR periodic_state IN (
        'ramadan', 'holiday', 'illness', 'busy_work', 'exam', 'pregnancy',
        'breastfeeding', 'injury', 'travel', 'custom', 'mini_cut', 'maintenance'
      ));
  END IF;
END $$;

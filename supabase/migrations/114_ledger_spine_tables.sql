-- 114: defter (turn_writes) güvenlik omurgasını adlandırabilir — user_constraints, health_events, food_preferences.
--
-- NEDEN (canlı deneme 2026-10-11, mem): constraint_add (alerji, sakatlık) defter satırları yalnız denetim
-- kaydıydı (table_name='profiles', row_id NULL, undo 'none'). Yanlış eklenmiş bir alerji ya da sakatlık
-- "geri al" ile geri alınamıyordu, defter de yanlış tabloyu gösteriyordu; health_events aynası hiç yoktu.
-- Yazma kaydı (write registry) constraint_add için undo 'deactivate' bildiriyor: bu migrasyon defterin o
-- satırları adlandırmasına izin verir.
--
-- GERİ ALMA MOTORU DEĞİŞMEZ (_v2_reverse_rows, 108). 'deactivate' = user_constraints.active alanının
-- restore_previous ile yazmadan önceki değerine dönmesi (yeni satırda false): omurga satırı geri almada
-- pasifleşir, asla silinmez. Aynalar aynı grupta: bu yazmanın açtığı health_events satırı (before NULL)
-- anlık görüntüsü defterde kalarak kaldırılır; food_preferences / profiles.dietary_restriction önceki
-- değerlerine döner. constraint_retract tersidir: geri alınması satırı yeniden etkinleştirir (koruma geri gelir).
--
-- BU MİGRASYON:
--   1. turn_writes.table_name CHECK'i: 108 listesi + user_constraints, health_events, food_preferences.
--   2. _v2_assert_table (dinamik SQL beyaz listesi) aynı listeyi kabul eder.
--   3. _v2_delete_row: user_constraints de asla fiziksel silinmez (omurga satırı yalnız pasifleşir).
--
-- DAĞITIM SIRASI: ÖNCE bu migrasyon, sonra edge function. Uygulanmadan dağıtılırsa adapter'ın bu tablolara
-- defter eki reddedilir (invalid_value): yazma yine geçerli olur ama makbuz "bu kayıt sohbetten geri
-- alınamaz" der (sessiz bir ok değil, ama gereksiz bir uyarı).
--
-- Yalnız service_role (fonksiyonlar 108'deki gibi SECURITY DEFINER çağıranların içinde çalışır). DOWN:
--   UPDATE turn_writes SET meta = meta || jsonb_build_object('down_114_table', table_name, 'down_114_row', row_id),
--          table_name = 'profiles', row_id = NULL, undo_mode = 'none', field_set = '{}', before = NULL, after = NULL
--    WHERE table_name IN ('user_constraints', 'health_events', 'food_preferences');
--   ALTER TABLE turn_writes DROP CONSTRAINT IF EXISTS turn_writes_table_name_check;
--   ALTER TABLE turn_writes ADD CONSTRAINT turn_writes_table_name_check CHECK (table_name IN (
--     'meal_logs','workout_logs','supplement_logs','daily_metrics','weight_history',
--     'profiles','user_venues','life_events','lab_values','achievements','strength_sets'));
--   ve _v2_assert_table ile _v2_delete_row'u 108'deki gövdeleriyle yeniden CREATE OR REPLACE et.

-- ─── 1. CHECK ──────────────────────────────────────────────────────────────────────────────────────
-- 108 kısıtı sütun üzerinde tanımladı (adı Postgres'in verdiği turn_writes_table_name_check); adına
-- güvenmeden table_name'e bakan CHECK'i bul ve değiştir.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.turn_writes'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%table_name%' LOOP
    EXECUTE format('ALTER TABLE public.turn_writes DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.turn_writes ADD CONSTRAINT turn_writes_table_name_check CHECK (table_name IN (
  'meal_logs','workout_logs','supplement_logs','daily_metrics','weight_history',
  'profiles','user_venues','life_events','lab_values','achievements','strength_sets',
  'user_constraints','health_events','food_preferences'));

-- ─── 2. Dinamik SQL beyaz listesi ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._v2_assert_table(p_table text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_table IS NULL OR p_table NOT IN ('meal_logs','workout_logs','supplement_logs','daily_metrics','weight_history',
                                        'profiles','user_venues','life_events','lab_values','achievements','strength_sets',
                                        'user_constraints','health_events','food_preferences') THEN
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'table_name', 'value', p_table));
  END IF;
END $$;

-- ─── 3. Omurga satırı asla fiziksel silinmez ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._v2_delete_row(p_table text, p_row uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM _v2_assert_table(p_table);
  IF p_table IN ('profiles', 'meal_logs', 'workout_logs', 'supplement_logs', 'life_events', 'lab_values', 'achievements',
                 'strength_sets', 'user_constraints') THEN
    -- Bu tabloların soft-delete'i (ya da kimliği / pasifleştirmesi) var: fiziksel silme defterden asla çıkmaz.
    RAISE EXCEPTION 'v2: % rows are never hard-deleted by the ledger', p_table;
  END IF;
  EXECUTE format('DELETE FROM public.%I WHERE id = $1', p_table) USING p_row;
END $$;

-- ─── 4. Yetkiler ───────────────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE yetkileri korur; yine de 108'deki gibi iç yardımcıları açıkça kapat.
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE '\_v2\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;

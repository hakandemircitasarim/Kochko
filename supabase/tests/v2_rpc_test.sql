-- v2 veritabanı RPC testleri (AI_MIMARI_V2 Faz 1 · migrasyonlar 108-113).
--
-- NEREDE: yalnızca bir DAL (branch) veritabanında, 108-113 uygulandıktan sonra. CANLIDA ÇALIŞTIRMA.
--   psql "$BRANCH_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/v2_rpc_test.sql
-- Her şey tek işlemde koşar ve sonda ROLLBACK edilir: hiçbir satır kalıcı olmaz. Bir ASSERT tutmazsa
-- psql durur ve hangi senaryonun kırıldığını mesajda yazar. Başarıda son satır 'v2_rpc_test OK' olur.
--
-- Senaryolar: yetkiler/RLS · su ekle/topla/geri al/geri getir (istemcinin araya giren eklemesi ezilmez) ·
-- günün toplamı sonrası 'later_write' · su düzeltmesi (replaces) ve grubun geri alınması · uyku normalleştirme ·
-- mood 8 kırpılmaz (ret) · tartı üç tabloda tek grup · nugget öğünü as_stated aynen + mekân yan etkisi ·
-- defter dışı eski kayıt (1708 kcal) düzeltmesi · kullanıcılar arası ref yalıtımı · bekletme onayı tek sefer ·
-- KVKK bekletme tekilliği korunur · v1 defter eki · antrenman + başarım · 7 günden eski kayıt · yarıda kalan
-- yazmanın geri sarılması · v2_turn_input şekli ve ref kararlılığı · mesaj bağlama · 30 gün saklama.

\set ON_ERROR_STOP on
BEGIN;

-- ─── Fikstürler ──────────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'v2-rpc-test-a@kochko.test', '{}', '{}', now(), now()),
       ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'v2-rpc-test-b@kochko.test', '{}', '{}', now(), now());
-- handle_new_user tetikleyicisi profilleri açar; tetikleyici yoksa (yalın dal) elle aç.
INSERT INTO profiles (id) VALUES ('00000000-0000-4000-8000-0000000000a1'), ('00000000-0000-4000-8000-0000000000b1')
ON CONFLICT (id) DO NOTHING;
UPDATE profiles SET weight_kg = 82 WHERE id = '00000000-0000-4000-8000-0000000000a1';

CREATE TEMP TABLE v2t (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;

-- ─── T0 yetkiler ve RLS ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.w_meal_apply(uuid,uuid,jsonb)', 'public.w_water_apply(uuid,uuid,jsonb)', 'public.w_metric_apply(uuid,uuid,jsonb)',
    'public.w_record_delete(uuid,uuid,jsonb,jsonb)', 'public.w_record_restore(uuid,uuid,jsonb,jsonb)',
    'public.v2_turn_input(uuid,date)', 'public.v2_ledger_append(uuid,uuid,jsonb)',
    'public.v2_hold_open(uuid,uuid,text,jsonb,jsonb)', 'public.v2_hold_resolve(uuid,uuid,uuid,text,jsonb,text)',
    'public.v2_link_turn_message(uuid,uuid,uuid)', 'public.v2_retention_sweep(integer)'] LOOP
    ASSERT has_function_privilege('service_role', f, 'EXECUTE'), 'T0 service_role cannot execute ' || f;
    ASSERT NOT has_function_privilege('authenticated', f, 'EXECUTE'), 'T0 authenticated can execute ' || f;
    ASSERT NOT has_function_privilege('anon', f, 'EXECUTE'), 'T0 anon can execute ' || f;
  END LOOP;
  ASSERT NOT has_function_privilege('authenticated', 'public._v2_set_fields(text,uuid,jsonb)', 'EXECUTE'), 'T0 internal helper exposed';
  ASSERT NOT has_function_privilege('authenticated', 'public._v2_reverse_rows(uuid,uuid,uuid[],text,uuid,boolean,jsonb)', 'EXECUTE'), 'T0 engine exposed';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.turn_writes'::regclass), 'T0 turn_writes RLS off';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.record_refs'::regclass), 'T0 record_refs RLS off';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename IN ('turn_writes', 'record_refs') AND cmd <> 'SELECT'),
    'T0 a write policy exists on the ledger';
END $$;

-- ─── T1 su: ekle, ekle (0,25 → NUMERIC(4,2) kaybetmez) ───────────────────────────────────────────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  r jsonb;
BEGIN
  r := w_water_apply(a, gen_random_uuid(), jsonb_build_object('day', current_date, 'mode', 'add', 'liters', 0.2,
         'as_stated', '1 bardak', 'quantity', 1, 'unit', 'bardak'));
  ASSERT (r ->> 'ok')::boolean, 'T1 add#1 failed: ' || r::text;
  ASSERT (r ->> 'total')::numeric = 0.2 AND r ->> 'ref' = 'd1', 'T1 add#1 receipt: ' || r::text;
  INSERT INTO v2t VALUES ('water1', r);

  r := w_water_apply(a, gen_random_uuid(), jsonb_build_object('day', current_date, 'mode', 'add', 'liters', 0.25, 'as_stated', '1 kupa'));
  ASSERT (r ->> 'ok')::boolean AND (r ->> 'total')::numeric = 0.45 AND r ->> 'ref' = 'd2', 'T1 add#2 receipt: ' || r::text;
  ASSERT (r ->> 'previous_total')::numeric = 0.2, 'T1 previous_total: ' || r::text;
  ASSERT (SELECT water_liters FROM daily_metrics WHERE user_id = a AND date = current_date) = 0.45, 'T1 stored total';
  ASSERT (SELECT undo_mode = 'revert_delta' AND (before ->> 'water_liters')::numeric = 0.2 AND meta ->> 'as_stated' = '1 kupa'
          FROM turn_writes WHERE id = (r ->> 'write_id')::uuid), 'T1 ledger row';
  INSERT INTO v2t VALUES ('water2', r);
END $$;

-- ─── T2 istemci su ekranı araya girer; d2 geri alınınca YALNIZ 0,25 düşer; geri getirilince geri gelir ──
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  r jsonb;
BEGIN
  UPDATE daily_metrics SET water_liters = water_liters + 0.5 WHERE user_id = a AND date = current_date;  -- 0,95
  r := w_record_delete(a, gen_random_uuid(), '{"ref":"d2"}');
  ASSERT (r ->> 'ok')::boolean, 'T2 delete d2: ' || r::text;
  ASSERT (SELECT water_liters FROM daily_metrics WHERE user_id = a AND date = current_date) = 0.70, 'T2 client add clobbered';
  ASSERT (SELECT undone_at IS NOT NULL FROM turn_writes WHERE id = ((SELECT v FROM v2t WHERE k = 'water2') ->> 'write_id')::uuid), 'T2 d2 not undone';
  r := w_record_delete(a, gen_random_uuid(), '{"ref":"d2"}');
  ASSERT NOT (r ->> 'ok')::boolean AND r ->> 'failure_class' = 'already_undone', 'T2 double delete: ' || r::text;
  r := w_record_restore(a, gen_random_uuid(), '{"ref":"d2"}');
  ASSERT (r ->> 'ok')::boolean, 'T2 restore d2: ' || r::text;
  ASSERT (SELECT water_liters FROM daily_metrics WHERE user_id = a AND date = current_date) = 0.95, 'T2 restore total';
  ASSERT (SELECT undone_at IS NULL FROM turn_writes WHERE id = ((SELECT v FROM v2t WHERE k = 'water2') ->> 'write_id')::uuid), 'T2 d2 not live again';
END $$;

-- ─── T3 günün toplamı; sonra istemci ekler → geri alma 'later_write', force ile önceki toplam ─────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  r jsonb;
  s jsonb;
BEGIN
  s := w_water_apply(a, gen_random_uuid(), jsonb_build_object('day', current_date, 'mode', 'set_day_total', 'liters', 2.0, 'as_stated', 'bugün toplam 2 litre'));
  ASSERT (s ->> 'ok')::boolean AND (s ->> 'total')::numeric = 2.0 AND (s ->> 'previous_total')::numeric = 0.95, 'T3 set: ' || s::text;
  ASSERT (SELECT undo_mode FROM turn_writes WHERE id = (s ->> 'write_id')::uuid) = 'restore_previous', 'T3 undo mode';
  -- Önceki bir "add" artık geri alınamaz: sonrasında mutlak bir toplam yazıldı.
  r := w_record_delete(a, gen_random_uuid(), '{"ref":"d1"}');
  ASSERT r ->> 'failure_class' = 'later_write', 'T3 add under a later set: ' || r::text;
  UPDATE daily_metrics SET water_liters = 2.3 WHERE user_id = a AND date = current_date;
  r := w_record_delete(a, gen_random_uuid(), jsonb_build_object('ref', s ->> 'ref'));
  ASSERT r ->> 'failure_class' = 'later_write', 'T3 conflict expected: ' || r::text;
  ASSERT (SELECT water_liters FROM daily_metrics WHERE user_id = a AND date = current_date) = 2.3, 'T3 conflict wrote something';
  r := w_record_delete(a, gen_random_uuid(), jsonb_build_object('ref', s ->> 'ref'), '{"force":true}');
  ASSERT (r ->> 'ok')::boolean AND (SELECT water_liters FROM daily_metrics WHERE user_id = a AND date = current_date) = 0.95, 'T3 force: ' || r::text;
END $$;

-- ─── T4 düzeltme: "yanlış, 2 bardaktı" → d1 geri alınır + yeni yazma, tek grup; grup geri alınınca ikisi de döner ──
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  r jsonb;
  w jsonb;
BEGIN
  w := w_water_apply(a, gen_random_uuid(), jsonb_build_object('day', current_date, 'mode', 'add', 'liters', 0.4, 'as_stated', '2 bardak', 'replaces', 'd1'));
  ASSERT (w ->> 'ok')::boolean, 'T4 replace: ' || w::text;
  ASSERT w -> 'replaced' -> 'target' ->> 'ref' = 'd1', 'T4 replaced target: ' || w::text;
  ASSERT (SELECT water_liters FROM daily_metrics WHERE user_id = a AND date = current_date) = 1.15, 'T4 total after replace';
  ASSERT (SELECT count(DISTINCT group_id) FROM turn_writes WHERE turn_id = (w ->> 'turn_id')::uuid) = 1, 'T4 not one group';
  r := w_record_restore(a, gen_random_uuid(), '{"ref":"d1"}');
  ASSERT r ->> 'failure_class' = 'replaced' AND r -> 'detail' -> 'replaced_by' ? (w ->> 'ref'), 'T4 restore of replaced: ' || r::text;
  r := w_water_apply(a, gen_random_uuid(), jsonb_build_object('day', current_date, 'mode', 'add', 'liters', 0.2, 'replaces', 'm1'));
  ASSERT r ->> 'failure_class' IN ('unknown_ref', 'wrong_ref_kind'), 'T4 water replacing a meal ref: ' || r::text;
  -- İstemci undo düğmesi: write_id ile bütün grup.
  r := w_record_delete(a, gen_random_uuid(), jsonb_build_object('write_id', w ->> 'write_id'));
  ASSERT (r ->> 'ok')::boolean AND r ->> 'scope' = 'group', 'T4 group undo: ' || r::text;
  ASSERT (SELECT water_liters FROM daily_metrics WHERE user_id = a AND date = current_date) = 0.95, 'T4 total after group undo';
  ASSERT (SELECT undone_at IS NULL FROM turn_writes WHERE id = ((SELECT v FROM v2t WHERE k = 'water1') ->> 'write_id')::uuid), 'T4 d1 not live again';
END $$;

-- ─── T5 uyku: kayıpsız normalleştirme görünür; ref ile geri alma ────────────────────────────────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  r jsonb;
BEGIN
  r := w_metric_apply(a, gen_random_uuid(), jsonb_build_object('metric', 'sleep', 'day', current_date,
         'values', jsonb_build_object('hours', 7.46, 'quality', 'good', 'wake_time', '07:00'), 'as_stated', '7,5 saat uyudum'));
  ASSERT (r ->> 'ok')::boolean AND r ->> 'op' = 'sleep_log', 'T5 sleep: ' || r::text;
  ASSERT jsonb_array_length(r -> 'normalized') = 1 AND (r -> 'normalized' -> 0 ->> 'to')::numeric = 7.5, 'T5 normalized: ' || r::text;
  ASSERT (SELECT sleep_hours = 7.5 AND sleep_quality = 'good' AND wake_time = '07:00'::time FROM daily_metrics WHERE user_id = a AND date = current_date), 'T5 stored';
  ASSERT left(r ->> 'ref', 1) = 'd', 'T5 ref kind: ' || r::text;
  r := w_record_delete(a, gen_random_uuid(), jsonb_build_object('ref', r ->> 'ref'));
  ASSERT (r ->> 'ok')::boolean, 'T5 delete: ' || r::text;
  ASSERT (SELECT sleep_hours IS NULL AND sleep_quality IS NULL AND wake_time IS NULL FROM daily_metrics WHERE user_id = a AND date = current_date), 'T5 not restored';
  ASSERT (SELECT water_liters FROM daily_metrics WHERE user_id = a AND date = current_date) = 0.95, 'T5 touched water';
END $$;

-- ─── T6 mood 8 kırpılmaz (§5.3), hiçbir şey yazılmaz; bilinmeyen metrik reddedilir ─────────────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  r jsonb;
  n bigint := (SELECT count(*) FROM turn_writes);
BEGIN
  r := w_metric_apply(a, gen_random_uuid(), jsonb_build_object('metric', 'mood', 'day', current_date, 'values', jsonb_build_object('score', 8)));
  ASSERT NOT (r ->> 'ok')::boolean AND r ->> 'failure_class' = 'invalid_value' AND r -> 'detail' ->> 'path' = 'values.score', 'T6 mood 8: ' || r::text;
  r := w_metric_apply(a, gen_random_uuid(), jsonb_build_object('metric', 'mood', 'day', current_date, 'values', jsonb_build_object('score', 3.5)));
  ASSERT r ->> 'failure_class' = 'invalid_value', 'T6 mood 3.5: ' || r::text;
  r := w_metric_apply(a, gen_random_uuid(), jsonb_build_object('metric', 'bp', 'day', current_date, 'values', '{}'::jsonb));
  ASSERT r ->> 'failure_class' = 'invalid_value', 'T6 unknown metric: ' || r::text;
  r := w_metric_apply(a, gen_random_uuid(), jsonb_build_object('metric', 'steps', 'day', (current_date + 5)::text, 'values', jsonb_build_object('steps', 9000)));
  ASSERT r ->> 'failure_class' = 'invalid_value' AND r -> 'detail' ->> 'path' = 'day', 'T6 future day: ' || r::text;
  ASSERT (SELECT count(*) FROM turn_writes) = n, 'T6 a rejected write left ledger rows';
  ASSERT (SELECT mood_score IS NULL FROM daily_metrics WHERE user_id = a AND date = current_date), 'T6 mood written';
END $$;

-- ─── T7 tartı: daily_metrics + weight_history + profiles tek grup; geri al / geri getir ──────────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  r jsonb;
  w jsonb;
  wh uuid;
BEGIN
  w := w_metric_apply(a, gen_random_uuid(), jsonb_build_object('metric', 'weight', 'day', current_date,
         'values', jsonb_build_object('kg', 80.4), 'update_profile', true, 'as_stated', '80,4'));
  ASSERT (w ->> 'ok')::boolean AND w ->> 'ref' = 'w1' AND w ->> 'op' = 'body_weight', 'T7 weight: ' || w::text;
  ASSERT (SELECT weight_kg FROM profiles WHERE id = a) = 80.4, 'T7 profile';
  SELECT id INTO wh FROM weight_history WHERE user_id = a AND recorded_at = current_date;
  ASSERT wh IS NOT NULL, 'T7 weight_history';
  ASSERT (SELECT count(*) FROM turn_writes WHERE group_id = (w ->> 'group_id')::uuid) = 3, 'T7 group size';
  r := w_record_delete(a, gen_random_uuid(), '{"ref":"w1"}');
  ASSERT (r ->> 'ok')::boolean, 'T7 delete: ' || r::text;
  ASSERT (SELECT weight_kg FROM profiles WHERE id = a) = 82, 'T7 profile not restored';
  ASSERT NOT EXISTS (SELECT 1 FROM weight_history WHERE id = wh), 'T7 created weight_history row survived undo';
  ASSERT (SELECT weight_kg IS NULL FROM daily_metrics WHERE user_id = a AND date = current_date), 'T7 daily weight';
  r := w_record_restore(a, gen_random_uuid(), '{"ref":"w1"}');
  ASSERT (r ->> 'ok')::boolean, 'T7 restore: ' || r::text;
  ASSERT (SELECT weight_kg FROM weight_history WHERE id = wh) = 80.4, 'T7 weight_history not re-inserted with the same id';
  ASSERT (SELECT weight_kg FROM profiles WHERE id = a) = 80.4, 'T7 profile after restore';
  -- Profil sonradan başka yoldan değişti: geri alma onu ezmez.
  UPDATE profiles SET weight_kg = 79.9 WHERE id = a;
  r := w_record_delete(a, gen_random_uuid(), '{"ref":"w1"}');
  ASSERT r ->> 'failure_class' = 'later_write', 'T7 later profile write: ' || r::text;
  ASSERT (SELECT weight_kg FROM weight_history WHERE id = wh) = 80.4, 'T7 partial undo leaked';
END $$;

-- ─── T8 öğün: "6 tavuk nugget" + "2 çimdik tuz" AYNEN; Lahmacuncu mekânı yan etki ─────────────────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  r jsonb;
  m uuid;
BEGIN
  r := w_meal_apply(a, gen_random_uuid(), jsonb_build_object(
         'day', current_date, 'meal_type', 'lunch', 'raw', '6 tavuk nugget yedim, yumurtaya 2 çimdik tuz', 'time_local', '13:10',
         'venue', jsonb_build_object('name', 'Lahmacuncu', 'type', 'restaurant'),
         'items', jsonb_build_array(
           jsonb_build_object('name', 'tavuk nugget', 'as_stated', '6 adet', 'grams', 110, 'kcal', 320, 'protein_g', 16,
                              'carbs_g', 18, 'fat_g', 20, 'allergens', jsonb_build_array('gluten'), 'may_contain', jsonb_build_array('egg'),
                              'confidence', 0.7, 'preparation', 'kızartma', 'reference_key', NULL),
           jsonb_build_object('name', 'tuz', 'as_stated', '2 çimdik', 'grams', 0.7, 'kcal', 0, 'protein_g', 0, 'carbs_g', 0, 'fat_g', 0,
                              'confidence', 0.6))));
  ASSERT (r ->> 'ok')::boolean, 'T8 meal: ' || r::text;
  ASSERT r ->> 'ref' = 'm1' AND (r ->> 'total_kcal')::numeric = 320 AND r ->> 'confidence' = 'low', 'T8 receipt: ' || r::text;
  ASSERT r -> 'items' -> 0 ->> 'name' = 'tavuk nugget' AND r -> 'items' -> 1 ->> 'as_stated' = '2 çimdik', 'T8 item order: ' || r::text;
  m := (r ->> 'row_id')::uuid;
  ASSERT (SELECT portion_text = '6 adet' AND as_stated = '6 adet' AND portion_grams = 110 AND calories = 320
                 AND allergen_tags = ARRAY['gluten'] AND meta -> 'may_contain' = '["egg"]'::jsonb AND data_source = 'ai_estimate'
                 AND meta ->> 'preparation' = 'kızartma'
          FROM meal_log_items WHERE meal_log_id = m AND food_name = 'tavuk nugget'), 'T8 nugget stored as stated';
  ASSERT (SELECT calories = 0 AND portion_grams = 0.7 FROM meal_log_items WHERE meal_log_id = m AND food_name = 'tuz'), 'T8 salt stored';
  ASSERT (SELECT visit_count FROM user_venues WHERE user_id = a AND venue_name = 'Lahmacuncu') = 1, 'T8 venue visit';
  ASSERT (r -> 'venue' ->> 'created')::boolean, 'T8 venue created flag';
  INSERT INTO v2t VALUES ('meal1', r);

  -- Bilinmeyen öğün tipi 'snack'e düşmez; boş kalem listesi; aralık dışı kcal.
  r := w_meal_apply(a, gen_random_uuid(), jsonb_build_object('day', current_date, 'meal_type', 'brunch', 'raw', 'x',
         'items', jsonb_build_array(jsonb_build_object('name', 'x', 'as_stated', '1', 'kcal', 1, 'protein_g', 0, 'carbs_g', 0, 'fat_g', 0))));
  ASSERT r ->> 'failure_class' = 'invalid_value' AND r -> 'detail' ->> 'path' = 'meal_type', 'T8 brunch: ' || r::text;
  r := w_meal_apply(a, gen_random_uuid(), jsonb_build_object('day', current_date, 'meal_type', 'snack', 'raw', 'x', 'items', '[]'::jsonb));
  ASSERT r ->> 'failure_class' = 'invalid_value', 'T8 empty items: ' || r::text;
  r := w_meal_apply(a, gen_random_uuid(), jsonb_build_object('day', current_date, 'meal_type', 'snack', 'raw', 'x',
         'items', jsonb_build_array(jsonb_build_object('name', 'x', 'as_stated', '1', 'kcal', -5, 'protein_g', 0, 'carbs_g', 0, 'fat_g', 0))));
  ASSERT r ->> 'failure_class' = 'invalid_value' AND r -> 'detail' ->> 'path' = 'items[0].kcal', 'T8 negative kcal: ' || r::text;
  ASSERT (SELECT count(*) FROM meal_logs WHERE user_id = a) = 1, 'T8 a rejected meal was written';
END $$;

-- ─── T9 öğünü ref ile sil → hayalet mekân ziyareti de gider; geri getir → ikisi de döner ─────────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  r jsonb;
  m uuid := ((SELECT v FROM v2t WHERE k = 'meal1') ->> 'row_id')::uuid;
BEGIN
  r := w_record_delete(a, gen_random_uuid(), '{"ref":"m1"}', '{"reason":"kullanıcı yemedim dedi"}');
  ASSERT (r ->> 'ok')::boolean, 'T9 delete: ' || r::text;
  ASSERT (SELECT is_deleted AND deleted_at IS NOT NULL FROM meal_logs WHERE id = m), 'T9 meal not soft-deleted';
  ASSERT NOT EXISTS (SELECT 1 FROM user_venues WHERE user_id = a AND venue_name = 'Lahmacuncu'), 'T9 phantom venue visit survived';
  ASSERT EXISTS (SELECT 1 FROM meal_log_items WHERE meal_log_id = m), 'T9 items hard-deleted';
  r := w_record_restore(a, gen_random_uuid(), '{"ref":"m1"}');
  ASSERT (r ->> 'ok')::boolean, 'T9 restore: ' || r::text;
  ASSERT (SELECT NOT is_deleted AND deleted_at IS NULL FROM meal_logs WHERE id = m), 'T9 meal not restored';
  ASSERT (SELECT visit_count FROM user_venues WHERE user_id = a AND venue_name = 'Lahmacuncu') = 1, 'T9 venue not restored';
  r := w_record_restore(a, gen_random_uuid(), '{"ref":"m1"}');
  ASSERT r ->> 'failure_class' = 'not_undone', 'T9 restore live record: ' || r::text;
END $$;

-- ─── T10 defter dışı eski kayıt (1708 kcal "nugget"): TurnInput'ta görünür, kimlikle düzeltilir ──────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  old_meal uuid := gen_random_uuid();
  ti jsonb;
  old_ref text;
  r jsonb;
  w jsonb;
BEGIN
  INSERT INTO meal_logs (id, user_id, raw_input, input_method, meal_type, confidence, logged_for_date, logged_at)
  VALUES (old_meal, a, '6 tavuk nugget', 'ai_chat', 'dinner', 'medium', current_date - 1, now() - interval '1 day');
  INSERT INTO meal_log_items (meal_log_id, food_name, portion_text, portion_grams, calories, protein_g, carbs_g, fat_g, data_source)
  VALUES (old_meal, 'Tavuk göğsü', '6 adet', 900, 1708, 280, 0, 32, 'reference');

  ti := v2_turn_input(a, current_date);
  SELECT e ->> 'ref' INTO old_ref FROM jsonb_array_elements(ti -> 'meals') e WHERE e ->> 'id' = old_meal::text;
  ASSERT old_ref IS NOT NULL, 'T10 legacy meal has no ref: ' || (ti -> 'meals')::text;
  ASSERT (SELECT (e ->> 'total_kcal')::numeric = 1708 AND e ->> 'source' = 'app' FROM jsonb_array_elements(ti -> 'meals') e
          WHERE e ->> 'id' = old_meal::text), 'T10 legacy meal shape';

  w := w_meal_apply(a, gen_random_uuid(), jsonb_build_object('day', (current_date - 1)::text, 'meal_type', 'dinner',
         'raw', '6 küçük nuggetti, 100 gram falan', 'replaces', old_ref,
         'items', jsonb_build_array(jsonb_build_object('name', 'tavuk nugget', 'as_stated', '6 küçük', 'grams', 100, 'kcal', 300,
                                                       'protein_g', 15, 'carbs_g', 17, 'fat_g', 19, 'confidence', 0.8))));
  ASSERT (w ->> 'ok')::boolean, 'T10 correction: ' || w::text;
  ASSERT (SELECT is_deleted FROM meal_logs WHERE id = old_meal), 'T10 old not soft-deleted';
  ASSERT (SELECT supersedes_id FROM meal_logs WHERE id = (w ->> 'row_id')::uuid) = old_meal, 'T10 supersedes_id';
  ASSERT (SELECT sum(i.calories) FROM meal_logs m JOIN meal_log_items i ON i.meal_log_id = m.id
          WHERE m.user_id = a AND m.logged_for_date = current_date - 1 AND NOT m.is_deleted) = 300, 'T10 double counted';
  r := w_record_restore(a, gen_random_uuid(), jsonb_build_object('ref', old_ref));
  ASSERT r ->> 'failure_class' = 'replaced', 'T10 restoring a replaced record: ' || r::text;
  r := w_record_delete(a, gen_random_uuid(), jsonb_build_object('ref', old_ref));
  ASSERT r ->> 'failure_class' = 'already_undone', 'T10 delete twice: ' || r::text;
  -- "geri al" (istemci undo, write_id): düzeltmenin tamamı geri alınır → eski kayıt döner, yeni gider.
  r := w_record_delete(a, gen_random_uuid(), jsonb_build_object('write_id', w ->> 'write_id'));
  ASSERT (r ->> 'ok')::boolean, 'T10 undo correction: ' || r::text;
  ASSERT (SELECT NOT is_deleted FROM meal_logs WHERE id = old_meal), 'T10 old not back';
  ASSERT (SELECT is_deleted FROM meal_logs WHERE id = (w ->> 'row_id')::uuid), 'T10 new not gone';
END $$;

-- ─── T11 kullanıcılar arası ref yalıtımı ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b1';
  r jsonb;
  bm jsonb;
BEGIN
  r := w_record_delete(b, gen_random_uuid(), '{"ref":"m1"}');
  ASSERT r ->> 'failure_class' = 'unknown_ref', 'T11 B resolved A''s ref: ' || r::text;
  r := w_record_delete(b, gen_random_uuid(), jsonb_build_object('write_id', (SELECT v FROM v2t WHERE k = 'meal1') ->> 'write_id'));
  ASSERT r ->> 'failure_class' = 'unknown_ref', 'T11 B used A''s write_id: ' || r::text;
  bm := w_meal_apply(b, gen_random_uuid(), jsonb_build_object('day', current_date, 'meal_type', 'breakfast', 'raw', 'muz',
          'items', jsonb_build_array(jsonb_build_object('name', 'muz', 'as_stated', '1 adet', 'kcal', 105, 'protein_g', 1.3, 'carbs_g', 27, 'fat_g', 0.4))));
  ASSERT bm ->> 'ref' = 'm1', 'T11 B''s own numbering: ' || bm::text;
  r := w_record_delete(a, gen_random_uuid(), '{"ref":"m1"}');
  ASSERT (r ->> 'ok')::boolean, 'T11 A delete own m1: ' || r::text;
  ASSERT (SELECT NOT is_deleted FROM meal_logs WHERE id = (bm ->> 'row_id')::uuid), 'T11 A deleted B''s meal';
  r := w_record_restore(a, gen_random_uuid(), '{"ref":"m1"}');
  ASSERT (r ->> 'ok')::boolean, 'T11 A restore m1: ' || r::text;
  r := w_record_delete(a, gen_random_uuid(), '{"ref":"c1"}');
  ASSERT r ->> 'failure_class' IN ('unknown_ref', 'not_deletable'), 'T11 constraint ref: ' || r::text;
END $$;

-- ─── T12 bekletme: aç → onayla (aynı işlem) → ikinci "evet" yazamaz; supersede; süresi dolmuş; KVKK tekilliği ──
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  h jsonb;
  h2 jsonb;
  r jsonb;
  n bigint;
  dup_blocked boolean := false;
BEGIN
  h := v2_hold_open(a, gen_random_uuid(), 'water_log', jsonb_build_object('quantity', 2, 'unit', 'sise_1500', 'mode', 'add'),
         jsonb_build_object('subject_key', 'water_log:' || current_date, 'reason_code', 'tek_seferde_cok', 'schema_version', 'kochko_understand_v1'));
  ASSERT (h ->> 'ok')::boolean AND left(h ->> 'ref', 1) = 'p', 'T12 open: ' || h::text;
  h2 := v2_hold_open(a, gen_random_uuid(), 'water_log', jsonb_build_object('quantity', 1, 'unit', 'sise_1500', 'mode', 'add'),
          jsonb_build_object('subject_key', 'water_log:' || current_date, 'reason_code', 'tek_seferde_cok'));
  ASSERT h2 ->> 'superseded_id' = h ->> 'pending_id', 'T12 supersede: ' || h2::text;
  ASSERT (SELECT status FROM pending_writes WHERE id = (h ->> 'pending_id')::uuid) = 'superseded', 'T12 old hold status';

  r := w_water_apply(a, gen_random_uuid(), jsonb_build_object('day', current_date, 'mode', 'add', 'liters', 1.5, 'pending_id', h ->> 'pending_id'));
  ASSERT r ->> 'failure_class' = 'hold_not_open', 'T12 superseded hold confirmed: ' || r::text;
  r := w_water_apply(a, gen_random_uuid(), jsonb_build_object('day', current_date, 'mode', 'add', 'liters', 1.5, 'pending_id', h2 ->> 'pending_id'));
  ASSERT (r ->> 'ok')::boolean, 'T12 confirm: ' || r::text;
  ASSERT (SELECT status = 'confirmed' AND result ->> 'write_id' = r ->> 'write_id' AND resolved_by_turn = (r ->> 'turn_id')::uuid
          FROM pending_writes WHERE id = (h2 ->> 'pending_id')::uuid), 'T12 hold not closed in the same transaction';
  n := (SELECT count(*) FROM turn_writes WHERE user_id = a);
  r := w_water_apply(a, gen_random_uuid(), jsonb_build_object('day', current_date, 'mode', 'add', 'liters', 1.5, 'pending_id', h2 ->> 'pending_id'));
  ASSERT r ->> 'failure_class' = 'hold_not_open' AND (SELECT count(*) FROM turn_writes WHERE user_id = a) = n, 'T12 second yes wrote: ' || r::text;
  r := w_meal_apply(a, gen_random_uuid(), jsonb_build_object('day', current_date, 'meal_type', 'snack', 'raw', 'x', 'pending_id', h2 ->> 'pending_id',
         'items', jsonb_build_array(jsonb_build_object('name', 'x', 'as_stated', '1', 'kcal', 1, 'protein_g', 0, 'carbs_g', 0, 'fat_g', 0))));
  ASSERT r ->> 'failure_class' = 'hold_not_open', 'T12 confirmed hold reused by another op: ' || r::text;

  INSERT INTO pending_writes (user_id, op, payload, expires_at) VALUES (a, 'profile_set', '{}', now() - interval '1 minute') RETURNING to_jsonb(pending_writes.*) INTO h;
  r := w_metric_apply(a, gen_random_uuid(), jsonb_build_object('metric', 'steps', 'day', current_date, 'values', jsonb_build_object('steps', 9000), 'pending_id', h ->> 'id'));
  ASSERT r ->> 'failure_class' IN ('hold_expired', 'hold_op_mismatch'), 'T12 expired/mismatched hold: ' || r::text;
  r := v2_hold_resolve(a, gen_random_uuid(), (h ->> 'id')::uuid, 'discarded', NULL, 'kullanıcı vazgeçti');
  ASSERT (r ->> 'ok')::boolean, 'T12 discard: ' || r::text;
  r := v2_hold_resolve(a, gen_random_uuid(), (h ->> 'id')::uuid, 'discarded', NULL, NULL);
  ASSERT r ->> 'failure_class' = 'hold_not_open', 'T12 double resolve: ' || r::text;
  -- Yazımı TS'te yapılan op (ör. constraint_retract → syncConstraint): onay + makbuz aynı çağrıda.
  h := v2_hold_open(a, gen_random_uuid(), 'constraint_retract', '{"target":"c1"}', '{"hold_class":"safety","reason_code":"severe_allergen_retract"}');
  ASSERT (h ->> 'ok')::boolean AND h ->> 'hold_class' = 'safety', 'T12 safety hold: ' || h::text;
  r := v2_hold_resolve(a, gen_random_uuid(), (h ->> 'pending_id')::uuid, 'confirmed', '{"ok":true}', NULL);
  ASSERT (r ->> 'ok')::boolean AND (SELECT status = 'confirmed' AND result = '{"ok":true}'::jsonb FROM pending_writes WHERE id = (h ->> 'pending_id')::uuid),
    'T12 confirm via resolve: ' || r::text;
  h := v2_hold_open(a, gen_random_uuid(), 'goal_set', '{}', '{"hold_class":"maybe"}');
  ASSERT h ->> 'failure_class' = 'invalid_value', 'T12 bad hold_class: ' || h::text;

  -- 106'nın KVKK kuralı aynen: subject_key'siz aynı op için ikinci açık bekletme açılamaz.
  INSERT INTO pending_writes (user_id, op, payload, expires_at) VALUES (a, 'account_erase_request', '{"scope":"memory"}', now() + interval '30 minutes');
  BEGIN
    INSERT INTO pending_writes (user_id, op, payload, expires_at) VALUES (a, 'account_erase_request', '{"scope":"account"}', now() + interval '30 minutes');
  EXCEPTION WHEN unique_violation THEN
    dup_blocked := true;
  END;
  ASSERT dup_blocked, 'T12 two open erase holds were allowed';
END $$;

-- ─── T13 v1 defter eki: v1'in yazdığı takviye ref alır, ref ile soft-delete olur; yabancı satır reddedilir ──
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  b uuid := '00000000-0000-4000-8000-0000000000b1';
  s uuid := gen_random_uuid();
  bs uuid := gen_random_uuid();
  r jsonb;
BEGIN
  INSERT INTO supplement_logs (id, user_id, supplement_name, amount, logged_for_date) VALUES (s, a, 'omega 3', '1 kapsül', current_date);
  INSERT INTO supplement_logs (id, user_id, supplement_name, amount, logged_for_date) VALUES (bs, b, 'kreatin', '5 g', current_date);
  r := v2_ledger_append(a, gen_random_uuid(), jsonb_build_array(jsonb_build_object(
         'op', 'supplement_log', 'table_name', 'supplement_logs', 'row_id', s, 'for_date', current_date,
         'undo_mode', 'soft_delete', 'after', jsonb_build_object('supplement_name', 'omega 3'))));
  ASSERT (r ->> 'ok')::boolean AND r -> 'entries' -> 0 ->> 'ref' = 's1', 'T13 append: ' || r::text;
  ASSERT (SELECT pipeline FROM turn_writes WHERE id = (r -> 'entries' -> 0 ->> 'write_id')::uuid) = 'v1', 'T13 pipeline';
  r := w_record_delete(a, gen_random_uuid(), '{"ref":"s1"}');
  ASSERT (r ->> 'ok')::boolean AND (SELECT is_deleted FROM supplement_logs WHERE id = s), 'T13 delete s1: ' || r::text;
  r := v2_ledger_append(a, gen_random_uuid(), jsonb_build_array(jsonb_build_object(
         'op', 'supplement_log', 'table_name', 'supplement_logs', 'row_id', bs, 'undo_mode', 'soft_delete')));
  ASSERT r ->> 'failure_class' = 'not_owner', 'T13 foreign row: ' || r::text;
  r := v2_ledger_append(a, gen_random_uuid(), jsonb_build_array(jsonb_build_object(
         'op', 'x', 'table_name', 'auth.users', 'row_id', a, 'undo_mode', 'soft_delete')));
  ASSERT r ->> 'failure_class' = 'invalid_value', 'T13 table outside the ledger: ' || r::text;
  r := v2_ledger_append(a, gen_random_uuid(), jsonb_build_array(jsonb_build_object(
         'op', 'water_log', 'table_name', 'daily_metrics', 'row_id', (SELECT id FROM daily_metrics WHERE user_id = a AND date = current_date),
         'undo_mode', 'soft_delete')));
  ASSERT r ->> 'failure_class' = 'invalid_value', 'T13 soft_delete on daily_metrics accepted: ' || r::text;
END $$;

-- ─── T13b v1'in "satırı ben açtım" metrik yazması geri alınınca günün satırı SİLİNMEZ, yalnız alan boşalır;
--          abonelik sütunları defterden asla yazılmaz ──────────────────────────────────────────────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  d date := current_date - 3;
  dm uuid := gen_random_uuid();
  r jsonb;
BEGIN
  INSERT INTO daily_metrics (id, user_id, date, steps, mood_score) VALUES (dm, a, d, 4200, 4);
  r := v2_ledger_append(a, gen_random_uuid(), jsonb_build_array(jsonb_build_object(
         'op', 'step_log', 'table_name', 'daily_metrics', 'row_id', dm, 'for_date', d, 'field_set', jsonb_build_array('steps'),
         'before', NULL, 'after', jsonb_build_object('steps', 4200), 'undo_mode', 'restore_previous')));
  ASSERT (r ->> 'ok')::boolean AND left(r -> 'entries' -> 0 ->> 'ref', 1) = 'd', 'T13b append: ' || r::text;
  r := w_record_delete(a, gen_random_uuid(), jsonb_build_object('ref', r -> 'entries' -> 0 ->> 'ref'));
  ASSERT (r ->> 'ok')::boolean, 'T13b delete: ' || r::text;
  ASSERT (SELECT steps IS NULL AND mood_score = 4 FROM daily_metrics WHERE id = dm), 'T13b day row deleted or other field touched';

  UPDATE profiles SET premium = false WHERE id = a;
  r := v2_ledger_append(a, gen_random_uuid(), jsonb_build_array(jsonb_build_object(
         'op', 'profile_set', 'table_name', 'profiles', 'row_id', a, 'field_set', jsonb_build_array('premium'),
         'before', jsonb_build_object('premium', true), 'after', jsonb_build_object('premium', false), 'undo_mode', 'restore_previous')));
  ASSERT r ->> 'failure_class' = 'invalid_value' AND r -> 'detail' ->> 'reason' = 'protected_column', 'T13b premium ledger accepted: ' || r::text;
  -- Defterde öyle bir satır olsa bile (doğrudan yazılmış), geri alma o sütunu yazamaz.
  INSERT INTO turn_writes (id, user_id, turn_id, op, table_name, row_id, field_set, before, after, undo_mode, group_id)
  VALUES ('00000000-0000-4000-8000-00000000f001', a, gen_random_uuid(), 'profile_set', 'profiles', a, ARRAY['premium'],
          '{"premium": true}', '{"premium": false}', 'restore_previous', gen_random_uuid());
  r := w_record_delete(a, gen_random_uuid(), '{"write_id":"00000000-0000-4000-8000-00000000f001"}');
  ASSERT NOT (r ->> 'ok')::boolean AND NOT (SELECT premium FROM profiles WHERE id = a), 'T13b premium written by undo: ' || r::text;
END $$;

-- ─── T14 antrenman + rekor başarımı birlikte gider/gelir ─────────────────────────────────────────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  w uuid := gen_random_uuid();
  ach uuid := gen_random_uuid();
  ti jsonb;
  t_ref text;
  r jsonb;
BEGIN
  INSERT INTO workout_logs (id, user_id, raw_input, workout_type, duration_min, intensity, logged_for_date)
  VALUES (w, a, 'squat 5x5 100 kg', 'strength', 45, 'high', current_date);
  INSERT INTO achievements (id, user_id, achievement_type, title, source_table, source_row_id)
  VALUES (ach, a, 'pr', 'Yeni rekor: squat 100kg', 'workout_logs', w);
  ti := v2_turn_input(a, current_date);
  SELECT e ->> 'ref' INTO t_ref FROM jsonb_array_elements(ti -> 'workouts') e WHERE e ->> 'id' = w::text;
  ASSERT t_ref = 't1', 'T14 workout ref: ' || coalesce(t_ref, 'null');
  r := w_record_delete(a, gen_random_uuid(), jsonb_build_object('ref', t_ref));
  ASSERT (r ->> 'ok')::boolean, 'T14 delete: ' || r::text;
  ASSERT (SELECT is_deleted FROM workout_logs WHERE id = w) AND (SELECT is_deleted FROM achievements WHERE id = ach), 'T14 PR survived';
  r := w_record_restore(a, gen_random_uuid(), jsonb_build_object('ref', t_ref));
  ASSERT (r ->> 'ok')::boolean, 'T14 restore: ' || r::text;
  ASSERT (SELECT NOT is_deleted FROM workout_logs WHERE id = w) AND (SELECT NOT is_deleted FROM achievements WHERE id = ach), 'T14 PR not back';
END $$;

-- ─── T14b tahlil ve yaşam olayı ref ile soft-delete; omurga ref'i record_ops ile silinemez ───────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  lab uuid := gen_random_uuid();
  ev uuid := gen_random_uuid();
  con uuid := gen_random_uuid();
  ti jsonb;
  r jsonb;
BEGIN
  INSERT INTO lab_values (id, user_id, parameter_name, value, unit, reference_min, measured_at)
  VALUES (lab, a, 'D vitamini', 12, 'ng/mL', 30, current_date);
  INSERT INTO life_events (id, user_id, title, event_type, event_date) VALUES (ev, a, 'kardeşimin düğünü', 'wedding', current_date + 20);
  INSERT INTO user_constraints (id, user_id, kind, subject, severity) VALUES (con, a, 'allergen', 'yer_fistigi', 'severe');
  ti := v2_turn_input(a, current_date);
  ASSERT (SELECT e ->> 'ref' FROM jsonb_array_elements(ti -> 'labs') e WHERE e ->> 'id' = lab::text) = 'l1', 'T14b lab ref';
  ASSERT (SELECT e ->> 'ref' FROM jsonb_array_elements(ti -> 'life_events') e WHERE e ->> 'id' = ev::text) = 'e1', 'T14b event ref';
  ASSERT (SELECT e ->> 'ref' FROM jsonb_array_elements(ti -> 'constraints') e WHERE e ->> 'id' = con::text) = 'c1', 'T14b constraint ref';
  r := w_record_delete(a, gen_random_uuid(), '{"ref":"l1"}');
  ASSERT (r ->> 'ok')::boolean AND (SELECT is_deleted FROM lab_values WHERE id = lab), 'T14b lab: ' || r::text;
  r := w_record_delete(a, gen_random_uuid(), '{"ref":"e1"}');
  ASSERT (r ->> 'ok')::boolean AND (SELECT is_deleted FROM life_events WHERE id = ev), 'T14b event: ' || r::text;
  -- Güvenlik kaydı record_ops ile silinmez: constraint_retract + iki adımlı onay (§6.2).
  r := w_record_delete(a, gen_random_uuid(), '{"ref":"c1"}');
  ASSERT r ->> 'failure_class' = 'not_deletable' AND (SELECT active FROM user_constraints WHERE id = con), 'T14b spine deleted: ' || r::text;
  ti := v2_turn_input(a, current_date);
  ASSERT jsonb_array_length(ti -> 'labs') = 0 AND jsonb_array_length(ti -> 'life_events') = 0, 'T14b deleted rows still in TurnInput';
END $$;

-- ─── T15 7 günden eski kayıt kimlikle silinemez ─────────────────────────────────────────────────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  m uuid := gen_random_uuid();
  r jsonb;
BEGIN
  INSERT INTO meal_logs (id, user_id, raw_input, meal_type, logged_for_date) VALUES (m, a, 'eski', 'lunch', current_date - 10);
  r := v2_ledger_append(a, gen_random_uuid(), jsonb_build_array(jsonb_build_object(
         'op', 'meal_log', 'table_name', 'meal_logs', 'row_id', m, 'undo_mode', 'soft_delete')));
  ASSERT (r ->> 'ok')::boolean, 'T15 append: ' || r::text;
  r := w_record_delete(a, gen_random_uuid(), jsonb_build_object('ref', r -> 'entries' -> 0 ->> 'ref'));
  ASSERT r ->> 'failure_class' = 'too_old', 'T15 old record: ' || r::text;
  ASSERT (SELECT NOT is_deleted FROM meal_logs WHERE id = m), 'T15 old record deleted';
END $$;

-- ─── T15b uygulama ekranında silinmiş (defter dışı) kayıt kimlikle geri getirilir, geri getirme deftere yazılır ──
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  m uuid := gen_random_uuid();
  ti jsonb;
  m_ref text;
  r jsonb;
BEGIN
  INSERT INTO meal_logs (id, user_id, raw_input, meal_type, logged_for_date) VALUES (m, a, 'menemen', 'breakfast', current_date);
  ti := v2_turn_input(a, current_date);
  SELECT e ->> 'ref' INTO m_ref FROM jsonb_array_elements(ti -> 'meals') e WHERE e ->> 'id' = m::text;
  ASSERT m_ref IS NOT NULL, 'T15b no ref';
  UPDATE meal_logs SET is_deleted = true, deleted_at = now() WHERE id = m;   -- istemcinin 10 sn undo'su
  r := w_record_restore(a, gen_random_uuid(), jsonb_build_object('ref', m_ref));
  ASSERT (r ->> 'ok')::boolean AND (SELECT NOT is_deleted FROM meal_logs WHERE id = m), 'T15b restore: ' || r::text;
  ASSERT EXISTS (SELECT 1 FROM turn_writes WHERE row_id = m AND op = 'record_restore'), 'T15b restore not in ledger';
  r := w_record_delete(a, gen_random_uuid(), jsonb_build_object('ref', m_ref));
  ASSERT (r ->> 'ok')::boolean AND (SELECT is_deleted FROM meal_logs WHERE id = m), 'T15b delete again: ' || r::text;
END $$;

-- ─── T16 yarıda kalan yazma geri sarılır: replaces çalıştıktan sonra toplam taşarsa d-ref canlı kalır ──
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  w jsonb;
  r jsonb;
  d date := current_date - 2;
BEGIN
  w := w_water_apply(a, gen_random_uuid(), jsonb_build_object('day', d, 'mode', 'add', 'liters', 0.5));
  ASSERT (w ->> 'ok')::boolean, 'T16 seed: ' || w::text;
  UPDATE daily_metrics SET water_liters = 99.5 WHERE user_id = a AND date = d;
  r := w_water_apply(a, gen_random_uuid(), jsonb_build_object('day', d, 'mode', 'add', 'liters', 1.0, 'replaces', w ->> 'ref'));
  ASSERT r ->> 'failure_class' = 'invalid_value', 'T16 overflow: ' || r::text;
  ASSERT (SELECT undone_at IS NULL FROM turn_writes WHERE id = (w ->> 'write_id')::uuid), 'T16 replaced write stayed undone after a failed transaction';
  ASSERT (SELECT water_liters FROM daily_metrics WHERE user_id = a AND date = d) = 99.5, 'T16 partial write leaked';
END $$;

-- ─── T17 v2_turn_input: şekil, ref kararlılığı, son tur, bekletmeler ────────────────────────────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  sess uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  ti1 jsonb;
  ti2 jsonb;
  k text;
  r jsonb;
  msg uuid := gen_random_uuid();
BEGIN
  INSERT INTO chat_sessions (id, user_id, is_active) VALUES (sess, a, true);
  r := w_metric_apply(a, t, jsonb_build_object('metric', 'steps', 'day', current_date, 'values', jsonb_build_object('steps', 8000.4)));
  ASSERT (r ->> 'ok')::boolean AND (r -> 'values' ->> 'steps')::integer = 8000, 'T17 steps: ' || r::text;
  INSERT INTO chat_messages (id, user_id, session_id, role, content, turn_id) VALUES (msg, a, sess, 'assistant', '8.000 adım kaydedildi', t);
  r := v2_link_turn_message(a, t, msg);
  ASSERT (r ->> 'ok')::boolean AND (r ->> 'writes')::integer = 1, 'T17 link: ' || r::text;

  ti1 := v2_turn_input(a, current_date);
  FOREACH k IN ARRAY ARRAY['schema', 'day', 'window', 'last_turn', 'profile', 'goal', 'safety', 'targets_today', 'constraints',
                           'meals', 'days', 'metric_writes', 'workouts', 'supplements', 'labs', 'life_events', 'weights_recent',
                           'recent_writes', 'pending', 'commitments', 'plans', 'portion_calibration', 'active_intent'] LOOP
    ASSERT ti1 ? k, 'T17 TurnInput missing key ' || k;
  END LOOP;
  ASSERT ti1 ->> 'schema' = 'v2_turn_input/1', 'T17 schema';
  ASSERT jsonb_array_length(ti1 -> 'days') = 7, 'T17 7 days';
  ASSERT (ti1 -> 'last_turn' ->> 'turn_id')::uuid = t, 'T17 last turn';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(ti1 -> 'metric_writes') e WHERE e ->> 'op' = 'step_log' AND (e ->> 'last_turn')::boolean),
    'T17 last-turn metric write not flagged';
  ASSERT (ti1 -> 'profile' ->> 'weight_kg')::numeric = 79.9, 'T17 profile fact';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ti1 -> 'meals') e WHERE (e ->> 'id')::uuid IN (SELECT id FROM meal_logs WHERE is_deleted)),
    'T17 deleted meal shown';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(ti1 -> 'pending') e WHERE e ->> 'op' = 'account_erase_request' AND left(e ->> 'ref', 1) = 'p'),
    'T17 pending hold missing';
  ASSERT (SELECT bool_and(e ? 'ref' AND e ? 'items') FROM jsonb_array_elements(ti1 -> 'meals') e), 'T17 meal without ref/items';
  ti2 := v2_turn_input(a, current_date);
  ASSERT (ti1 -> 'meals') = (ti2 -> 'meals') AND (ti1 -> 'metric_writes') = (ti2 -> 'metric_writes'), 'T17 refs not stable';
END $$;

-- ─── T18 30 gün saklama ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1';
  old_id uuid := gen_random_uuid();
  new_id uuid := gen_random_uuid();
  orphan_id uuid := gen_random_uuid();
  hold uuid := gen_random_uuid();
  r jsonb;
BEGIN
  INSERT INTO ai_turn_log (id, user_id, function_name, model_requested, model_served, pipeline, stage, decision, v1_actions, created_at)
  VALUES (old_id, a, 'ai-chat', 'm', 'm', 'v2_shadow', 'understand', '{"writes":[]}', '[]', now() - interval '31 days'),
         (new_id, a, 'ai-chat', 'm', 'm', 'v2_shadow', 'understand', '{"writes":[]}', '[]', now() - interval '2 days'),
         (orphan_id, NULL, 'ai-chat', 'm', 'm', 'v2', 'understand', '{"writes":[]}', NULL, now());
  INSERT INTO pending_writes (id, user_id, op, payload, status, expires_at, resolved_at)
  VALUES (hold, a, 'goal_set', '{}', 'discarded', now() - interval '40 days', now() - interval '31 days');
  r := v2_retention_sweep(30);
  ASSERT (r ->> 'turn_log_payloads_purged')::integer >= 2, 'T18 sweep: ' || r::text;
  ASSERT (SELECT decision IS NULL AND v1_actions IS NULL AND payload_purged_at IS NOT NULL FROM ai_turn_log WHERE id = old_id), 'T18 old payload kept';
  ASSERT (SELECT decision IS NULL FROM ai_turn_log WHERE id = orphan_id), 'T18 deleted-user payload kept';
  ASSERT (SELECT decision IS NOT NULL FROM ai_turn_log WHERE id = new_id), 'T18 fresh payload purged';
  ASSERT EXISTS (SELECT 1 FROM ai_turn_log WHERE id = old_id), 'T18 metrics row deleted';
  ASSERT NOT EXISTS (SELECT 1 FROM pending_writes WHERE id = hold), 'T18 old resolved hold kept';
  ASSERT NOT EXISTS (SELECT 1 FROM pending_writes WHERE status = 'pending' AND expires_at < now()), 'T18 stale hold not expired';
END $$;

-- ─── T19 RLS: kullanıcı yalnız KENDİ defterini/ref'lerini okur, yazamaz ─────────────────────────────
GRANT SELECT ON turn_writes, record_refs TO authenticated;  -- Supabase varsayılan yetkileri zaten verir; yalın dal için
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b1', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
DO $$
DECLARE blocked boolean := false;
BEGIN
  ASSERT (SELECT count(*) FROM turn_writes) > 0, 'T19 owner cannot read own ledger';
  ASSERT NOT EXISTS (SELECT 1 FROM turn_writes WHERE user_id <> '00000000-0000-4000-8000-0000000000b1'), 'T19 RLS leak on turn_writes';
  ASSERT NOT EXISTS (SELECT 1 FROM record_refs WHERE user_id <> '00000000-0000-4000-8000-0000000000b1'), 'T19 RLS leak on record_refs';
  BEGIN
    INSERT INTO turn_writes (user_id, turn_id, op, table_name, undo_mode, group_id)
    VALUES ('00000000-0000-4000-8000-0000000000b1', gen_random_uuid(), 'meal_log', 'meal_logs', 'none', gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  ASSERT blocked, 'T19 a client could write its own ledger';
END $$;
RESET ROLE;

SELECT 'v2_rpc_test OK' AS result;
ROLLBACK;

-- 113: v2 yazıcı RPC'leri (öğün, su, metrikler) + v2_turn_input (Stage A'nın gördüğü TurnInput).
--
-- NEDEN (AI_MIMARI_V2 §3.2 T3/T5, §4.4, §6.1 · Faz 1): bugün bir öğün 8-10 sıralı supabase-js turu
-- (ebeveyn, kalemler, geri sarma, mekân…) ve her biri ayrı ayrı başarısız olabiliyor; su "önce oku,
-- sonra yaz" yarışıyla istemcinin su ekranını eziyor; hiçbir yazmanın önceki değeri tutulmuyor.
-- Her yazıcı RPC TEK işlemdir: kayıt + yan etkiler + turn_writes satırı + (varsa) bekletmenin onayı
-- + (varsa) düzeltilen eski kaydın geri alınması ya hep birlikte olur ya hiç olmaz.
--
-- SÖZLEŞME (yapay zekâ anlar, kod denetler):
--   * Anlamı model verir, aritmetiği TS'teki kayıt (derive) yapar, kuralları TS validatorü uygular.
--     Bu RPC'ler yalnızca DB bütünlüğünü korur: tip, DB sütun sınırları, sahiplik, ref çözümü, atomiklik.
--     Aralık dışı değer KIRPILMAZ, gerekçeli reddedilir (ok:false, failure_class:'invalid_value', detail.path).
--   * as_stated AYNEN saklanır, asla ayrıştırılmaz. Su litresi kodun derive() sonucudur (bardak → ml → L).
--   * Kayıpsız normalleştirme (uyku 7,46 → 7,5 sa; adım 8000,4 → 8000) makbuzun normalized[] alanında görünür.
--   * replaces: aynı tipte yeni kayıt + eskisinin geri alınması, aynı işlemde ve aynı grupta (§6.2).
--   * pending_id: onaylanan bekletme aynı işlemde 'confirmed' olur; tekrar gelen "evet" ikinci kez yazamaz.
--   * Her RPC her zaman bir makbuz döner: {ok:true, …} ya da {ok:false, failure_class, detail}.
--
-- v2_turn_input(uid, gün): Stage A'nın TurnInput'u (§3.2 T3, §4.2). Son 7 günün kayıtları kalıcı kısa
-- ref'lerle, bugünkü metrikler, defterin son yazmaları, profil olguları, omurga, bekleyen onaylar,
-- açık sözler, plan/taslak özeti. Geçmiş (sohbet) ve REFERANS ADAYLARI TS'te eklenir. Görüntülenecek
-- kayıtlara ref atadığı için VOLATILE'dır (yalnız record_refs'e yazar; kullanıcı verisine dokunmaz).
--
-- Yalnız service_role. DOWN:
--   DROP FUNCTION IF EXISTS public.v2_turn_input(uuid, date), public.w_metric_apply(uuid, uuid, jsonb),
--     public.w_water_apply(uuid, uuid, jsonb), public.w_meal_apply(uuid, uuid, jsonb);

-- ─── Su ────────────────────────────────────────────────────────────────────────────────────────────
-- p_payload: {day, mode:'add'|'set_day_total', liters (kodun derive sonucu, 0..8), as_stated?, quantity?,
--             unit?, replaces?:'d#', pending_id?, pipeline?:'v1'|'v2', meta?}
-- add → atomik artırma (satır kilidi altında), geri alma = farkı düş (istemcinin araya giren eklemelerini ezmez).
-- set_day_total → mutlak değer, geri alma = önceki toplam (sonradan değiştiyse 'later_write').
CREATE OR REPLACE FUNCTION public.w_water_apply(p_user uuid, p_turn_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_op       constant text := 'water_log';
  v_p        jsonb := coalesce(p_payload, '{}'::jsonb);
  v_group    uuid := gen_random_uuid();
  v_write    uuid := gen_random_uuid();
  v_day      date;
  v_mode     text;
  v_liters   numeric;
  v_pipeline text;
  v_hold     uuid;
  v_replaced jsonb;
  v_row      uuid;
  v_prev     numeric;
  v_next     numeric;
  v_ref      text;
  v_receipt  jsonb;
  v_msg      text;
  v_detail   text;
  v_state    text;
BEGIN
  BEGIN
    IF p_user IS NULL OR p_turn_id IS NULL THEN PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'identity')); END IF;
    v_day := _v2_day(v_p ->> 'day');
    v_mode := _v2_text(v_p, 'mode', 20, false, 'mode');
    IF v_mode NOT IN ('add', 'set_day_total') THEN
      PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'mode', 'value', v_mode));
    END IF;
    v_liters := round(_v2_num(v_p, 'liters', 0, 8, false, 'liters'), 2);
    -- "Bugün hiç su içmedim" geçerli bir gün toplamıdır; 0 eklemek ise hiçbir şey yazmaz.
    IF v_mode = 'add' AND v_liters <= 0 THEN PERFORM _v2_fail('no_op', jsonb_build_object('path', 'liters')); END IF;
    v_pipeline := _v2_pipeline(v_p ->> 'pipeline');
    PERFORM _v2_text(v_p, 'as_stated', 120, true, 'as_stated');
    IF v_p ? 'meta' AND jsonb_typeof(v_p -> 'meta') NOT IN ('object', 'null') THEN
      PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'meta'));
    END IF;

    IF nullif(v_p ->> 'pending_id', '') IS NOT NULL THEN
      v_hold := (v_p ->> 'pending_id')::uuid;
      PERFORM _v2_hold_claim(p_user, v_hold, v_op);
    END IF;
    IF nullif(v_p ->> 'replaces', '') IS NOT NULL THEN
      v_replaced := _v2_record_op(p_user, p_turn_id, jsonb_build_object('ref', v_p ->> 'replaces'), 'delete', v_group,
                      jsonb_build_object('expect_kind', 'd', 'expect_op', v_op, 'pipeline', v_pipeline, 'reason', 'replaced'));
    END IF;

    INSERT INTO daily_metrics (user_id, date, synced) VALUES (p_user, v_day, true) ON CONFLICT (user_id, date) DO NOTHING;
    SELECT id, water_liters INTO v_row, v_prev FROM daily_metrics WHERE user_id = p_user AND date = v_day FOR UPDATE;
    v_next := CASE WHEN v_mode = 'add' THEN coalesce(v_prev, 0) + v_liters ELSE v_liters END;
    IF v_next > 99.99 THEN
      PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'liters', 'reason', 'day_total_out_of_range', 'total', v_next));
    END IF;
    UPDATE daily_metrics SET water_liters = v_next, synced = true WHERE id = v_row;

    v_ref := _v2_ref_for(p_user, 'd', 'turn_writes', v_write);
    PERFORM _v2_ledger_insert(v_write, p_user, p_turn_id, v_pipeline, v_op, 'daily_metrics', v_row, v_day, ARRAY['water_liters'],
      jsonb_build_object('water_liters', v_prev), jsonb_build_object('water_liters', v_next),
      CASE WHEN v_mode = 'add' THEN 'revert_delta' ELSE 'restore_previous' END, v_group, true, v_ref, NULL,
      coalesce(CASE WHEN jsonb_typeof(v_p -> 'meta') = 'object' THEN v_p -> 'meta' END, '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object('mode', v_mode, 'liters', v_liters, 'as_stated', v_p -> 'as_stated',
             'quantity', v_p -> 'quantity', 'unit', v_p -> 'unit', 'replaces', v_p -> 'replaces', 'pending_id', v_hold)));

    v_receipt := jsonb_build_object('ok', true, 'op', v_op, 'turn_id', p_turn_id, 'write_id', v_write, 'group_id', v_group,
      'ref', v_ref, 'day', v_day, 'mode', v_mode, 'liters', v_liters, 'previous_total', v_prev, 'total', v_next,
      'replaced', v_replaced, 'pending_id', v_hold);
    IF v_hold IS NOT NULL THEN PERFORM _v2_hold_close(v_hold, 'confirmed', p_turn_id, v_receipt, 'confirmed'); END IF;
    RETURN v_receipt;
  EXCEPTION
    WHEN SQLSTATE 'V2F01' THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
      RETURN _v2_failure(v_op, v_msg, v_detail);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
      RETURN _v2_write_failed(v_op, v_state, v_msg);
  END;
END $$;

-- ─── Uyku / mood / adım / tartı ───────────────────────────────────────────────────────────────────
-- p_payload: {metric:'sleep'|'mood'|'steps'|'weight', day, values, as_stated?, replaces?:'d#'|'w#',
--             pending_id?, pipeline?, meta?, update_profile?:boolean (yalnız tartı; TS "kullanıcının bugünü" ise true)}
--   sleep  values {hours (0<h<24), quality: good|ok|bad|null, sleep_time?: 'HH:MM'|null, wake_time?: 'HH:MM'|null}
--   mood   values {score: 1..5 tamsayı (8/10 → 4 dönüşümü TS derive'ın işi; burada KIRPMA YOK), note?}
--   steps  values {steps: 0..100000, source?: manual|phone|wearable}
--   weight values {kg: 20..300} → daily_metrics + weight_history (+ profiles.weight_kg), tek grupta
-- Hepsi restore_previous: geri alma = önceki değer (sonradan değiştiyse 'later_write').
CREATE OR REPLACE FUNCTION public.w_metric_apply(p_user uuid, p_turn_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p        jsonb := coalesce(p_payload, '{}'::jsonb);
  v_metric   text;
  v_op       text := 'metric_log';
  v_kind     text;
  v_vals     jsonb;
  v_new      jsonb := '{}'::jsonb;
  v_norm     jsonb := '[]'::jsonb;
  v_key      text;
  v_n        numeric;
  v_r        numeric;
  v_t        text;
  v_day      date;
  v_pipeline text;
  v_hold     uuid;
  v_replaced jsonb;
  v_group    uuid := gen_random_uuid();
  v_write    uuid := gen_random_uuid();
  v_ref      text;
  v_row      uuid;
  v_cur      jsonb;
  v_fields   text[];
  v_before   jsonb;
  v_meta     jsonb;
  v_wh_id    uuid;
  v_wh_prev  numeric;
  v_prof_prev numeric;
  v_side     jsonb := '[]'::jsonb;
  v_receipt  jsonb;
  v_msg      text;
  v_detail   text;
  v_state    text;
BEGIN
  BEGIN
    IF p_user IS NULL OR p_turn_id IS NULL THEN PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'identity')); END IF;
    v_metric := _v2_text(v_p, 'metric', 10, false, 'metric');
    v_op := CASE v_metric WHEN 'sleep' THEN 'sleep_log' WHEN 'mood' THEN 'mood_log'
                          WHEN 'steps' THEN 'step_log' WHEN 'weight' THEN 'body_weight' END;
    IF v_op IS NULL THEN
      v_op := 'metric_log';
      PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'metric', 'value', v_metric));
    END IF;
    v_kind := CASE WHEN v_metric = 'weight' THEN 'w' ELSE 'd' END;
    v_day := _v2_day(v_p ->> 'day');
    v_pipeline := _v2_pipeline(v_p ->> 'pipeline');
    PERFORM _v2_text(v_p, 'as_stated', 120, true, 'as_stated');
    v_vals := v_p -> 'values';
    IF jsonb_typeof(v_vals) IS DISTINCT FROM 'object' THEN PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'values')); END IF;
    IF v_p ? 'meta' AND jsonb_typeof(v_p -> 'meta') NOT IN ('object', 'null') THEN
      PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'meta'));
    END IF;

    IF v_metric = 'sleep' THEN
      v_n := _v2_num(v_vals, 'hours', 0, 24, false, 'values.hours');
      IF v_n <= 0 OR v_n >= 24 THEN
        PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'values.hours', 'reason', 'out_of_range', 'value', v_n));
      END IF;
      v_r := round(v_n, 1);  -- DECIMAL(3,1)
      IF v_r <> v_n THEN v_norm := v_norm || jsonb_build_object('path', 'values.hours', 'from', v_n, 'to', v_r); END IF;
      v_t := _v2_text(v_vals, 'quality', 10, true, 'values.quality');
      IF v_t IS NOT NULL AND v_t NOT IN ('good', 'ok', 'bad') THEN
        PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'values.quality', 'value', v_t));
      END IF;
      v_new := jsonb_build_object('sleep_hours', v_r, 'sleep_quality', v_t);
      FOREACH v_key IN ARRAY ARRAY['sleep_time', 'wake_time'] LOOP
        IF v_vals ? v_key THEN
          v_t := _v2_text(v_vals, v_key, 5, true, 'values.' || v_key);
          IF v_t IS NOT NULL AND v_t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
            PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'values.' || v_key, 'value', v_t, 'reason', 'not_hh_mm'));
          END IF;
          v_new := v_new || jsonb_build_object(v_key, v_t);
        END IF;
      END LOOP;
    ELSIF v_metric = 'mood' THEN
      v_n := _v2_num(v_vals, 'score', 1, 5, false, 'values.score');
      IF v_n <> trunc(v_n) THEN
        PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'values.score', 'reason', 'not_an_integer', 'value', v_n));
      END IF;
      v_new := jsonb_build_object('mood_score', v_n::integer, 'mood_note', _v2_text(v_vals, 'note', 500, true, 'values.note'));
    ELSIF v_metric = 'steps' THEN
      v_n := _v2_num(v_vals, 'steps', 0, 100000, false, 'values.steps');
      v_r := round(v_n);
      IF v_r <> v_n THEN v_norm := v_norm || jsonb_build_object('path', 'values.steps', 'from', v_n, 'to', v_r); END IF;
      v_t := coalesce(_v2_text(v_vals, 'source', 10, true, 'values.source'), 'manual');
      IF v_t NOT IN ('manual', 'phone', 'wearable') THEN
        PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'values.source', 'value', v_t));
      END IF;
      v_new := jsonb_build_object('steps', v_r::integer, 'steps_source', v_t);
    ELSE -- weight
      v_n := _v2_num(v_vals, 'kg', 20, 300, false, 'values.kg');
      v_r := round(v_n, 2);  -- DECIMAL(5,2)
      IF v_r <> v_n THEN v_norm := v_norm || jsonb_build_object('path', 'values.kg', 'from', v_n, 'to', v_r); END IF;
      v_new := jsonb_build_object('weight_kg', v_r);
    END IF;

    IF nullif(v_p ->> 'pending_id', '') IS NOT NULL THEN
      v_hold := (v_p ->> 'pending_id')::uuid;
      PERFORM _v2_hold_claim(p_user, v_hold, v_op);
    END IF;
    IF nullif(v_p ->> 'replaces', '') IS NOT NULL THEN
      v_replaced := _v2_record_op(p_user, p_turn_id, jsonb_build_object('ref', v_p ->> 'replaces'), 'delete', v_group,
                      jsonb_build_object('expect_kind', v_kind, 'expect_op', v_op, 'pipeline', v_pipeline, 'reason', 'replaced'));
    END IF;

    INSERT INTO daily_metrics (user_id, date, synced) VALUES (p_user, v_day, true) ON CONFLICT (user_id, date) DO NOTHING;
    SELECT dm.id, to_jsonb(dm) INTO v_row, v_cur FROM daily_metrics dm WHERE dm.user_id = p_user AND dm.date = v_day FOR UPDATE;
    v_fields := ARRAY(SELECT jsonb_object_keys(v_new) ORDER BY 1);
    v_before := _v2_subset(v_cur, v_fields);
    PERFORM _v2_set_fields('daily_metrics', v_row, v_new || jsonb_build_object('synced', true));
    -- "after" DB'nin kendi gösterimiyle ('07:00' → "07:00:00"): geri almanın çakışma denetimi birebir karşılaştırır.
    v_new := _v2_subset(_v2_row_state('daily_metrics', v_row), v_fields);

    v_meta := coalesce(CASE WHEN jsonb_typeof(v_p -> 'meta') = 'object' THEN v_p -> 'meta' END, '{}'::jsonb)
              || jsonb_strip_nulls(jsonb_build_object('metric', v_metric, 'as_stated', v_p -> 'as_stated',
                                                      'replaces', v_p -> 'replaces', 'pending_id', v_hold));
    v_ref := _v2_ref_for(p_user, v_kind, 'turn_writes', v_write);
    PERFORM _v2_ledger_insert(v_write, p_user, p_turn_id, v_pipeline, v_op, 'daily_metrics', v_row, v_day, v_fields,
                              v_before, v_new, 'restore_previous', v_group, true, v_ref, NULL, v_meta);

    IF v_metric = 'weight' THEN
      -- weight_history: günde tek satır (049).
      SELECT id, weight_kg INTO v_wh_id, v_wh_prev FROM weight_history WHERE user_id = p_user AND recorded_at = v_day FOR UPDATE;
      IF FOUND THEN
        UPDATE weight_history SET weight_kg = v_r WHERE id = v_wh_id;
        PERFORM _v2_ledger_insert(NULL, p_user, p_turn_id, v_pipeline, v_op, 'weight_history', v_wh_id, v_day, ARRAY['weight_kg'],
                                  jsonb_build_object('weight_kg', v_wh_prev), jsonb_build_object('weight_kg', v_r),
                                  'restore_previous', v_group, false, NULL, NULL, '{}'::jsonb);
      ELSE
        v_wh_id := gen_random_uuid();
        INSERT INTO weight_history (id, user_id, weight_kg, recorded_at) VALUES (v_wh_id, p_user, v_r, v_day);
        PERFORM _v2_ledger_insert(NULL, p_user, p_turn_id, v_pipeline, v_op, 'weight_history', v_wh_id, v_day, ARRAY['weight_kg'],
                                  NULL, jsonb_build_object('weight_kg', v_r, 'recorded_at', v_day),
                                  'restore_previous', v_group, false, NULL, NULL, '{}'::jsonb);
      END IF;
      v_side := v_side || jsonb_build_object('table', 'weight_history', 'row_id', v_wh_id, 'previous', v_wh_prev);
      -- Geçmiş tarihli tartı canlı kiloyu ezmez (AI-INT-04): "bugün mü" kararını TS verir.
      IF coalesce((v_p ->> 'update_profile')::boolean, false) THEN
        SELECT weight_kg INTO v_prof_prev FROM profiles WHERE id = p_user FOR UPDATE;
        UPDATE profiles SET weight_kg = v_r, updated_at = now() WHERE id = p_user;
        PERFORM _v2_ledger_insert(NULL, p_user, p_turn_id, v_pipeline, v_op, 'profiles', p_user, v_day, ARRAY['weight_kg'],
                                  jsonb_build_object('weight_kg', v_prof_prev), jsonb_build_object('weight_kg', v_r),
                                  'restore_previous', v_group, false, NULL, NULL, '{}'::jsonb);
        v_side := v_side || jsonb_build_object('table', 'profiles', 'row_id', p_user, 'previous', v_prof_prev);
      END IF;
    END IF;

    v_receipt := jsonb_build_object('ok', true, 'op', v_op, 'metric', v_metric, 'turn_id', p_turn_id, 'write_id', v_write,
      'group_id', v_group, 'ref', v_ref, 'day', v_day, 'values', v_new, 'previous', v_before, 'normalized', v_norm,
      'side_effects', v_side, 'replaced', v_replaced, 'pending_id', v_hold);
    IF v_hold IS NOT NULL THEN PERFORM _v2_hold_close(v_hold, 'confirmed', p_turn_id, v_receipt, 'confirmed'); END IF;
    RETURN v_receipt;
  EXCEPTION
    WHEN SQLSTATE 'V2F01' THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
      RETURN _v2_failure(v_op, v_msg, v_detail);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
      RETURN _v2_write_failed(v_op, v_state, v_msg);
  END;
END $$;

-- ─── Öğün ──────────────────────────────────────────────────────────────────────────────────────────
-- p_payload: {day, meal_type, raw, input_method?, time_local?, venue?:{name, type?}, replaces?:'m#',
--             pending_id?, pipeline?, meta?,
--             items:[{name, as_stated, grams|null, kcal, protein_g, carbs_g, fat_g, alcohol_g?, caffeine_mg?,
--                     preparation?, allergens?[], may_contain?[], reference_key?, confidence?, data_source?, meta?}]}
-- Kalemlerin sayıları TS'in COMMIT sonucudur (reference_key varsa gram × referans/100 — modelin seçimi;
-- yoksa modelin sayıları). Bu RPC hiçbir sayıyı yeniden hesaplamaz.
CREATE OR REPLACE FUNCTION public.w_meal_apply(p_user uuid, p_turn_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_op        constant text := 'meal_log';
  v_p         jsonb := coalesce(p_payload, '{}'::jsonb);
  v_group     uuid := gen_random_uuid();
  v_write     uuid := gen_random_uuid();
  v_meal      uuid := gen_random_uuid();
  v_day       date;
  v_type      text;
  v_raw       text;
  v_method    text;
  v_pipeline  text;
  v_items     jsonb;
  v_item      jsonb;
  v_i         integer := 0;
  v_t         text;
  v_minconf   numeric;
  v_conf      text;
  v_hold      uuid;
  v_replaced  jsonb;
  v_old_meal  uuid;
  v_vname     text;
  v_vtype     text;
  v_vid       uuid;
  v_vprev     integer;
  v_vnext     integer;
  v_venue     jsonb;
  v_items_out jsonb;
  v_kcal      numeric;
  v_protein   numeric;
  v_carbs     numeric;
  v_fat       numeric;
  v_alcohol   numeric;
  v_ref       text;
  v_receipt   jsonb;
  v_msg       text;
  v_detail    text;
  v_state     text;
BEGIN
  BEGIN
    IF p_user IS NULL OR p_turn_id IS NULL THEN PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'identity')); END IF;
    v_day := _v2_day(v_p ->> 'day');
    v_type := _v2_text(v_p, 'meal_type', 20, false, 'meal_type');
    -- Enum varsayılanına düşme YOK (§5.3): bilinmeyen öğün tipi 'snack' olmaz, reddedilir.
    IF v_type NOT IN ('breakfast', 'lunch', 'dinner', 'snack') THEN
      PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'meal_type', 'value', v_type));
    END IF;
    v_raw := coalesce(_v2_text(v_p, 'raw', 2000, true, 'raw'), '');
    v_method := coalesce(_v2_text(v_p, 'input_method', 20, true, 'input_method'), 'ai_chat');
    IF v_method NOT IN ('text', 'photo', 'barcode', 'voice', 'template', 'ai_chat') THEN
      PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'input_method', 'value', v_method));
    END IF;
    v_pipeline := _v2_pipeline(v_p ->> 'pipeline');
    v_t := _v2_text(v_p, 'time_local', 5, true, 'time_local');
    IF v_t IS NOT NULL AND v_t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'time_local', 'value', v_t, 'reason', 'not_hh_mm'));
    END IF;
    IF v_p ? 'meta' AND jsonb_typeof(v_p -> 'meta') NOT IN ('object', 'null') THEN
      PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'meta'));
    END IF;

    v_items := v_p -> 'items';
    IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) NOT BETWEEN 1 AND 20 THEN
      PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'items', 'reason', 'need_1_to_20_items'));
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
      IF jsonb_typeof(v_item) <> 'object' THEN
        PERFORM _v2_fail('invalid_value', jsonb_build_object('path', format('items[%s]', v_i)));
      END IF;
      v_t := btrim(_v2_text(v_item, 'name', 200, false, format('items[%s].name', v_i)));
      IF v_t = '' THEN PERFORM _v2_fail('invalid_value', jsonb_build_object('path', format('items[%s].name', v_i), 'reason', 'empty')); END IF;
      PERFORM _v2_text(v_item, 'as_stated', 200, true, format('items[%s].as_stated', v_i));
      -- DB sütun sınırları (SMALLINT / DECIMAL(5,1) / DECIMAL(7,1)). Kayıttaki sert aralıklar TS'te.
      PERFORM _v2_num(v_item, 'kcal',        0, 32767,    false, format('items[%s].kcal', v_i));
      PERFORM _v2_num(v_item, 'protein_g',   0, 9999.9,   false, format('items[%s].protein_g', v_i));
      PERFORM _v2_num(v_item, 'carbs_g',     0, 9999.9,   false, format('items[%s].carbs_g', v_i));
      PERFORM _v2_num(v_item, 'fat_g',       0, 9999.9,   false, format('items[%s].fat_g', v_i));
      PERFORM _v2_num(v_item, 'alcohol_g',   0, 9999.9,   true,  format('items[%s].alcohol_g', v_i));
      PERFORM _v2_num(v_item, 'grams',       0, 999999.9, true,  format('items[%s].grams', v_i));
      PERFORM _v2_num(v_item, 'confidence',  0, 1,        true,  format('items[%s].confidence', v_i));
      PERFORM _v2_num(v_item, 'caffeine_mg', 0, 100000,   true,  format('items[%s].caffeine_mg', v_i));
      PERFORM _v2_text(v_item, 'reference_key', 120, true, format('items[%s].reference_key', v_i));
      PERFORM _v2_text(v_item, 'preparation', 80, true, format('items[%s].preparation', v_i));
      PERFORM _v2_text_array(v_item, 'allergens', format('items[%s].allergens', v_i));
      PERFORM _v2_text_array(v_item, 'may_contain', format('items[%s].may_contain', v_i));
      v_t := _v2_text(v_item, 'data_source', 20, true, format('items[%s].data_source', v_i));
      IF v_t IS NOT NULL AND v_t NOT IN ('ai_estimate', 'reference', 'barcode', 'user_correction', 'venue_memory', 'template') THEN
        PERFORM _v2_fail('invalid_value', jsonb_build_object('path', format('items[%s].data_source', v_i), 'value', v_t));
      END IF;
      IF v_item ? 'meta' AND jsonb_typeof(v_item -> 'meta') NOT IN ('object', 'null') THEN
        PERFORM _v2_fail('invalid_value', jsonb_build_object('path', format('items[%s].meta', v_i)));
      END IF;
      v_i := v_i + 1;
    END LOOP;

    IF jsonb_typeof(v_p -> 'venue') = 'object' THEN
      v_vname := btrim(_v2_text(v_p -> 'venue', 'name', 120, false, 'venue.name'));
      IF v_vname = '' THEN PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'venue.name', 'reason', 'empty')); END IF;
      v_vtype := _v2_text(v_p -> 'venue', 'type', 40, true, 'venue.type');
    ELSIF v_p ? 'venue' AND jsonb_typeof(v_p -> 'venue') <> 'null' THEN
      PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'venue'));
    END IF;

    IF nullif(v_p ->> 'pending_id', '') IS NOT NULL THEN
      v_hold := (v_p ->> 'pending_id')::uuid;
      PERFORM _v2_hold_claim(p_user, v_hold, v_op);
    END IF;
    -- Düzeltme: eski öğün AYNI işlemde ve AYNI grupta geri alınır; yenisi onu supersedes_id ile gösterir.
    IF nullif(v_p ->> 'replaces', '') IS NOT NULL THEN
      v_replaced := _v2_record_op(p_user, p_turn_id, jsonb_build_object('ref', v_p ->> 'replaces'), 'delete', v_group,
                      jsonb_build_object('expect_kind', 'm', 'pipeline', v_pipeline, 'reason', 'replaced'));
      v_old_meal := (v_replaced -> 'target' ->> 'row_id')::uuid;
    END IF;

    -- Güven kovası en düşük kalemden (v1 ile aynı eşikler; ConfidenceBadge bunu okur).
    SELECT min((e ->> 'confidence')::numeric) INTO v_minconf
    FROM jsonb_array_elements(v_items) AS e WHERE jsonb_typeof(e -> 'confidence') = 'number';
    v_conf := CASE WHEN v_minconf IS NULL THEN 'medium' WHEN v_minconf >= 0.85 THEN 'high'
                   WHEN v_minconf >= 0.65 THEN 'medium' ELSE 'low' END;

    INSERT INTO meal_logs (id, user_id, raw_input, input_method, meal_type, confidence, logged_for_date, synced, supersedes_id)
    VALUES (v_meal, p_user, v_raw, v_method, v_type, v_conf, v_day, true, v_old_meal);

    WITH src AS (
      SELECT gen_random_uuid() AS id, e.ord::integer AS ord, e.val
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(val, ord)
    ), ins AS (
      INSERT INTO meal_log_items (id, meal_log_id, food_name, portion_text, portion_grams, calories, protein_g, carbs_g, fat_g,
                                  alcohol_g, data_source, as_stated, reference_key, allergen_tags, meta)
      SELECT s.id, v_meal, btrim(s.val ->> 'name'),
             -- portion_text NOT NULL ve eski okuyucular onu gösterir: kullanıcının ifadesi AYNEN.
             coalesce(s.val ->> 'as_stated', ''),
             round((s.val ->> 'grams')::numeric, 1),
             round((s.val ->> 'kcal')::numeric)::integer,
             round((s.val ->> 'protein_g')::numeric, 1),
             round((s.val ->> 'carbs_g')::numeric, 1),
             round((s.val ->> 'fat_g')::numeric, 1),
             coalesce(round((s.val ->> 'alcohol_g')::numeric, 1), 0),
             coalesce(s.val ->> 'data_source',
                      CASE WHEN nullif(s.val ->> 'reference_key', '') IS NOT NULL THEN 'reference' ELSE 'ai_estimate' END),
             s.val ->> 'as_stated',
             nullif(s.val ->> 'reference_key', ''),
             CASE WHEN jsonb_typeof(s.val -> 'allergens') = 'array'
                  THEN ARRAY(SELECT a FROM jsonb_array_elements_text(s.val -> 'allergens') AS a) ELSE '{}'::text[] END,
             coalesce(CASE WHEN jsonb_typeof(s.val -> 'meta') = 'object' THEN s.val -> 'meta' END, '{}'::jsonb)
               || jsonb_strip_nulls(jsonb_build_object(
                    'position', s.ord,
                    'may_contain', CASE WHEN jsonb_typeof(s.val -> 'may_contain') = 'array' THEN s.val -> 'may_contain' END,
                    'confidence', s.val -> 'confidence',
                    'preparation', s.val -> 'preparation',
                    'caffeine_mg', s.val -> 'caffeine_mg'))
      FROM src AS s
      RETURNING id, food_name, portion_text, as_stated, portion_grams, calories, protein_g, carbs_g, fat_g, alcohol_g,
                data_source, reference_key, allergen_tags, meta
    )
    SELECT jsonb_agg(jsonb_build_object('id', i.id, 'name', i.food_name, 'as_stated', i.as_stated, 'grams', i.portion_grams,
                       'kcal', i.calories, 'protein_g', i.protein_g, 'carbs_g', i.carbs_g, 'fat_g', i.fat_g,
                       'alcohol_g', i.alcohol_g, 'data_source', i.data_source, 'reference_key', i.reference_key,
                       'allergen_tags', to_jsonb(i.allergen_tags), 'may_contain', coalesce(i.meta -> 'may_contain', '[]'::jsonb),
                       'confidence', i.meta -> 'confidence') ORDER BY s.ord),
           sum(i.calories), sum(i.protein_g), sum(i.carbs_g), sum(i.fat_g), sum(i.alcohol_g)
    INTO v_items_out, v_kcal, v_protein, v_carbs, v_fat, v_alcohol
    FROM ins AS i JOIN src AS s ON s.id = i.id;

    v_ref := _v2_ref_for(p_user, 'm', 'meal_logs', v_meal);
    PERFORM _v2_ledger_insert(v_write, p_user, p_turn_id, v_pipeline, v_op, 'meal_logs', v_meal, v_day, '{}'::text[], NULL,
      jsonb_build_object('meal_type', v_type, 'logged_for_date', v_day, 'raw_input', left(v_raw, 300),
                         'item_count', jsonb_array_length(v_items), 'total_kcal', v_kcal),
      'soft_delete', v_group, true, v_ref, NULL,
      coalesce(CASE WHEN jsonb_typeof(v_p -> 'meta') = 'object' THEN v_p -> 'meta' END, '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object('time_local', v_p -> 'time_local', 'replaces', v_p -> 'replaces',
                                                'pending_id', v_hold, 'venue', v_vname)));

    -- Mekân ziyareti öğünün yan etkisidir: aynı grupta, öğünle birlikte geri alınır (final2#12).
    IF v_vname IS NOT NULL THEN
      SELECT id, visit_count INTO v_vid, v_vprev FROM user_venues WHERE user_id = p_user AND venue_name = v_vname FOR UPDATE;
      IF FOUND THEN
        UPDATE user_venues SET visit_count = coalesce(visit_count, 0) + 1 WHERE id = v_vid RETURNING visit_count INTO v_vnext;
        v_vprev := coalesce(v_vprev, 0);
      ELSE
        v_vid := gen_random_uuid();
        INSERT INTO user_venues (id, user_id, venue_name, venue_type, visit_count)
        VALUES (v_vid, p_user, v_vname, v_vtype, 1)
        ON CONFLICT (user_id, venue_name) DO UPDATE SET visit_count = coalesce(user_venues.visit_count, 0) + 1
        RETURNING id, visit_count INTO v_vid, v_vnext;
        v_vprev := CASE WHEN v_vnext > 1 THEN v_vnext - 1 END;  -- yarışta başkası açtıysa satır bu yazmanın değil
      END IF;
      PERFORM _v2_ledger_insert(NULL, p_user, p_turn_id, v_pipeline, v_op, 'user_venues', v_vid, v_day, ARRAY['visit_count'],
        CASE WHEN v_vprev IS NULL THEN NULL ELSE jsonb_build_object('visit_count', v_vprev) END,
        jsonb_build_object('visit_count', v_vnext), 'revert_delta', v_group, false, NULL, NULL,
        jsonb_build_object('venue_name', v_vname));
      v_venue := jsonb_build_object('id', v_vid, 'name', v_vname, 'visit_count', v_vnext, 'created', v_vprev IS NULL);
    END IF;

    v_receipt := jsonb_build_object('ok', true, 'op', v_op, 'turn_id', p_turn_id, 'write_id', v_write, 'group_id', v_group,
      'ref', v_ref, 'row_id', v_meal, 'day', v_day, 'meal_type', v_type, 'confidence', v_conf,
      'total_kcal', v_kcal, 'total_protein_g', v_protein, 'total_carbs_g', v_carbs, 'total_fat_g', v_fat,
      'total_alcohol_g', v_alcohol, 'items', v_items_out, 'venue', v_venue, 'replaced', v_replaced, 'pending_id', v_hold);
    IF v_hold IS NOT NULL THEN PERFORM _v2_hold_close(v_hold, 'confirmed', p_turn_id, v_receipt, 'confirmed'); END IF;
    RETURN v_receipt;
  EXCEPTION
    WHEN SQLSTATE 'V2F01' THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
      RETURN _v2_failure(v_op, v_msg, v_detail);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
      RETURN _v2_write_failed(v_op, v_state, v_msg);
  END;
END $$;

-- ─── TurnInput ────────────────────────────────────────────────────────────────────────────────────
-- p_day = kullanıcının YEREL bugünü (TS: tz + day_boundary_hour). Pencere: p_day-6 .. p_day.
-- Dönen nesne serileştirilebilir ve deterministiktir (her liste zaman + id ile sıralı). Hesap/yorum
-- YOK: hedef fonksiyonu, YB zaman çözülmesi, şüpheli kayıt işareti ve satır biçimi TS'in işidir.
CREATE OR REPLACE FUNCTION public.v2_turn_input(p_user uuid, p_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from       date := p_day - 6;
  v_last_turn  uuid;
  v_last_at    timestamptz;
  v_ids        uuid[];
  v_profile    jsonb;
  v_goal       jsonb;
  v_safety     jsonb;
  v_targets    jsonb;
  v_constraints jsonb;
  v_meals      jsonb;
  v_days       jsonb;
  v_mwrites    jsonb;
  v_workouts   jsonb;
  v_supps      jsonb;
  v_labs       jsonb;
  v_events     jsonb;
  v_weights    jsonb;
  v_recent     jsonb;
  v_pending    jsonb;
  v_commit     jsonb;
  v_plans      jsonb;
  v_drafts     jsonb;
  v_portion    jsonb;
  v_intent     jsonb;
BEGIN
  IF p_user IS NULL OR p_day IS NULL THEN RAISE EXCEPTION 'v2_turn_input: user and day are required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user) THEN RAISE EXCEPTION 'v2_turn_input: unknown user'; END IF;

  -- 1. Görünecek her kayda kalıcı ref (eskiler önce → küçük numara).
  SELECT array_agg(id ORDER BY logged_for_date, logged_at, id) INTO v_ids FROM meal_logs
  WHERE user_id = p_user AND logged_for_date BETWEEN v_from AND p_day AND is_deleted IS NOT TRUE;
  PERFORM _v2_ensure_refs(p_user, 'm', 'meal_logs', v_ids);
  SELECT array_agg(id ORDER BY logged_for_date, logged_at, id) INTO v_ids FROM workout_logs
  WHERE user_id = p_user AND logged_for_date BETWEEN v_from AND p_day AND is_deleted IS NOT TRUE;
  PERFORM _v2_ensure_refs(p_user, 't', 'workout_logs', v_ids);
  SELECT array_agg(id ORDER BY logged_for_date, logged_at, id) INTO v_ids FROM supplement_logs
  WHERE user_id = p_user AND logged_for_date BETWEEN v_from AND p_day AND NOT is_deleted;
  PERFORM _v2_ensure_refs(p_user, 's', 'supplement_logs', v_ids);
  SELECT array_agg(id ORDER BY measured_at, id) INTO v_ids FROM lab_values
  WHERE user_id = p_user AND measured_at BETWEEN v_from AND p_day AND NOT is_deleted;
  PERFORM _v2_ensure_refs(p_user, 'l', 'lab_values', v_ids);
  SELECT array_agg(id ORDER BY event_date, id) INTO v_ids FROM (
    SELECT id, event_date FROM life_events
    WHERE user_id = p_user AND is_active AND NOT is_deleted AND event_date >= p_day - 1
    ORDER BY event_date, id LIMIT 5) AS e;
  PERFORM _v2_ensure_refs(p_user, 'e', 'life_events', v_ids);
  SELECT array_agg(id ORDER BY stated_at, id) INTO v_ids FROM user_constraints WHERE user_id = p_user AND active;
  PERFORM _v2_ensure_refs(p_user, 'c', 'user_constraints', v_ids);
  SELECT array_agg(id ORDER BY created_at, id) INTO v_ids FROM (
    SELECT id, created_at FROM user_commitments
    WHERE user_id = p_user AND resolved_at IS NULL AND coalesce(status, 'pending') IN ('pending', 'followed_up')
    ORDER BY follow_up_at NULLS LAST, created_at DESC LIMIT 10) AS k;
  PERFORM _v2_ensure_refs(p_user, 'k', 'user_commitments', v_ids);
  SELECT array_agg(id ORDER BY created_at, id) INTO v_ids FROM pending_writes
  WHERE user_id = p_user AND status = 'pending' AND expires_at > now();
  PERFORM _v2_ensure_refs(p_user, 'p', 'pending_writes', v_ids);
  SELECT array_agg(id ORDER BY generated_at, id) INTO v_ids FROM weekly_plans WHERE user_id = p_user AND status = 'draft';
  PERFORM _v2_ensure_refs(p_user, 'dft', 'weekly_plans', v_ids);

  -- 2. Son tur = son asistan mesajı (bu turun asistan mesajı henüz yok).
  SELECT turn_id, created_at INTO v_last_turn, v_last_at FROM chat_messages
  WHERE user_id = p_user AND role = 'assistant' ORDER BY created_at DESC LIMIT 1;

  -- 3. Olgular. Sütun kayması olan tablolarda to_jsonb + anahtar seçimi: eksik sütun = eksik anahtar, hata değil.
  SELECT (SELECT coalesce(jsonb_object_agg(k, pj -> k), '{}'::jsonb) FROM unnest(ARRAY[
            'gender', 'birth_year', 'height_cm', 'weight_kg', 'activity_level', 'unit_system', 'diet_mode',
            'home_timezone', 'active_timezone', 'day_boundary_hour', 'water_target_liters', 'step_target',
            'protein_per_kg', 'tdee_calculated', 'tdee_calculated_at', 'calorie_range_training_min',
            'calorie_range_training_max', 'calorie_range_rest_min', 'calorie_range_rest_max',
            'periodic_state', 'periodic_state_start', 'periodic_state_end', 'if_active', 'if_window',
            'if_eating_start', 'if_eating_end', 'onboarding_completed', 'occupation', 'sleep_time', 'wake_time',
            'work_start', 'work_end', 'dietary_restriction', 'menstrual_tracking', 'training_style',
            'equipment_access', 'cooking_skill', 'budget_level', 'household_size', 'coach_tone']) AS k WHERE pj ? k)
  INTO v_profile FROM (SELECT to_jsonb(p) AS pj FROM profiles p WHERE p.id = p_user) AS s;

  SELECT (SELECT coalesce(jsonb_object_agg(k, gj -> k), '{}'::jsonb) FROM unnest(ARRAY[
            'id', 'goal_type', 'target_weight_kg', 'target_weeks', 'start_weight_kg', 'weekly_rate',
            'restriction_mode', 'phase_label', 'phase_order', 'goal_reason', 'created_at']) AS k WHERE gj ? k)
  INTO v_goal FROM (SELECT to_jsonb(g) AS gj FROM goals g WHERE g.user_id = p_user AND g.is_active
                    ORDER BY g.created_at DESC LIMIT 1) AS s;

  SELECT jsonb_build_object('ed_tier', ed_tier, 'ed_signal_count', ed_signal_count, 'ed_last_signal_at', ed_last_signal_at,
                            'ed_escalated_at', ed_escalated_at, 'overtraining_tier', overtraining_tier, 'updated_at', updated_at)
  INTO v_safety FROM user_safety_state WHERE user_id = p_user;

  SELECT (SELECT coalesce(jsonb_object_agg(k, dj -> k), '{}'::jsonb) FROM unnest(ARRAY[
            'date', 'plan_type', 'calorie_target_min', 'calorie_target_max', 'protein_target_g', 'carbs_target_g',
            'fat_target_g', 'water_target_liters', 'status', 'version']) AS k WHERE dj ? k)
  INTO v_targets FROM (SELECT to_jsonb(d) AS dj FROM daily_plans d WHERE d.user_id = p_user AND d.date = p_day
                       ORDER BY d.version DESC NULLS LAST, d.generated_at DESC NULLS LAST LIMIT 1) AS s;

  SELECT coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'id', c.id, 'kind', c.kind, 'subject', c.subject,
           'severity', c.severity, 'body_parts', to_jsonb(c.body_parts), 'note', c.note, 'source', c.source,
           'confidence', c.confidence, 'confirmed_at', c.confirmed_at, 'stated_at', c.stated_at)
           ORDER BY c.stated_at, c.id), '[]'::jsonb)
  INTO v_constraints
  FROM user_constraints c JOIN record_refs r ON r.user_id = p_user AND r.target_table = 'user_constraints' AND r.target_id = c.id
  WHERE c.user_id = p_user AND c.active;

  -- Öğünler: kalemleriyle, kim yazdı (defter v1/v2 ya da uygulama), son turda mı, neyin yerine geçti.
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.d, x.at, x.id), '[]'::jsonb) INTO v_meals
  FROM (
    SELECT m.logged_for_date AS d, m.logged_at AS at, m.id,
      jsonb_build_object(
        'ref', r.ref, 'id', m.id, 'day', m.logged_for_date, 'meal_type', m.meal_type, 'logged_at', m.logged_at,
        'raw_input', left(m.raw_input, 300), 'input_method', m.input_method, 'confidence', m.confidence,
        'supersedes_ref', sr.ref,
        'source', CASE WHEN lw.id IS NULL THEN 'app' ELSE 'ledger_' || lw.pipeline END,
        'turn_id', lw.turn_id,
        'last_turn', (v_last_turn IS NOT NULL AND lw.turn_id IS NOT DISTINCT FROM v_last_turn),
        'total_kcal', coalesce(it.kcal, 0), 'total_protein_g', coalesce(it.protein, 0), 'total_carbs_g', coalesce(it.carbs, 0),
        'total_fat_g', coalesce(it.fat, 0), 'total_alcohol_g', coalesce(it.alcohol, 0),
        'items', coalesce(it.items, '[]'::jsonb)) AS j
    FROM meal_logs m
    JOIN record_refs r ON r.user_id = p_user AND r.target_table = 'meal_logs' AND r.target_id = m.id
    LEFT JOIN record_refs sr ON sr.user_id = p_user AND sr.target_table = 'meal_logs' AND sr.target_id = m.supersedes_id
    LEFT JOIN LATERAL (
      SELECT w.id, w.turn_id, w.pipeline FROM turn_writes w
      WHERE w.user_id = p_user AND w.table_name = 'meal_logs' AND w.row_id = m.id AND w.before IS NULL AND w.undo_mode = 'soft_delete'
      ORDER BY w.seq DESC LIMIT 1) AS lw ON true
    LEFT JOIN LATERAL (
      SELECT sum(i.calories) AS kcal, sum(i.protein_g) AS protein, sum(i.carbs_g) AS carbs, sum(i.fat_g) AS fat,
             sum(coalesce(i.alcohol_g, 0)) AS alcohol,
             jsonb_agg(jsonb_build_object('name', i.food_name, 'as_stated', i.as_stated, 'portion_text', i.portion_text,
                 'grams', i.portion_grams, 'kcal', i.calories, 'protein_g', i.protein_g, 'carbs_g', i.carbs_g, 'fat_g', i.fat_g,
                 'alcohol_g', i.alcohol_g, 'data_source', i.data_source, 'reference_key', i.reference_key,
                 'allergen_tags', to_jsonb(i.allergen_tags), 'may_contain', coalesce(i.meta -> 'may_contain', '[]'::jsonb),
                 'confidence', i.meta -> 'confidence')
               ORDER BY CASE WHEN jsonb_typeof(i.meta -> 'position') = 'number' THEN (i.meta ->> 'position')::numeric END NULLS LAST,
                        i.food_name, i.id) AS items
      FROM meal_log_items i WHERE i.meal_log_id = m.id) AS it ON true
    WHERE m.user_id = p_user AND m.logged_for_date BETWEEN v_from AND p_day AND m.is_deleted IS NOT TRUE
  ) AS x;

  -- Gün özetleri (7 gün): öğün toplamları + daily_metrics.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'day', g.d, 'meal_count', coalesce(mt.n, 0), 'kcal', coalesce(mt.kcal, 0), 'protein_g', coalesce(mt.protein, 0),
           'carbs_g', coalesce(mt.carbs, 0), 'fat_g', coalesce(mt.fat, 0),
           'water_liters', dm.water_liters, 'sleep_hours', dm.sleep_hours, 'sleep_quality', dm.sleep_quality,
           'mood_score', dm.mood_score, 'steps', dm.steps, 'weight_kg', dm.weight_kg) ORDER BY g.d), '[]'::jsonb)
  INTO v_days
  FROM (SELECT generate_series(v_from, p_day, interval '1 day')::date AS d) AS g
  LEFT JOIN daily_metrics dm ON dm.user_id = p_user AND dm.date = g.d
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT m.id) AS n, sum(i.calories) AS kcal, sum(i.protein_g) AS protein, sum(i.carbs_g) AS carbs, sum(i.fat_g) AS fat
    FROM meal_logs m LEFT JOIN meal_log_items i ON i.meal_log_id = m.id
    WHERE m.user_id = p_user AND m.logged_for_date = g.d AND m.is_deleted IS NOT TRUE) AS mt ON true;

  -- Metrik yazmaları (d#/w#): canlı, ana, pencere içi; son 40.
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.seq), '[]'::jsonb) INTO v_mwrites
  FROM (
    SELECT w.seq, jsonb_build_object('ref', w.ref, 'write_id', w.id, 'op', w.op, 'day', w.for_date,
             'field_set', to_jsonb(w.field_set), 'before', w.before, 'after', w.after, 'mode', w.meta -> 'mode',
             'as_stated', w.meta -> 'as_stated', 'pipeline', w.pipeline, 'turn_id', w.turn_id,
             'last_turn', (v_last_turn IS NOT NULL AND w.turn_id = v_last_turn), 'created_at', w.created_at) AS j
    FROM turn_writes w
    WHERE w.user_id = p_user AND w.table_name = 'daily_metrics' AND w.is_primary AND w.undone_at IS NULL
      AND w.reverses IS NULL AND w.op NOT IN ('record_delete', 'record_restore')
      AND w.for_date BETWEEN v_from AND p_day
    ORDER BY w.seq DESC LIMIT 40
  ) AS x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'id', w.id, 'day', w.logged_for_date, 'workout_type', w.workout_type,
           'duration_min', w.duration_min, 'intensity', w.intensity, 'calories_burned', w.calories_burned,
           'raw_input', left(w.raw_input, 200),
           'set_count', (SELECT count(*) FROM strength_sets s WHERE s.workout_log_id = w.id AND NOT s.is_deleted))
           ORDER BY w.logged_for_date, w.logged_at, w.id), '[]'::jsonb)
  INTO v_workouts
  FROM workout_logs w JOIN record_refs r ON r.user_id = p_user AND r.target_table = 'workout_logs' AND r.target_id = w.id
  WHERE w.user_id = p_user AND w.logged_for_date BETWEEN v_from AND p_day AND w.is_deleted IS NOT TRUE;

  SELECT coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'id', s.id, 'day', s.logged_for_date, 'name', s.supplement_name,
           'amount', s.amount, 'calories', s.calories, 'protein_g', s.protein_g, 'logged_at', s.logged_at)
           ORDER BY s.logged_for_date, s.logged_at, s.id), '[]'::jsonb)
  INTO v_supps
  FROM supplement_logs s JOIN record_refs r ON r.user_id = p_user AND r.target_table = 'supplement_logs' AND r.target_id = s.id
  WHERE s.user_id = p_user AND s.logged_for_date BETWEEN v_from AND p_day AND NOT s.is_deleted;

  SELECT coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'id', l.id, 'day', l.measured_at, 'parameter', l.parameter_name,
           'value', l.value, 'unit', l.unit, 'reference_min', l.reference_min, 'reference_max', l.reference_max,
           'is_out_of_range', l.is_out_of_range, 'notes', l.notes) ORDER BY l.measured_at, l.id), '[]'::jsonb)
  INTO v_labs
  FROM lab_values l JOIN record_refs r ON r.user_id = p_user AND r.target_table = 'lab_values' AND r.target_id = l.id
  WHERE l.user_id = p_user AND l.measured_at BETWEEN v_from AND p_day AND NOT l.is_deleted;

  SELECT coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'id', e.id, 'title', e.title, 'event_type', e.event_type,
           'event_date', e.event_date, 'note', e.note) ORDER BY e.event_date, e.id), '[]'::jsonb)
  INTO v_events
  FROM life_events e JOIN record_refs r ON r.user_id = p_user AND r.target_table = 'life_events' AND r.target_id = e.id
  WHERE e.user_id = p_user AND e.is_active AND NOT e.is_deleted AND e.event_date >= p_day - 1;

  -- Önemlilik denetimi (kilo sıçraması) için son tartılar.
  SELECT coalesce(jsonb_agg(jsonb_build_object('day', x.recorded_at, 'kg', x.weight_kg) ORDER BY x.recorded_at), '[]'::jsonb)
  INTO v_weights
  FROM (SELECT recorded_at, weight_kg FROM weight_history WHERE user_id = p_user AND recorded_at <= p_day
        ORDER BY recorded_at DESC LIMIT 10) AS x;

  -- Defterin son 15 satırı (her tablo; geri almalar dahil) — "son tur" ve düzeltme bağlamı.
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.seq), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT w.seq, jsonb_build_object('write_id', w.id, 'ref', w.ref, 'op', w.op, 'table', w.table_name, 'day', w.for_date,
             'field_set', to_jsonb(w.field_set), 'before', w.before, 'after', w.after, 'is_primary', w.is_primary,
             'pipeline', w.pipeline, 'turn_id', w.turn_id,
             'last_turn', (v_last_turn IS NOT NULL AND w.turn_id = v_last_turn),
             'reverses', w.reverses, 'undone_at', w.undone_at, 'created_at', w.created_at) AS j
    FROM turn_writes w WHERE w.user_id = p_user ORDER BY w.seq DESC LIMIT 15
  ) AS x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'id', pw.id, 'op', pw.op, 'payload', pw.payload,
           'subject_key', pw.subject_key, 'hold_class', pw.hold_class, 'reason_code', pw.reason_code,
           'schema_version', pw.schema_version, 'turn_id', pw.turn_id, 'created_at', pw.created_at, 'expires_at', pw.expires_at)
           ORDER BY pw.created_at, pw.id), '[]'::jsonb)
  INTO v_pending
  FROM pending_writes pw JOIN record_refs r ON r.user_id = p_user AND r.target_table = 'pending_writes' AND r.target_id = pw.id
  WHERE pw.user_id = p_user AND pw.status = 'pending' AND pw.expires_at > now();

  SELECT coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'id', c.id, 'commitment', c.commitment, 'follow_up_at', c.follow_up_at,
           'status', c.status, 'created_at', c.created_at) ORDER BY c.follow_up_at NULLS LAST, c.created_at, c.id), '[]'::jsonb)
  INTO v_commit
  FROM user_commitments c JOIN record_refs r ON r.user_id = p_user AND r.target_table = 'user_commitments' AND r.target_id = c.id
  WHERE c.user_id = p_user AND c.resolved_at IS NULL AND coalesce(c.status, 'pending') IN ('pending', 'followed_up');

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.wj -> 'id', 'plan_type', x.wj -> 'plan_type',
           'plan_subtype', x.wj -> 'plan_subtype', 'week_start', x.wj -> 'week_start', 'approved_at', x.wj -> 'approved_at',
           'stale_reason', x.wj -> 'stale_reason') ORDER BY x.wj ->> 'plan_type', x.wj ->> 'id'), '[]'::jsonb)
  INTO v_plans
  FROM (SELECT to_jsonb(wp) AS wj FROM weekly_plans wp WHERE wp.user_id = p_user AND wp.status = 'active') AS x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'id', x.wj -> 'id', 'plan_type', x.wj -> 'plan_type',
           'plan_subtype', x.wj -> 'plan_subtype', 'week_start', x.wj -> 'week_start', 'generated_at', x.wj -> 'generated_at',
           'revision_count', CASE WHEN jsonb_typeof(x.wj -> 'user_revisions') = 'array' THEN jsonb_array_length(x.wj -> 'user_revisions') ELSE 0 END)
           ORDER BY x.wj ->> 'plan_type', x.wj ->> 'id'), '[]'::jsonb)
  INTO v_drafts
  FROM (SELECT wp.id, to_jsonb(wp) AS wj FROM weekly_plans wp WHERE wp.user_id = p_user AND wp.status = 'draft') AS x
  JOIN record_refs r ON r.user_id = p_user AND r.target_table = 'weekly_plans' AND r.target_id = x.id;

  SELECT portion_calibration INTO v_portion FROM ai_summary WHERE user_id = p_user;
  SELECT active_intent INTO v_intent FROM chat_sessions
  WHERE user_id = p_user AND is_active ORDER BY started_at DESC NULLS LAST LIMIT 1;

  RETURN jsonb_build_object(
    'schema', 'v2_turn_input/1',
    'day', p_day,
    'window', jsonb_build_object('from', v_from, 'to', p_day),
    'generated_at', now(),
    'last_turn', jsonb_build_object('turn_id', v_last_turn, 'at', v_last_at),
    'profile', coalesce(v_profile, '{}'::jsonb),
    'goal', v_goal,
    'safety', v_safety,
    'targets_today', v_targets,
    'constraints', v_constraints,
    'meals', v_meals,
    'days', v_days,
    'metric_writes', v_mwrites,
    'workouts', v_workouts,
    'supplements', v_supps,
    'labs', v_labs,
    'life_events', v_events,
    'weights_recent', v_weights,
    'recent_writes', v_recent,
    'pending', v_pending,
    'commitments', v_commit,
    'plans', jsonb_build_object('active', v_plans, 'drafts', v_drafts),
    'portion_calibration', coalesce(v_portion, '{}'::jsonb),
    'active_intent', v_intent);
END $$;

REVOKE ALL ON FUNCTION public.w_water_apply(uuid, uuid, jsonb)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.w_metric_apply(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.w_meal_apply(uuid, uuid, jsonb)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v2_turn_input(uuid, date)         FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.w_water_apply(uuid, uuid, jsonb)  TO service_role;
GRANT EXECUTE ON FUNCTION public.w_metric_apply(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.w_meal_apply(uuid, uuid, jsonb)   TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_turn_input(uuid, date)         TO service_role;

SELECT '113 v2 writer RPCs + v2_turn_input applied' AS status;

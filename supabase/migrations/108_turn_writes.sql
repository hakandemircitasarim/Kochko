-- 108: turn_writes — her yazmanın önce/sonra defteri, kalıcı kısa ref'ler ve kimlikle geri alma.
--
-- NEDEN (AI_MIMARI_V2 §1, §4.4(3), §6.1 · Faz 1): bugün düzeltme/geri alma, mesajdaki alt dizelere
-- bakan regex'lerle ve "en son yazılan" tahminiyle yapılıyor. Model bir kaydı kimliğiyle gösteremiyor:
--   * su kaydından sonra "geri al" → 45 dk önceki akşam yemeği silindi (final2#2, diff#5);
--   * "düzeltiyorum" → ikinci öğün eklendi, yanlışı kaldı (final2#6);
--   * su, uyku, mood, adım ve kilo HİÇ geri alınamıyordu (daily_metrics tek satır, önceki değer yok).
--
-- BU MİGRASYON:
--   1. record_refs — kullanıcı başına KALICI kısa ref'ler (m12, d3, w2, c1, k1, p1, dft1). Ref'ler tur
--      başına yeniden numaralanmaz: geçmişteki "⟦m12 düzeltildi → m15⟧" satırı sonraki turlarda da
--      aynı kaydı gösterir. Model yalnızca ref görür; uuid'ye çeviri SUNUCUDA, kullanıcıya göre yapılır.
--   2. turn_writes — §6.1 defteri. Her yazıcı RPC bu satırı AYNI işlemde yazar. daily_metrics için
--      yalnızca dokunulan alanların önceki/sonraki değeri tutulur. group_id bir mantıksal yazmanın tüm
--      yan etkilerini bağlar (öğün + mekân ziyareti): öğün geri alınınca hayalet ziyaret de gider (final2#12).
--   3. Geri alma motoru (_v2_reverse_rows) + w_record_delete / w_record_restore. Hiçbir şey kalıcı
--      silinmez: kayıt satırları soft-delete olur, metrikler önceki değere döner, her geri alma da
--      deftere yazılır (geri alınan geri alma = "geri getir").
--   4. v2_ledger_append — v1 executeActions'ın (ve henüz RPC'si olmayan yazıcıların) deftere yazması
--      için. Karışık geçişte v2 kullanıcısı v1'de yapılmış bir yazmayı da kimliğiyle geri alabilir.
--
-- GERİ ALMA KİPLERİ (undo_mode):
--   soft_delete      — satırı bu yazma ekledi; geri alma = is_deleted=true.
--   restore_previous — alanların önceki değeri geri yazılır. before=NULL → satırı bu yazma ekledi
--                      (soft-delete'i olmayan tablo, ör. weight_history) → satır silinir, anlık görüntüsü
--                      defterde kalır; after=NULL → bu yazma satırı sildi → anlık görüntüden geri eklenir.
--   revert_delta     — eklemeli yazma (su "add", mekân ziyareti): geri alma = farkı düşmek. İstemcinin
--                      araya giren su eklemelerini EZMEZ (değişmeli).
--
-- ÇAKIŞMA (noLaterWriteOnSameField): aynı alana daha sonra canlı bir mutlak yazma varsa ya da alanın
-- şimdiki değeri bu yazmanın bıraktığı değer değilse geri alma YAPILMAZ: ok=false, failure_class=
-- 'later_write'. Kod sessizce ezmez (§2 kural 1); koç sorar.
--
-- KANONİK DEĞERLER: defterin before/after değerleri, sütun karşılığı olan her anahtar için sütunun kendi
-- tipine çevrilerek saklanır (_v2_canon: '23:00' → "23:00:00", DECIMAL(3,1)'e 7.46 → 7.5). Böylece
-- geri almanın çakışma denetimi DB'nin to_jsonb değeriyle AYNI gösterimi karşılaştırır; v1'in
-- v2_ledger_append ile yazdığı '23:00' artık sahte bir 'later_write' üretmez (§6.1: v2, v1 yazmasını
-- geri alabilir).
--
-- ANTRENMAN: antrenman soft-delete olunca başarımları (source_row_id) VE set'leri (strength_sets)
-- aynı grupta birlikte soft-delete olur; geri getirme hepsini geri getirir. Geri alınmış bir
-- "200 kg squat" set'i rekor/geçmiş okuyucularında kalmaz (okuyucular is_deleted süzmeli — 110).
--
-- GÜVENLİK: tüm fonksiyonlar SECURITY DEFINER + yalnız service_role (072'nin dersi: p_user alan bir
-- RPC'yi authenticated çağırabilirse başkasının verisini siler). Tablolar RLS açık: kullanıcı yalnızca
-- kendi defterini/ref'lerini OKUR, yazma politikası BİLEREK yok.
--
-- DOWN:
--   DROP FUNCTION IF EXISTS public.w_record_restore(uuid, uuid, jsonb, jsonb), public.w_record_delete(uuid, uuid, jsonb, jsonb),
--     public.v2_ledger_append(uuid, uuid, jsonb), public._v2_record_op(uuid, uuid, jsonb, text, uuid, jsonb),
--     public._v2_reverse_rows(uuid, uuid, uuid[], text, uuid, boolean, jsonb), public._v2_soft_delete(uuid, uuid, text, text, text, uuid, date, uuid, boolean, text, uuid, jsonb),
--     public._v2_ledger_insert(uuid, uuid, uuid, text, text, text, uuid, date, text[], jsonb, jsonb, text, uuid, boolean, text, uuid, jsonb),
--     public._v2_ref_for(uuid, text, text, uuid), public._v2_ensure_refs(uuid, text, text, uuid[]), public._v2_ref_kind_for(text, text[]),
--     public._v2_insert_row(text, jsonb), public._v2_delete_row(text, uuid), public._v2_set_fields(text, uuid, jsonb),
--     public._v2_row_owner(text, uuid), public._v2_row_state(text, uuid), public._v2_assert_table(text), public._v2_record_day(text, jsonb),
--     public._v2_canon(text, jsonb, text), public._v2_unwritable(text, text[]),
--     public._v2_subset(jsonb, text[]), public._v2_text_array(jsonb, text, text), public._v2_text(jsonb, text, integer, boolean, text),
--     public._v2_num(jsonb, text, numeric, numeric, boolean, text), public._v2_day(text), public._v2_pipeline(text),
--     public._v2_write_failed(text, text, text), public._v2_failure(text, text, text), public._v2_fail(text, jsonb);
--   DROP TABLE IF EXISTS turn_writes; DROP TABLE IF EXISTS record_refs;

-- ─── 1. Kalıcı kısa ref'ler ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS record_refs (
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- m=öğün t=antrenman s=takviye e=yaşam olayı l=tahlil d=metrik yazması (su/uyku/mood/adım)
  -- w=tartı yazması c=kısıt (omurga) k=söz p=bekleyen onay dft=plan taslağı
  kind         text NOT NULL CHECK (kind IN ('m','t','s','e','l','d','w','c','k','p','dft')),
  seq          integer NOT NULL CHECK (seq > 0),
  ref          text GENERATED ALWAYS AS (kind || seq::text) STORED,
  target_table text NOT NULL,
  target_id    uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, seq),
  UNIQUE (user_id, target_table, target_id),
  -- d/w ref'leri bir SATIRI değil bir YAZMAYI gösterir (daily_metrics günde tek satır).
  CONSTRAINT record_refs_kind_target_check CHECK (
       (kind = 'm'   AND target_table = 'meal_logs')
    OR (kind = 't'   AND target_table = 'workout_logs')
    OR (kind = 's'   AND target_table = 'supplement_logs')
    OR (kind = 'e'   AND target_table = 'life_events')
    OR (kind = 'l'   AND target_table = 'lab_values')
    OR (kind IN ('d','w') AND target_table = 'turn_writes')
    OR (kind = 'c'   AND target_table = 'user_constraints')
    OR (kind = 'k'   AND target_table = 'user_commitments')
    OR (kind = 'p'   AND target_table = 'pending_writes')
    OR (kind = 'dft' AND target_table = 'weekly_plans')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_record_refs_user_ref ON record_refs (user_id, ref);

ALTER TABLE record_refs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS record_refs_select_own ON record_refs;
CREATE POLICY record_refs_select_own ON record_refs FOR SELECT TO authenticated USING (auth.uid() = user_id);

COMMENT ON TABLE record_refs IS 'v2: kullanıcı başına kalıcı kısa ref''ler (m12, d3…). Model yalnız ref görür; uuid çevirisi sunucuda, kullanıcıya göre. Yazan yalnız service role.';

-- ─── 2. Defter ──────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS turn_writes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tek bir işlem içindeki satırların created_at'i aynıdır; sıra (geri alma tersten yürür) buradan gelir.
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  turn_id         uuid NOT NULL,
  -- Asistan mesajı yazmalardan SONRA saklanır; v2_link_turn_message (112) sonradan damgalar.
  chat_message_id uuid,
  pipeline        text NOT NULL DEFAULT 'v2' CHECK (pipeline IN ('v1','v2')),
  -- Bu satırın ilgili olduğu kaydın kalıcı ref'i (record_refs). Geri alma satırları aynı ref'i taşır.
  ref             text,
  -- Kayıttaki op adı: meal_log, water_log, sleep_log, mood_log, step_log, body_weight, … ya da
  -- record_delete / record_restore (geri alma satırları).
  op              text NOT NULL CHECK (length(op) BETWEEN 1 AND 64),
  table_name      text NOT NULL CHECK (table_name IN (
                    'meal_logs','workout_logs','supplement_logs','daily_metrics','weight_history',
                    'profiles','user_venues','life_events','lab_values','achievements','strength_sets')),
  row_id          uuid,
  for_date        date,
  field_set       text[] NOT NULL DEFAULT '{}',
  before          jsonb,
  after           jsonb,
  undo_mode       text NOT NULL CHECK (undo_mode IN ('soft_delete','restore_previous','revert_delta','none')),
  group_id        uuid NOT NULL,
  -- Ref'in gösterdiği ana satır. Yan etkiler (mekân, başarım) false.
  is_primary      boolean NOT NULL DEFAULT true,
  -- Geri alma satırları: tersine çevirdiği defter satırı. Bu satır da geri alınırsa asıl yazma canlanır.
  reverses        uuid REFERENCES turn_writes(id) ON DELETE SET NULL,
  -- as_stated, mode, birim, reason gibi yapısal ekler. Sohbet mesajının kendisi BURAYA YAZILMAZ.
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  undone_at       timestamptz,
  undone_by_turn  uuid,
  -- Geri alma kırpıldı (ör. su 0'ın altına inecekti) ya da satır dışarıda silinmişti: insan bakmalı.
  needs_review    boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_turn_writes_user_seq   ON turn_writes (user_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_turn_writes_user_turn  ON turn_writes (user_id, turn_id);
CREATE INDEX IF NOT EXISTS idx_turn_writes_group      ON turn_writes (group_id);
CREATE INDEX IF NOT EXISTS idx_turn_writes_target     ON turn_writes (user_id, table_name, row_id);
CREATE INDEX IF NOT EXISTS idx_turn_writes_reverses   ON turn_writes (reverses) WHERE reverses IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_turn_writes_live_day   ON turn_writes (user_id, for_date) WHERE undone_at IS NULL;

ALTER TABLE turn_writes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS turn_writes_select_own ON turn_writes;
CREATE POLICY turn_writes_select_own ON turn_writes FOR SELECT TO authenticated USING (auth.uid() = user_id);

COMMENT ON TABLE turn_writes IS 'v2 §6.1 yazma defteri: her yazıcı RPC aynı işlemde yazar (önce/sonra). Kullanıcı yalnız okur; yazan/geri alan yalnız service role.';
COMMENT ON COLUMN turn_writes.before IS 'Dokunulan alanların önceki değeri. NULL = satırı bu yazma ekledi.';
COMMENT ON COLUMN turn_writes.after  IS 'Dokunulan alanların yeni değeri. NULL = bu yazma satırı sildi (before = tam anlık görüntü).';

-- ─── 3. Ortak yardımcılar (iç kullanım; service_role'e bile GRANT edilmez) ──────────────────────────

-- Tipli başarısızlık: yazıcılar bunu yakalayıp {ok:false, failure_class} makbuzuna çevirir. Savepoint
-- geri sarıldığı için yarım yazma kalmaz.
CREATE OR REPLACE FUNCTION public._v2_fail(p_class text, p_detail jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'V2F01', MESSAGE = p_class, DETAIL = coalesce(p_detail, '{}'::jsonb)::text;
END $$;

CREATE OR REPLACE FUNCTION public._v2_failure(p_op text, p_class text, p_detail text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_detail jsonb;
BEGIN
  BEGIN
    v_detail := nullif(p_detail, '')::jsonb;
  EXCEPTION WHEN others THEN
    v_detail := to_jsonb(p_detail);
  END;
  RETURN jsonb_build_object('ok', false, 'op', p_op, 'failure_class', p_class, 'detail', coalesce(v_detail, '{}'::jsonb));
END $$;

-- Beklenmeyen DB hatası da makbuz olur (istemci kırmızı rozet, TS log'lar); asla sessiz ok:true değil.
CREATE OR REPLACE FUNCTION public._v2_write_failed(p_op text, p_sqlstate text, p_message text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('ok', false, 'op', p_op, 'failure_class', 'write_failed',
    'detail', jsonb_build_object('sqlstate', p_sqlstate, 'error', left(p_message, 300)));
$$;

CREATE OR REPLACE FUNCTION public._v2_pipeline(p_value text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text := coalesce(nullif(p_value, ''), 'v2');
BEGIN
  IF v NOT IN ('v1', 'v2') THEN
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'pipeline', 'value', p_value));
  END IF;
  RETURN v;
END $$;

-- 'YYYY-MM-DD'. Kayıt kuralı (en fazla 7 gün geri, gelecek yok, kullanıcının saat dilimi) TS
-- validatorunun işi; burası yalnızca DB akıl sağlığı penceresi (sunucu UTC günü ±).
CREATE OR REPLACE FUNCTION public._v2_day(p_value text)
RETURNS date LANGUAGE plpgsql AS $$
DECLARE v_day date;
BEGIN
  IF p_value IS NULL OR p_value !~ '^\d{4}-\d{2}-\d{2}$' THEN
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'day', 'value', p_value));
  END IF;
  BEGIN
    v_day := p_value::date;
  EXCEPTION WHEN others THEN
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'day', 'value', p_value));
  END;
  IF v_day < current_date - 14 OR v_day > current_date + 1 THEN
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'day', 'value', p_value, 'reason', 'out_of_window'));
  END IF;
  RETURN v_day;
END $$;

-- JSON sayısı; tip ve aralık denetimi. Kırpma YOK: aralık dışı = gerekçeli ret (§5.3).
CREATE OR REPLACE FUNCTION public._v2_num(p_obj jsonb, p_key text, p_lo numeric, p_hi numeric, p_nullable boolean, p_path text)
RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE
  v jsonb := p_obj -> p_key;
  n numeric;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) = 'null' THEN
    IF p_nullable THEN RETURN NULL; END IF;
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', p_path, 'reason', 'required'));
  END IF;
  IF jsonb_typeof(v) <> 'number' THEN
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', p_path, 'reason', 'not_a_number', 'value', v));
  END IF;
  n := (v #>> '{}')::numeric;
  IF n < p_lo OR n > p_hi THEN
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', p_path, 'reason', 'out_of_range', 'value', v, 'min', p_lo, 'max', p_hi));
  END IF;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public._v2_text(p_obj jsonb, p_key text, p_max integer, p_nullable boolean, p_path text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v jsonb := p_obj -> p_key;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) = 'null' THEN
    IF p_nullable THEN RETURN NULL; END IF;
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', p_path, 'reason', 'required'));
  END IF;
  IF jsonb_typeof(v) <> 'string' THEN
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', p_path, 'reason', 'not_a_string'));
  END IF;
  IF length(v #>> '{}') > p_max THEN
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', p_path, 'reason', 'too_long', 'max', p_max));
  END IF;
  RETURN v #>> '{}';
END $$;

-- Etiket listesi (alerjen id'leri vb.): string dizisi ya da null → text[].
CREATE OR REPLACE FUNCTION public._v2_text_array(p_obj jsonb, p_key text, p_path text)
RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE v jsonb := p_obj -> p_key;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) = 'null' THEN RETURN '{}'::text[]; END IF;
  IF jsonb_typeof(v) <> 'array'
     OR jsonb_array_length(v) > 30
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e) <> 'string' OR length(e #>> '{}') NOT BETWEEN 1 AND 64) THEN
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', p_path, 'reason', 'not_a_tag_list'));
  END IF;
  RETURN ARRAY(SELECT e FROM jsonb_array_elements_text(v) AS e);
END $$;

CREATE OR REPLACE FUNCTION public._v2_subset(p_obj jsonb, p_keys text[])
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_object_agg(k, p_obj -> k), '{}'::jsonb) FROM unnest(p_keys) AS k;
$$;

-- Defterin dokunabildiği tablolar. Dinamik SQL yalnızca bu listeye ve gerçek, üretilmemiş sütunlara gider.
CREATE OR REPLACE FUNCTION public._v2_assert_table(p_table text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_table IS NULL OR p_table NOT IN ('meal_logs','workout_logs','supplement_logs','daily_metrics','weight_history',
                                        'profiles','user_venues','life_events','lab_values','achievements','strength_sets') THEN
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'table_name', 'value', p_table));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._v2_row_state(p_table text, p_row uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  PERFORM _v2_assert_table(p_table);
  IF p_row IS NULL THEN RETURN NULL; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I AS t WHERE t.id = $1', p_table) INTO v USING p_row;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public._v2_row_owner(p_table text, p_row uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  PERFORM _v2_assert_table(p_table);
  IF p_table = 'profiles' THEN
    SELECT id INTO v FROM profiles WHERE id = p_row;
  ELSIF p_table = 'strength_sets' THEN
    -- strength_sets'in user_id'si yok: sahiplik antrenman ebeveyninden (005'in RLS'iyle aynı yol).
    SELECT w.user_id INTO v FROM strength_sets s JOIN workout_logs w ON w.id = s.workout_log_id WHERE s.id = p_row;
  ELSE
    EXECUTE format('SELECT user_id FROM public.%I WHERE id = $1', p_table) INTO v USING p_row;
  END IF;
  RETURN v;
END $$;

-- Defterin yazamayacağı anahtarlar: kimlik sütunları, korunan profil sütunları, tabloda olmayan ya da
-- üretilmiş sütunlar. _v2_set_fields (yazma anı) ve v2_ledger_append (kayıt anı) aynı listeyi kullanır:
-- geri alınabilirlik yazılırken denetlenir, geri alma anında sürpriz olmaz.
CREATE OR REPLACE FUNCTION public._v2_unwritable(p_table text, p_keys text[])
RETURNS text[] LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_bad text[];
BEGIN
  PERFORM _v2_assert_table(p_table);
  SELECT coalesce(array_agg(k ORDER BY k), '{}'::text[]) INTO v_bad
  FROM unnest(coalesce(p_keys, '{}'::text[])) AS k
  WHERE k IS NULL OR k IN ('id', 'user_id')
     -- Abonelik ve hesap durumu defterden asla yazılmaz (geri alma bile).
     OR (p_table = 'profiles' AND k IN ('premium', 'premium_expires_at', 'trial_used', 'deleted_at',
                                         'deletion_requested_at', 'deletion_cancelled'))
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = format('public.%I', p_table)::regclass
                      AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '');
  RETURN v_bad;
END $$;

-- Defter değerlerinin KANONİK gösterimi: nesnenin sütun karşılığı olan her anahtarı sütunun kendi
-- tipinden (typmod dahil) geçirilip to_jsonb ile geri yazılır ('23:00' → "23:00:00", DECIMAL(3,1)'e
-- 7.46 → 7.5, '2026-10-06T10:00Z' → "2026-10-06T10:00:00+00:00"). Sütunu olmayan anahtarlar (ör. öğünün
-- item_count özeti) aynen kalır, yeni anahtar eklenmez. Böylece geri almanın çakışma denetimi DB'nin
-- to_jsonb değeriyle aynı gösterimi karşılaştırır. Sütun tipine uymayan değer = gerekçeli ret.
CREATE OR REPLACE FUNCTION public._v2_canon(p_table text, p_obj jsonb, p_path text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_cols text[];
  v_row  jsonb;
BEGIN
  IF p_obj IS NULL OR jsonb_typeof(p_obj) <> 'object' THEN RETURN p_obj; END IF;
  PERFORM _v2_assert_table(p_table);
  SELECT array_agg(k) INTO v_cols FROM jsonb_object_keys(p_obj) AS k
  WHERE EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = format('public.%I', p_table)::regclass
                  AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_cols IS NULL THEN RETURN p_obj; END IF;
  BEGIN
    EXECUTE format('SELECT to_jsonb(r) FROM jsonb_populate_record(NULL::public.%I, $1) AS r', p_table)
      INTO v_row USING _v2_subset(p_obj, v_cols);
  EXCEPTION WHEN others THEN
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', p_path, 'reason', 'not_column_type',
                                                         'table', p_table, 'error', left(SQLERRM, 200)));
  END;
  RETURN p_obj || _v2_subset(v_row, v_cols);
END $$;

-- Alan yazımı: değerler jsonb_populate_record ile sütun tipine çevrilir (numeric(4,2), time, text[]…).
CREATE OR REPLACE FUNCTION public._v2_set_fields(p_table text, p_row uuid, p_values jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_bad  text[];
  v_sets text;
BEGIN
  PERFORM _v2_assert_table(p_table);
  IF p_values IS NULL OR p_values = '{}'::jsonb THEN RETURN; END IF;
  v_bad := _v2_unwritable(p_table, ARRAY(SELECT jsonb_object_keys(p_values)));
  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'v2: column(s) % not writable on %', array_to_string(v_bad, ','), p_table;
  END IF;
  SELECT string_agg(format('%I = r.%I', k, k), ', ') INTO v_sets FROM jsonb_object_keys(p_values) AS k;
  EXECUTE format('UPDATE public.%I AS t SET %s FROM jsonb_populate_record(NULL::public.%I, $1) AS r WHERE t.id = $2',
                 p_table, v_sets, p_table) USING p_values, p_row;
END $$;

CREATE OR REPLACE FUNCTION public._v2_delete_row(p_table text, p_row uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM _v2_assert_table(p_table);
  IF p_table IN ('profiles', 'meal_logs', 'workout_logs', 'supplement_logs', 'life_events', 'lab_values', 'achievements',
                 'strength_sets') THEN
    -- Bu tabloların soft-delete'i (ya da kimliği) var: fiziksel silme defterden asla çıkmaz.
    RAISE EXCEPTION 'v2: % rows are never hard-deleted by the ledger', p_table;
  END IF;
  EXECUTE format('DELETE FROM public.%I WHERE id = $1', p_table) USING p_row;
END $$;

-- Silinmiş satırı defterdeki anlık görüntüden aynı id ile geri ekler (üretilmiş sütunlar hariç).
CREATE OR REPLACE FUNCTION public._v2_insert_row(p_table text, p_snapshot jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_cols text;
BEGIN
  PERFORM _v2_assert_table(p_table);
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = format('public.%I', p_table)::regclass
    AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity = ''
    AND p_snapshot ? a.attname::text;
  IF v_cols IS NULL THEN RAISE EXCEPTION 'v2: empty snapshot for %', p_table; END IF;
  EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)',
                 p_table, v_cols, v_cols, p_table) USING p_snapshot;
END $$;

-- Kaydın "günü" (yaş denetimi için). life_events ileri tarihli olabilir → yaş sınırı yok.
CREATE OR REPLACE FUNCTION public._v2_record_day(p_table text, p_state jsonb)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_table
    WHEN 'meal_logs'       THEN (p_state->>'logged_for_date')::date
    WHEN 'workout_logs'    THEN (p_state->>'logged_for_date')::date
    WHEN 'supplement_logs' THEN (p_state->>'logged_for_date')::date
    WHEN 'lab_values'      THEN (p_state->>'measured_at')::date
    ELSE NULL END;
$$;

-- ─── 4. Ref atama ──────────────────────────────────────────────────────────────────────────────────

-- Sıradaki numara max+1: aynı kullanıcı için ref atamasını işlem sonuna kadar kilitle (iki paralel tur
-- nadirdir ama istek günlüğü bir kilit değildir).
CREATE OR REPLACE FUNCTION public._v2_ensure_refs(p_user uuid, p_kind text, p_table text, p_ids uuid[])
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_max integer;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('record_refs:' || p_user::text, 0));
  SELECT coalesce(max(seq), 0) INTO v_max FROM record_refs WHERE user_id = p_user AND kind = p_kind;
  INSERT INTO record_refs (user_id, kind, seq, target_table, target_id)
  SELECT p_user, p_kind, v_max + row_number() OVER (ORDER BY x.ord), p_table, x.id
  FROM (SELECT DISTINCT ON (u.id) u.id, u.ord
        FROM unnest(p_ids) WITH ORDINALITY AS u(id, ord)
        WHERE u.id IS NOT NULL
        ORDER BY u.id, u.ord) AS x
  WHERE NOT EXISTS (SELECT 1 FROM record_refs r
                    WHERE r.user_id = p_user AND r.target_table = p_table AND r.target_id = x.id);
END $$;

CREATE OR REPLACE FUNCTION public._v2_ref_for(p_user uuid, p_kind text, p_table text, p_id uuid)
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v text;
BEGIN
  PERFORM _v2_ensure_refs(p_user, p_kind, p_table, ARRAY[p_id]);
  SELECT ref INTO v FROM record_refs WHERE user_id = p_user AND target_table = p_table AND target_id = p_id;
  RETURN v;
END $$;

-- Ana (primary) defter satırının ref türü. Metrik yazmaları satırı değil yazmayı gösterir.
CREATE OR REPLACE FUNCTION public._v2_ref_kind_for(p_table text, p_field_set text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_table
    WHEN 'meal_logs'       THEN 'm'
    WHEN 'workout_logs'    THEN 't'
    WHEN 'supplement_logs' THEN 's'
    WHEN 'life_events'     THEN 'e'
    WHEN 'lab_values'      THEN 'l'
    WHEN 'daily_metrics'   THEN CASE WHEN 'weight_kg' = ANY(p_field_set) THEN 'w' ELSE 'd' END
    ELSE NULL END;
$$;

-- ─── 5. Defter satırı ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._v2_ledger_insert(
  p_id uuid, p_user uuid, p_turn_id uuid, p_pipeline text, p_op text, p_table text, p_row uuid, p_for_date date,
  p_field_set text[], p_before jsonb, p_after jsonb, p_undo_mode text, p_group uuid, p_is_primary boolean,
  p_ref text, p_reverses uuid, p_meta jsonb
) RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- before/after HER yolda kanonik saklanır (yazıcılar, geri alma motoru, v1 eki): çakışma denetimi
  -- DB'nin to_jsonb gösterimiyle birebir karşılaştırır.
  INSERT INTO turn_writes (id, user_id, turn_id, pipeline, ref, op, table_name, row_id, for_date, field_set,
                           before, after, undo_mode, group_id, is_primary, reverses, meta)
  VALUES (coalesce(p_id, gen_random_uuid()), p_user, p_turn_id, p_pipeline, p_ref, p_op, p_table, p_row, p_for_date,
          coalesce(p_field_set, '{}'), _v2_canon(p_table, p_before, 'before'), _v2_canon(p_table, p_after, 'after'),
          p_undo_mode, p_group, p_is_primary, p_reverses, coalesce(p_meta, '{}'::jsonb))
  RETURNING id INTO p_id;
  RETURN p_id;
END $$;

-- Bir kayıt satırını soft-delete eder ve deftere yazar. Antrenmanın başarımları (source_row_id) ve
-- set'leri (strength_sets) aynı grupta, yan etki satırları olarak birlikte gider; geri getirme onları da
-- geri getirir. (v1 antrenmanı hard-delete ediyordu → set'ler FK CASCADE ile gidiyordu; soft-delete'te
-- set'ler kalsaydı geri alınmış bir "200 kg squat" rekor okuyucularında tarihi en yüksek olarak kalırdı.)
CREATE OR REPLACE FUNCTION public._v2_soft_delete(
  p_user uuid, p_turn_id uuid, p_pipeline text, p_op text, p_table text, p_row uuid, p_for_date date,
  p_group uuid, p_is_primary boolean, p_ref text, p_reverses uuid, p_meta jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_state jsonb := _v2_row_state(p_table, p_row);
  v_before jsonb;
  v_after jsonb;
  v_id uuid;
  v_dep record;
BEGIN
  v_before := jsonb_build_object('is_deleted', false, 'deleted_at', v_state -> 'deleted_at');
  v_after := jsonb_build_object('is_deleted', true, 'deleted_at', to_jsonb(now()));
  PERFORM _v2_set_fields(p_table, p_row, v_after);
  v_id := _v2_ledger_insert(NULL, p_user, p_turn_id, p_pipeline, p_op, p_table, p_row, p_for_date,
                            ARRAY['is_deleted', 'deleted_at'], v_before, v_after, 'restore_previous',
                            p_group, p_is_primary, p_ref, p_reverses, p_meta);
  IF p_table = 'workout_logs' THEN
    FOR v_dep IN SELECT a.id, a.deleted_at FROM achievements a
                 WHERE a.user_id = p_user AND a.source_row_id = p_row AND a.is_deleted = false LOOP
      PERFORM _v2_set_fields('achievements', v_dep.id, v_after);
      PERFORM _v2_ledger_insert(NULL, p_user, p_turn_id, p_pipeline, p_op, 'achievements', v_dep.id, p_for_date,
                                ARRAY['is_deleted', 'deleted_at'],
                                jsonb_build_object('is_deleted', false, 'deleted_at', v_dep.deleted_at), v_after,
                                'restore_previous', p_group, false, NULL, NULL,
                                jsonb_build_object('dependent_of', p_row));
    END LOOP;
    FOR v_dep IN SELECT s.id, s.deleted_at FROM strength_sets s
                 WHERE s.workout_log_id = p_row AND s.is_deleted = false ORDER BY s.set_number, s.id LOOP
      PERFORM _v2_set_fields('strength_sets', v_dep.id, v_after);
      PERFORM _v2_ledger_insert(NULL, p_user, p_turn_id, p_pipeline, p_op, 'strength_sets', v_dep.id, p_for_date,
                                ARRAY['is_deleted', 'deleted_at'],
                                jsonb_build_object('is_deleted', false, 'deleted_at', v_dep.deleted_at), v_after,
                                'restore_previous', p_group, false, NULL, NULL,
                                jsonb_build_object('dependent_of', p_row));
    END LOOP;
  END IF;
  RETURN jsonb_build_object('write_id', v_id, 'table', p_table, 'row_id', p_row, 'ref', p_ref,
                            'field_set', to_jsonb(ARRAY['is_deleted', 'deleted_at']), 'before', v_before, 'after', v_after);
END $$;

-- ─── 6. Geri alma motoru ──────────────────────────────────────────────────────────────────────────
-- p_ids defter satırlarını SONDAN BAŞA tersine çevirir. Her tersine çevirme yeni bir defter satırıdır
-- (op = p_op, reverses = asıl satır); asıl satır undone olur. Tersine çevrilen satır kendisi bir geri
-- alma ise, onun geri aldığı asıl yazma yeniden canlanır. Çakışmada _v2_fail('later_write') — çağıranın
-- savepoint'i yarım işi geri sarar.
CREATE OR REPLACE FUNCTION public._v2_reverse_rows(
  p_user uuid, p_turn_id uuid, p_ids uuid[], p_op text, p_group uuid, p_force boolean, p_meta jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  L          turn_writes%ROWTYPE;
  v_pipeline text := _v2_pipeline(p_meta ->> 'pipeline');
  v_meta     jsonb := coalesce(p_meta, '{}'::jsonb) - 'pipeline';
  v_cur      jsonb;
  v_f        text;
  v_new      jsonb;
  v_before   jsonb;
  v_after    jsonb;
  v_mode     text;
  v_delta    numeric;
  v_val      numeric;
  v_all_zero boolean;
  v_review   boolean;
  v_id       uuid;
  v_rows     jsonb := '[]'::jsonb;
  v_changed  integer := 0;
BEGIN
  FOR L IN SELECT * FROM turn_writes WHERE id = ANY(p_ids) AND user_id = p_user ORDER BY seq DESC LOOP
    -- Bu döngüde daha önce (aynı grubun sonraki satırı olarak) geri alınmış olabilir.
    PERFORM 1 FROM turn_writes WHERE id = L.id AND undone_at IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_review := false;
    v_cur := _v2_row_state(L.table_name, L.row_id);
    IF v_cur IS NOT NULL AND _v2_row_owner(L.table_name, L.row_id) IS DISTINCT FROM p_user THEN
      PERFORM _v2_fail('not_owner', jsonb_build_object('write_id', L.id));
    END IF;

    -- noLaterWriteOnSameField: aynı alana sonradan yapılmış canlı, mutlak (restore_previous) bir yazma
    -- varsa bu yazmayı geri almak onu ezer. Eklemeli (revert_delta) yazmalar birbirini engellemez;
    -- geri alma satırları (reverses dolu) önceki bir durumu geri getirdiği için sayılmaz.
    IF NOT p_force AND L.undo_mode IN ('restore_previous', 'revert_delta') AND cardinality(L.field_set) > 0 AND EXISTS (
         SELECT 1 FROM turn_writes x
         WHERE x.user_id = p_user AND x.table_name = L.table_name AND x.row_id = L.row_id
           AND x.seq > L.seq AND x.undone_at IS NULL AND x.reverses IS NULL
           AND x.field_set && L.field_set
           AND (L.undo_mode = 'restore_previous' OR x.undo_mode = 'restore_previous')) THEN
      PERFORM _v2_fail('later_write', jsonb_build_object('write_id', L.id, 'ref', L.ref, 'table', L.table_name, 'fields', to_jsonb(L.field_set)));
    END IF;

    v_id := NULL;
    IF L.undo_mode = 'none' THEN
      PERFORM _v2_fail('not_reversible', jsonb_build_object('write_id', L.id, 'op', L.op));

    ELSIF L.undo_mode = 'soft_delete' THEN
      IF v_cur IS NULL OR coalesce((v_cur ->> 'is_deleted')::boolean, false) THEN
        -- Satır dışarıda silinmiş (uygulama ekranı / istemci undo): etkisi zaten yok.
        v_review := v_cur IS NULL;
      ELSE
        v_new := _v2_soft_delete(p_user, p_turn_id, v_pipeline, p_op, L.table_name, L.row_id, L.for_date,
                                 p_group, L.is_primary, L.ref, L.id, v_meta || jsonb_build_object('reverses_op', L.op));
        v_id := (v_new ->> 'write_id')::uuid;
        v_rows := v_rows || v_new;
      END IF;

    ELSIF L.undo_mode = 'restore_previous' THEN
      -- daily_metrics günde tek satırdır ve başka alanları da taşır: "satırı bu yazma açtı" bile olsa
      -- geri alma satırı silmez, yalnız bu yazmanın alanlarını boşaltır.
      IF L.before IS NULL AND L.table_name = 'daily_metrics' THEN
        L.before := (SELECT jsonb_object_agg(f, NULL) FROM unnest(L.field_set) AS f);
      END IF;
      IF L.before IS NULL THEN
        -- L satırı ekledi (soft-delete'i olmayan tablo): geri alma = satırı sil, anlık görüntüyü sakla.
        IF v_cur IS NULL THEN
          v_review := true;
        ELSE
          IF NOT p_force THEN
            FOREACH v_f IN ARRAY L.field_set LOOP
              IF v_f NOT IN ('deleted_at', 'updated_at', 'synced') AND (v_cur -> v_f) IS DISTINCT FROM (L.after -> v_f) THEN
                PERFORM _v2_fail('later_write', jsonb_build_object('write_id', L.id, 'ref', L.ref, 'field', v_f, 'expected', L.after -> v_f, 'current', v_cur -> v_f));
              END IF;
            END LOOP;
          END IF;
          PERFORM _v2_delete_row(L.table_name, L.row_id);
          v_before := v_cur; v_after := NULL;
          v_id := _v2_ledger_insert(NULL, p_user, p_turn_id, v_pipeline, p_op, L.table_name, L.row_id, L.for_date,
                                    L.field_set, v_before, v_after, 'restore_previous', p_group, L.is_primary, L.ref, L.id,
                                    v_meta || jsonb_build_object('reverses_op', L.op));
        END IF;
      ELSIF L.after IS NULL THEN
        -- L satırı sildi: geri alma = anlık görüntüden aynı id ile geri ekle.
        IF v_cur IS NOT NULL AND NOT p_force THEN
          PERFORM _v2_fail('later_write', jsonb_build_object('write_id', L.id, 'ref', L.ref, 'reason', 'row_exists'));
        END IF;
        IF v_cur IS NULL THEN
          PERFORM _v2_insert_row(L.table_name, L.before);
          v_before := NULL; v_after := _v2_subset(L.before, L.field_set);
          v_id := _v2_ledger_insert(NULL, p_user, p_turn_id, v_pipeline, p_op, L.table_name, L.row_id, L.for_date,
                                    L.field_set, v_before, v_after, 'restore_previous', p_group, L.is_primary, L.ref, L.id,
                                    v_meta || jsonb_build_object('reverses_op', L.op));
        END IF;
      ELSE
        IF v_cur IS NULL THEN
          v_review := true;
        ELSE
          IF NOT p_force THEN
            FOREACH v_f IN ARRAY L.field_set LOOP
              IF v_f NOT IN ('deleted_at', 'updated_at', 'synced') AND (v_cur -> v_f) IS DISTINCT FROM (L.after -> v_f) THEN
                PERFORM _v2_fail('later_write', jsonb_build_object('write_id', L.id, 'ref', L.ref, 'field', v_f, 'expected', L.after -> v_f, 'current', v_cur -> v_f));
              END IF;
            END LOOP;
          END IF;
          v_new := _v2_subset(L.before, L.field_set);
          -- Bir soft-delete'in geri alınması: deleted_at NULL'a döner, is_deleted false.
          v_before := _v2_subset(v_cur, L.field_set);
          PERFORM _v2_set_fields(L.table_name, L.row_id, v_new);
          v_id := _v2_ledger_insert(NULL, p_user, p_turn_id, v_pipeline, p_op, L.table_name, L.row_id, L.for_date,
                                    L.field_set, v_before, v_new, 'restore_previous', p_group, L.is_primary, L.ref, L.id,
                                    v_meta || jsonb_build_object('reverses_op', L.op));
          v_after := v_new;
        END IF;
      END IF;

    ELSIF L.undo_mode = 'revert_delta' THEN
      IF v_cur IS NULL THEN
        v_review := true;
      ELSE
        v_new := '{}'::jsonb; v_all_zero := true;
        FOREACH v_f IN ARRAY L.field_set LOOP
          v_delta := coalesce((L.after ->> v_f)::numeric, 0) - coalesce((L.before ->> v_f)::numeric, 0);
          v_val := coalesce((v_cur ->> v_f)::numeric, 0) - v_delta;
          IF v_val < 0 THEN v_val := 0; v_review := true; END IF;
          IF v_val <> 0 THEN v_all_zero := false; END IF;
          v_new := v_new || jsonb_build_object(v_f, v_val);
        END LOOP;
        v_before := _v2_subset(v_cur, L.field_set);
        IF L.before IS NULL AND v_all_zero AND L.table_name = 'user_venues' THEN
          -- Mekânı bu yazma açmıştı ve başka ziyaret kalmadı: satır gider, anlık görüntü defterde.
          PERFORM _v2_delete_row(L.table_name, L.row_id);
          v_before := v_cur; v_after := NULL; v_mode := 'restore_previous';
        ELSE
          PERFORM _v2_set_fields(L.table_name, L.row_id, v_new);
          v_after := v_new; v_mode := 'revert_delta';
        END IF;
        v_id := _v2_ledger_insert(NULL, p_user, p_turn_id, v_pipeline, p_op, L.table_name, L.row_id, L.for_date,
                                  L.field_set, v_before, v_after, v_mode, p_group, L.is_primary, L.ref, L.id,
                                  v_meta || jsonb_build_object('reverses_op', L.op));
      END IF;
    END IF;

    IF v_id IS NOT NULL AND L.undo_mode <> 'soft_delete' THEN
      v_rows := v_rows || jsonb_build_object('write_id', v_id, 'reverses', L.id, 'table', L.table_name, 'row_id', L.row_id,
                                             'ref', L.ref, 'field_set', to_jsonb(L.field_set), 'before', v_before, 'after', v_after,
                                             'needs_review', v_review);
    END IF;
    IF v_id IS NOT NULL THEN v_changed := v_changed + 1; END IF;
    IF v_review AND v_id IS NOT NULL THEN
      UPDATE turn_writes SET needs_review = true WHERE id = v_id;
    END IF;

    UPDATE turn_writes SET undone_at = now(), undone_by_turn = p_turn_id, needs_review = needs_review OR v_review
    WHERE id = L.id;
    IF L.reverses IS NOT NULL THEN
      UPDATE turn_writes SET undone_at = NULL, undone_by_turn = NULL WHERE id = L.reverses AND user_id = p_user;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('rows', v_rows, 'changed', v_changed);
END $$;

-- ─── 7. Kimlikle silme / geri getirme çekirdeği ───────────────────────────────────────────────────
-- p_target: {"ref":"m12"} (kayıt ya da metrik yazması — kendisi + yan etkileri) veya
--           {"write_id":"<uuid>"} (o mantıksal yazmanın TÜM grubu — istemci undo düğmesi, "geri al").
-- p_action: 'delete' | 'restore'. p_opts: force, max_age_days (7), expect_kind ('m' / 'd,w'),
--           expect_op ('water_log'), pipeline, reason.
CREATE OR REPLACE FUNCTION public._v2_record_op(
  p_user uuid, p_turn_id uuid, p_target jsonb, p_action text, p_group uuid, p_opts jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_opts     jsonb := coalesce(p_opts, '{}'::jsonb);
  v_force    boolean := coalesce((v_opts ->> 'force')::boolean, false);
  v_max_age  integer := coalesce((v_opts ->> 'max_age_days')::integer, 7);
  v_pipeline text := _v2_pipeline(v_opts ->> 'pipeline');
  v_meta     jsonb := jsonb_build_object('pipeline', _v2_pipeline(v_opts ->> 'pipeline'), 'reason', v_opts ->> 'reason');
  v_refrow   record_refs%ROWTYPE;
  v_anchor   turn_writes%ROWTYPE;
  v_rev      turn_writes%ROWTYPE;
  v_has_anchor boolean := false;
  v_scope    text;
  v_table    text;
  v_row      uuid;
  v_ref      text;
  v_cur      jsonb;
  v_day      date;
  v_ids      uuid[];
  v_live     text[];
  v_result   jsonb;
  v_one      jsonb;
  v_op       text := CASE p_action WHEN 'delete' THEN 'record_delete' WHEN 'restore' THEN 'record_restore' END;
BEGIN
  IF v_op IS NULL THEN PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'action', 'value', p_action)); END IF;
  IF p_user IS NULL OR p_turn_id IS NULL THEN PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'identity')); END IF;

  -- 1. Hedefi çöz (yalnız bu kullanıcının ref'leri / defteri).
  IF jsonb_typeof(p_target -> 'ref') = 'string' THEN
    SELECT * INTO v_refrow FROM record_refs WHERE user_id = p_user AND ref = p_target ->> 'ref';
    IF NOT FOUND THEN PERFORM _v2_fail('unknown_ref', jsonb_build_object('ref', p_target ->> 'ref')); END IF;
    IF v_opts ? 'expect_kind' AND NOT (v_refrow.kind = ANY(string_to_array(v_opts ->> 'expect_kind', ','))) THEN
      PERFORM _v2_fail('wrong_ref_kind', jsonb_build_object('ref', v_refrow.ref, 'expected', v_opts ->> 'expect_kind'));
    END IF;
    IF v_refrow.kind IN ('c', 'k', 'p', 'dft') THEN
      -- Omurga constraint_retract, söz commitment_resolve, bekletme discard, taslak plan_action ile kapanır.
      PERFORM _v2_fail('not_deletable', jsonb_build_object('ref', v_refrow.ref, 'kind', v_refrow.kind));
    END IF;
    v_ref := v_refrow.ref;
    v_scope := 'record';
    IF v_refrow.target_table = 'turn_writes' THEN
      SELECT * INTO v_anchor FROM turn_writes WHERE id = v_refrow.target_id AND user_id = p_user;
      IF NOT FOUND THEN PERFORM _v2_fail('unknown_ref', jsonb_build_object('ref', v_ref)); END IF;
      v_has_anchor := true;
      v_table := v_anchor.table_name; v_row := v_anchor.row_id;
    ELSE
      v_table := v_refrow.target_table; v_row := v_refrow.target_id;
    END IF;
  ELSIF jsonb_typeof(p_target -> 'write_id') = 'string' THEN
    SELECT * INTO v_anchor FROM turn_writes WHERE id = (p_target ->> 'write_id')::uuid AND user_id = p_user;
    IF NOT FOUND THEN PERFORM _v2_fail('unknown_ref', jsonb_build_object('write_id', p_target ->> 'write_id')); END IF;
    v_has_anchor := true;
    v_scope := 'group';
    v_ref := v_anchor.ref; v_table := v_anchor.table_name; v_row := v_anchor.row_id;
  ELSE
    PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'target'));
  END IF;

  IF v_has_anchor AND v_opts ? 'expect_op' AND v_anchor.op <> (v_opts ->> 'expect_op') THEN
    PERFORM _v2_fail('wrong_ref_kind', jsonb_build_object('ref', v_ref, 'op', v_anchor.op, 'expected', v_opts ->> 'expect_op'));
  END IF;

  -- 2. Geri alınacak defter satırlarını seç.
  IF v_scope = 'group' THEN
    IF p_action = 'restore' AND v_anchor.op NOT IN ('record_delete', 'record_restore') THEN
      PERFORM _v2_fail('not_undone', jsonb_build_object('write_id', v_anchor.id, 'op', v_anchor.op));
    END IF;
    IF v_anchor.undone_at IS NOT NULL THEN PERFORM _v2_fail('already_undone', jsonb_build_object('write_id', v_anchor.id)); END IF;
    IF v_anchor.created_at < now() - make_interval(days => v_max_age + 1) THEN
      PERFORM _v2_fail('too_old', jsonb_build_object('write_id', v_anchor.id, 'max_age_days', v_max_age));
    END IF;
    SELECT array_agg(id) INTO v_ids FROM turn_writes
    WHERE user_id = p_user AND group_id = v_anchor.group_id AND undone_at IS NULL;

  ELSIF p_action = 'delete' THEN
    IF v_has_anchor THEN
      -- Metrik yazması (d/w): kendisi + yan etkileri.
      IF v_anchor.undone_at IS NOT NULL THEN PERFORM _v2_fail('already_undone', jsonb_build_object('ref', v_ref)); END IF;
      IF v_anchor.created_at < now() - make_interval(days => v_max_age + 1) THEN
        PERFORM _v2_fail('too_old', jsonb_build_object('ref', v_ref, 'max_age_days', v_max_age));
      END IF;
      SELECT array_agg(id) INTO v_ids FROM turn_writes
      WHERE user_id = p_user AND group_id = v_anchor.group_id AND undone_at IS NULL
        AND op NOT IN ('record_delete', 'record_restore') AND (id = v_anchor.id OR NOT is_primary);
    ELSE
      v_cur := _v2_row_state(v_table, v_row);
      IF v_cur IS NULL THEN PERFORM _v2_fail('row_missing', jsonb_build_object('ref', v_ref)); END IF;
      IF _v2_row_owner(v_table, v_row) IS DISTINCT FROM p_user THEN PERFORM _v2_fail('not_owner', jsonb_build_object('ref', v_ref)); END IF;
      IF coalesce((v_cur ->> 'is_deleted')::boolean, false) THEN PERFORM _v2_fail('already_undone', jsonb_build_object('ref', v_ref)); END IF;
      v_day := _v2_record_day(v_table, v_cur);
      IF v_day IS NOT NULL AND v_day < current_date - (v_max_age + 1) THEN
        PERFORM _v2_fail('too_old', jsonb_build_object('ref', v_ref, 'day', v_day, 'max_age_days', v_max_age));
      END IF;
      -- Satırı ekleyen defter yazması varsa yan etkileri (mekân ziyareti) onunla gider.
      SELECT * INTO v_anchor FROM turn_writes
      WHERE user_id = p_user AND table_name = v_table AND row_id = v_row
        AND before IS NULL AND undo_mode = 'soft_delete' AND undone_at IS NULL
      ORDER BY seq DESC LIMIT 1;
      IF FOUND THEN
        SELECT array_agg(id) INTO v_ids FROM turn_writes
        WHERE user_id = p_user AND group_id = v_anchor.group_id AND undone_at IS NULL
          AND op NOT IN ('record_delete', 'record_restore') AND (id = v_anchor.id OR NOT is_primary);
      ELSE
        -- Defterin hiç görmediği satır (uygulama ekranı, v2 öncesi geçmiş — ör. 1708 kcal nugget):
        -- doğrudan soft-delete; silmenin kendisi defterde, geri getirilebilir.
        v_one := _v2_soft_delete(p_user, p_turn_id, v_pipeline, v_op, v_table, v_row, v_day, p_group, true, v_ref, NULL, v_meta);
        RETURN jsonb_build_object('scope', 'record', 'target', jsonb_build_object('ref', v_ref, 'table', v_table, 'row_id', v_row),
                                  'reversed', jsonb_build_array(v_one), 'needs_review', false);
      END IF;
    END IF;

  ELSE -- restore
    IF v_has_anchor THEN
      -- Metrik yazması: onu geri alan canlı silme satırını bul.
      IF v_anchor.undone_at IS NULL THEN PERFORM _v2_fail('not_undone', jsonb_build_object('ref', v_ref)); END IF;
      SELECT * INTO v_rev FROM turn_writes
      WHERE user_id = p_user AND reverses = v_anchor.id AND undone_at IS NULL AND op = 'record_delete'
      ORDER BY seq DESC LIMIT 1;
      IF NOT FOUND THEN PERFORM _v2_fail('not_undone', jsonb_build_object('ref', v_ref)); END IF;
    ELSE
      SELECT * INTO v_rev FROM turn_writes
      WHERE user_id = p_user AND table_name = v_table AND row_id = v_row AND op = 'record_delete' AND undone_at IS NULL
      ORDER BY seq DESC LIMIT 1;
      IF NOT FOUND THEN
        v_cur := _v2_row_state(v_table, v_row);
        IF v_cur IS NULL THEN PERFORM _v2_fail('row_missing', jsonb_build_object('ref', v_ref)); END IF;
        IF NOT coalesce((v_cur ->> 'is_deleted')::boolean, false) THEN PERFORM _v2_fail('not_undone', jsonb_build_object('ref', v_ref)); END IF;
        v_day := _v2_record_day(v_table, v_cur);
        IF v_day IS NOT NULL AND v_day < current_date - (v_max_age + 1) THEN
          PERFORM _v2_fail('too_old', jsonb_build_object('ref', v_ref, 'day', v_day, 'max_age_days', v_max_age));
        END IF;
        -- Defter dışında silinmiş (uygulama ekranı): doğrudan geri getir, deftere yaz.
        PERFORM _v2_set_fields(v_table, v_row, jsonb_build_object('is_deleted', false, 'deleted_at', NULL));
        v_one := jsonb_build_object('write_id', _v2_ledger_insert(NULL, p_user, p_turn_id, v_pipeline, v_op, v_table, v_row,
                   _v2_record_day(v_table, v_cur), ARRAY['is_deleted', 'deleted_at'],
                   jsonb_build_object('is_deleted', true, 'deleted_at', v_cur -> 'deleted_at'),
                   jsonb_build_object('is_deleted', false, 'deleted_at', NULL), 'restore_previous', p_group, true, v_ref, NULL, v_meta),
                   'table', v_table, 'row_id', v_row, 'ref', v_ref);
        RETURN jsonb_build_object('scope', 'record', 'target', jsonb_build_object('ref', v_ref, 'table', v_table, 'row_id', v_row),
                                  'reversed', jsonb_build_array(v_one), 'needs_review', false);
      END IF;
    END IF;
    IF v_rev.created_at < now() - make_interval(days => v_max_age + 1) THEN
      PERFORM _v2_fail('too_old', jsonb_build_object('ref', v_ref, 'max_age_days', v_max_age));
    END IF;
    -- Silme bir düzeltmenin parçasıysa (aynı grupta yeni kayıt canlı), eskiyi geri getirmek çift sayım
    -- olur: modele yerine geçen ref'i söyle, kod tahmin etmez.
    SELECT array_agg(coalesce(ref, id::text)) INTO v_live FROM turn_writes
    WHERE user_id = p_user AND group_id = v_rev.group_id AND undone_at IS NULL AND is_primary
      AND op NOT IN ('record_delete', 'record_restore');
    IF v_live IS NOT NULL THEN
      PERFORM _v2_fail('replaced', jsonb_build_object('ref', v_ref, 'replaced_by', to_jsonb(v_live)));
    END IF;
    SELECT array_agg(id) INTO v_ids FROM turn_writes
    WHERE user_id = p_user AND group_id = v_rev.group_id AND undone_at IS NULL AND op = 'record_delete';
  END IF;

  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    PERFORM _v2_fail('already_undone', jsonb_build_object('ref', v_ref));
  END IF;

  v_result := _v2_reverse_rows(p_user, p_turn_id, v_ids, v_op, p_group, v_force, v_meta);
  IF coalesce((v_result ->> 'changed')::integer, 0) = 0 THEN
    PERFORM _v2_fail('already_undone', jsonb_build_object('ref', v_ref, 'reason', 'nothing_changed'));
  END IF;

  RETURN jsonb_build_object(
    'scope', v_scope,
    'target', jsonb_build_object('ref', v_ref, 'table', v_table, 'row_id', v_row, 'write_id', CASE WHEN v_has_anchor THEN v_anchor.id END),
    'reversed', v_result -> 'rows',
    'needs_review', EXISTS (SELECT 1 FROM jsonb_array_elements(v_result -> 'rows') e WHERE (e ->> 'needs_review')::boolean));
END $$;

-- ─── 8. Kamuya açık RPC'ler (yalnız service_role) ─────────────────────────────────────────────────

-- record_ops.delete (§4.4 (3)) + istemci undo düğmesi (write_id ile) + "geri al".
CREATE OR REPLACE FUNCTION public.w_record_delete(p_user uuid, p_turn_id uuid, p_target jsonb, p_opts jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group uuid := gen_random_uuid();
  v_res   jsonb;
  v_msg   text;
  v_detail text;
  v_state text;
BEGIN
  BEGIN
    v_res := _v2_record_op(p_user, p_turn_id, p_target, 'delete', v_group, p_opts);
    RETURN jsonb_build_object('ok', true, 'op', 'record_delete', 'turn_id', p_turn_id, 'group_id', v_group) || v_res;
  EXCEPTION
    WHEN SQLSTATE 'V2F01' THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
      RETURN _v2_failure('record_delete', v_msg, v_detail);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
      RETURN _v2_write_failed('record_delete', v_state, v_msg);
  END;
END $$;

-- Geri alınmış bir kaydı/yazmayı geri getirir ("yanlışlıkla sildim").
CREATE OR REPLACE FUNCTION public.w_record_restore(p_user uuid, p_turn_id uuid, p_target jsonb, p_opts jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group uuid := gen_random_uuid();
  v_res   jsonb;
  v_msg   text;
  v_detail text;
  v_state text;
BEGIN
  BEGIN
    v_res := _v2_record_op(p_user, p_turn_id, p_target, 'restore', v_group, p_opts);
    RETURN jsonb_build_object('ok', true, 'op', 'record_restore', 'turn_id', p_turn_id, 'group_id', v_group) || v_res;
  EXCEPTION
    WHEN SQLSTATE 'V2F01' THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
      RETURN _v2_failure('record_restore', v_msg, v_detail);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
      RETURN _v2_write_failed('record_restore', v_state, v_msg);
  END;
END $$;

-- v1 executeActions'ın (ve henüz RPC'si olmayan yazıcıların) deftere yazması. Yazmanın kendisiyle AYNI
-- işlemde değildir (v1 supabase-js ile yazar) — en iyi çaba; v2 yazıcı RPC'leri aynı işlemde yazar.
-- p_entries: [{op, table_name, row_id, for_date, field_set[], before, after, undo_mode, group?, is_primary?, meta?, pipeline?}]
-- Aynı "group" etiketini taşıyan girdiler tek mantıksal yazmadır.
-- restore_previous / revert_delta girdileri için (geri alınabilirlik YAZILIRKEN denetlenir):
--   * field_set yalnız yazılabilir gerçek sütunlardır (kimlik/korunan/üretilmiş/olmayan sütun = ret);
--   * before/after nesne ise field_set'in HER anahtarını taşır (null değer = "boştu"/"boşalttım");
--   * satır duruyorsa after zorunludur (after=NULL "bu yazma satırı sildi" demektir);
--   * before/after sütun tipine göre kanonik saklanır (_v2_canon): v1'in '23:00'ı "23:00:00" olur ve
--     geri almanın çakışma denetimi DB değeriyle aynı gösterimi karşılaştırır. Kanonik after DB'deki
--     değerle tutmuyorsa (araya başka yazma girdi / v1 yanlış after verdi) geri alma 'later_write' ile
--     reddedilir — sessiz ezme yok.
CREATE OR REPLACE FUNCTION public.v2_ledger_append(p_user uuid, p_turn_id uuid, p_entries jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e        jsonb;
  i        integer := 0;
  v_out    jsonb := '[]'::jsonb;
  v_groups jsonb := '{}'::jsonb;
  v_label  text;
  v_gid    uuid;
  v_id     uuid;
  v_table  text;
  v_row    uuid;
  v_fields text[];
  v_kind   text;
  v_ref    text;
  v_mode   text;
  v_primary boolean;
  v_owner  uuid;
  v_before jsonb;
  v_after  jsonb;
  v_bad    text[];
  v_side   text;
  v_msg    text;
  v_detail text;
  v_state  text;
BEGIN
  BEGIN
    IF p_user IS NULL OR p_turn_id IS NULL THEN PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'identity')); END IF;
    IF jsonb_typeof(p_entries) IS DISTINCT FROM 'array' OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 50 THEN
      PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'entries'));
    END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
      i := i + 1;
      v_table := e ->> 'table_name';
      PERFORM _v2_assert_table(v_table);
      v_mode := e ->> 'undo_mode';
      IF v_mode IS NULL OR v_mode NOT IN ('soft_delete', 'restore_previous', 'revert_delta', 'none') THEN
        PERFORM _v2_fail('invalid_value', jsonb_build_object('path', format('entries[%s].undo_mode', i), 'value', v_mode));
      END IF;
      PERFORM _v2_text(e, 'op', 64, false, format('entries[%s].op', i));
      v_row := nullif(e ->> 'row_id', '')::uuid;
      v_fields := _v2_text_array(e, 'field_set', format('entries[%s].field_set', i));
      -- Geri alınabilirlik yazılırken denetlenir, geri alma anında sürpriz olmaz.
      IF v_mode = 'soft_delete' AND v_table NOT IN ('meal_logs', 'workout_logs', 'supplement_logs', 'life_events', 'lab_values',
                                                    'achievements', 'strength_sets') THEN
        PERFORM _v2_fail('invalid_value', jsonb_build_object('path', format('entries[%s].undo_mode', i), 'reason', 'table_has_no_soft_delete'));
      END IF;
      IF v_mode IN ('restore_previous', 'revert_delta') AND cardinality(v_fields) = 0 THEN
        PERFORM _v2_fail('invalid_value', jsonb_build_object('path', format('entries[%s].field_set', i), 'reason', 'required'));
      END IF;
      IF v_mode <> 'none' AND v_row IS NULL THEN
        PERFORM _v2_fail('invalid_value', jsonb_build_object('path', format('entries[%s].row_id', i), 'reason', 'required'));
      END IF;
      IF v_table = 'profiles' AND v_fields && ARRAY['premium', 'premium_expires_at', 'trial_used', 'deleted_at',
                                                    'deletion_requested_at', 'deletion_cancelled'] THEN
        PERFORM _v2_fail('invalid_value', jsonb_build_object('path', format('entries[%s].field_set', i), 'reason', 'protected_column'));
      END IF;
      v_before := CASE WHEN jsonb_typeof(e -> 'before') = 'object' THEN e -> 'before' END;
      v_after  := CASE WHEN jsonb_typeof(e -> 'after') = 'object' THEN e -> 'after' END;
      IF v_mode IN ('restore_previous', 'revert_delta') THEN
        v_bad := _v2_unwritable(v_table, v_fields);
        IF cardinality(v_bad) > 0 THEN
          PERFORM _v2_fail('invalid_value', jsonb_build_object('path', format('entries[%s].field_set', i), 'reason', 'not_writable',
                                                               'fields', to_jsonb(v_bad)));
        END IF;
        FOREACH v_side IN ARRAY ARRAY['before', 'after'] LOOP
          SELECT array_agg(f ORDER BY f) INTO v_bad FROM unnest(v_fields) AS f
          WHERE NOT (CASE v_side WHEN 'before' THEN v_before ELSE v_after END) ? f;
          IF (CASE v_side WHEN 'before' THEN v_before ELSE v_after END) IS NOT NULL AND v_bad IS NOT NULL THEN
            PERFORM _v2_fail('invalid_value', jsonb_build_object('path', format('entries[%s].%s', i, v_side), 'reason', 'missing_field',
                                                                 'fields', to_jsonb(v_bad)));
          END IF;
        END LOOP;
      END IF;
      IF v_row IS NOT NULL THEN
        v_owner := _v2_row_owner(v_table, v_row);
        -- Satır yoksa yalnızca "bu yazma satırı sildi" (after NULL) kaydı anlamlıdır.
        IF v_owner IS NULL AND NOT (v_mode = 'restore_previous' AND v_after IS NULL) THEN
          PERFORM _v2_fail('row_missing', jsonb_build_object('path', format('entries[%s].row_id', i)));
        END IF;
        IF v_owner IS NOT NULL AND v_owner <> p_user THEN
          PERFORM _v2_fail('not_owner', jsonb_build_object('path', format('entries[%s].row_id', i)));
        END IF;
        -- Satır duruyor: geri almanın karşılaştıracağı "bu yazmanın bıraktığı değer" olmadan girdi geri alınamaz.
        IF v_owner IS NOT NULL AND v_mode IN ('restore_previous', 'revert_delta') AND v_after IS NULL THEN
          PERFORM _v2_fail('invalid_value', jsonb_build_object('path', format('entries[%s].after', i), 'reason', 'required'));
        END IF;
      END IF;
      v_before := _v2_canon(v_table, v_before, format('entries[%s].before', i));
      v_after  := _v2_canon(v_table, v_after,  format('entries[%s].after', i));
      v_label := coalesce(e ->> 'group', 'auto:' || i::text);
      v_gid := coalesce((v_groups ->> v_label)::uuid, gen_random_uuid());
      v_groups := v_groups || jsonb_build_object(v_label, v_gid);
      v_primary := coalesce((e ->> 'is_primary')::boolean, true);
      v_id := gen_random_uuid();
      v_ref := NULL;
      v_kind := _v2_ref_kind_for(v_table, v_fields);
      IF v_primary AND v_kind IS NOT NULL THEN
        IF v_kind IN ('d', 'w') THEN
          v_ref := _v2_ref_for(p_user, v_kind, 'turn_writes', v_id);
        ELSIF v_row IS NOT NULL THEN
          v_ref := _v2_ref_for(p_user, v_kind, v_table, v_row);
        END IF;
      END IF;
      PERFORM _v2_ledger_insert(v_id, p_user, p_turn_id, _v2_pipeline(coalesce(e ->> 'pipeline', 'v1')), e ->> 'op', v_table, v_row,
                                nullif(e ->> 'for_date', '')::date, v_fields, v_before, v_after,
                                v_mode, v_gid, v_primary, v_ref, NULL,
                                CASE WHEN jsonb_typeof(e -> 'meta') = 'object' THEN e -> 'meta' ELSE '{}'::jsonb END);
      v_out := v_out || jsonb_build_object('index', i - 1, 'write_id', v_id, 'group_id', v_gid, 'ref', v_ref);
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'op', 'ledger_append', 'turn_id', p_turn_id, 'entries', v_out);
  EXCEPTION
    WHEN SQLSTATE 'V2F01' THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
      RETURN _v2_failure('ledger_append', v_msg, v_detail);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
      RETURN _v2_write_failed('ledger_append', v_state, v_msg);
  END;
END $$;

-- ─── 9. Yetkiler ──────────────────────────────────────────────────────────────────────────────────
-- Supabase varsayılan yetkileri yeni fonksiyonları anon/authenticated'a da açar: hepsini açıkça kapat.
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE '\_v2\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.w_record_delete(uuid, uuid, jsonb, jsonb)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.w_record_restore(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v2_ledger_append(uuid, uuid, jsonb)        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.w_record_delete(uuid, uuid, jsonb, jsonb)  TO service_role;
GRANT EXECUTE ON FUNCTION public.w_record_restore(uuid, uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_ledger_append(uuid, uuid, jsonb)        TO service_role;

SELECT '108 turn_writes + record_refs + record ops applied' AS status;

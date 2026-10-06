-- 109: pending_writes v2 — ASK/hold sonucunun genel deposu (106'yı GENİŞLETİR, yeniden yaratmaz).
--
-- NEDEN (AI_MIMARI_V2 §5.2 ASK, §7.1 iki adımlı kaldırma · Faz 1): 106 tabloyu KVKK sohbet silmesi için
-- açtı. v2'de denetimden "sor" çıkan her yazma buraya gider (p#, 48 sa): günün toplamı kayıttan az,
-- "kayıtlarımda 35 yaş var, 12 dedin", bandı >300 kcal oynatan hedef, ciddi alerjen kaldırma… Stage B
-- tek soruyu sorar; SONRAKİ turda Stage A confirm{p#} / discard / modify üretir, kod yalnız onayda yazar.
--
-- BU MİGRASYON:
--   * turn_id, subject_key, hold_class ('ask' | 'safety'), reason_code, schema_version, chat_message_id,
--     resolved_by_turn, result sütunları.
--   * status'a 'superseded' (modify: eski bekletme kapanır, yenisi açılır).
--   * "Kullanıcı × op başına tek açık bekletme" kuralı (user, op, subject_key) olur. subject_key NULL
--     olan satırlar (KVKK silme bekletmesi) için kural AYNEN sürer: erase-hold.ts davranışı değişmez.
--   * expires_at varsayılanı 48 sa (106 her satırda açıkça veriyordu; o yol değişmez).
--   * v2_hold_open / v2_hold_resolve RPC'leri + yazıcı RPC'lerin onayı AYNI işlemde kapatması için
--     _v2_hold_claim / _v2_hold_close. Onay yazıyla birlikte ya hep ya hiç: tekrar denenen bir "evet"
--     ikinci kez yazamaz (bekletme artık 'pending' değildir).
--   * Bekletme yalnız SONRAKİ bir turda onaylanır (§4.4(4), §5.2; erase-hold.ts ile aynı kural): onu açan
--     turun kimliğiyle gelen onay 'hold_not_open' (detail.reason='same_turn') döner. Model aynı turda p#'yi
--     göremez; bu kod tarafındaki ikinci kilittir.
--
-- Kullanıcının ham mesajı payload'a YAZILMAZ: yalnız modelin yapısal argümanları (106 ile aynı kural).
--
-- DOWN:
--   DROP FUNCTION IF EXISTS public.v2_hold_resolve(uuid, uuid, uuid, text, jsonb, text), public.v2_hold_open(uuid, uuid, text, jsonb, jsonb),
--     public._v2_hold_close(uuid, text, uuid, jsonb, text), public._v2_hold_claim(uuid, uuid, text, uuid);
--   DROP INDEX IF EXISTS idx_pending_writes_open, idx_pending_writes_resolved; DROP INDEX IF EXISTS uq_pending_writes_one_open;
--   CREATE UNIQUE INDEX uq_pending_writes_one_open ON pending_writes(user_id, op) WHERE status = 'pending';
--   ALTER TABLE pending_writes DROP CONSTRAINT IF EXISTS pending_writes_hold_class_check;
--   ALTER TABLE pending_writes DROP COLUMN IF EXISTS turn_id, DROP COLUMN IF EXISTS subject_key, DROP COLUMN IF EXISTS hold_class,
--     DROP COLUMN IF EXISTS reason_code, DROP COLUMN IF EXISTS schema_version, DROP COLUMN IF EXISTS chat_message_id,
--     DROP COLUMN IF EXISTS resolved_by_turn, DROP COLUMN IF EXISTS result;
--   (status CHECK'ini 106'daki listeye döndür.)

ALTER TABLE pending_writes ADD COLUMN IF NOT EXISTS turn_id          uuid;
-- Aynı konuya ikinci bekletme açılmasın: 'water_log:2026-10-06', 'constraint_retract:c3', 'profile_set:birth_year'.
ALTER TABLE pending_writes ADD COLUMN IF NOT EXISTS subject_key      text;
-- 'safety' = alerjen/sakatlık kaldırma, kimlik/cinsiyet, bant değişimi, hesap silme: koç sormazsa kod şablon soru ekler.
ALTER TABLE pending_writes ADD COLUMN IF NOT EXISTS hold_class       text NOT NULL DEFAULT 'ask';
-- Bekletmeyi doğuran validator kuralı: 'tek_seferde_cok', 'toplam_kayittan_az', 'materiality_birth_year'…
ALTER TABLE pending_writes ADD COLUMN IF NOT EXISTS reason_code      text;
-- Payload'ın uyduğu kayıt sürümü (SCHEMA_VERSION): kayıt değişirse eski bir payload körlemesine uygulanmaz.
ALTER TABLE pending_writes ADD COLUMN IF NOT EXISTS schema_version   text;
ALTER TABLE pending_writes ADD COLUMN IF NOT EXISTS chat_message_id  uuid;
ALTER TABLE pending_writes ADD COLUMN IF NOT EXISTS resolved_by_turn uuid;
-- Onayda yazıcının makbuzu (ya da başarısızlık sınıfı).
ALTER TABLE pending_writes ADD COLUMN IF NOT EXISTS result           jsonb;

ALTER TABLE pending_writes DROP CONSTRAINT IF EXISTS pending_writes_hold_class_check;
ALTER TABLE pending_writes ADD CONSTRAINT pending_writes_hold_class_check CHECK (hold_class IN ('ask', 'safety'));

ALTER TABLE pending_writes DROP CONSTRAINT IF EXISTS pending_writes_status_check;
ALTER TABLE pending_writes ADD CONSTRAINT pending_writes_status_check
  CHECK (status IN ('pending', 'confirmed', 'discarded', 'superseded', 'expired', 'failed'));

ALTER TABLE pending_writes ALTER COLUMN expires_at SET DEFAULT (now() + interval '48 hours');

DROP INDEX IF EXISTS uq_pending_writes_one_open;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_writes_one_open
  ON pending_writes (user_id, op, (coalesce(subject_key, ''))) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pending_writes_open     ON pending_writes (user_id, expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pending_writes_resolved ON pending_writes (resolved_at) WHERE status <> 'pending';

COMMENT ON COLUMN pending_writes.hold_class IS 'ask = koç kendi sözleriyle sorar; safety = koç sormazsa kod şablon soru ekler (§5.2).';
COMMENT ON COLUMN pending_writes.subject_key IS 'Aynı konuya tek açık bekletme. NULL = op başına tek (106 KVKK davranışı).';

-- ─── Yazıcıların onayı aynı işlemde kapatması ────────────────────────────────────────────────────
-- Satırı kilitler; yalnızca bu kullanıcının, açık, süresi dolmamış, aynı op'lu ve BAŞKA bir turda
-- açılmış bekletmesi onaylanabilir. p_turn_id = onaylayan tur (zorunlu).
CREATE OR REPLACE FUNCTION public._v2_hold_claim(p_user uuid, p_pending_id uuid, p_op text, p_turn_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_hold pending_writes%ROWTYPE;
BEGIN
  IF p_turn_id IS NULL THEN PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'identity')); END IF;
  SELECT * INTO v_hold FROM pending_writes WHERE id = p_pending_id AND user_id = p_user FOR UPDATE;
  IF NOT FOUND OR v_hold.status <> 'pending' THEN
    PERFORM _v2_fail('hold_not_open', jsonb_build_object('pending_id', p_pending_id, 'status', v_hold.status));
  END IF;
  -- Onay bir SORUYA verilen cevaptır: soruyu soran (bekletmeyi açan) turda onay olamaz.
  IF v_hold.turn_id IS NOT NULL AND v_hold.turn_id = p_turn_id THEN
    PERFORM _v2_fail('hold_not_open', jsonb_build_object('pending_id', p_pending_id, 'status', v_hold.status, 'reason', 'same_turn'));
  END IF;
  IF v_hold.expires_at <= now() THEN
    PERFORM _v2_fail('hold_expired', jsonb_build_object('pending_id', p_pending_id, 'expires_at', v_hold.expires_at));
  END IF;
  IF p_op IS NOT NULL AND v_hold.op <> p_op THEN
    PERFORM _v2_fail('hold_op_mismatch', jsonb_build_object('pending_id', p_pending_id, 'op', v_hold.op, 'expected', p_op));
  END IF;
  RETURN to_jsonb(v_hold);
END $$;

CREATE OR REPLACE FUNCTION public._v2_hold_close(p_pending_id uuid, p_status text, p_turn_id uuid, p_result jsonb, p_note text)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE pending_writes
  SET status = p_status, resolved_at = now(), resolved_by_turn = p_turn_id,
      result = p_result, resolution_note = coalesce(p_note, p_status)
  WHERE id = p_pending_id AND status = 'pending';
  IF NOT FOUND THEN
    PERFORM _v2_fail('hold_not_open', jsonb_build_object('pending_id', p_pending_id));
  END IF;
END $$;

-- ASK sonucu: bekletme aç. Aynı (op, subject_key) için açık bir bekletme varsa 'superseded' olur.
-- p_opts: subject_key, hold_class ('ask'|'safety'), reason_code, schema_version, ttl_minutes (1..10080, vars. 2880).
CREATE OR REPLACE FUNCTION public.v2_hold_open(p_user uuid, p_turn_id uuid, p_op text, p_payload jsonb, p_opts jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_opts    jsonb := coalesce(p_opts, '{}'::jsonb);
  v_subject text;
  v_class   text;
  v_ttl     numeric;
  v_id      uuid := gen_random_uuid();
  v_prev    uuid;
  v_ref     text;
  v_exp     timestamptz;
  v_msg     text;
  v_detail  text;
  v_state   text;
BEGIN
  BEGIN
    IF p_user IS NULL OR p_turn_id IS NULL THEN PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'identity')); END IF;
    PERFORM _v2_text(jsonb_build_object('op', p_op), 'op', 64, false, 'op');
    IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'payload')); END IF;
    v_subject := _v2_text(v_opts, 'subject_key', 120, true, 'subject_key');
    v_class := coalesce(_v2_text(v_opts, 'hold_class', 10, true, 'hold_class'), 'ask');
    IF v_class NOT IN ('ask', 'safety') THEN PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'hold_class', 'value', v_class)); END IF;
    v_ttl := coalesce(_v2_num(v_opts, 'ttl_minutes', 1, 10080, true, 'ttl_minutes'), 2880);
    v_exp := now() + make_interval(mins => v_ttl::integer);

    UPDATE pending_writes
    SET status = 'superseded', resolved_at = now(), resolved_by_turn = p_turn_id, resolution_note = 'superseded'
    WHERE user_id = p_user AND op = p_op AND coalesce(subject_key, '') = coalesce(v_subject, '') AND status = 'pending'
    RETURNING id INTO v_prev;

    INSERT INTO pending_writes (id, user_id, op, payload, status, expires_at, turn_id, subject_key, hold_class,
                                reason_code, schema_version)
    VALUES (v_id, p_user, p_op, p_payload, 'pending', v_exp, p_turn_id, v_subject, v_class,
            _v2_text(v_opts, 'reason_code', 80, true, 'reason_code'), _v2_text(v_opts, 'schema_version', 40, true, 'schema_version'));

    v_ref := _v2_ref_for(p_user, 'p', 'pending_writes', v_id);
    RETURN jsonb_build_object('ok', true, 'op', 'hold_open', 'pending_id', v_id, 'ref', v_ref, 'expires_at', v_exp,
                              'superseded_id', v_prev, 'hold_class', v_class);
  EXCEPTION
    WHEN SQLSTATE 'V2F01' THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
      RETURN _v2_failure('hold_open', v_msg, v_detail);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
      RETURN _v2_write_failed('hold_open', v_state, v_msg);
  END;
END $$;

-- Yazma RPC'si olmayan kapanışlar: discard (kullanıcı vazgeçti), superseded (modify), expired, failed,
-- ve yazımı TS'te yapılan op'ların onayı (ör. constraint_retract → syncConstraint) için 'confirmed'.
CREATE OR REPLACE FUNCTION public.v2_hold_resolve(p_user uuid, p_turn_id uuid, p_pending_id uuid, p_status text,
                                                  p_result jsonb DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hold   jsonb;
  v_msg    text;
  v_detail text;
  v_state  text;
BEGIN
  BEGIN
    IF p_status IS NULL OR p_status NOT IN ('confirmed', 'discarded', 'superseded', 'expired', 'failed') THEN
      PERFORM _v2_fail('invalid_value', jsonb_build_object('path', 'status', 'value', p_status));
    END IF;
    -- Süresi dolmuş bir bekletme yalnızca 'expired' / 'discarded' / 'failed' ile kapanabilir; onaylanamaz.
    IF p_status = 'confirmed' THEN
      v_hold := _v2_hold_claim(p_user, p_pending_id, NULL, p_turn_id);
    ELSE
      PERFORM 1 FROM pending_writes WHERE id = p_pending_id AND user_id = p_user AND status = 'pending' FOR UPDATE;
      IF NOT FOUND THEN PERFORM _v2_fail('hold_not_open', jsonb_build_object('pending_id', p_pending_id)); END IF;
    END IF;
    PERFORM _v2_hold_close(p_pending_id, p_status, p_turn_id, p_result, left(p_note, 200));
    RETURN jsonb_build_object('ok', true, 'op', 'hold_resolve', 'pending_id', p_pending_id, 'status', p_status);
  EXCEPTION
    WHEN SQLSTATE 'V2F01' THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
      RETURN _v2_failure('hold_resolve', v_msg, v_detail);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
      RETURN _v2_write_failed('hold_resolve', v_state, v_msg);
  END;
END $$;

DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE '\_v2\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.v2_hold_open(uuid, uuid, text, jsonb, jsonb)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v2_hold_resolve(uuid, uuid, uuid, text, jsonb, text)      FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2_hold_open(uuid, uuid, text, jsonb, jsonb)           TO service_role;
GRANT EXECUTE ON FUNCTION public.v2_hold_resolve(uuid, uuid, uuid, text, jsonb, text)   TO service_role;

SELECT '109 pending_writes v2 applied' AS status;

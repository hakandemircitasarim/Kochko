-- 115: düzeltmeyi geri almak önceki kaydı geri getirir; tartı geri alınınca profil kilosu en son tartıyı izler.
--
-- NEDEN (yeniden deneme 2026-10-12, final2):
--   * 82 kg yazıldı, "aslında 88" → bekletme → "evet": düzeltme TEK grupta yazıldı = 82'nin record_delete
--     satırları (meta.reason='replaced') + 88'in yazması. Ardından "tartı düzeltmesini geri al" → ref (w2) ile
--     silme yalnız 88'in satırlarını geri aldı: _v2_record_op (108) ref kapsamında grubun record_delete
--     satırlarını BİLEREK atlıyordu (`op NOT IN ('record_delete','record_restore')`). 82 hiç geri gelmedi;
--     o gün tartı kalmadı, weight_history satırı silindi, profil 81,6'ya döndü. Koç "yeniden 88" dedi.
--   * Ertesi turda dünkü 81,6 tartısı silinince profil kilosu o yazmanın "önceki" değerine (78,2) döndü:
--     profiles.weight_kg her tartı yazmasında restore_previous ile defterleniyor, yani geri alma onu
--     o yazmadan ÖNCEKİ (bayat) değere sarıyordu — kalan en son tartıya değil.
--
-- BU MİGRASYON (eklemeli; motor _v2_reverse_rows ve yazıcı RPC'ler DEĞİŞMEZ):
--   1. _v2_record_op — ref ile silmede (metrik yazması d#/w# ya da kayıt m#…) çağıran AÇIKÇA isterse
--      (p_opts.restore_replaced = true) çapanın grubundaki CANLI record_delete satırları meta.reason='replaced'
--      ise onlar da geri alınır: düzeltmeyi geri almak = yeni kaydı kaldırmak + yerine geçtiği kaydı geri
--      getirmek ("geri al / düzeltmeyi geri al"). Bu, istemci undo düğmesinin {write_id} grup kapsamıyla aynı
--      sonuçtur. İstenmezse (varsayılan) yalnız kayıt gider, yerine geçtiği kayıt silinmiş kalır ("aslında hiç
--      yemedim, sil" — 2 dilim pide geri GELMEMELİ; ön-yeniden-deneme-3 incelemesi). Kararı model verir
--      (record_delete.restore_replaced), kod yalnız bir düzeltme ref'inde geçirir (records.ts derive).
--      İSTİSNA: çağrının kendisi bir düzeltmeyse (p_opts.reason='replaced', yazıcı RPC'lerin replaces yolu)
--      eski davranış sürer — düzeltmenin düzeltmesi yalnız son kaydı değiştirir; öğünde eski kaydı da
--      canlandırmak çift sayım olurdu.
--   1b. Tartının profil satırı türetilmiştir (2. madde onu kalan en son tartıya eşitler): daha yeni bir
--      TARTININ profil satırı canlıyken daha eski bir tartıyı geri almak/geri getirmek motorun later_write
--      kuralına takılıyordu (bugünkü 82 canlıyken dünkü 81,6 onaylandıktan sonra bile silinemiyordu). Yalnız
--      engelleyen sonraki yazmaların HEPSİ bir tartı grubunun profil satırı ya da bir eşitleme satırıysa, o
--      profil satırı denetimsiz (force) geri alınır; ardından eşitleme profili yine en son tartıya getirir.
--      Sonraki yazma tartı DEĞİLSE (ör. elle yazılmış profil kilosu) later_write aynen işler.
--   2. _v2_latest_weight + _v2_profile_weight_sync — bir geri alma/geri getirme tartıya dokunduysa
--      (weight_history ya da weight_kg alanı) profiles.weight_kg kalan EN SON tartıya eşitlenir; değer
--      değişirse bu da aynı grupta bir defter satırıdır (meta.derived='profile_weight_latest'), yani o
--      geri alma geri getirilirse o da geri döner. En son tartı = weight_history ∪ daily_metrics.weight_kg
--      (uygulamanın tartı ekranı yalnız daily_metrics + profiles yazar, weight_history'ye yazmaz —
--      src/services/weight.service.ts); aynı günde ikisi varsa günün daily_metrics değeri. Hiç tartı
--      kalmadıysa profil geri almanın bıraktığı değerde kalır. Düzeltme yolunda (reason='replaced')
--      eşitleme yapılmaz: aynı işlemdeki yeni yazma profili kendisi yazar.
--
-- BİLİNEN SINIRLAR (değişmedi, güvenli tarafta): adaptör op'larının (antrenman, takviye…) düzeltmesi iki
-- ayrı grupta yazılır (adapter.ts withReplacement); onların "düzeltmeyi geri al"ı eski kaydı geri getirmez —
-- kayıt geri getirme yine w_record_restore'dur.
--
-- Yalnız service_role (fonksiyonlar 108'deki SECURITY DEFINER RPC'lerin içinde çalışır). DOWN:
--   DROP FUNCTION IF EXISTS public._v2_profile_weight_sync(uuid, uuid, text, uuid, text, text), public._v2_latest_weight(uuid);
--   ve _v2_record_op'u 108_turn_writes.sql'deki gövdesiyle yeniden CREATE OR REPLACE et (imza aynı).

-- ─── 1. En son canlı tartı ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._v2_latest_weight(p_user uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT x.kg FROM (
    SELECT dm.date AS d, dm.weight_kg AS kg, 0 AS pri FROM daily_metrics dm WHERE dm.user_id = p_user AND dm.weight_kg IS NOT NULL
    UNION ALL
    SELECT wh.recorded_at, wh.weight_kg, 1 FROM weight_history wh WHERE wh.user_id = p_user
  ) AS x
  ORDER BY x.d DESC, x.pri
  LIMIT 1;
$$;

-- ─── 2. Profil kilosunu en son tartıya eşitle (değiştiyse defter satırıyla) ───────────────────────
-- Dönen: makbuzun reversed[] satırı biçiminde bir nesne ya da (değişiklik yoksa) NULL.
CREATE OR REPLACE FUNCTION public._v2_profile_weight_sync(
  p_user uuid, p_turn_id uuid, p_op text, p_group uuid, p_pipeline text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_latest numeric := _v2_latest_weight(p_user);
  v_prof   numeric;
  v_before jsonb;
  v_after  jsonb;
  v_id     uuid;
BEGIN
  IF v_latest IS NULL THEN RETURN NULL; END IF;
  SELECT weight_kg INTO v_prof FROM profiles WHERE id = p_user FOR UPDATE;
  IF NOT FOUND OR v_prof IS NOT DISTINCT FROM v_latest THEN RETURN NULL; END IF;
  v_before := jsonb_build_object('weight_kg', v_prof);
  v_after := jsonb_build_object('weight_kg', v_latest);
  UPDATE profiles SET weight_kg = v_latest, updated_at = now() WHERE id = p_user;
  v_id := _v2_ledger_insert(NULL, p_user, p_turn_id, p_pipeline, p_op, 'profiles', p_user, NULL, ARRAY['weight_kg'],
                            v_before, v_after, 'restore_previous', p_group, false, NULL, NULL,
                            jsonb_strip_nulls(jsonb_build_object('reason', p_reason, 'derived', 'profile_weight_latest')));
  RETURN jsonb_build_object('write_id', v_id, 'table', 'profiles', 'row_id', p_user, 'ref', NULL,
                            'field_set', to_jsonb(ARRAY['weight_kg']), 'before', v_before, 'after', v_after,
                            'needs_review', false, 'derived', true);
END $$;

-- ─── 3. Kimlikle silme / geri getirme çekirdeği (108'in gövdesi + ekler, "115:" yorumlu) ──────────
-- p_target: {"ref":"m12"} (kayıt ya da metrik yazması — kendisi + yan etkileri; restore_replaced ise ve
--           çapanın grubu bir düzeltmeyse yerine geçtiği kaydın 'replaced' silmeleri de) veya
--           {"write_id":"<uuid>"} (o mantıksal yazmanın TÜM grubu — istemci undo düğmesi, "geri al").
-- p_action: 'delete' | 'restore'. p_opts: force, max_age_days (7), expect_kind ('m' / 'd,w'),
--           expect_op ('water_log'), pipeline, reason ('replaced' = çağıran bir düzeltme yazıyor),
--           restore_replaced (boolean, varsayılan false: düzeltmenin yerine geçtiği kaydı geri getir).
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
  -- 115: bu çağrı bir yazıcının replaces yolu mu (düzeltme yazılıyor) yoksa kullanıcının geri alması mı.
  v_supersede boolean := coalesce(v_opts ->> 'reason', '') = 'replaced';
  -- 115: düzeltmenin yerine geçtiği kayıt geri gelsin mi ("geri al" evet, "sil / hiç olmadı" hayır).
  v_restore_replaced boolean := coalesce((v_opts ->> 'restore_replaced')::boolean, false);
  v_rows     jsonb;
  v_sync     jsonb;
  v_all_ids  uuid[];
  v_prof_ids uuid[];
  v_forced   jsonb;
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
      -- 115: grup bir düzeltmeyse (aynı grupta canlı 'replaced' silmeleri) ve çağıran istediyse
      -- (restore_replaced) onlar da geri alınır: yerine geçilen kayıt geri gelir. İstenmediyse ya da çağrı
      -- kendisi bir düzeltmeyse (v_supersede) yalnız bu yazma gider.
      SELECT array_agg(id) INTO v_ids FROM turn_writes
      WHERE user_id = p_user AND group_id = v_anchor.group_id AND undone_at IS NULL
        AND ((op NOT IN ('record_delete', 'record_restore') AND (id = v_anchor.id OR NOT is_primary))
             OR (NOT v_supersede AND v_restore_replaced AND op = 'record_delete' AND meta ->> 'reason' = 'replaced'));
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
        -- 115: öğün düzeltmesinin geri alınması istendiyse eski öğün de geri gelir (yukarıdaki kuralın aynısı).
        SELECT array_agg(id) INTO v_ids FROM turn_writes
        WHERE user_id = p_user AND group_id = v_anchor.group_id AND undone_at IS NULL
          AND ((op NOT IN ('record_delete', 'record_restore') AND (id = v_anchor.id OR NOT is_primary))
               OR (NOT v_supersede AND v_restore_replaced AND op = 'record_delete' AND meta ->> 'reason' = 'replaced'));
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

  -- 115: tartının profil satırı türetilmiştir (aşağıdaki eşitleme). Seçilen bir profiles.weight_kg satırını
  -- engelleyen (motorun later_write denetimiyle aynı tanım: aynı satır/alan, daha sonra, canlı, geri alma
  -- değil, bu çağrının kendi satırlarından değil) yazmaların HEPSİ bir tartı grubunun profil satırı ya da bir
  -- eşitleme satırıysa o profil satırı ayrıca, denetimsiz geri alınır; eşitleme profili en son tartıya getirir.
  -- Tartı olmayan tek bir sonraki yazma bile varsa ya da profil kilosu defter dışında değiştiyse (şu anki
  -- değer en son canlı defter satırının bıraktığı değer değil) satır normal yoldan gider, later_write işler.
  v_all_ids := v_ids;
  IF NOT v_supersede AND NOT v_force THEN
    SELECT array_agg(l.id) INTO v_prof_ids FROM turn_writes l
    WHERE l.id = ANY(v_ids) AND l.user_id = p_user AND l.table_name = 'profiles' AND l.field_set = ARRAY['weight_kg']
      AND l.undo_mode = 'restore_previous'
      AND (SELECT p.weight_kg::numeric FROM profiles p WHERE p.id = l.row_id) IS NOT DISTINCT FROM (
        SELECT (z.after ->> 'weight_kg')::numeric FROM turn_writes z
        WHERE z.user_id = p_user AND z.table_name = 'profiles' AND z.row_id = l.row_id AND z.undone_at IS NULL
          AND 'weight_kg' = ANY(z.field_set)
        ORDER BY z.seq DESC LIMIT 1)
      AND EXISTS (
        SELECT 1 FROM turn_writes x
        WHERE x.user_id = p_user AND x.table_name = 'profiles' AND x.row_id = l.row_id AND x.seq > l.seq
          AND x.undone_at IS NULL AND x.reverses IS NULL AND x.field_set && l.field_set AND NOT (x.id = ANY(v_ids)))
      AND NOT EXISTS (
        SELECT 1 FROM turn_writes x
        WHERE x.user_id = p_user AND x.table_name = 'profiles' AND x.row_id = l.row_id AND x.seq > l.seq
          AND x.undone_at IS NULL AND x.reverses IS NULL AND x.field_set && l.field_set AND NOT (x.id = ANY(v_ids))
          AND coalesce(x.meta ->> 'derived', '') <> 'profile_weight_latest'
          AND NOT EXISTS (
            SELECT 1 FROM turn_writes y
            WHERE y.user_id = p_user AND y.group_id = x.group_id AND y.undone_at IS NULL AND y.reverses IS NULL
              AND (y.table_name = 'weight_history' OR (y.table_name = 'daily_metrics' AND 'weight_kg' = ANY(y.field_set)))));
    IF v_prof_ids IS NOT NULL THEN
      v_ids := ARRAY(SELECT unnest(v_ids) EXCEPT SELECT unnest(v_prof_ids));
    END IF;
  END IF;

  v_result := _v2_reverse_rows(p_user, p_turn_id, v_ids, v_op, p_group, v_force, v_meta);
  IF v_prof_ids IS NOT NULL THEN
    v_forced := _v2_reverse_rows(p_user, p_turn_id, v_prof_ids, v_op, p_group, true, v_meta || jsonb_build_object('derived_profile', true));
    v_result := jsonb_build_object(
      'rows', coalesce(v_result -> 'rows', '[]'::jsonb) || coalesce(v_forced -> 'rows', '[]'::jsonb),
      'changed', coalesce((v_result ->> 'changed')::integer, 0) + coalesce((v_forced ->> 'changed')::integer, 0));
  END IF;
  v_ids := v_all_ids;
  IF coalesce((v_result ->> 'changed')::integer, 0) = 0 THEN
    PERFORM _v2_fail('already_undone', jsonb_build_object('ref', v_ref, 'reason', 'nothing_changed'));
  END IF;
  v_rows := coalesce(v_result -> 'rows', '[]'::jsonb);

  -- 115: defter değişmezi "canlı bir geri alma satırının hedefi geri alınmıştır". Motor bir geri almayı
  -- geri alırken (L.reverses = R) R'nin hedefini canlandırır; R kendisi bir geri almaysa (düzeltmenin
  -- 'replaced' silmesi, geri getirmenin geri alınması) R yeniden canlıdır ve onun hedefi (R.reverses)
  -- yeniden geri alınmış sayılmalı — yoksa geri getir → geri al zincirinde eski kayıt "canlı" görünür.
  UPDATE turn_writes o SET undone_at = now(), undone_by_turn = p_turn_id
  FROM turn_writes l, turn_writes r
  WHERE l.id = ANY(v_ids) AND l.user_id = p_user AND l.reverses IS NOT NULL
    AND r.id = l.reverses AND r.user_id = p_user AND r.undone_at IS NULL AND r.reverses IS NOT NULL
    AND o.id = r.reverses AND o.user_id = p_user AND o.undone_at IS NULL;

  -- 115: tartıya dokunan bir geri alma/geri getirme sonrası profil kilosu kalan en son tartıyı izler
  -- (restore_previous profili o yazmadan önceki — bayat olabilen — değere sarar). Düzeltme yolunda değil:
  -- aynı işlemdeki yeni yazma profili kendisi yazar.
  IF NOT v_supersede AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_rows) e
       WHERE e ->> 'table' = 'weight_history'
          OR (e ->> 'table' IN ('daily_metrics', 'profiles') AND coalesce(e -> 'field_set', '[]'::jsonb) ? 'weight_kg')) THEN
    v_sync := _v2_profile_weight_sync(p_user, p_turn_id, v_op, p_group, v_pipeline, v_opts ->> 'reason');
    IF v_sync IS NOT NULL THEN v_rows := v_rows || jsonb_build_array(v_sync); END IF;
  END IF;

  RETURN jsonb_build_object(
    'scope', v_scope,
    'target', jsonb_build_object('ref', v_ref, 'table', v_table, 'row_id', v_row, 'write_id', CASE WHEN v_has_anchor THEN v_anchor.id END),
    'reversed', v_rows,
    'needs_review', EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE (e ->> 'needs_review')::boolean));
END $$;

-- ─── 4. Yetkiler ───────────────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE yetkileri korur; yeni iç yardımcılar Supabase varsayılanıyla açılır: hepsini kapat.
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE '\_v2\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;

SELECT '115 undo restores the replaced record + profile weight follows the latest weigh-in' AS status;

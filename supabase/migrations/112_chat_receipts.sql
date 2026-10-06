-- 112: chat_messages — tur kimliği, kota sınıfı, tam makbuz ve ayrı kod notları.
--
-- NEDEN (AI_MIMARI_V2 §3.2 T0/T9, §6.2 · Faz 1):
--   * Kota sınıfı LLM'den ÖNCE (regex'le "bu bir kayıt mesajı" tahmini) değil, T5'te GERÇEKTEN
--     yazılana göre belirlenir. Bugün adım ve kısa su mesajları hızlı kayıt modunu ıskalayıp saatlik
--     sohbet limitine takılıyor, uyku sorusu kayıt sayılıyor (final2#13). quota_class kullanıcı
--     satırına yazılır; sayaç (rate-limit.ts) Faz 3'te bunu okur:
--       'record'       — tur en az bir kayıt yazdı, sohbet değil (120/gün kayıt tavanı)
--       'conversation' — sohbet turu (50/gün ücretsiz tavan)
--       'exempt'       — istemci undo düğmesi, açık acil yolu (LLM yok)
--     NULL = v1 satırı (bugünkü sayım aynen sürer).
--   * actions_executed v1'de yalnız [{type}] tutuyor: geçmiş yeniden yüklenince başarısız yazma da
--     yeşil rozet alıyor, düzeltme rozeti kayboluyor (diff#7). v2 buraya TAM makbuzu yazar
--     ([{action_type, ok, rows_affected, user_line, failure_class, ref, write_id, …}] — v1'in
--     [{type}] okuyucularıyla geriye uyumlu üst küme). Sütun zaten jsonb: şema değişikliği gerekmez.
--   * code_notes: koda ait, cevabın SONUNA eklenen satırlar (112 / uzman yönlendirmesi / alerjen
--     maruziyeti onayı / güvenlik bekletmesi sorusu). content istemcinin gördüğü metnin tamamıdır
--     (geriye uyum); code_notes aynı satırları sırayla tutar, böylece geçmiş Stage B'ye verilirken
--     modelin kendi metni kod notlarından ayrılır ("kod nesir yazar" kalıbı modele öğretilmez).
--   * turn_id: chat_messages ↔ turn_writes ↔ ai_turn_log ↔ pending_writes aynı tur.
--
-- v2_link_turn_message: asistan mesajı yazmalardan SONRA saklandığı için turun defter satırlarına ve
-- açtığı bekletmelere mesaj kimliğini sonradan damgalar (geçmişte "⟦m12 düzeltildi → m15⟧" satırı).
--
-- DOWN:
--   DROP FUNCTION IF EXISTS public.v2_link_turn_message(uuid, uuid, uuid);
--   DROP INDEX IF EXISTS idx_chat_messages_turn, idx_chat_messages_quota;
--   ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_quota_class_check,
--     DROP CONSTRAINT IF EXISTS chat_messages_pipeline_check, DROP CONSTRAINT IF EXISTS chat_messages_code_notes_check;
--   ALTER TABLE chat_messages DROP COLUMN IF EXISTS code_notes, DROP COLUMN IF EXISTS quota_class,
--     DROP COLUMN IF EXISTS pipeline, DROP COLUMN IF EXISTS turn_id;

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS turn_id     uuid;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS pipeline    text;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS quota_class text;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS code_notes  jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.chat_messages'::regclass
                 AND conname = 'chat_messages_quota_class_check') THEN
    ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_quota_class_check
      CHECK (quota_class IS NULL OR quota_class IN ('conversation', 'record', 'exempt'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.chat_messages'::regclass
                 AND conname = 'chat_messages_pipeline_check') THEN
    ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_pipeline_check
      CHECK (pipeline IS NULL OR pipeline IN ('v1', 'v2'));
  END IF;
  -- [{kind, text}] — kind: emergency | referral | allergen_exposure | safety_hold | plan_honesty | other
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.chat_messages'::regclass
                 AND conname = 'chat_messages_code_notes_check') THEN
    ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_code_notes_check
      CHECK (code_notes IS NULL OR jsonb_typeof(code_notes) = 'array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_messages_turn  ON public.chat_messages (user_id, turn_id) WHERE turn_id IS NOT NULL;
-- v2 kota sayımı: kullanıcının günlük satırları sınıfa göre.
CREATE INDEX IF NOT EXISTS idx_chat_messages_quota ON public.chat_messages (user_id, created_at)
  WHERE role = 'user' AND quota_class IS NOT NULL;

COMMENT ON COLUMN public.chat_messages.quota_class      IS 'v2: T5''te yazılana göre — record | conversation | exempt. NULL = v1 satırı.';
COMMENT ON COLUMN public.chat_messages.code_notes       IS 'v2: cevabın sonuna KODUN eklediği satırlar [{kind, text}], sırayla. content = model metni + bu satırlar.';
COMMENT ON COLUMN public.chat_messages.actions_executed IS 'v1: [{type}]. v2: tam makbuz [{action_type, ok, rows_affected, user_line, failure_class, ref, write_id, …}] — [{type}] okuyucularıyla uyumlu üst küme.';
COMMENT ON COLUMN public.chat_messages.turn_id          IS 'turn_writes / ai_turn_log / pending_writes ile aynı tur kimliği.';

CREATE OR REPLACE FUNCTION public.v2_link_turn_message(p_user uuid, p_turn_id uuid, p_chat_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_writes integer;
  v_holds  integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM chat_messages WHERE id = p_chat_message_id AND user_id = p_user) THEN
    RETURN jsonb_build_object('ok', false, 'op', 'link_turn_message', 'failure_class', 'unknown_ref',
                              'detail', jsonb_build_object('chat_message_id', p_chat_message_id));
  END IF;
  UPDATE turn_writes SET chat_message_id = p_chat_message_id
  WHERE user_id = p_user AND turn_id = p_turn_id AND chat_message_id IS NULL;
  GET DIAGNOSTICS v_writes = ROW_COUNT;
  UPDATE pending_writes SET chat_message_id = p_chat_message_id
  WHERE user_id = p_user AND turn_id = p_turn_id AND chat_message_id IS NULL;
  GET DIAGNOSTICS v_holds = ROW_COUNT;
  UPDATE chat_messages SET turn_id = p_turn_id WHERE id = p_chat_message_id AND turn_id IS NULL;
  RETURN jsonb_build_object('ok', true, 'op', 'link_turn_message', 'writes', v_writes, 'holds', v_holds);
END $$;

REVOKE ALL ON FUNCTION public.v2_link_turn_message(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2_link_turn_message(uuid, uuid, uuid) TO service_role;

SELECT '112 chat receipts applied' AS status;

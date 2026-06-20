-- Migration 065: chat_messages çift trigger'ını tekle + drift'i kapat
--
-- AMAÇ (Audit MEDIUM): Canlıda chat_messages üzerinde İKİ AFTER INSERT trigger var,
--   her mesaj eklendiğinde chat_sessions'a İKİ ayrı UPDATE gidiyor (gereksiz kilit
--   + WAL maliyeti):
--     * trg_chat_messages_bump_session → bump_chat_session_updated_at()
--         (yalnız updated_at = NOW(); migration 035'te tanımlı)
--     * trg_update_session_on_message  → update_session_timestamp()
--         (updated_at = NOW() + message_count = message_count + 1)
--   İkinci fonksiyon/trigger HİÇBİR migration'da yok (drift) — sıfırdan kurulan bir
--   ortam message_count'u hiç artırmaz ve canlıdan sessizce farklılaşır.
--
--   ÇÖZÜM: İki etkiyi tek fonksiyonda (update_session_timestamp) birleştir
--   (updated_at + message_count tek UPDATE'te), bu fonksiyonu/trigger'ı migration'a
--   kaydet (drift'i kapat), ve redundant bump trigger'ını DÜŞÜR. bump fonksiyonunu
--   silmiyoruz (başka yerde referans olabilir; trigger'ı kaldırmak çift UPDATE'i
--   bitirmeye yeter ve daha az yıkıcı).
--
-- CANLI KANIT (node TEMP/q.mjs):
--   * pg_trigger (chat_messages, tgisinternal=false): yukarıdaki iki trigger, ikisi de
--     AFTER INSERT FOR EACH ROW, tgenabled='O'.
--   * pg_get_functiondef(update_session_timestamp): tek UPDATE → updated_at=NOW(),
--     message_count = message_count + 1 WHERE id = NEW.session_id.
--   * grep supabase/migrations: 'update_session_timestamp' YALNIZ bu dosyada (canlıda
--     var, migration'da yoktu → drift teyitli). 'bump_chat_session_updated_at' yalnız 035.
--   * information_schema.columns: chat_sessions'ta hem message_count hem updated_at MEVCUT.
--
-- IDEMPOTENCY: CREATE OR REPLACE FUNCTION; DROP TRIGGER IF EXISTS + CREATE TRIGGER.
--
-- YIKICI İŞLEM (DROP TRIGGER trg_chat_messages_bump_session):
--   Etki = chat_messages INSERT'inde bir adet fazladan no-op'a yakın UPDATE'in
--   kaldırılması. Kalan trigger (update_session_timestamp) zaten updated_at'i de
--   güncellediğinden 035'in amacı (24h-inactive cleanup için updated_at bump'ı)
--   KORUNUR — davranış kaybı yok, yalnız çift UPDATE tekilleşir.
--
-- DOWN: DROP TRIGGER IF EXISTS trg_update_session_on_message ON chat_messages;
--       (ve istenirse) CREATE TRIGGER trg_chat_messages_bump_session AFTER INSERT
--         ON chat_messages FOR EACH ROW EXECUTE FUNCTION bump_chat_session_updated_at();

-- 1. Birleşik fonksiyon: updated_at + message_count tek UPDATE'te.
--    (Canlıdaki update_session_timestamp ile aynı; NEW.session_id NULL guard'ı
--     eklendi — chat_messages.session_id NOT NULL olsa da savunma derinliği.)
CREATE OR REPLACE FUNCTION public.update_session_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    UPDATE chat_sessions
    SET updated_at = NOW(),
        message_count = message_count + 1
    WHERE id = NEW.session_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Tek kanonik trigger (drift'i migration'a kaydeder).
DROP TRIGGER IF EXISTS trg_update_session_on_message ON public.chat_messages;
CREATE TRIGGER trg_update_session_on_message
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_session_timestamp();

-- 3. Redundant ikinci trigger'ı düşür (yalnız updated_at güncelliyordu; üstteki
--    fonksiyon zaten updated_at'i de güncelliyor → davranış kaybı yok).
--    Fonksiyon (bump_chat_session_updated_at) bilerek bırakıldı.
DROP TRIGGER IF EXISTS trg_chat_messages_bump_session ON public.chat_messages;

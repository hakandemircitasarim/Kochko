-- 054: chat_messages.session_id → chat_sessions(id) ON DELETE CASCADE FK (HIGH/bütünlük)
--
-- AMAÇ: chat_messages.session_id NOT NULL ve uuid ama chat_sessions'a FK YOK (canlı
-- pg_constraint teyidi: yalnız pkey, role_check, user_id_fkey). İki AFTER INSERT trigger
-- chat_sessions'ı session_id ile UPDATE ediyor ama geçersiz session_id INSERT'ini
-- engelleyen kısıt yok → latent yetim-mesaj bütünlük açığı. Canlı orphan taraması = 0.
--
-- ÇÖZÜM: önce güvenlik için yetim temizliği (canlıda 0, idempotent), sonra koşullu
-- ADD CONSTRAINT (pg_constraint kontrollü DO bloğu — constraint'te IF NOT EXISTS yok).
-- ON DELETE CASCADE seçildi: session-bazlı model ve mevcut deleteSession (manuel DELETE)
-- davranışıyla tutarlı; oturum silinince mesajlar otomatik temizlenir.
--
-- Geri-alma: ALTER TABLE public.chat_messages DROP CONSTRAINT chat_messages_session_id_fkey.

-- FIX (audit DB/HIGH — chat_messages.session_id NOT NULL ama chat_sessions'a FK yok)
DELETE FROM public.chat_messages m
WHERE m.session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.chat_sessions s WHERE s.id = m.session_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_session_id_fkey'
  ) THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;
  END IF;
END $$;

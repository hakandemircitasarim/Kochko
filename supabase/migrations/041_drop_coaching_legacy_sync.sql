-- 041: coaching_messages legacy sütun + trigger drift temizliği
--
-- Canlı DB'de migration'lar dışında eklenmiş legacy `message` / `is_read`
-- kolonları ve bunları senkronlayan BEFORE INSERT OR UPDATE trigger'ı
-- (trg_sync_coaching → sync_coaching_columns) vardı. Fonksiyonun son satırı
-- KOŞULSUZ `NEW."read" := NEW.is_read;` çalıştırdığı için client'ın
-- `read = true` güncellemesi (is_read eski değerinde kaldığından) anında
-- geri alınıyordu: proaktif koç mesajları HİÇBİR ZAMAN okundu/dismiss
-- yapılamıyordu ve dashboard'da kalıcı birikiyordu.
--
-- Kod tabanında `message`/`is_read` kolonlarının tek okuyucusu/yazıcısı yok
-- (client content/read kullanıyor) — drift'i kapatmak için trigger, fonksiyon
-- ve legacy kolonlar düşürülür.

DROP TRIGGER IF EXISTS trg_sync_coaching ON public.coaching_messages;
DROP FUNCTION IF EXISTS public.sync_coaching_columns();
ALTER TABLE public.coaching_messages DROP COLUMN IF EXISTS message;
ALTER TABLE public.coaching_messages DROP COLUMN IF EXISTS is_read;

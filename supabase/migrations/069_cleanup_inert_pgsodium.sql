-- 069: Migration 025 inert pgsodium altyapısını TEMİZLE (MEDIUM — sağlık verisi düz metin, ölü view+label)
--
-- AMAÇ: Migration 025 health_events.description/event_type'ı pgsodium ile şifrelemeyi DENEDİ ama
-- yazma-zamanı şifreleme fiilen DEVREDE DEĞİL: tek health_events satırının her iki nonce kolonu da
-- NULL (= hiç şifrelenmemiş, düz metin). Geriye yalnızca ÖLÜ altyapı kaldı: decrypted_health_events
-- view'ı + 2 nonce kolonu + 2 asılı SECURITY LABEL. Hiçbir kod bunları kullanmıyor. Bu migration
-- ölü pgsodium iskeletini kaldırır. (NOT: Şifreleme gerçekten istenirse bu temizlik YERİNE ayrı bir
-- "şifrelemeyi tamamla" epiki yapılmalı — app yazımını decrypted view'a yöneltmek, event trigger'ı
-- kalıcı kurmak. Mevcut durumda "güvenlik var" algısı + sıfır koruma olduğundan temizlik tercih edildi.)
--
-- CANLI-KANIT (node TEMP/q.mjs, salt-okunur):
--   SELECT count(*) total, count(description_nonce) dn, count(event_type_nonce) en FROM health_events;
--     => total=1, dn=0, en=0  (HİÇ satır şifrelenmemiş → düz metin → nonce kolonları ölü)
--   pg_seclabel provider='pgsodium' => health_events.description + .event_type label'ları asılı
--     (pgsodium.key label'ı extension-içi, ona DOKUNULMAZ).
--   pg_views => decrypted_health_events MEVCUT (025 dosyasında yok → out-of-band eklenmiş, ölü).
--   lab_values'ta nonce kolonu YOK (025'teki IF EXISTS guard'ı hep FALSE'tu — temizlenecek bir şey yok).
-- KOD-KANIT (grep src + supabase/functions):
--   'decrypted_health_events' / 'description_nonce' / 'event_type_nonce' => 0 eşleşme.
--   Tüm okuyucu/yazıcılar base health_events tablosunu doğrudan kullanır (health.service.ts:18,
--   export.service.ts:44 .select('*') → düşen nonce kolonlarını zaten hiç tüketmiyor).
--
-- preApplyCheck (her ikisi de 0 dönmeli; >0 ise gerçek şifrelenmiş veri var demektir → UYGULAMA):
--   SELECT count(description_nonce) + count(event_type_nonce) AS encrypted_rows FROM health_events;
--
-- safety: destructive-verified-dead (nonce hep NULL + view/label/kolon hiçbir kod tarafından okunmuyor)
-- Idempotent: DROP VIEW/COLUMN IF EXISTS; SECURITY LABEL ... IS NULL (kaldırma) güvenli/tekrar-edilebilir.
-- DOWN: gerek yok (altyapı zaten inert/ölüydü). Şifreleme istenirse ayrı epik.

DO $$
DECLARE
  v_encrypted bigint;
BEGIN
  -- Güvenlik: gerçekten şifrelenmiş satır olmadığını runtime'da da doğrula.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='health_events'
               AND column_name='description_nonce') THEN
    EXECUTE 'SELECT count(description_nonce) + count(event_type_nonce) FROM public.health_events'
      INTO v_encrypted;
    RAISE NOTICE '[069] health_events şifrelenmiş (non-null nonce) satır sayısı = % (0 bekleniyor)', v_encrypted;
    IF v_encrypted > 0 THEN
      RAISE EXCEPTION '[069] ABORT: % satırda non-null nonce var — gerçek şifreli veri olabilir, temizlik iptal.', v_encrypted;
    END IF;
  ELSE
    RAISE NOTICE '[069] nonce kolonları zaten yok — kısmen/tamamen temizlenmiş.';
  END IF;
END $$;

-- 1) Asılı SECURITY LABEL'ları kaldır (IS NULL = label sil). Kolon hâlâ varken yapılmalı.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='health_events' AND column_name='description') THEN
    EXECUTE 'SECURITY LABEL FOR pgsodium ON COLUMN public.health_events.description IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='health_events' AND column_name='event_type') THEN
    EXECUTE 'SECURITY LABEL FOR pgsodium ON COLUMN public.health_events.event_type IS NULL';
  END IF;
EXCEPTION
  WHEN undefined_object OR feature_not_supported THEN
    -- pgsodium provider mevcut değilse (örn. extension kaldırılmış) sessiz geç.
    RAISE NOTICE '[069] pgsodium SECURITY LABEL kaldırma atlandı (provider/extension yok).';
END $$;

-- 2) Ölü view'ı düşür.
DROP VIEW IF EXISTS public.decrypted_health_events;

-- 3) Ölü nonce kolonlarını düşür (hepsi NULL — veri kaybı yok).
ALTER TABLE public.health_events DROP COLUMN IF EXISTS description_nonce;
ALTER TABLE public.health_events DROP COLUMN IF EXISTS event_type_nonce;

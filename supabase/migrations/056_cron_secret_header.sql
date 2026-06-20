-- 056: cron HTTP çağrılarına x-cron-secret header ekle + 014/022 hizalama (HIGH)
--
-- AMAÇ: cron-auth.ts denyIfNotCron, CRON_SECRET tanımlıysa x-cron-secret header'ını
-- karşılaştırıp eşleşmezse 401, tanımsızsa fail-open. Migration 014/022'deki tüm
-- net.http_post header'ları yalnız Content-Type + Bearer service_role içeriyor;
-- x-cron-secret YOK. Biri güvenlik için CRON_SECRET set ederse ai-extractor /
-- ai-proactive / cleanup-scheduled cron'larının TAMAMI 401 alır ve hiçbir nudge /
-- extraction / temizlik üretilmez (sessiz ölüm). Canlı job'lar elle yamandı (secret
-- içeriyor) ama migration dosyaları geride kaldı → temiz DB reset'te açık geri gelir.
--
-- ÇÖZÜM: edge-fonksiyonu çağıran cron job'larını x-cron-secret eklenmiş header ile
-- yeniden tanımla (idempotent unschedule + schedule). Secret düz-metin gömmek yerine
-- current_setting('app.settings.cron_secret', true) GUC'undan oku — missing_ok=true ki
-- GUC yoksa NULL döner ve cron-auth fail-open kalır (014'ün service_role_key GUC kalıbıyla
-- tutarlı). Vault'a taşıma ayrı/sonraki migration (064) kapsamındadır.
--
-- KAPSAM: yalnız denyIfNotCron-korumalı edge fonksiyonlarını çağıran job'lar — canlı
-- jobname'lere göre (014'teki morning/afternoon/evening proactive job'ları canlıda tek
-- kochko-proactive-hourly ile değişmiş; bu drift uzlaştırması ayrı 057 işidir, burada
-- canlı jobname kullanılır). session-cleanup / hard-delete / sessions-prune / subscription-
-- expire saf SQL çalıştırır (edge çağırmaz) → dokunulmaz.
--
-- Idempotent: cron.unschedule(jobname) IF EXISTS koruması + cron.schedule yeniden tanımlar.
-- GUC ayarı (örn. ALTER DATABASE ... SET app.settings.cron_secret = '<secret>') operasyonel
-- adımdır; deploy'da set edilmeli (bkz. needsLiveStep).
-- DOWN: aynı job'ları x-cron-secret header'ı OLMADAN yeniden schedule et.

-- FIX (audit DB/HIGH — cron net.http_post çağrıları x-cron-secret göndermiyor; CRON_SECRET set iken tüm cron 401)
DO $$
DECLARE
  jn text;
BEGIN
  FOREACH jn IN ARRAY ARRAY[
    'kochko-tier2-extraction',
    'kochko-tier3-extraction',
    'kochko-proactive-hourly',
    'kochko-photo-cleanup'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = jn) THEN
      PERFORM cron.unschedule(jn);
    END IF;
  END LOOP;
END $$;

-- ai-extractor (Tier 2): her gece 00:00 UTC = 03:00 TR
SELECT cron.schedule(
  'kochko-tier2-extraction',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/ai-extractor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'x-cron-secret', current_setting('app.settings.cron_secret', true)
    ),
    body := '{"tier": 2}'::jsonb
  );
  $$
);

-- ai-extractor (Tier 3): Pazar 00:30 UTC = 03:30 TR
SELECT cron.schedule(
  'kochko-tier3-extraction',
  '30 0 * * 0',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/ai-extractor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'x-cron-secret', current_setting('app.settings.cron_secret', true)
    ),
    body := '{"tier": 3}'::jsonb
  );
  $$
);

-- ai-proactive: saatlik (canlı tek-job; 014'teki 3 ayrı job yerine kochko-proactive-hourly)
SELECT cron.schedule(
  'kochko-proactive-hourly',
  '7 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/ai-proactive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'x-cron-secret', current_setting('app.settings.cron_secret', true)
    ),
    body := '{"trigger": "hourly"}'::jsonb
  );
  $$
);

-- cleanup-scheduled (022 kaynaklı): 15 dakikada bir
SELECT cron.schedule(
  'kochko-photo-cleanup',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/cleanup-scheduled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'x-cron-secret', current_setting('app.settings.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

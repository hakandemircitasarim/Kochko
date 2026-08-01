-- Client-side error + analytics sink (launch observability).
--
-- NEDEN: `src/lib/sentry.ts` son 50 hatayı YALNIZCA RAM'deki bir halka tamponda tutuyordu ve
-- `analytics.service.ts` olayları 1000'lik bir tamponda biriktirip `flushEventBuffer()` ile
-- yalnızca DÖNDÜRÜYORDU — çağıran hiç yoktu. Yani uygulama kapandığı anda hem hatalar hem
-- ürün olayları kayboluyordu: kapalı testte bir kullanıcı "çöktü" dediğinde elimizde hiçbir
-- kanıt olmuyordu. @sentry/react-native kurulu değil ve bir DSN'e (harici hesap) bağlı;
-- bu tablo aynı görevi kendi altyapımızda, harici servis olmadan görür.
--
-- Play Console zaten YERLİ çökmeleri ve ANR'leri kendisi raporluyor; buradaki boşluk
-- JS/React tarafındaki hatalar ve ürün olaylarıydı — kapsanan tam olarak o.
--
-- DOWN: DROP TABLE IF EXISTS client_events;

CREATE TABLE IF NOT EXISTS client_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- 'error' → yakalanmış istisna;  'event' → ürün/analitik olayı
  kind TEXT NOT NULL CHECK (kind IN ('error', 'event')),
  -- error için hata mesajı, event için olay adı
  name TEXT NOT NULL,
  stack TEXT,
  props JSONB NOT NULL DEFAULT '{}',
  app_version TEXT,
  platform TEXT,
  -- Olayın CİHAZDA gerçekleştiği an (tampon çevrimdışı beklemiş olabilir; created_at
  -- yalnızca sunucuya ulaştığı andır — ikisini karıştırmak zaman çizelgesini bozar).
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_events_user_time ON client_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_events_kind_time ON client_events(kind, occurred_at DESC);

ALTER TABLE client_events ENABLE ROW LEVEL SECURITY;

-- Kullanıcı YALNIZCA kendi satırını yazabilir ve okuyabilir. UPDATE/DELETE politikası
-- BİLEREK yok: telemetri append-only olmalı (kullanıcı da uygulama da geçmişi düzeltemez).
DROP POLICY IF EXISTS client_events_insert_own ON client_events;
CREATE POLICY client_events_insert_own ON client_events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS client_events_select_own ON client_events;
CREATE POLICY client_events_select_own ON client_events
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- KVKK: hesap silindiğinde ON DELETE CASCADE ile birlikte gider (profiles FK).
-- Saklama: 90 günden eski telemetri cleanup-scheduled tarafından budanabilir.
COMMENT ON TABLE client_events IS 'İstemci hata + analitik olay havuzu (append-only, RLS: yalnız sahibi).';

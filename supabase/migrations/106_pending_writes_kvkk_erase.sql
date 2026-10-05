-- 106: pending_writes — onay bekleyen yazmalar (ASK / hold). İlk tüketici: KVKK sohbet silmesi.
--
-- NEDEN (AI_MIMARI_V2 §1, §5.2, §7.3 · Faz 0 #5): sohbetteki KVKK silme yolu, model mesajı OKUMADAN
-- önce çalışan bir alt dize regex'iydi: herhangi bir "sil/unut/sıfırla" + herhangi bir
-- "hesab/hafıza/veri" → ai_summary satırı SİLİNİYOR, mesajda "hesab" varsa 30 günlük hesap silmesi
-- AYNI turda planlanıyordu. Canlıda "kalori hesabını sil" (= hesaplamayı yeniden yap) kullanıcının
-- HESABINI silme kuyruğuna aldı. Satırın silinmesi 101'deki tombstone sütununu da götürdüğü için
-- gece çıkarıcısı "silinen" hafızayı geri kuruyordu.
--
-- YENİ SÖZLEŞME (kod: supabase/functions/shared/erase-hold.ts):
--   1. Niyeti MODEL okur → data_erase_request{scope}. Kod hiçbir şeyi silmez; buraya bir bekletme
--      satırı yazar ve cevaba tek, sabit bir onay sorusu ekler.
--   2. Yalnızca BİR SONRAKİ kullanıcı turunda, model açık bir "evet" okursa data_erase_confirm yazar.
--      Kod satırı ancak şu koşullarda işler: status='pending', süresi dolmamış ve satırla bu tur
--      arasında TEK koç cevabı (sorunun kendisi) var. Aksi halde bekletme düşer.
--   3. Hafıza silmesi = tombstone (alanlar boşaltılır + derived_suppressed_at), ai_summary satırı KALIR.
--      Hesap silmesi = Ayarlar yolunun aynısı (deletion_requested_at + deleted_at, 30 gün).
--
-- GENEL TABLO: §5.2'nin ASK sonucu (p#, alerjen/sakatlık kaldırma, kimlik/cinsiyet, bant değişimi) da
-- ileride buraya yazacak. Faz 1'in planladığı "107_pending_writes.sql" bu tabloyu YENİDEN YARATMAMALI,
-- gerekirse ALTER ile genişletmelidir.
--
-- DOWN: DROP TABLE IF EXISTS pending_writes;

CREATE TABLE IF NOT EXISTS pending_writes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Yazma kaydındaki op adı (§4.4): ilk değer 'account_erase_request'.
  op TEXT NOT NULL,
  -- Modelin verdiği yapısal argümanlar (ör. {"scope":"account"}). Kullanıcı metni BURADA TUTULMAZ.
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'discarded', 'expired', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  -- Neden kapandı: 'confirmed_next_turn' | 'superseded' | 'not_confirmed' | 'expired' | 'not_next_turn' | hata
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_writes_user_op_time
  ON pending_writes(user_id, op, created_at DESC);

-- Kullanıcı başına op başına EN FAZLA BİR açık bekletme: eski bir "evet" yeni bir talebi onaylayamaz.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_writes_one_open
  ON pending_writes(user_id, op) WHERE status = 'pending';

ALTER TABLE pending_writes ENABLE ROW LEVEL SECURITY;

-- Kullanıcı yalnızca KENDİ bekletmelerini okuyabilir. INSERT/UPDATE/DELETE politikası BİLEREK yok:
-- bekletmeyi yalnızca edge fonksiyonu (service role) açar ve kapatır — istemci bir silme onayını
-- kendi kendine "confirmed" yapamaz.
DROP POLICY IF EXISTS pending_writes_select_own ON pending_writes;
CREATE POLICY pending_writes_select_own ON pending_writes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- KVKK: hesap silindiğinde ON DELETE CASCADE ile birlikte gider (profiles FK).
COMMENT ON TABLE pending_writes IS 'Onay bekleyen yazmalar (ASK/hold). Yalnız bir SONRAKİ turda onaylanır; yazan/kapatan yalnız service role.';

SELECT '106 pending_writes (kvkk erase hold) applied' AS status;

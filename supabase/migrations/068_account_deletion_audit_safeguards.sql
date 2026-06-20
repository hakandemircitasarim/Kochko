-- 068: execute_pending_account_deletions güvenlik korumaları (LOW — geri-alınamaz hard-delete)
--
-- AMAÇ: Canlı execute_pending_account_deletions() (migration 023 ile birebir) hiçbir iz bırakmadan
-- 30-gün dolmuş profilleri (CASCADE) + auth.users'ı kalıcı siler. Eksikler: (1) silmeden önce audit
-- izi yok; (2) tek koşuda toplu silme için güvenlik üst-sınırı (cap) yok — deletion_requested_at
-- yanlışlıkla geçmişe set edilirse kitlesel imha; (3) iptal bayrağı yalnızca deletion_requested_at
-- NULL'lamaya bağlı (tek mekanizma). Bu migration fonksiyonu CREATE OR REPLACE ile sağlamlaştırır:
--   - Her silmeden ÖNCE kalıcı (cascade'siz) account_deletion_audit tablosuna kayıt yazar.
--   - Tek koşuda en fazla p_max silme yapar (varsayılan 50); fazlası sonraki koşuya kalır.
--   - Açık deletion_cancelled bayrağını da iptal yolu olarak destekler (NULL'lama yolu korunur).
--
-- CANLI-KANIT (node TEMP/q.mjs):
--   pg_get_functiondef(...execute_pending_account_deletions...) => 023 ile aynı (audit/cap/cancel yok).
--   audit_logs.user_id FK = ON DELETE CASCADE → profiles silinince audit_logs satırı da silinir;
--     bu yüzden audit izi AYRI, cascade'siz bir tabloya yazılmalı (account_deletion_audit).
--   profiles deletion kolonları: deletion_requested_at, deleted_at (deletion_cancelled YOK → ekliyoruz).
--   Cancel akışı: src/services/privacy.service.ts:48 deletion_requested_at=NULL.
--
-- preApplyCheck:
--   SELECT count(*) FROM profiles
--     WHERE deletion_requested_at IS NOT NULL
--       AND deletion_requested_at < now() - interval '30 days';
--     -- şu an silinmeye aday satır sayısı; p_max'ın altında olmalı (değilse cap birden çok koşuya yayar).
--   Test (kk.mjs, AYRI dev kullanıcı ile — GERÇEK kullanıcıda ÇALIŞTIRMA):
--     deletion_requested_at'i 31 gün geçmişe set et → execute_pending_account_deletions() çalıştır →
--     account_deletion_audit'te satır oluşmalı + kullanıcı silinmeli; deletion_cancelled=true iken silinmemeli.
--
-- safety: needs-code-wiring
--   Fonksiyon mantığı ve audit tablosu additive/geriye-uyumlu (mevcut cron çağrısı değişmeden çalışır,
--   yeni p_max DEFAULT'lu). deletion_cancelled bayrağını UI'dan set etmek opsiyonel AYRI iştir;
--   mevcut NULL'lama-ile-iptal yolu aynen korunur. Canlı veriyi bu migration ETKİLEMEZ (yalnız fn + yeni tablo).
--
-- Idempotent: CREATE TABLE/COLUMN/INDEX IF NOT EXISTS, DROP FUNCTION (her iki imza) + CREATE OR REPLACE.
-- DOWN: 023'teki fonksiyon gövdesini CREATE OR REPLACE ile geri yükle;
--       (audit tablosu ve deletion_cancelled kolonu bırakılabilir — zararsız).

-- 1) Kalıcı (cascade'siz) silme audit tablosu — profil silinince KAYBOLMAMALI.
CREATE TABLE IF NOT EXISTS public.account_deletion_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_user_id uuid NOT NULL,            -- KASTEN FK YOK: silinen profile referans tutulmaz
  requested_at    timestamptz,              -- profiles.deletion_requested_at anlık değeri
  executed_at     timestamptz NOT NULL DEFAULT now(),
  reason          text NOT NULL DEFAULT 'grace_period_expired',
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.account_deletion_audit ENABLE ROW LEVEL SECURITY;
-- Politika yok → yalnız service_role / SECURITY DEFINER fn yazıp okuyabilir (client erişimi kapalı).

CREATE INDEX IF NOT EXISTS idx_account_deletion_audit_executed
  ON public.account_deletion_audit (executed_at DESC);

-- 2) Açık iptal bayrağı (mevcut NULL'lama-ile-iptal yoluna EK savunma).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deletion_cancelled boolean NOT NULL DEFAULT false;

-- 3) Fonksiyonu sağlamlaştır. Eski imzayı (argümansız) düşür, p_max parametreli sürümle değiştir.
DROP FUNCTION IF EXISTS public.execute_pending_account_deletions();
DROP FUNCTION IF EXISTS public.execute_pending_account_deletions(integer);

CREATE OR REPLACE FUNCTION public.execute_pending_account_deletions(p_max integer DEFAULT 50)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec   RECORD;
  v_count INTEGER := 0;
  v_cap   INTEGER := GREATEST(1, COALESCE(p_max, 50));  -- güvenlik üst-sınırı (en az 1)
BEGIN
  FOR v_rec IN
    SELECT id, deletion_requested_at
    FROM profiles
    WHERE deletion_requested_at IS NOT NULL
      AND deletion_requested_at < NOW() - INTERVAL '30 days'
      AND COALESCE(deletion_cancelled, false) = false   -- iptal edilmişleri atla
    ORDER BY deletion_requested_at ASC                   -- en eski grace önce
    LIMIT v_cap                                          -- tek koşuda cap'le sınırla
  LOOP
    -- ÖNCE kalıcı audit izi (cascade'siz tabloya) — silme sonrası da kalır.
    INSERT INTO public.account_deletion_audit (deleted_user_id, requested_at, reason, metadata)
    VALUES (
      v_rec.id,
      v_rec.deletion_requested_at,
      'grace_period_expired',
      jsonb_build_object('grace_days', 30, 'executed_by', 'execute_pending_account_deletions')
    );

    -- profiles silmesi tüm kullanıcı-satırlarını FK ON DELETE CASCADE ile temizler.
    DELETE FROM profiles WHERE id = v_rec.id;

    -- auth.users satırını da kaldır (e-posta yeniden kayda açılsın).
    DELETE FROM auth.users WHERE id = v_rec.id;

    v_count := v_count + 1;
  END LOOP;

  IF v_count > 0 THEN
    RAISE NOTICE '[068] % hesap kalıcı olarak silindi (cap=%).', v_count, v_cap;
  END IF;

  RETURN v_count;
END $$;

-- 050'nin sertleştirme niyetini koru: yalnız service_role çalıştırabilsin.
REVOKE ALL ON FUNCTION public.execute_pending_account_deletions(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_pending_account_deletions(integer) TO service_role;
-- 023 argümansız çağrı uyumu: cron 'SELECT execute_pending_account_deletions();' çağrısı
-- DEFAULT p_max sayesinde bu (integer) fonksiyonuna çözülür — ek sarmalayıcı gerekmez.

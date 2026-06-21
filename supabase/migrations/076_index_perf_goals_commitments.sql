-- 076: index performans iyileştirmeleri (MEDIUM — audit 2026-06-21 DB-IDX-01 / DB-IDX-05)
--
-- NOT: Bu bulgular audit'te geçmiş migration dosyalarına atfedilmişti; geçmiş (uygulanmış)
-- migration'ları düzenlemek canlıyı DEĞİŞTİRMEZ ve geçmişi bozar — bu yüzden değişiklikler
-- YENİ migration olarak burada toplandı (doğru yol).
--
-- DB-IDX-01: goals üzerindeki iki index de (033/060) is_active=TRUE üzerinde KISMİ. Tüm-geçmiş
-- okumaları (getGoalPhases, addPhase, ON DELETE CASCADE) goals'u seq-scan ediyordu. Tam kapsayıcı
-- (user_id, phase_order) index'i bu okumaları VE getGoalPhases'in ORDER BY phase_order'ını karşılar.
--
-- DB-IDX-05: idx_commitments_pending (user_id) WHERE status='pending' KISMİ index'i gereksiz —
-- idx_commitments_user (user_id, status) (mig 003) zaten (user_id, status='pending') aramasını tam
-- karşılıyor. Yazma-ağırlıklı user_commitments tablosunda yalnız yazma/disk yükü ekliyordu.
--
-- (DB-IDX-04 idx_coach_consents_coach canlıda ZATEN mevcut — bu migrationda atlandı.)
-- Idempotent: IF NOT EXISTS / IF EXISTS. Geri-alma: index'i sırasıyla drop/yeniden-create et.

CREATE INDEX IF NOT EXISTS idx_goals_user ON public.goals (user_id, phase_order);

DROP INDEX IF EXISTS public.idx_commitments_pending;

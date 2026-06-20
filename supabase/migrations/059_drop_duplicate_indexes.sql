-- ============================================================================
-- 059_drop_duplicate_indexes.sql
-- ----------------------------------------------------------------------------
-- AMAÇ (audit DB [MEDIUM] "Tam çift (duplicate) index'ler — 5 tablo"):
--   Canlıda birebir aynı tablo+kolon setine sahip mükerrer index çiftlerinin
--   gereksiz (az/hiç kullanılan) kopyasını düşür. Her INSERT/UPDATE'te ikinci
--   index bakımı + disk israfı; scan=0 olanlar hiç kullanılmıyor.
--
-- CANLI KANIT (node TEMP/q.mjs, pg_stat_user_indexes.idx_scan + pg_get_indexdef):
--   weight_history:
--     idx_weight_history_user      (user_id, recorded_at)  non-unique  scan=60   <- DÜŞ
--     weight_history_user_date_uniq(user_id, recorded_at)  UNIQUE      scan=7    (KORU)
--       -> UNIQUE index aynı (user_id, recorded_at) prefix'ini karşıladığı için
--          non-unique kopya tamamen gereksiz; sorgular UNIQUE index'e düşer.
--   daily_metrics:
--     idx_daily_metrics_user_date  (user_id, date)         non-unique  scan=5922 <- DÜŞ
--     daily_metrics_user_id_date_key(user_id, date)        UNIQUE      scan=86   (KORU)
--       -> Aynı kolon seti; UNIQUE index aynı erişimi sağlar (heavy-use sorgular
--          drop sonrası UNIQUE index'e otomatik geçer; constraint index korunur).
--   audit_logs:
--     idx_audit_logs_user          (user_id, created_at DESC) non-unique scan=0  <- DÜŞ
--     idx_audit_logs_user_created  (user_id, created_at DESC) non-unique scan=123 (KORU)
--       -> Birebir aynı tanım; scan=0 olan tam ölü.
--   coaching_messages:
--     idx_coaching_user            (user_id, created_at)      non-unique scan=0  <- DÜŞ
--     idx_coaching_messages_user   (user_id, created_at DESC) non-unique scan=5227(KORU)
--       -> Aynı lider prefix; scan=0 olan ölü, aktif index DESC sıralamayı da kapsar.
--   saved_recipes:
--     idx_recipes_user             (user_id)                  non-unique scan=0  <- DÜŞ
--     idx_saved_recipes_user       (user_id)                  non-unique scan=166 (KORU)
--       -> Birebir aynı; scan=0 olan ölü.
--
--   Düşürülen index'lerin HİÇBİRİ unique/constraint DEĞİL (indisunique=false canlıda
--   teyit edildi) -> DROP veri bütünlüğünü etkilemez, yalnız tekrar eden erişim yolunu
--   kaldırır. Korunan eşleri aynı veya daha kapsamlı (UNIQUE/DESC) erişimi sağlar.
--
-- IDEMPOTENCY: DROP INDEX IF EXISTS (tekrar çalıştırılabilir, no-op olur).
--
-- DOWN (geri alma): aşağıdaki orijinal tanımlardan yeniden yaratılabilir:
--   CREATE INDEX idx_weight_history_user ON public.weight_history (user_id, recorded_at);
--   CREATE INDEX idx_daily_metrics_user_date ON public.daily_metrics (user_id, date);
--   CREATE INDEX idx_audit_logs_user ON public.audit_logs (user_id, created_at DESC);
--   CREATE INDEX idx_coaching_user ON public.coaching_messages (user_id, created_at);
--   CREATE INDEX idx_recipes_user ON public.saved_recipes (user_id);
-- ============================================================================

drop index if exists public.idx_weight_history_user;
drop index if exists public.idx_daily_metrics_user_date;
drop index if exists public.idx_audit_logs_user;
drop index if exists public.idx_coaching_user;
drop index if exists public.idx_recipes_user;

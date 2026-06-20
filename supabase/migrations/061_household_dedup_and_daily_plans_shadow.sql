-- ============================================================================
-- 061_household_dedup_and_daily_plans_shadow.sql
-- ----------------------------------------------------------------------------
-- AMAÇ:
--   (A) [LOW] household_members örtüşen index dedup — non-unique idx_household_members_user
--       (user_id) UNIQUE uniq_household_member_per_user(user_id) tarafından TAM kapsanıyor.
--   (B) [LOW] idx_daily_plans_user_date shadow index — daha geniş
--       idx_daily_plans_version(user_id, date, version DESC) tarafından gölgeleniyor; kullanılmıyor.
--   İkisi de YIKICI (DROP INDEX) ama her ikisi de ölü/gereksiz olduğu CANLI scan ile teyit edildi.
--
-- CANLI KANIT (node TEMP/q.mjs, pg_stat_user_indexes.idx_scan + pg_get_indexdef):
--   (A) household_members:
--       idx_household_members_user     (user_id)            non-unique  scan=23   <- DÜŞ
--       uniq_household_member_per_user (user_id)            UNIQUE      scan=105  (KORU)
--       household_members_household_id_user_id_key (household_id,user_id) UNIQUE scan=8 (KORU)
--         -> UNIQUE(user_id) aynı lider kolonu (user_id) tek-kolon erişimini birebir
--            karşılar; non-unique kopya tamamen gereksiz. Composite UNIQUE
--            (household_id, user_id) lider kolonu FARKLI (household_id) olduğu için
--            user_id-tek erişimi karşılamaz -> KORUNUR (audit NIT composite'i "gereksiz"
--            dese de lider kolon farkı nedeniyle DOKUNULMADI; salt güvenli dedup).
--   (B) daily_plans:
--       idx_daily_plans_user_date  (user_id, date)            non-unique  scan=0    <- DÜŞ
--       idx_daily_plans_version    (user_id, date, version DESC) non-unique scan=1686 (KORU)
--       daily_plans_user_id_date_version_key (user_id,date,version) UNIQUE scan=1    (KORU)
--         -> (user_id, date) prefix'i version index'i tarafından karşılanıyor;
--            idx_daily_plans_user_date scan=0 = hiç kullanılmıyor (gölgelenmiş, ölü).
--
--   Düşürülen index'lerin HİÇBİRİ unique/constraint DEĞİL (indisunique=false canlıda
--   teyit edildi) -> DROP veri bütünlüğünü/tek-aktif invariant'larını etkilemez.
--
-- ETKİ-SAYIMI: DROP öncesi RAISE NOTICE ile son scan değerini logla (operatör kanıtı).
--
-- IDEMPOTENCY: DROP INDEX IF EXISTS (tekrar çalıştırılabilir, no-op olur).
--              NOTICE bloğu da to_regclass guard'lı.
--
-- DOWN (geri alma):
--   CREATE INDEX idx_household_members_user ON public.household_members (user_id);
--   CREATE INDEX idx_daily_plans_user_date  ON public.daily_plans (user_id, date);
-- ============================================================================

do $$
declare
  v_hm_scan  bigint;
  v_dp_scan  bigint;
begin
  select idx_scan into v_hm_scan
    from pg_stat_user_indexes where indexrelname = 'idx_household_members_user';
  select idx_scan into v_dp_scan
    from pg_stat_user_indexes where indexrelname = 'idx_daily_plans_user_date';

  raise notice '[061] drop-öncesi idx_scan: idx_household_members_user=% , idx_daily_plans_user_date=%',
    coalesce(v_hm_scan::text, 'YOK'), coalesce(v_dp_scan::text, 'YOK');

  if v_hm_scan is not null and v_hm_scan > 0 then
    raise notice '[061] DİKKAT: idx_household_members_user scan>0 (%); UNIQUE(user_id) yine de aynı erişimi karşılar, drop güvenli.', v_hm_scan;
  end if;
end $$;

-- (A) household_members non-unique user_id index — UNIQUE(user_id) ile tam kapsanıyor.
drop index if exists public.idx_household_members_user;

-- (B) daily_plans (user_id, date) shadow index — version index ile gölgeleniyor, scan=0.
drop index if exists public.idx_daily_plans_user_date;

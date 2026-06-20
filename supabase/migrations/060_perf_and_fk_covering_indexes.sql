-- ============================================================================
-- 060_perf_and_fk_covering_indexes.sql
-- ----------------------------------------------------------------------------
-- AMAÇ (audit DB [MEDIUM] meal_logs logged_at index + [LOW] coach_consents
--   active index + [NIT] FK kolonları kapsayıcı index): tamamı SAFE-ADDITIVE.
--   Sıcak sorgu yollarına ve FK kolonlarına eksik index'leri ekle. Tablolar
--   küçük (households=0, scheduled_cleanups=0, meal_logs~16, weekly_plans~13)
--   olduğu için bugün etki minimal; veri büyüdükçe RLS qual + ON DELETE
--   CASCADE + sıralama seq-scan'e düşmesin diye ileriye dönük eklenir.
--   CREATE INDEX CONCURRENTLY KULLANILMADI (transaction içinde çalışmaz; tablolar küçük).
--
-- CANLI KANIT (node TEMP/q.mjs):
--   1) meal_logs(user_id, logged_at DESC) — sıcak sorgular logged_at DESC sıralıyor
--      (realtime-sync.service.ts:241, ai-proactive:844/:389) ama tek non-pk index
--      idx_meal_logs_user_date (user_id, logged_for_date) — logged_for_date (date)
--      != logged_at (timestamptz), sıralamaya hizmet etmez.
--      Kolon teyidi: meal_logs.logged_at timestamptz NOT NULL, is_deleted boolean (var).
--      ai-proactive is_deleted=false filtreli -> kısmi index ideal.
--   2) coach_consents(coach_id) WHERE is_active — getCoachClients .eq('coach_id')
--      .eq('is_active',true) (coach-mode.service.ts). Mevcut idx_coach_consents_coach
--      (coach_id) is_active içermiyor; kolon teyidi: coach_consents.is_active boolean (var).
--   3) FK kapsayıcı index'ler — pg_constraint contype='f' ile teyit edilen 4 FK,
--      hiçbirinin lider kolonu bu FK kolonu olan index'i YOK:
--        households_owner_id_fkey         -> owner_id      (households index: yalnız pkey + invite_code_key)
--        scheduled_cleanups_user_id_fkey  -> user_id       (mevcut index'ler scheduled_at/scheduled_for üzerinde)
--        meal_logs_template_id_fkey       -> template_id   (sparse: template_id nullable)
--        weekly_plans_superseded_by_fkey  -> superseded_by (sparse: superseded_by nullable)
--      Kolon teyidi: owner_id uuid NOT NULL, scheduled_cleanups.user_id uuid NOT NULL,
--      meal_logs.template_id uuid NULL, weekly_plans.superseded_by uuid NULL.
--      Nullable FK kolonları için kısmi (WHERE ... IS NOT NULL) index -> daha küçük/sparse.
--
-- IDEMPOTENCY: CREATE INDEX IF NOT EXISTS (tekrar çalıştırılabilir, no-op olur).
--
-- DOWN (geri alma):
--   DROP INDEX IF EXISTS public.idx_meal_logs_user_logged_at;
--   DROP INDEX IF EXISTS public.idx_coach_consents_coach_active;
--   DROP INDEX IF EXISTS public.idx_households_owner;
--   DROP INDEX IF EXISTS public.idx_scheduled_cleanups_user;
--   DROP INDEX IF EXISTS public.idx_meal_logs_template;
--   DROP INDEX IF EXISTS public.idx_weekly_plans_superseded_by;
-- ============================================================================

-- 1) Sıcak sorgu: son öğünler (user_id, logged_at DESC), aktif kayıtlar için kısmi.
create index if not exists idx_meal_logs_user_logged_at
  on public.meal_logs (user_id, logged_at desc)
  where is_deleted = false;

-- 2) coach_consents aktif rıza filtresi için kısmi index.
create index if not exists idx_coach_consents_coach_active
  on public.coach_consents (coach_id)
  where is_active = true;

-- 3) FK kapsayıcı index'ler.
create index if not exists idx_households_owner
  on public.households (owner_id);

create index if not exists idx_scheduled_cleanups_user
  on public.scheduled_cleanups (user_id);

create index if not exists idx_meal_logs_template
  on public.meal_logs (template_id)
  where template_id is not null;

create index if not exists idx_weekly_plans_superseded_by
  on public.weekly_plans (superseded_by)
  where superseded_by is not null;

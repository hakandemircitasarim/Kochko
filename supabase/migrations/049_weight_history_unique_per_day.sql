-- #R3: weight_history (newly written by ai-chat since #R1-M2) used a plain insert, so
-- two weigh-ins on the same calendar day produced two conflicting rows with no canonical
-- daily value. recorded_at is a DATE, so one row per (user, day) is the right granularity.
-- Collapse any existing same-day duplicates (keep the most recent id), then enforce it.
delete from weight_history a using weight_history b
  where a.user_id = b.user_id and a.recorded_at = b.recorded_at and a.id < b.id;

-- FIX (audit DB-MIG-02): ADD CONSTRAINT has no IF NOT EXISTS form, so a replay (db reset after a
-- mid-chain failure, migration-history desync, or manual re-apply) would abort the whole tx with
-- 42710. Wrap in the same pg_constraint guard the project already uses in 054/063/070.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.weight_history'::regclass
      and conname = 'weight_history_user_date_uniq'
  ) then
    alter table public.weight_history
      add constraint weight_history_user_date_uniq unique (user_id, recorded_at);
  end if;
end $$;

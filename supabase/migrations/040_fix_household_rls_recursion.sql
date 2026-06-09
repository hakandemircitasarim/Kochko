-- 040: Fix infinite recursion (42P17) in household RLS policies.
--
-- The "Members can view members" policy on household_members subqueried
-- household_members itself, so evaluating the policy re-triggered the same
-- policy → infinite recursion. Any households SELECT (incl. the .select() after
-- a create) hit it via the cross-table "Household members can view household"
-- policy. This kept the entire Aile Planı / Koç Paylaşımı feature 500-ing.
--
-- Fix: a SECURITY DEFINER helper resolves the caller's household ids WITHOUT
-- re-entering RLS (the function owner bypasses RLS), then the two recursive
-- policies reference it instead of self-joining.

create or replace function public.user_household_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select household_id from public.household_members where user_id = auth.uid()
$$;

revoke all on function public.user_household_ids() from public;
grant execute on function public.user_household_ids() to authenticated;

-- household_members: see other members of households you belong to (no self-recursion).
drop policy if exists "Members can view members" on public.household_members;
create policy "Members can view members" on public.household_members
  for select
  using (household_id in (select public.user_household_ids()));

-- households: see households you belong to (resolved via the SECURITY DEFINER helper).
drop policy if exists "Household members can view household" on public.households;
create policy "Household members can view household" on public.households
  for select
  using (id in (select public.user_household_ids()));

-- 050_security_hardening_round2.sql
-- Overnight live-audit DB hardening (3 confirmed findings).
--
-- S16: household_members had an over-broad "Users can manage own membership" FOR ALL policy
--      (USING user_id = auth.uid(), WITH CHECK reused from USING). On INSERT the only constraint
--      was user_id = auth.uid(), so any authenticated user could POST a membership row for an
--      ARBITRARY household_id — bypassing the invite-code gate + 6-member cap (both live only in
--      the SECURITY DEFINER join_household_by_code RPC) and exposing other members' diet plans /
--      shopping lists via get_household_shopping_list. Split into narrow per-command policies:
--      client INSERT is limited to a household the caller OWNS (the createHousehold bootstrap);
--      all other joins must go through join_household_by_code (definer, bypasses RLS).
-- S17: execute_pending_account_deletions() (irreversible account hard-delete cron) and
--      expire_stale_subscriptions() never REVOKEd the implicit PUBLIC grant CREATE FUNCTION adds,
--      so any anon/authenticated client could POST /rpc/<fn> to trigger these maintenance routines
--      on demand. Strip PUBLIC/anon/authenticated; pg_cron runs as owner so the schedule is unaffected.
-- S1:  scheduled_cleanups still had legacy NOT-NULL columns (cleanup_type, target_table,
--      scheduled_for) that the unified write path (resource_type/resource_id/scheduled_at, mig 022)
--      never supplies — guaranteeing a 23502 the moment schedulePhotoCleanup is wired in. Relax them.

-- ── S16: household_members RLS ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can manage own membership" ON public.household_members;

CREATE POLICY hm_select_own ON public.household_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY hm_delete_own ON public.household_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Client INSERT only into a household the caller OWNS (createHousehold bootstrap writes
-- role='owner'). Members are added exclusively via join_household_by_code (SECURITY DEFINER).
CREATE POLICY hm_insert_owned ON public.household_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'
    AND household_id IN (SELECT id FROM public.households WHERE owner_id = auth.uid())
  );

-- ── S17: lock down SECURITY DEFINER maintenance cron functions ─────────────────
REVOKE EXECUTE ON FUNCTION public.execute_pending_account_deletions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_stale_subscriptions() FROM PUBLIC, anon, authenticated;

-- ── S1: relax dead legacy NOT-NULL columns on scheduled_cleanups ───────────────
ALTER TABLE public.scheduled_cleanups ALTER COLUMN cleanup_type DROP NOT NULL;
ALTER TABLE public.scheduled_cleanups ALTER COLUMN target_table DROP NOT NULL;
ALTER TABLE public.scheduled_cleanups ALTER COLUMN scheduled_for DROP NOT NULL;

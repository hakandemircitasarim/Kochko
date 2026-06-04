-- Migration 039: widen daily_plans.status_check for the weekly_plans -> daily_plans
-- projection (Option A root fix).
--
-- Context: 004_plans_and_reports.sql created daily_plans.status with
--   CHECK (status IN ('draft','approved','modified','rejected'))
-- but mvd.service.ts and ai-chat write 'active' / 'mvd_suspended'. While daily_plans
-- was empty DB-wide these writes never executed, so the mismatch was a latent 400.
-- The projection fix populates daily_plans, which makes those writes happen — so the
-- constraint must accept the full set the app actually writes.

ALTER TABLE public.daily_plans DROP CONSTRAINT IF EXISTS daily_plans_status_check;

ALTER TABLE public.daily_plans
  ADD CONSTRAINT daily_plans_status_check
  CHECK (status IN ('draft', 'approved', 'modified', 'rejected', 'active', 'mvd_suspended'));

-- Migration 036: Align monthly_reports.trend_direction CHECK with the Turkish values.
-- The AI (ai-report MONTHLY_REPORT_SYSTEM) emits 'yukselis|dusus|stabil' and the UI
-- (app/reports/monthly.tsx) is typed for the same Turkish values, but the original
-- CHECK only allowed English ('losing','gaining','stable','fluctuating'). Every monthly
-- report upsert therefore violated the constraint and silently never persisted — each
-- visit re-ran the AI and stored nothing. Align the DB to the Turkish source of truth.

ALTER TABLE monthly_reports
  DROP CONSTRAINT IF EXISTS monthly_reports_trend_direction_check,
  ADD CONSTRAINT monthly_reports_trend_direction_check
    CHECK (trend_direction IS NULL OR trend_direction IN ('yukselis', 'dusus', 'stabil'));

NOTIFY pgrst, 'reload schema';

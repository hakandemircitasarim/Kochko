-- 097: turn-ledger observability columns for the F0 "kapı" stage (plan v2).
--
-- WHY (AI_BEYIN_2026-07-25.md §7, F0): two gates in the roadmap are unanswerable today.
--   * A00 (rollout gate) must be able to prove "this turn ran on the new path, in shadow" with a
--     SQL query instead of a human reading function logs that vanish.
--   * A0 (live gate) must be able to prove an emulator drive actually happened and what the UI
--     rendered — the repo's two most expensive historical mistakes were both "server green, UX
--     broken" and both were caught late because nothing tied a drive to evidence.
--
-- Both columns are ADDITIVE and NULLABLE: every existing reader/writer is unaffected, and an
-- old edge deploy simply leaves them NULL. No backfill, no data movement, no lock beyond the
-- catalog update.
--
-- DOWN:
--   ALTER TABLE ai_turn_log DROP COLUMN IF EXISTS rollout_stamp;
--   ALTER TABLE ai_turn_log DROP COLUMN IF EXISTS ui_markers;
--   DROP INDEX IF EXISTS idx_ai_turn_log_rollout;

-- Which rollout gates were non-'off' for this turn, e.g. 'a1_ed_decay=shadow|b1_turn_mode=on'.
-- Empty string = every gate was off (the normal, unchanged path). NULL = written by a build that
-- predates this column.
ALTER TABLE ai_turn_log ADD COLUMN IF NOT EXISTS rollout_stamp text;

-- Client-side UI breadcrumbs for the live gate: 'plan_preview_rendered', 'plan_approve_sent',
-- 'receipts_rendered', 'memory_mirror_opened', 'nudge_accept_sent', 'reasoning_opened'.
-- The client cannot write ai_turn_log (RLS: service_role only, 085), so markers ride in on the
-- NEXT ai-chat request body and the edge function stamps them here. That keeps the "no new table"
-- rule (§8) while still making the drive SQL-verifiable.
ALTER TABLE ai_turn_log ADD COLUMN IF NOT EXISTS ui_markers text[];

-- Cheap lookup for "show me the turns where a gate was active" — the A00 acceptance query.
CREATE INDEX IF NOT EXISTS idx_ai_turn_log_rollout ON ai_turn_log (created_at DESC)
  WHERE rollout_stamp IS NOT NULL AND rollout_stamp <> '';

SELECT '097 turn-log observability columns applied' AS status;

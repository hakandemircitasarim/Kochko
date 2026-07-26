-- 100: the commitment loop's MISSING half — an outcome that can actually be written.
--
-- WHY (AI_BEYIN_2026-07-25.md, ÖĞRENME-01 / F3 · C2): user_commitments had 3 INSERTs and exactly
-- ONE update in the whole repo — ai-proactive setting status='followed_up', which means "we asked",
-- not "we learned what happened". 'completed'/'abandoned' had ZERO writers, so the coach could
-- propose, record and remind — and never, ever close. The user says "yaptım" and nothing anywhere
-- can store that fact; the same commitment resurfaces forever, which is the single most concrete
-- "this thing doesn't actually follow me" experience the app produces.
--
-- Additive only. `status` and its existing values stay untouched (the cron's followed_up flow keeps
-- working); outcome is the new truth: kept / missed / partial.
--
-- DOWN:
--   ALTER TABLE user_commitments DROP COLUMN IF EXISTS resolved_at;
--   ALTER TABLE user_commitments DROP COLUMN IF EXISTS outcome;

ALTER TABLE user_commitments ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE user_commitments ADD COLUMN IF NOT EXISTS outcome text
  CHECK (outcome IN ('kept', 'missed', 'partial'));

-- The follow-up surfaces read "open" commitments; give them a cheap path.
CREATE INDEX IF NOT EXISTS idx_commitments_open ON user_commitments (user_id, follow_up_at)
  WHERE resolved_at IS NULL;

SELECT '100 commitment outcome applied' AS status;

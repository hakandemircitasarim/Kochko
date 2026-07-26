-- 098: the turn's identity — one canonical mode, and work that outlives one message.
--
-- WHY (AI_BEYIN_2026-07-25.md §7, F1 · B1a):
--  * ai_turn_log.system_mode stored the RAW keyword-detected mode, so "which contract actually
--    ran?" was unanswerable — and the two most common surprises (a promoted plan turn losing its
--    temperature and its return-flow context) were invisible in the ledger.
--  * chat_sessions had no notion of an OPEN piece of work. A plan negotiation therefore lived or
--    died on whether each single message happened to contain a plan keyword; "peki neden 1900
--    kalori?" dropped the user out of the plan conversation mid-sentence (MUHAKEME-02/-05).
--
-- All three columns are ADDITIVE and NULLABLE. `mode`/`raw_mode` sit next to the existing
-- system_mode (kept, still written) so nothing that reads it today changes.
--
-- DOWN:
--   ALTER TABLE ai_turn_log DROP COLUMN IF EXISTS mode;
--   ALTER TABLE ai_turn_log DROP COLUMN IF EXISTS raw_mode;
--   ALTER TABLE ai_turn_log DROP COLUMN IF EXISTS mode_source;
--   ALTER TABLE chat_sessions DROP COLUMN IF EXISTS active_intent;

-- The CANONICAL mode the turn ran under (what getModeInstructions/retrieval/temperature used).
ALTER TABLE ai_turn_log ADD COLUMN IF NOT EXISTS mode text;
-- What keyword detection alone would have said. DIAGNOSTIC ONLY — never a gate again.
ALTER TABLE ai_turn_log ADD COLUMN IF NOT EXISTS raw_mode text;
-- Which precedence rule won: active_intent | onboarding_hint | client_hint | promotion | detected.
-- Makes a surprising mode explainable from ONE row instead of a reasoning exercise.
ALTER TABLE ai_turn_log ADD COLUMN IF NOT EXISTS mode_source text;

-- An open piece of work that outlives a single message, e.g.
--   {"kind":"plan","plan_type":"diet","opened_at":"2026-07-26T09:12:00Z"}
-- NULL = nothing open (the normal state).
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS active_intent jsonb;

-- "Show me the turns where the canonical mode differed from what the regex thought" — the B1a
-- acceptance query and, afterwards, the cheapest way to see mode churn.
CREATE INDEX IF NOT EXISTS idx_ai_turn_log_mode_drift ON ai_turn_log (created_at DESC)
  WHERE mode IS NOT NULL AND raw_mode IS NOT NULL AND mode <> raw_mode;

SELECT '098 turn identity applied' AS status;

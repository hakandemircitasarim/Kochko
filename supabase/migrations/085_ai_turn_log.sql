-- 085: ai_turn_log — append-only observability ledger for every LLM turn (target-arch step 5).
--
-- Token usage, the ACTUAL served model, latency and the fallback reason were all discarded — usage
-- was thrown away and fallbacks logged only to a vanishing console.error. So cost, silent model
-- downgrades (gpt-4o → mini), and reliability were invisible. Now every turn writes one row from
-- the openai.ts UsageReceipt, fail-loud. This is also the substrate TurnTrace (step 21) physicalises
-- on and what a cost circuit-breaker / model-swap eval gate will read.

CREATE TABLE IF NOT EXISTS ai_turn_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  function_name    text NOT NULL,                 -- 'ai-chat', 'ai-plan', 'ai-proactive'…
  system_mode      text,                          -- task mode (coaching/register/plan/simulation…)
  model_requested  text NOT NULL,
  model_served     text NOT NULL,                 -- differs from requested when a fallback fired
  prompt_tokens    integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens     integer NOT NULL DEFAULT 0,
  latency_ms       integer NOT NULL DEFAULT 0,
  finish_reason    text,
  fallback_reason  text,                          -- null on the happy path; else timeout/http_5xx/empty…
  attempts         integer NOT NULL DEFAULT 1,    -- upstream calls this turn cost
  guard_verdict    text,                          -- clean | allergen_warned | injury_warned | crisis | ed_flag …
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_turn_log_user_time ON ai_turn_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_turn_log_time ON ai_turn_log (created_at DESC);
-- Partial index to cheaply surface degraded turns (fell back or downgraded model).
CREATE INDEX IF NOT EXISTS idx_ai_turn_log_fallback ON ai_turn_log (created_at DESC) WHERE fallback_reason IS NOT NULL;

ALTER TABLE ai_turn_log ENABLE ROW LEVEL SECURITY;
-- Users may read their OWN turn ledger (future MemoryMirror / transparency surface). Writes are
-- service_role only (edge functions insert via the admin client, which bypasses RLS).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_turn_log' AND policyname='atl_sel') THEN
    CREATE POLICY atl_sel ON ai_turn_log FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

SELECT 'ai_turn_log created' AS status;

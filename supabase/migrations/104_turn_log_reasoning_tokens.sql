-- 104: record reasoning tokens on the observability ledger.
--
-- WHY: the GPT-5.6 migration moves the AI onto reasoning models, which are billed for tokens the
-- caller never sees. Those tokens are counted as OUTPUT tokens upstream, so without a dedicated
-- column `completion_tokens` silently absorbs them and a cost review cannot tell an expensive
-- ANSWER apart from expensive THINKING — the single most important lever we now control
-- (shared/openai.ts EFFORT). Nullable + default 0 so every pre-migration row stays valid and the
-- legacy /chat/completions path (gpt-4o rollback) simply writes 0.

ALTER TABLE public.ai_turn_log
  ADD COLUMN IF NOT EXISTS reasoning_tokens integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ai_turn_log.reasoning_tokens IS
  'Invisible thinking tokens billed as output (reasoning models only). 0 on the legacy chat-completions path.';

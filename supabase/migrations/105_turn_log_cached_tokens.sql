-- 105: record prompt-cache hits on the observability ledger.
--
-- WHY: every chat turn resends the whole context spine (base prompt + profile + memory + 30-message
-- history, ~15-18k tokens). OpenAI serves the repeated prefix from cache at 5-10% of the input price
-- and with lower latency — but only when the prompt is ordered stable-first. Without this column the
-- hit rate (and therefore whether a prompt-layout change actually paid off) cannot be measured.
-- Nullable-safe default 0 so every existing row stays valid.

ALTER TABLE public.ai_turn_log
  ADD COLUMN IF NOT EXISTS cached_tokens integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ai_turn_log.cached_tokens IS
  'Input tokens served from the provider prompt cache (subset of prompt_tokens).';

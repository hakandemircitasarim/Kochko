-- 087: promote processed_chat_requests to a REQUEST JOURNAL (target-arch step 4, audit finding 9).
--
-- Today the idempotency guard is a bare (user_id, idempotency_key) UNIQUE claimed LATE inside
-- executeActions — it prevents double action side-effects but NOT the second LLM call, the divergent
-- second reply, or the duplicate chat_messages/ai_turn_log rows when the client retries (its per-
-- attempt timeout is 20s while the first attempt keeps running server-side). A journal with an
-- in_flight/committed state + the stored response lets a retry either WAIT for the in-flight original
-- and REPLAY its exact answer (no 2nd LLM, no duplicate history) or, if it committed, replay directly.

ALTER TABLE processed_chat_requests ADD COLUMN IF NOT EXISTS state            text NOT NULL DEFAULT 'in_flight';
ALTER TABLE processed_chat_requests ADD COLUMN IF NOT EXISTS response_envelope jsonb;
ALTER TABLE processed_chat_requests ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE processed_chat_requests ADD COLUMN IF NOT EXISTS committed_at     timestamptz;
ALTER TABLE processed_chat_requests ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT now();

-- state ∈ in_flight | committed | failed
ALTER TABLE processed_chat_requests DROP CONSTRAINT IF EXISTS processed_chat_requests_state_check;
ALTER TABLE processed_chat_requests ADD CONSTRAINT processed_chat_requests_state_check
  CHECK (state IN ('in_flight','committed','failed'));

-- Existing historical rows (claimed by the old guard, request long since finished) → committed so a
-- late stray retry doesn't get stuck polling a phantom in_flight.
UPDATE processed_chat_requests SET state = 'committed', committed_at = COALESCE(committed_at, created_at)
WHERE state = 'in_flight' AND created_at < now() - interval '2 minutes';

SELECT state, count(*) FROM processed_chat_requests GROUP BY state;

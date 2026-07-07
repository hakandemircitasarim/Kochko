-- 090: exactly-once ACTION side-effects for the request journal (fixes audit findings 6 & 7).
--
-- The journal (087) replays a COMMITTED response, but if the owner applied its action side-effects
-- (meal_log / water / supplement…) and then threw BEFORE committing, failRequest marked it 'failed'
-- and a same-key retry reclaimed + re-ran executeActions — double-applying every action. This adds a
-- side_effects_at stamp that executeActions claims ATOMICALLY (UPDATE … WHERE side_effects_at IS
-- NULL), so the action loop runs at most once per idempotency_key regardless of retries/reclaims.

ALTER TABLE processed_chat_requests ADD COLUMN IF NOT EXISTS side_effects_at timestamptz;

SELECT 'processed_chat_requests.side_effects_at ready' AS status;

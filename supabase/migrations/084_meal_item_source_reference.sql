-- 084: allow data_source='reference' on meal_log_items.
--
-- Step 7 grounds logged meals against the deterministic food reference and stamps the item
-- data_source='reference' when the macros come from canonical data rather than a model estimate.
-- The existing CHECK only permitted ai_estimate|barcode|user_correction|venue_memory|template, so
-- a grounded row 23514-failed the whole items insert (meal saved with ZERO items). Add 'reference'.

ALTER TABLE meal_log_items DROP CONSTRAINT IF EXISTS meal_log_items_data_source_check;
ALTER TABLE meal_log_items ADD CONSTRAINT meal_log_items_data_source_check
  CHECK (data_source = ANY (ARRAY['ai_estimate','reference','barcode','user_correction','venue_memory','template']));

SELECT pg_get_constraintdef(oid) AS def
FROM pg_constraint WHERE conname = 'meal_log_items_data_source_check';

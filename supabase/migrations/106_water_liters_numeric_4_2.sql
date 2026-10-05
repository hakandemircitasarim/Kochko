-- 106: daily_metrics.water_liters DECIMAL(3,1) → NUMERIC(4,2)  (docs/AI_MIMARI_V2.md §4.4, Faz 0 #2)
--
-- water_log now arrives as quantity + unit and the server converts with a fixed ml table
-- (kupa 250 ml, şişe 330 ml, …). DECIMAL(3,1) rounded every write to 0,1 L, so one kupa (0,25 L)
-- was stored as 0,3 and repeated small drinks drifted away from what the receipt showed.
-- NUMERIC(4,2) keeps 0,01 L; the range (max 99,99) still covers any real day (per-write cap 8 L).
--
-- Widening only (precision 3→4, scale 1→2): every existing value fits unchanged. No view, policy
-- or function in the migrations references the column. Table rewrite is small (one row per user-day).

ALTER TABLE daily_metrics ALTER COLUMN water_liters TYPE NUMERIC(4,2);

SELECT format_type(atttypid, atttypmod) AS water_liters_type
FROM pg_attribute
WHERE attrelid = 'daily_metrics'::regclass AND attname = 'water_liters';

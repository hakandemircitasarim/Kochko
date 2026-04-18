-- Community barcode aggregation (Spec 19.3)
-- When 3+ distinct users have contributed corrections for the same barcode,
-- we treat that barcode as "community-verified" and expose median nutrition
-- values via an RPC. This makes rarely-tracked/regional products available
-- to everyone without exposing individual user corrections across accounts.

CREATE OR REPLACE FUNCTION get_community_barcode(p_barcode TEXT)
RETURNS TABLE (
  found BOOLEAN,
  food_name TEXT,
  calories NUMERIC,
  protein_g NUMERIC,
  carbs_g NUMERIC,
  fat_g NUMERIC,
  portion_g NUMERIC,
  contributor_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  -- How many distinct users have contributed non-empty, non-placeholder entries?
  SELECT COUNT(DISTINCT user_id) INTO v_count
  FROM barcode_corrections
  WHERE barcode = p_barcode
    AND food_name <> '_UNFOUND_'
    AND calories > 0
    AND portion_g > 0;

  IF v_count < 3 THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, v_count;
    RETURN;
  END IF;

  -- Median over all verified contributions for this barcode
  RETURN QUERY
  SELECT
    true AS found,
    (mode() WITHIN GROUP (ORDER BY food_name))::TEXT AS food_name,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY calories)::NUMERIC AS calories,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY protein_g)::NUMERIC AS protein_g,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY carbs_g)::NUMERIC AS carbs_g,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY fat_g)::NUMERIC AS fat_g,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY portion_g)::NUMERIC AS portion_g,
    v_count AS contributor_count
  FROM barcode_corrections
  WHERE barcode = p_barcode
    AND food_name <> '_UNFOUND_'
    AND calories > 0
    AND portion_g > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION get_community_barcode(TEXT) TO authenticated, anon, service_role;

-- Unfound barcode reports: allow any authenticated user to see counts for
-- dashboards/stats, but not row-level data of other users (RLS already blocks).
-- We expose an aggregated view for "how many people hit this barcode without a match".
CREATE OR REPLACE VIEW barcode_unfound_counts AS
SELECT
  barcode,
  COUNT(DISTINCT user_id) AS miss_count,
  MAX(created_at) AS last_miss_at
FROM barcode_corrections
WHERE food_name = '_UNFOUND_'
GROUP BY barcode;

GRANT SELECT ON barcode_unfound_counts TO authenticated;

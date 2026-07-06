-- 082: clinical_rules — the versioned, CITED audit mirror of the clinical safety constants.
--
-- The authoritative runtime source is code (supabase/functions/shared/clinical-rules.ts): a safety
-- floor must not depend on a DB read that can fail. This table exists so those constants are
-- INSPECTABLE and AUDITABLE (what value, which citation, which ruleset version) and to be the
-- future admin-override / MemoryMirror surface. It is seeded to match the code and stamped with the
-- same CLINICAL_RULESET_VERSION; a drift between the two is a release-check failure, not a runtime
-- one.

CREATE TABLE IF NOT EXISTS clinical_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key     text NOT NULL,                 -- e.g. 'calorie_floor.male'
  value_num    numeric,                       -- the constant (numeric rules)
  unit         text,                          -- 'kcal', 'kg_per_week', 'g_per_kg', 'ratio', 'pct'
  applies_when jsonb NOT NULL DEFAULT '{}',   -- {} = always; future: {gender:'male'}, {state:'ramadan'}
  effect       text,                          -- human-readable effect
  citation     text NOT NULL,                 -- the evidence/source
  version      text NOT NULL,                 -- CLINICAL_RULESET_VERSION at seed time
  active       boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_key, version)
);

CREATE INDEX IF NOT EXISTS idx_clinical_rules_active ON clinical_rules (rule_key) WHERE active;

-- Read-only to authenticated users (the values are not user data); writes are admin/migration only.
ALTER TABLE clinical_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='clinical_rules' AND policyname='cr_sel') THEN
    CREATE POLICY cr_sel ON clinical_rules FOR SELECT USING (true);
  END IF;
END $$;

-- ── SEED (must match clinical-rules.ts allClinicalRules(); version 2026.07.06) ──
INSERT INTO clinical_rules (rule_key, value_num, unit, applies_when, effect, citation, version) VALUES
  ('calorie_floor.female',        1200, 'kcal',        '{"gender":"female"}', 'Daily intake never programmed below this', 'NICE CG189 / EFSA 2013 — unsupervised weight-loss diets >=1200 kcal/day (women)', '2026.07.06'),
  ('calorie_floor.male',          1500, 'kcal',        '{"gender":"male"}',   'Daily intake never programmed below this', 'NICE CG189 / EFSA 2013 — unsupervised weight-loss diets >=1500 kcal/day (men)',   '2026.07.06'),
  ('calorie_floor.default',       1200, 'kcal',        '{}',                  'Conservative floor when gender unknown',   'Conservative floor applied when gender is unknown', '2026.07.06'),
  ('kcal_per_kg',                 7700, 'kcal',        '{}',                  'kcal<->kg bridge for deficit/timeline',    'Wishnofsky 1958 — ~7700 kcal ~= 1 kg body mass', '2026.07.06'),
  ('max_rate_kg_per_week.lose',    1.0, 'kg_per_week', '{"goal":"lose"}',     'Weekly loss rate ceiling',                 'Helms/ISSN — <=0.5-1.0 kg/wk loss preserves lean mass', '2026.07.06'),
  ('max_rate_kg_per_week.gain',    0.5, 'kg_per_week', '{"goal":"gain"}',     'Weekly gain rate ceiling',                 'ISSN — ~0.25-0.5 kg/wk lean-gain ceiling', '2026.07.06'),
  ('protein_floor_g_per_kg',       1.6, 'g_per_kg',    '{}',                  'Min daily protein to defend lean mass',    'Morton et al. 2018 — ~1.6 g/kg/day maximises lean-mass retention', '2026.07.06'),
  ('band_range_pct',              0.10, 'pct',         '{}',                  'Calorie band width around target',         'Product rule — ~10%-wide livable band', '2026.07.06'),
  ('rest_day_kcal_reduction',      250, 'kcal',        '{}',                  'Rest-day kcal trim (never below floor)',   'Product rule — rest days trim ~250 kcal', '2026.07.06'),
  ('fixed_factor.lose',           0.85, 'ratio',       '{"goal":"lose"}',     'Fallback deficit when no timeline',         'Fallback — ~15% deficit', '2026.07.06'),
  ('fixed_factor.gain',           1.10, 'ratio',       '{"goal":"gain"}',     'Fallback surplus when no timeline',         'Fallback — ~10% surplus', '2026.07.06'),
  ('fixed_factor.maintain',       1.00, 'ratio',       '{"goal":"maintain"}', 'Maintenance = TDEE',                       'Maintenance = TDEE', '2026.07.06')
ON CONFLICT (rule_key, version) DO NOTHING;

SELECT rule_key, value_num, unit, version FROM clinical_rules ORDER BY rule_key;

-- 080: user_constraints — the SAFETY SPINE (target-architecture L1).
-- The single, typed store the guardrail layer reads. A safety check must NEVER grep free text;
-- today allergens live in food_preferences.is_allergen, injuries as free-text health_events.description,
-- and dietary limits in profiles.dietary_restriction — three shapes, three algorithms. This unifies
-- them into one typed row-per-constraint with canonical subjects + typed body_parts.
--
-- STEP 1a: create + backfill. Forward-sync (handlers also write here) + repointing the guardrails
-- to read ONLY this table are the next steps; until then this store is kept correct by backfill and
-- the sync helper added in ai-chat.

CREATE TABLE IF NOT EXISTS user_constraints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('allergen','intolerance','injury','surgery','condition','medication','dietary')),
  subject     text NOT NULL,                 -- canonical token: 'laktoz', 'sol_diz', 'gluten', 'vegan'
  severity    text CHECK (severity IN ('mild','moderate','severe')),
  body_parts  text[] NOT NULL DEFAULT '{}',  -- typed, for injury matching (no per-request extraction)
  active      boolean NOT NULL DEFAULT true, -- flag, never hard-delete (retraction sets false)
  source      text NOT NULL DEFAULT 'user_stated' CHECK (source IN ('user_stated','onboarding','imported','inferred','confirmed')),
  note        text,                          -- the original phrasing / detail
  stated_at   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, subject)            -- one row per (user, kind, canonical subject)
);

CREATE INDEX IF NOT EXISTS idx_user_constraints_active ON user_constraints (user_id, kind) WHERE active;

ALTER TABLE user_constraints ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_constraints' AND policyname='uc_sel') THEN
    CREATE POLICY uc_sel ON user_constraints FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_constraints' AND policyname='uc_ins') THEN
    CREATE POLICY uc_ins ON user_constraints FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_constraints' AND policyname='uc_upd') THEN
    CREATE POLICY uc_upd ON user_constraints FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_constraints' AND policyname='uc_del') THEN
    CREATE POLICY uc_del ON user_constraints FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── BACKFILL ───────────────────────────────────────────────────────────────
-- Allergens/intolerances from food_preferences.is_allergen
INSERT INTO user_constraints (user_id, kind, subject, severity, source, note, stated_at)
SELECT user_id, 'allergen', lower(food_name),
       COALESCE(allergen_severity,'moderate'), 'imported', food_name, now()
FROM food_preferences WHERE is_allergen = true
ON CONFLICT (user_id, kind, subject) DO NOTHING;

-- Dietary restriction from profiles
INSERT INTO user_constraints (user_id, kind, subject, source, note, stated_at)
SELECT id, 'dietary', lower(dietary_restriction), 'imported', dietary_restriction, now()
FROM profiles WHERE dietary_restriction IS NOT NULL AND dietary_restriction <> ''
ON CONFLICT (user_id, kind, subject) DO NOTHING;

-- Injuries / surgeries / conditions / medications from ongoing health_events, with
-- best-effort SQL keyword body_parts (the forward-sync helper uses the real TS extractor).
INSERT INTO user_constraints (user_id, kind, subject, body_parts, source, note, stated_at)
SELECT
  he.user_id,
  CASE WHEN he.event_type IN ('surgery','injury','condition','medication') THEN he.event_type ELSE 'condition' END,
  -- subject: first matched body part, else the event_type
  COALESCE((SELECT bp FROM unnest(parts.arr) bp LIMIT 1), he.event_type),
  parts.arr,
  'imported', he.description, COALESCE(he.event_date::timestamptz, he.created_at, now())
FROM health_events he,
LATERAL (SELECT array_remove(ARRAY[
    CASE WHEN he.description ~* '(^|[^a-zçğıöşü])(bel|belim|beli)([^a-zçğıöşü]|$)' THEN 'bel' END,
    CASE WHEN he.description ~* 'diz'      THEN 'diz'   END,
    CASE WHEN he.description ~* 'omuz'     THEN 'omuz'  END,
    CASE WHEN he.description ~* 'dirsek'   THEN 'dirsek' END,
    CASE WHEN he.description ~* '(el bilek|el bileğ|bilek)' THEN 'bilek' END,
    CASE WHEN he.description ~* '(ayak bileğ|ayak bilek)'   THEN 'ayak_bileği' END,
    CASE WHEN he.description ~* 'boyun'    THEN 'boyun' END,
    CASE WHEN he.description ~* '(sırt|sirt)' THEN 'sırt' END,
    CASE WHEN he.description ~* '(kalça|kalca)' THEN 'kalça' END,
    CASE WHEN he.description ~* 'menisk'   THEN 'diz'   END
  ], NULL) AS arr) parts
WHERE he.is_ongoing = true
ON CONFLICT (user_id, kind, subject) DO NOTHING;

SELECT kind, count(*) FROM user_constraints GROUP BY kind ORDER BY kind;

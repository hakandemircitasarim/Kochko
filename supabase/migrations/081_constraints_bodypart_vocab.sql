-- 081: normalize user_constraints body_parts + injury subject to the ENGLISH canonical
-- vocabulary the guardrails actually use.
--
-- Migration 080's backfill emitted TURKISH tokens (diz/bel/omuz/…) into body_parts and into
-- the injury subject. But the code guardrails (guardrails.ts INJURY_KEYWORDS keys and
-- EXERCISE_BODY_PART_MAP values) speak ENGLISH ('knee','back','shoulder',…), and the live
-- forward-sync (syncInjuryFromText → extractInjuredBodyParts) already writes English. So a
-- backfilled injury:
--   • never matched the injury exercise-conflict filter (dead safety row), and
--   • duplicated the forward-synced English row (subject 'diz' AND 'knee' for one knee).
-- This remaps the vocabulary, de-dups the arrays, and merges the collisions
-- (keeping the higher-confidence user_stated/confirmed row over the imported one).
--
-- Idempotent + a no-op on already-English data, so a from-scratch apply (080 then 081)
-- reaches the correct English end-state without touching 080.

-- Canonical Turkish→English body-part mapping (matches INJURY_KEYWORDS keys).
CREATE TEMP TABLE _bp_map(tr text, en text) ON COMMIT DROP;
INSERT INTO _bp_map(tr, en) VALUES
  ('diz','knee'), ('bel','back'), ('sırt','back'), ('sirt','back'),
  ('omuz','shoulder'), ('dirsek','elbow'), ('bilek','wrist'),
  ('ayak_bileği','ankle'), ('ayak_bilegi','ankle'), ('ayak bileği','ankle'),
  ('boyun','neck'), ('kalça','hip'), ('kalca','hip'),
  ('kasık','groin'), ('kasik','groin'),
  ('arka bacak','hamstring'), ('ön bacak','quad'), ('on bacak','quad');

-- 1) Remap + de-dup body_parts array elements for physical constraints.
UPDATE user_constraints uc
SET body_parts = sub.arr, updated_at = now()
FROM (
  SELECT id, ARRAY(
    SELECT DISTINCT COALESCE(m.en, bp)
    FROM unnest(body_parts) AS bp
    LEFT JOIN _bp_map m ON m.tr = bp
  ) AS arr
  FROM user_constraints
  WHERE kind IN ('injury','surgery','condition','medication')
) sub
WHERE uc.id = sub.id
  AND uc.body_parts IS DISTINCT FROM sub.arr;

-- 2a) Merge collisions: delete the IMPORTED Turkish-subject row when an English-subject row
--     for the same (user, kind) already exists (the survivor is the higher-confidence one).
DELETE FROM user_constraints uc
USING _bp_map m, user_constraints other
WHERE uc.kind IN ('injury','surgery','condition','medication')
  AND uc.subject = m.tr
  AND other.user_id = uc.user_id
  AND other.kind    = uc.kind
  AND other.subject = m.en
  AND other.id <> uc.id;

-- 2b) Retarget the remaining Turkish-subject rows to the English canonical (no collision left).
UPDATE user_constraints uc
SET subject = m.en, updated_at = now()
FROM _bp_map m
WHERE uc.kind IN ('injury','surgery','condition','medication')
  AND uc.subject = m.tr
  AND NOT EXISTS (
    SELECT 1 FROM user_constraints o
    WHERE o.user_id = uc.user_id AND o.kind = uc.kind AND o.subject = m.en AND o.id <> uc.id
  );

SELECT kind, subject, body_parts, source, active
FROM user_constraints
WHERE kind IN ('injury','surgery','condition','medication')
ORDER BY subject;

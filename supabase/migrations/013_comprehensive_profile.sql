-- ============================================================
-- Migration 013: Comprehensive Profile Data Collection
-- Adds 25+ new profile columns for complete user understanding
-- All new fields are TEXT (free-form) to preserve natural language
-- ============================================================

-- === LIFESTYLE & DAILY ROUTINE ===
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dietary_restriction TEXT;       -- vegan, vegetarian, halal, kosher, pescatarian, none, serbest metin
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stress_level TEXT;              -- serbest: "yuksek, is kaynakli"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stress_sources TEXT;            -- serbest: "is, aile, finansal"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sleep_quality TEXT;             -- serbest: "genelde iyi ama stresli gunlerde kotu"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS motivation_source TEXT;         -- serbest: "dugun, saglik, ozguven"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS biggest_challenge TEXT;         -- serbest: "gece atistirmasi, yemek kontrolu"

-- === HEALTH & MEDICAL ===
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS digestive_issues TEXT;          -- serbest: "reflu, siskinlik, IBS"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hormone_conditions TEXT;        -- serbest: "tiroid, PCOS, insulin direnci"

-- === NUTRITION HABITS ===
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS previous_diets TEXT;            -- serbest: "keto 3 ay denedim, 5 kg verdim ama geri aldim"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS eating_out_frequency TEXT;      -- serbest: "haftada 2-3 kez, genelde oglen"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS fastfood_frequency TEXT;        -- serbest: "ayda 1-2 kez"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS skipped_meals TEXT;             -- serbest: "kahvaltiyi hep atlarim"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS night_eating_habit TEXT;        -- serbest: "gece 12den sonra atistiriyorum"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS emotional_eating TEXT;          -- serbest: "stresli olunca cikolata"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS snacking_habit TEXT;            -- serbest: "ikindi 4-5 arasi hep bir seyler yerim"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS caffeine_intake TEXT;           -- serbest: "gunde 3 kahve, 2 cay"

-- === KITCHEN & LOGISTICS ===
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS meal_prep_time TEXT;            -- serbest: "gunde max 30dk"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kitchen_equipment TEXT;         -- serbest: "firin, airfryer, blender, tarti var"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS household_cooking TEXT;         -- serbest: "esim pisirir genelde"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS household_diet_challenge TEXT;  -- serbest: "esim diyet yapmiyor, cocuklar fast food istiyor"

-- === EXERCISE & TRAINING ===
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS training_experience TEXT;       -- serbest: "3 yildir duzensiz salon, baslangic-orta arasi"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS exercise_history TEXT;          -- serbest: "futbol oynamistim, simdi sadece yuruyor"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferred_exercises TEXT;       -- serbest: "bench press, squat, yuruyus"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS disliked_exercises TEXT;        -- serbest: "kosma, burpee"
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS available_training_times TEXT;  -- serbest: "sabah 7-8, aksam 19-21 arasi"

-- === EXTRACTION CHECKPOINT (for AI extractor cron) ===
ALTER TABLE ai_summary ADD COLUMN IF NOT EXISTS extraction_checkpoint JSONB DEFAULT '{}';
-- Structure: { "tier2_last": "ISO", "tier3_last": "ISO", "last_message_id": "uuid" }

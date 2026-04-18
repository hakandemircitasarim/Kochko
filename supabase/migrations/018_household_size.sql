-- Household size for recipe scaling (Spec 7.7)
-- Simple single-user-facing field for "kac kisi icin pisiriyorsun" — used by
-- the recipe mode to scale servings and present toplam + kisi basi macros.
--
-- NOTE: The richer household_members table (household.service.ts) is a future
-- feature for multi-account household sharing. This column is the lightweight
-- MVP that gets recipe scaling working immediately.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS household_size SMALLINT DEFAULT 1 CHECK (household_size BETWEEN 1 AND 12);

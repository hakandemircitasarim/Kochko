-- Migration 008: Add start_weight_kg to goals table
-- Required for accurate goal progress tracking
ALTER TABLE goals ADD COLUMN IF NOT EXISTS start_weight_kg DECIMAL(5,2);

-- Backfill: set start_weight_kg from profile weight for existing goals
UPDATE goals g SET start_weight_kg = p.weight_kg
FROM profiles p WHERE g.user_id = p.id AND g.start_weight_kg IS NULL;

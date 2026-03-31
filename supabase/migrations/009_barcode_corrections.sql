-- Package 13: Barcode corrections & unfound barcode logging
-- Users can store personal corrections for barcode products
-- and unfound barcodes are logged for future community contribution.

CREATE TABLE IF NOT EXISTS barcode_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  food_name TEXT NOT NULL,
  calories DECIMAL(7,2),
  protein_g DECIMAL(5,2),
  carbs_g DECIMAL(5,2),
  fat_g DECIMAL(5,2),
  portion_g DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_barcode_corrections_barcode ON barcode_corrections(barcode);
CREATE INDEX idx_barcode_corrections_user ON barcode_corrections(user_id);

-- RLS
ALTER TABLE barcode_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own barcode corrections"
  ON barcode_corrections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own barcode corrections"
  ON barcode_corrections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own barcode corrections"
  ON barcode_corrections FOR DELETE
  USING (auth.uid() = user_id);

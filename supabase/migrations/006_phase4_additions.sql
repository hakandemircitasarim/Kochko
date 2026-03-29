-- Migration 006: Phase 4 additions
-- Unfound barcodes (Spec 19.3), notification prefs, scheduled export, profile extras

-- Unfound barcodes for community contribution (Spec 19.3)
CREATE TABLE IF NOT EXISTS unfound_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode TEXT NOT NULL UNIQUE,
  scan_count INT DEFAULT 1,
  last_scanned_at TIMESTAMPTZ DEFAULT NOW(),
  -- Community contribution fields (future)
  contributed_name TEXT,
  contributed_calories SMALLINT,
  contributed_protein SMALLINT,
  contributed_carbs SMALLINT,
  contributed_fat SMALLINT,
  contribution_count INT DEFAULT 0,
  verified BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_unfound_barcodes_barcode ON unfound_barcodes(barcode);
CREATE INDEX idx_unfound_barcodes_scan_count ON unfound_barcodes(scan_count DESC);

-- Add notification prefs and scheduled export to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS scheduled_export_settings JSONB DEFAULT '{}';

-- RLS for unfound_barcodes (public insert, no user binding needed)
ALTER TABLE unfound_barcodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert unfound barcodes"
  ON unfound_barcodes FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update scan count"
  ON unfound_barcodes FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can read unfound barcodes"
  ON unfound_barcodes FOR SELECT
  USING (true);

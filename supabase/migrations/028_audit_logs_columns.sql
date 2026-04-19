-- Migration 028: Ensure audit_logs has all required columns
-- The pre-existing audit_logs table (created outside migrations) may be missing
-- columns that src/services/audit-log.service.ts writes (PGRST204 on INSERT).
-- This migration is idempotent via ADD COLUMN IF NOT EXISTS.

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Reload PostgREST schema cache so new columns are visible to clients immediately.
NOTIFY pgrst, 'reload schema';

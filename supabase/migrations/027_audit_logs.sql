-- Migration 027: audit_logs table for KVKK/GDPR compliance
-- Client-side service (src/services/audit-log.service.ts) writes here on
-- data export, view, delete, AI summary access, photo upload/delete.
-- Table was referenced by services but never created -> client INSERTs failing with PGRST204.

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'data_export', 'data_view', 'data_delete',
    'ai_summary_view', 'ai_summary_edit', 'ai_summary_delete',
    'account_delete_request', 'account_delete_cancel',
    'photo_upload', 'photo_delete', 'profile_update'
  )),
  description TEXT NOT NULL,
  metadata JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON audit_logs(user_id, created_at DESC);

-- RLS: users can only read/insert their own audit logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_select_own" ON audit_logs;
CREATE POLICY "audit_logs_select_own" ON audit_logs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "audit_logs_insert_own" ON audit_logs;
CREATE POLICY "audit_logs_insert_own" ON audit_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

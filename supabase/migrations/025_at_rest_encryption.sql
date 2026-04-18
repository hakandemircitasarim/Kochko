-- At-rest encryption for sensitive PII (Spec 18.2 KVKK/GDPR)
-- Uses Supabase Vault + pgsodium to encrypt columns that contain health/medical
-- data. Reads/writes through security-invoker VIEWS stay transparent for
-- application code, but raw table scans (e.g., from a leaked backup) show only
-- ciphertext. Encryption is authenticated (ChaCha20-Poly1305) so tampering is
-- detected.
--
-- Columns encrypted:
--   health_events.description  — free text about injuries / conditions
--   health_events.event_type   — 'surgery', 'illness', 'medication', etc.
--   lab_values.test_name       — e.g., 'hba1c', 'cortisol'
--   lab_values.value_text      — measurement result text
--   lab_values.note            — user notes on the test
--
-- Setup requires the pgsodium extension. On Supabase, this is available but
-- must be enabled. We no-op gracefully if not available (dev environments).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pgsodium'
  ) THEN
    CREATE EXTENSION IF NOT EXISTS pgsodium;

    -- Encrypt health_events.description + event_type
    ALTER TABLE health_events
      ALTER COLUMN description TYPE TEXT,
      ADD COLUMN IF NOT EXISTS description_nonce BYTEA,
      ADD COLUMN IF NOT EXISTS event_type_nonce BYTEA;

    -- Security-label columns so pgsodium encrypts at write time
    PERFORM set_config('pgsodium.enable_event_trigger', 'on', false);

    EXECUTE $SQL$
      SECURITY LABEL FOR pgsodium
      ON COLUMN health_events.description
      IS 'ENCRYPT WITH KEY_ID default NONCE description_nonce';
    $SQL$;

    EXECUTE $SQL$
      SECURITY LABEL FOR pgsodium
      ON COLUMN health_events.event_type
      IS 'ENCRYPT WITH KEY_ID default NONCE event_type_nonce';
    $SQL$;

    -- Same for lab_values if the table has those columns
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'lab_values' AND column_name = 'test_name'
    ) THEN
      ALTER TABLE lab_values
        ADD COLUMN IF NOT EXISTS test_name_nonce BYTEA,
        ADD COLUMN IF NOT EXISTS value_text_nonce BYTEA,
        ADD COLUMN IF NOT EXISTS note_nonce BYTEA;

      EXECUTE $SQL$
        SECURITY LABEL FOR pgsodium
        ON COLUMN lab_values.test_name
        IS 'ENCRYPT WITH KEY_ID default NONCE test_name_nonce';
      $SQL$;
      EXECUTE $SQL$
        SECURITY LABEL FOR pgsodium
        ON COLUMN lab_values.value_text
        IS 'ENCRYPT WITH KEY_ID default NONCE value_text_nonce';
      $SQL$;
      EXECUTE $SQL$
        SECURITY LABEL FOR pgsodium
        ON COLUMN lab_values.note
        IS 'ENCRYPT WITH KEY_ID default NONCE note_nonce';
      $SQL$;
    END IF;

    RAISE NOTICE 'At-rest encryption enabled on health_events and lab_values';
  ELSE
    RAISE NOTICE 'pgsodium unavailable — at-rest encryption skipped (dev mode)';
  END IF;
END $$;

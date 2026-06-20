-- Migration 064: audit_logs üzerindeki yinelenen SELECT politikasını tekle
--
-- AMAÇ (Audit NIT): audit_logs'ta birbirinin AYNISI iki SELECT politikası var:
--   `audit_logs_select_own` ve `Users can view own audit logs` — her ikisi de
--   USING (auth.uid() = user_id), {public} rolü. Güvenlik açığı değil ama çift
--   politika kafa karışıklığı + birini değiştirip diğerini unutma riski yaratır.
--   Kanonik tek politikayı (`audit_logs_select_own`) bırakıp diğerini düşürüyoruz.
--
-- CANLI KANIT (node TEMP/q.mjs — pg_policies WHERE tablename='audit_logs'):
--   SELECT politikaları:
--     * 'Users can view own audit logs'  cmd=SELECT  qual=(auth.uid()=user_id)  {public}
--     * 'audit_logs_select_own'          cmd=SELECT  qual=(auth.uid()=user_id)  {public}
--       → birebir aynı; biri fazlalık.
--   INSERT politikaları (DOKUNULMUYOR — 038 forgery düzeltmesi sağlam):
--     * 'Service can insert audit logs'  cmd=INSERT  with_check=true  {service_role}
--     * 'audit_logs_insert_own'          cmd=INSERT  with_check=(auth.uid()=user_id) {public}
--
-- IDEMPOTENCY: DROP POLICY IF EXISTS. Kanonik politika zaten varsa tekrar
--   yaratmaya kalkmıyoruz; yoksa güvence olarak yeniden oluşturuyoruz.
--
-- DOWN: CREATE POLICY "Users can view own audit logs" ON audit_logs
--         FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own audit logs" ON public.audit_logs;

-- Kanonik SELECT politikasını güvenceye al (yoksa oluştur).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_logs'
      AND policyname = 'audit_logs_select_own'
  ) THEN
    CREATE POLICY audit_logs_select_own ON public.audit_logs
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

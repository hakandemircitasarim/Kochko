-- 075: chat-request idempotency (HIGH — audit 2026-06-21 AI-INT-01)
--
-- AMAÇ: Client (chat.service invokeChat) timeout'ta isteği retry ediyor, ama "underlying request
-- may continue" — yani sunucu ilk denemeyi hâlâ işlerken ikinci deneme AYNI body'yi gönderiyor.
-- ai-chat action döngüsü (su +0.25L, supplement, workout, commitment, recovery_plan kalori
-- kesintisi…) idempotent olmadığından yan-etkiler İKİ KEZ uygulanıyor (mükerrer kayıt / çift
-- kalori kesintisi).
--
-- ÇÖZÜM: (user_id, idempotency_key) PRIMARY KEY'li küçük bir dedupe tablosu. ai-chat, action
-- yan-etkilerini uygulamadan ÖNCE bu anahtarı INSERT etmeye çalışır; UNIQUE ihlali (retry veya
-- eşzamanlı kopya) → action döngüsü atlanır, böylece yazımlar TAM BİR KEZ olur. UNIQUE kısıtı
-- eşzamanlılığı atomik çözer (iki deneme yarışırsa yalnız biri insert eder).
--
-- Yalnız service_role (ai-chat supabaseAdmin) erişir → RLS açık, policy yok (client erişmez).
-- Eski satırlar pg_cron ile 3 günde bir budanır (tablo küçük tutulur).
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS; cron.schedule aynı isimle upsert eder.

CREATE TABLE IF NOT EXISTS public.processed_chat_requests (
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_processed_chat_requests_created
  ON public.processed_chat_requests (created_at);

ALTER TABLE public.processed_chat_requests ENABLE ROW LEVEL SECURITY;
-- (no policies → only service_role / postgres bypass RLS; the client never reads/writes this)

-- Daily prune of keys older than 3 days (retry windows are seconds; 3 days is generous).
SELECT cron.schedule(
  'kochko-idempotency-prune',
  '30 4 * * *',
  $$DELETE FROM public.processed_chat_requests WHERE created_at < now() - interval '3 days'$$
);

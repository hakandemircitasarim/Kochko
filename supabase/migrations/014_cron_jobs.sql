-- Enable pg_cron and pg_net extensions for scheduled edge function calls
-- pg_cron: schedule recurring jobs
-- pg_net: make HTTP requests from within PostgreSQL

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Tier 2: Daily extraction (every night at 03:00 Turkey time = 00:00 UTC)
SELECT cron.schedule(
  'kochko-tier2-extraction',
  '0 0 * * *',  -- midnight UTC = 03:00 TR
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/ai-extractor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"tier": 2}'::jsonb
  );
  $$
);

-- Tier 3: Weekly extraction (Sunday night at 03:30 Turkey time = 00:30 UTC)
SELECT cron.schedule(
  'kochko-tier3-extraction',
  '30 0 * * 0',  -- Sunday midnight:30 UTC = 03:30 TR
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/ai-extractor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"tier": 3}'::jsonb
  );
  $$
);

-- Proactive nudges: 3 times daily (08:00, 13:00, 20:00 Turkey time)
SELECT cron.schedule(
  'kochko-proactive-morning',
  '0 5 * * *',  -- 05:00 UTC = 08:00 TR
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/ai-proactive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"trigger": "morning"}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'kochko-proactive-afternoon',
  '0 10 * * *',  -- 10:00 UTC = 13:00 TR
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/ai-proactive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"trigger": "afternoon"}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'kochko-proactive-evening',
  '0 17 * * *',  -- 17:00 UTC = 20:00 TR
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/ai-proactive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"trigger": "evening"}'::jsonb
  );
  $$
);

-- Session auto-close: daily cleanup of 24h+ inactive sessions
SELECT cron.schedule(
  'kochko-session-cleanup',
  '0 2 * * *',  -- 02:00 UTC = 05:00 TR
  $$
  UPDATE chat_sessions
  SET is_active = false,
      ended_at = NOW()
  WHERE is_active = true
    AND updated_at < NOW() - INTERVAL '24 hours';
  $$
);

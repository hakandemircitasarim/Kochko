-- 093: #S1 one-thread structural rebuild — session semantics change.
--
-- The chat is now ONE continuous coach conversation. The nightly auto-close
-- ('kochko-session-cleanup', 014_cron_jobs.sql) closed the active session after 24h idle —
-- beheading the user's thread every day and making the coach greet blank ("amnesia") each
-- morning. In one-thread semantics the active session is ETERNAL: unschedule the job.
-- (chat_sessions stays as invisible storage; old sessions remain frozen history for
-- settings/chat-history + the KVKK export. 'kochko-user-sessions-prune' — the AUTH sessions
-- pruner — is unrelated and stays.)

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kochko-session-cleanup') then
    perform cron.unschedule('kochko-session-cleanup');
  end if;
end $$;

-- Data hygiene for the transition (the step-8 items, folded here):
-- (a) close orphan zero-message sessions so get-or-create converges on one meaningful thread;
update chat_sessions s
set is_active = false, ended_at = coalesce(s.ended_at, now())
where s.is_active = true
  and not exists (select 1 from chat_messages m where m.session_id = s.id);

-- (b) recount message_count from truth (live drift observed: count=0 while 2 real messages);
update chat_sessions s
set message_count = sub.real_count
from (
  select session_id, count(*)::int as real_count
  from chat_messages
  group by session_id
) sub
where sub.session_id = s.id
  and s.message_count is distinct from sub.real_count;

-- (c) safety: if any user somehow has >1 active session (pre-index legacy), keep only the most
-- recently updated one. The mig-035 partial unique index enforces this going forward.
with ranked as (
  select id, row_number() over (partition by user_id order by updated_at desc nulls last, started_at desc) as rn
  from chat_sessions where is_active = true
)
update chat_sessions set is_active = false, ended_at = now()
where id in (select id from ranked where rn > 1);

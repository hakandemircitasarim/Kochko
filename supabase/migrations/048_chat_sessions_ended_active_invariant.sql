-- #R1-L4: chat_sessions.ended_at and is_active could diverge. storeMessages() in
-- ai-chat resolves the active session purely by is_active=true and never reads
-- ended_at, so a row with is_active=true AND ended_at!=null was still treated as
-- open. Real clients/cron always set both, but the invariant was unenforced.
-- Enforce it at the DB layer with a BEFORE trigger (does NOT fail existing rows,
-- unlike a CHECK constraint): whenever ended_at is set, is_active is forced false.

-- 1) Repair any already-divergent rows (e.g. a session whose ended_at was set
--    directly without flipping is_active).
update chat_sessions set is_active = false
where ended_at is not null and is_active = true;

-- 2) Trigger that keeps the two columns consistent on every write.
create or replace function enforce_chat_session_ended_inactive()
returns trigger language plpgsql as $$
begin
  if new.ended_at is not null then
    new.is_active := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_session_ended_inactive on chat_sessions;
create trigger trg_chat_session_ended_inactive
  before insert or update on chat_sessions
  for each row execute function enforce_chat_session_ended_inactive();

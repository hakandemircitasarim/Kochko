-- #R3: weight_history (newly written by ai-chat since #R1-M2) used a plain insert, so
-- two weigh-ins on the same calendar day produced two conflicting rows with no canonical
-- daily value. recorded_at is a DATE, so one row per (user, day) is the right granularity.
-- Collapse any existing same-day duplicates (keep the most recent id), then enforce it.
delete from weight_history a using weight_history b
  where a.user_id = b.user_id and a.recorded_at = b.recorded_at and a.id < b.id;

alter table weight_history
  add constraint weight_history_user_date_uniq unique (user_id, recorded_at);

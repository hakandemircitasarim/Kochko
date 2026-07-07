-- 091: fact-capture receipts on the observability ledger (#S2 structural rebuild).
--
-- WHY: the "anladım, 25 yaşındasın" bug class — the coach verbally acknowledges a fact but no
-- write lands — was INVISIBLE: nothing recorded which facts a turn captured and whether the
-- DB row actually changed. This column stores per-turn receipts:
--   [{"field":"birth_year","value":2001,"source":"regex|model|net","verified":true}, ...]
-- written as a dedicated function_name='fact-capture' row by shared/turn-log.ts.
-- It doubles as: (a) the dirty-flag S3 (derived summary) uses to know a source table changed,
-- and (b) the stated-fact record S4 (contradiction engine) uses for per-field cooldowns.

alter table ai_turn_log add column if not exists facts_captured jsonb;

comment on column ai_turn_log.facts_captured is
  '#S2 per-turn fact-capture receipts: [{field, value, source, verified}] — written by function_name=fact-capture rows; the write-verification trail for user-stated facts.';

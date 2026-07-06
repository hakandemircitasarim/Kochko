-- 086: epistemics on user_constraints — confidence + confirmed_at (target-arch step 1 keystone).
--
-- The round-2 critic's #1 foundational gap: you cannot tell a CONFIRMED fact from a DEFAULTED or
-- BACKFILLED one, so the coach treats a possibly-stale import as gospel. We saw this directly —
-- migration 080's backfill produced junk like 'ürünleri' (a truncated "deniz ürünleri") and a
-- 'balık sevmiyorum' free-text sentence as a dietary constraint. A belief needs provenance.
--
-- confidence: how sure we are (1.0 = the user said it; lower = imported/inferred, may be stale).
-- confirmed_at: when the USER last affirmed it (null = never explicitly confirmed).
--
-- SAFETY INVARIANT: confidence NEVER gates enforcement. The guardrails act on every ACTIVE
-- constraint regardless of confidence (an unconfirmed allergen is still fail-safe blocked). Epistemics
-- only affects CONVERSATION — whether the coach asks "kaydımda X görünüyor, hâlâ geçerli mi?".

ALTER TABLE user_constraints ADD COLUMN IF NOT EXISTS confidence   numeric NOT NULL DEFAULT 1.0;
ALTER TABLE user_constraints ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Backfill from the existing source: what the user stated/confirmed is trusted + treated as
-- confirmed at stated_at; imported/inferred beliefs are lower-confidence and NOT yet confirmed.
UPDATE user_constraints SET
  confidence = CASE WHEN source IN ('user_stated','onboarding','confirmed') THEN 1.0 ELSE 0.6 END,
  confirmed_at = CASE WHEN source IN ('user_stated','confirmed') THEN COALESCE(confirmed_at, stated_at) ELSE confirmed_at END;

SELECT source, confidence, count(*) FROM user_constraints GROUP BY source, confidence ORDER BY source;

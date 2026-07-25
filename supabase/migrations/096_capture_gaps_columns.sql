-- 096: give the "acknowledged but nowhere to store" fields a real home (C4-no-storage class).
--
-- WHY (audit whole-system 2026-07-23, class C4): several onboarding-card checklist fields and lab
-- details were things the coach ASKED FOR and affirmed back to the user, while no column or handler
-- existed — so the information was silently dropped and the card could even re-ask for it forever:
--   * "uyku sorunları" (insomnia/apnea/night waking) — the sleep card asks; only sleep_time/
--     wake_time/sleep_quality existed, so a genuine sleep-disorder disclosure was lost or mangled
--     into the coarse sleep_quality enum.
--   * "yeme saatleri" (meal clock) — the eating card asks; profiles had no column (only
--     ai_summary.learned_meal_times, which is cron-derived, never chat-written).
--   * goal REASON vs stress MOTIVATION — both cards wrote profiles.motivation_source, so whichever
--     card the user filled second silently OVERWROTE the other ("3 ay sonra düğünüm var" replaced
--     by "beni ailem motive ediyor"). Goal reason now lives on the goal row it belongs to.
--   * lab QUALITATIVE findings + the stated test date — the labs handler dropped any item without a
--     finite numeric value and hardcoded measured_at=today, so "3 ay önce baktım, D vitaminim düşük,
--     tiroid normal" stored ZERO rows while the card closed.
--
-- All additive + idempotent; no backfill, nothing rewritten. DOWN: DROP the four columns.

ALTER TABLE profiles    ADD COLUMN IF NOT EXISTS sleep_problems TEXT; -- serbest: "uykuya dalamıyorum, gece 3-4 kez uyanıyorum, horlama"
ALTER TABLE profiles    ADD COLUMN IF NOT EXISTS meal_times     TEXT; -- serbest: "sabah 8, öğlen 13, akşam 20 civarı"
ALTER TABLE goals       ADD COLUMN IF NOT EXISTS reason         TEXT; -- goal-specific motivation ("3 ay sonra düğünüm var")
ALTER TABLE lab_values  ADD COLUMN IF NOT EXISTS notes          TEXT; -- qualitative finding / doctor comment ("D vitamini düşük — doktor takviye önerdi")

COMMENT ON COLUMN profiles.sleep_problems IS 'Free-text sleep complaints captured in the sleep onboarding card (mig 096).';
COMMENT ON COLUMN profiles.meal_times     IS 'Free-text habitual meal clock captured in the eating card (mig 096).';
COMMENT ON COLUMN goals.reason            IS 'Why THIS goal — separate from profiles.motivation_source, which the stress card owns (mig 096).';
COMMENT ON COLUMN lab_values.notes        IS 'Qualitative lab finding / doctor comment for rows whose value is not numeric-only (mig 096).';

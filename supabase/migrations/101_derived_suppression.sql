-- 101: the KVKK tombstone — a memory reset that actually STAYS reset.
--
-- WHY (AI_BEYIN_2026-07-25.md, HAFIZA-06 / F3 · C6): "Tüm Hafızayı Sıfırla" says "bu işlem geri
-- alınamaz", empties ai_summary — and the summary comes BACK: general_summary is a DERIVED VIEW,
-- so the next fact-turn (ai-chat) and the nightly extractor regenerate it from the same canonical
-- rows it was derived from. The user watches their "irreversibly deleted" memory reappear within
-- a day, which is both a broken promise and a KVKK Art.17 problem.
--
-- THE SEMANTIC (per plan §7/C6, and the do-not list: tombstones are for DERIVED views ONLY):
--   * suppressed_at set  → derived regeneration is HELD. Canonical rows are untouched; the user
--     asked to clear the derived picture, not their meal history.
--   * The user SPEAKING new facts to the coach lifts the suppression (ai-chat's factsDirty regen
--     clears the stamp first) — new input is fresh consent for a fresh summary.
--   * The nightly extractor NEVER lifts it — a cron reprocessing old data is exactly the
--     "it came back by itself" experience this exists to end.
--
-- DOWN: ALTER TABLE ai_summary DROP COLUMN IF EXISTS derived_suppressed_at;

ALTER TABLE ai_summary ADD COLUMN IF NOT EXISTS derived_suppressed_at timestamptz;

SELECT '101 derived suppression applied' AS status;

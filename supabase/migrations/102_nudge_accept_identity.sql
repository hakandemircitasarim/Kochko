-- 102: the offer's IDENTITY — an accepted nudge that the coach can actually see.
--
-- WHY (AI_BEYIN_2026-07-25.md, TUTARLILIK-02 / ÖĞRENME-11 / F3 · C5): tapping "Evet" on a
-- coaching offer did three self-defeating things at once: (1) the client marked the message READ
-- before navigating — extinguishing the "AÇIK TEKLİF (cevaplanmadı)" flag at the exact moment it
-- was being answered; (2) it prefilled the ANONYMOUS sentence "Evet, önerini uygulayalım." into a
-- thread whose coach had no idea which offer existed; (3) nothing anywhere recorded that the offer
-- was ACCEPTED, so acceptance could never gate re-offering or feed the learning loop.
--
-- accepted_at is the truth the whole loop was missing. Additive, nullable; `read` keeps meaning
-- what it always meant (seen), acceptance is its own fact.
--
-- DOWN: ALTER TABLE coaching_messages DROP COLUMN IF EXISTS accepted_at;

ALTER TABLE coaching_messages ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

SELECT '102 nudge accept identity applied' AS status;

-- Migration 063: ai_feedback.context_type ve profiles.periodic_state için enum CHECK
--
-- AMAÇ (Audit LOW): ContextType ve PeriodicState enum'ları yalnız TS'te (database.ts)
--   enforce ediliyor; canlı DB'de CHECK constraint yok. Edge/SQL ile geçersiz değer
--   yazılırsa DB kabul eder ve TS reader bunu sessizce kaçırır. Savunma derinliği için
--   DB-katman CHECK ekleniyor. NULL serbest (her iki kolon da nullable).
--
-- ENUM DEĞER KÜMELERİ (src/types/database.ts:40-41 ile birebir):
--   ContextType  = meal_suggestion | workout_plan | coaching_message | recipe
--   PeriodicState= ramadan | holiday | illness | busy_work | exam | pregnancy |
--                  breastfeeding | injury | travel | custom
--
-- CANLI KANIT (node TEMP/q.mjs ile — mevcut değerler conform mu?):
--   * SELECT context_type, count(*) FROM ai_feedback GROUP BY context_type → []
--       (tablo boş; uymayan satır yok)
--   * SELECT periodic_state, count(*) FROM profiles GROUP BY periodic_state →
--       yalnız {periodic_state: null, count: 27}  (tümü NULL; uymayan satır yok)
--   * her iki kolon da data_type='text'; bu kolonlar üzerinde mevcut CHECK yok
--       (ai_feedback'te yalnız ai_feedback_feedback_check var).
--   → Mevcut tüm değerler conform olduğundan CHECK'ler VALID olarak eklenebilir
--     (NOT VALID gerekmiyor); mevcut satırları kırmaz.
--
-- IDEMPOTENCY: pg_constraint DO-blok kontrolüyle yalnız yoksa ADD CONSTRAINT.
--
-- DOWN: ALTER TABLE ai_feedback DROP CONSTRAINT IF EXISTS ai_feedback_context_type_check;
--       ALTER TABLE profiles    DROP CONSTRAINT IF EXISTS profiles_periodic_state_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_feedback'::regclass
      AND conname = 'ai_feedback_context_type_check'
  ) THEN
    ALTER TABLE public.ai_feedback
      ADD CONSTRAINT ai_feedback_context_type_check
      CHECK (context_type IS NULL OR context_type IN (
        'meal_suggestion', 'workout_plan', 'coaching_message', 'recipe'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_periodic_state_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_periodic_state_check
      CHECK (periodic_state IS NULL OR periodic_state IN (
        'ramadan', 'holiday', 'illness', 'busy_work', 'exam', 'pregnancy',
        'breastfeeding', 'injury', 'travel', 'custom'
      ));
  END IF;
END $$;

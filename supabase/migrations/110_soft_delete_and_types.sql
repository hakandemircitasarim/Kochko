-- 110: soft-delete her yerde + öğün kalemlerinin esnek alanları (as_stated, reference_key, alerjen etiketleri).
--
-- NEDEN (AI_MIMARI_V2 §4.3, §4.4(2), §6.1 · Faz 1):
--   * Sohbetten artık hiçbir şey kalıcı olarak silinmez. Bugün düzeltme/geri alma antrenman ve takviyeyi
--     HARD delete ediyor (repair-handler); yaşam olayı ve tahlilde silme hiç yok. Bu tablolara
--     is_deleted/deleted_at eklenir; geri alma (108 _v2_soft_delete) bunları işaretler, geri getirme
--     işareti kaldırır. Antrenmanın ürettiği başarımlar source_row_id ile antrenmana zincirlenir ve
--     onunla birlikte gider/gelir.
--   * Her miktarın iki yüzü (§4.3): as_stated = kullanıcının ifadesi AYNEN ("2 çimdik", "6 adet"),
--     asla ayrıştırılmaz; sayılar modelin tahminidir. reference_key yalnızca modelin REFERANS
--     ADAYLARI'ndan seçtiği satırdır (kod seçmez, nugget → tavuk göğsü bir daha olmaz).
--     allergen_tags modelin kalem başına alerjen etiketleri; meta: may_contain, güven, pişirme,
--     kafein mg, model_kcal, sıra (position).
--   * meal_logs.supersedes_id: "perşembe nugget 1700 olmuş, düzelt" → eski satır soft-delete, yenisi
--     onu gösterir (§6.2). Çift sayım yok.
--
-- OKUYUCULAR (Faz 3'ten ÖNCE güncellenmeli — bkz. rapor): yeni is_deleted sütunları varsayılan false;
-- bugün hiçbir yol bu satırları işaretlemiyor, bu yüzden bu migrasyon tek başına hiçbir ekranı
-- değiştirmez. v2 yazıcıları canlıya çıkmadan önce supplement_logs / life_events / lab_values /
-- achievements / workout_logs / strength_sets okuyucuları "is_deleted IS NOT TRUE" filtresini almalı.
-- Bu migrasyon setindeki SQL okuyucusu (113 v2_turn_input set_count) zaten süzüyor. Uygulama kodu bu
-- sütun canlıda yokken süzemez (sorgu hata verir), bu yüzden şunlar ENTEGRASYON maddesidir:
--   strength_sets (108 _v2_soft_delete antrenmanla birlikte soft-delete eder; rekor/geçmiş okuyucuları
--   ya strength_sets.is_deleted'i ya da workout_logs!inner(is_deleted)'i süzmeli):
--     ai-chat/index.ts PR tespiti (tarihi en yüksek ağırlık, ~5406) · ai-plan/index.ts progresif yüklenme
--     (~302) · ai-proactive/index.ts progresif yüklenme (~1001) · ai-report/index.ts ömür boyu PR (~685) ·
--     src/services/strength.service.ts (~56, ~188) · src/services/export.service.ts (~34, dışa aktarım).
--   achievements: v1'in PR başarımı (ai-chat/index.ts ~5418) source_table/source_row_id YAZMIYOR; v1
--   defter kablolaması bunu doldurmazsa geri alınan antrenmanın rekor başarımı kalır.
--
-- Tüm eklemeler NULL'a izinli ya da sabit varsayılanlı: PG11+ yalnızca katalog güncellemesi, tablo
-- yeniden yazılmaz, geri dönük veri hareketi yok.
--
-- DOWN:
--   ALTER TABLE meal_log_items DROP COLUMN IF EXISTS meta, DROP COLUMN IF EXISTS allergen_tags,
--     DROP COLUMN IF EXISTS reference_key, DROP COLUMN IF EXISTS as_stated;
--   ALTER TABLE meal_logs DROP COLUMN IF EXISTS supersedes_id;
--   ALTER TABLE achievements DROP COLUMN IF EXISTS source_row_id, DROP COLUMN IF EXISTS source_table,
--     DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS is_deleted;
--   ALTER TABLE lab_values / life_events / supplement_logs / strength_sets DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS is_deleted;
--   ALTER TABLE workout_logs DROP COLUMN IF EXISTS deleted_at;

-- ─── Soft-delete ───────────────────────────────────────────────────────────────────────────────────
-- workout_logs.is_deleted 002'den beri var (nullable, varsayılan false); yalnızca zaman damgası eksik.
ALTER TABLE workout_logs    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE strength_sets   ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE strength_sets   ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE supplement_logs ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE supplement_logs ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- is_active (geçti/iptal) ile ayrı: is_deleted = "bu kayıt hiç olmamalıydı" (yanlış anlaşılmış olay).
ALTER TABLE life_events     ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE life_events     ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE lab_values      ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE lab_values      ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE achievements    ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE achievements    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
-- Başarımı doğuran kayıt (bugün: PR → workout_logs). Antrenman geri alınınca rekor da gider.
ALTER TABLE achievements    ADD COLUMN IF NOT EXISTS source_table text;
ALTER TABLE achievements    ADD COLUMN IF NOT EXISTS source_row_id uuid;

-- Canlı satırların sıcak sorguları (günün kayıtları) silinmişleri taramasın.
CREATE INDEX IF NOT EXISTS idx_supplement_logs_user_live ON supplement_logs (user_id, logged_for_date) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_workout_logs_user_live    ON workout_logs (user_id, logged_for_date) WHERE is_deleted IS NOT TRUE;
CREATE INDEX IF NOT EXISTS idx_lab_values_user_live      ON lab_values (user_id, measured_at) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_achievements_source       ON achievements (source_row_id) WHERE source_row_id IS NOT NULL;
-- Antrenman soft-delete/geri getirme kaskadı (108 _v2_soft_delete) set'leri antrenmana göre arar;
-- 002'nin idx_strength_sets_workout indeksi bunu zaten karşılar.

-- ─── Öğün düzeltme zinciri ─────────────────────────────────────────────────────────────────────────
ALTER TABLE meal_logs ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES meal_logs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_meal_logs_supersedes ON meal_logs (supersedes_id) WHERE supersedes_id IS NOT NULL;

-- ─── Öğün kalemlerinin esnek alanları ────────────────────────────────────────────────────────────
-- portion_text (NOT NULL) eski okuyucular için kalır; v2 yazıcısı as_stated'i AYNEN oraya da yazar.
ALTER TABLE meal_log_items ADD COLUMN IF NOT EXISTS as_stated     text;
ALTER TABLE meal_log_items ADD COLUMN IF NOT EXISTS reference_key text;
ALTER TABLE meal_log_items ADD COLUMN IF NOT EXISTS allergen_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE meal_log_items ADD COLUMN IF NOT EXISTS meta          jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.meal_log_items'::regclass
                 AND conname = 'meal_log_items_meta_object_check') THEN
    ALTER TABLE public.meal_log_items
      ADD CONSTRAINT meal_log_items_meta_object_check CHECK (jsonb_typeof(meta) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN meal_log_items.as_stated     IS 'Kullanıcının miktar ifadesi AYNEN ("2 çimdik", "6 adet"). Kod ayrıştırmaz (AI_MIMARI_V2 §4.3).';
COMMENT ON COLUMN meal_log_items.reference_key IS 'Modelin REFERANS ADAYLARI''ndan seçtiği food-reference anahtarı; kod asla kendisi seçmez. NULL = modelin tahmini.';
COMMENT ON COLUMN meal_log_items.allergen_tags IS 'Modelin kalem başına alerjen etiketleri (vocab id''leri). Tüketim denetimi bunlar ∪ meta.may_contain ∪ sözlük ile çalışır.';
COMMENT ON COLUMN meal_log_items.meta          IS 'may_contain[], confidence, preparation, caffeine_mg, model_kcal, position (kalem sırası).';
COMMENT ON COLUMN meal_logs.supersedes_id      IS 'Bu öğün, düzeltilen (soft-delete edilen) eski öğünün yerine geçer.';
COMMENT ON COLUMN achievements.source_row_id   IS 'Başarımı doğuran kayıt (PR → workout_logs.id); kayıt geri alınınca başarım da soft-delete olur.';

SELECT '110 soft-delete + meal item flexible fields applied' AS status;

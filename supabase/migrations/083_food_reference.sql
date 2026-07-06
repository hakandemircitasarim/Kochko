-- 083: food_reference — the versioned nutrition seed the deterministic calculator grounds meals on.
--
-- Runtime authority is code (supabase/functions/shared/food-reference.ts): resolution + portion
-- math must be fast and fail-safe (no per-item DB round-trip while logging a meal). This table is
-- the AUDIT + FUTURE-GROWTH surface — a full TÜRKOMP/OpenFoodFacts import lands here, and an admin
-- can add foods without a redeploy once resolveFood is taught to merge DB rows. Seeded to match the
-- curated code table (83 foods, per 100 g edible portion, cooked where normally eaten cooked).

CREATE TABLE IF NOT EXISTS food_reference (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  food_key     text NOT NULL UNIQUE,          -- canonical Turkish name
  aliases      text[] NOT NULL DEFAULT '{}',  -- spelling / inflection variants
  kcal_100g    numeric NOT NULL,
  protein_100g numeric NOT NULL,
  carbs_100g   numeric NOT NULL,
  fat_100g     numeric NOT NULL,
  piece_g      numeric,                        -- one "adet/tane"
  slice_g      numeric,                        -- one "dilim"
  portion_g    numeric,                        -- one "porsiyon"
  liquid       boolean NOT NULL DEFAULT false,
  source       text NOT NULL DEFAULT 'curated_seed',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_food_reference_key ON food_reference (food_key);

ALTER TABLE food_reference ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='food_reference' AND policyname='fr_sel') THEN
    CREATE POLICY fr_sel ON food_reference FOR SELECT USING (true);
  END IF;
END $$;

INSERT INTO food_reference
  (food_key, aliases, kcal_100g, protein_100g, carbs_100g, fat_100g, piece_g, slice_g, portion_g, liquid)
VALUES
('beyaz pilav', '{"pilav","pirinç pilavı","pirinc pilavi","bulgur pilavı yerine"}', 130, 2.4, 28, 0.3, NULL, NULL, 180, false),
('bulgur pilavı', '{"bulgur","bulgur pilavi"}', 83, 3, 18, 0.2, NULL, NULL, 180, false),
('makarna', '{"makarna","spagetti","penne","erişte","eriste"}', 158, 5.8, 31, 0.9, NULL, NULL, 200, false),
('ekmek', '{"ekmek","beyaz ekmek","somun"}', 265, 9, 49, 3.2, NULL, 25, NULL, false),
('tam buğday ekmeği', '{"tam buğday ekmeği","tam bugday ekmek","kepekli ekmek","esmer ekmek"}', 247, 13, 41, 3.4, NULL, 28, NULL, false),
('simit', '{"simit","gevrek"}', 320, 9, 58, 5, 100, NULL, NULL, false),
('yulaf', '{"yulaf","yulaf ezmesi","oatmeal"}', 68, 2.4, 12, 1.4, NULL, NULL, 220, false),
('patates', '{"patates","haşlanmış patates","haslanmis patates","patates püresi","patates puresi"}', 87, 2, 20, 0.1, 150, NULL, 150, false),
('patates kızartması', '{"patates kızartması","patates kizartmasi","french fries","cips patates"}', 312, 3.4, 41, 15, NULL, NULL, 130, false),
('börek', '{"börek","borek","su böreği","sigara böreği","kıymalı börek"}', 300, 7, 30, 17, NULL, 120, NULL, false),
('pizza', '{"pizza"}', 266, 11, 33, 10, NULL, 120, NULL, false),
('lahmacun', '{"lahmacun"}', 240, 10, 33, 8, 130, NULL, NULL, false),
('mantı', '{"mantı","manti"}', 200, 8, 28, 6, NULL, NULL, 250, false),
('mercimek çorbası', '{"mercimek çorbası","mercimek corbasi","mercimek çorba"}', 55, 3, 8, 1.2, NULL, NULL, 250, true),
('mercimek', '{"mercimek","kırmızı mercimek","yeşil mercimek"}', 116, 9, 20, 0.4, NULL, NULL, 200, false),
('nohut', '{"nohut","nohut yemeği","humus değil"}', 164, 8.9, 27, 2.6, NULL, NULL, 200, false),
('kuru fasulye', '{"kuru fasulye","fasulye","barbunya"}', 130, 8, 22, 0.8, NULL, NULL, 220, false),
('çorba', '{"çorba","corba","tavuk çorbası","ezogelin","yayla çorbası"}', 50, 2.5, 7, 1.5, NULL, NULL, 250, true),
('tavuk göğsü', '{"tavuk göğsü","tavuk gogsu","tavuk","ızgara tavuk","izgara tavuk","tavuk eti"}', 165, 31, 0, 3.6, NULL, NULL, 150, false),
('tavuk but', '{"tavuk but","tavuk baget","tavuk kalça"}', 209, 26, 0, 11, NULL, NULL, 150, false),
('kırmızı et', '{"kırmızı et","kirmizi et","dana eti","biftek","bonfile","et"}', 250, 26, 0, 15, NULL, NULL, 150, false),
('kıyma', '{"kıyma","kiyma","kıymalı"}', 240, 26, 0, 15, NULL, NULL, 120, false),
('köfte', '{"köfte","kofte","ızgara köfte"}', 230, 18, 6, 15, 30, NULL, 150, false),
('kuzu eti', '{"kuzu eti","kuzu","kuzu pirzola"}', 294, 25, 0, 21, NULL, NULL, 150, false),
('balık', '{"balık","balik","levrek","çipura","cipura","hamsi","uskumru"}', 130, 22, 0, 4.5, NULL, NULL, 150, false),
('somon', '{"somon","salmon"}', 208, 20, 0, 13, NULL, NULL, 150, false),
('ton balığı', '{"ton balığı","ton baligi","tuna"}', 116, 26, 0, 1, NULL, NULL, 100, false),
('yumurta', '{"yumurta","haşlanmış yumurta","omlet","menemen yumurta","sahanda yumurta"}', 155, 13, 1.1, 11, 50, NULL, NULL, false),
('sucuk', '{"sucuk"}', 340, 20, 2, 28, NULL, 15, NULL, false),
('sosis', '{"sosis","sausage"}', 300, 12, 3, 27, 40, NULL, NULL, false),
('salam', '{"salam","jambon","pastırma","pastirma"}', 250, 18, 2, 19, NULL, 15, NULL, false),
('döner', '{"döner","doner","et döner","tavuk döner","dürüm"}', 215, 20, 5, 13, NULL, NULL, 150, false),
('süt', '{"süt","sut","yarım yağlı süt","tam yağlı süt"}', 61, 3.2, 4.8, 3.3, NULL, NULL, NULL, true),
('yoğurt', '{"yoğurt","yogurt"}', 61, 3.5, 4.7, 3.3, NULL, NULL, 200, false),
('süzme yoğurt', '{"süzme yoğurt","suzme yogurt","yunan yoğurdu","labne"}', 96, 9, 4, 5, NULL, NULL, 150, false),
('ayran', '{"ayran"}', 38, 2, 3, 1.8, NULL, NULL, NULL, true),
('beyaz peynir', '{"beyaz peynir","peynir","feta"}', 264, 14, 4, 21, NULL, NULL, 30, false),
('kaşar peyniri', '{"kaşar peyniri","kasar peyniri","kaşar","kasar"}', 330, 25, 2, 26, NULL, 20, NULL, false),
('lor peyniri', '{"lor peyniri","lor","çökelek"}', 98, 11, 3, 4.3, NULL, NULL, 60, false),
('kaymak', '{"kaymak"}', 330, 5, 3, 33, NULL, NULL, 30, false),
('tereyağı', '{"tereyağı","tereyag","tereyağ"}', 717, 0.9, 0.1, 81, NULL, NULL, 10, false),
('salata', '{"salata","mevsim salata","çoban salata","yeşil salata"}', 35, 1.5, 5, 1.2, NULL, NULL, 150, false),
('domates', '{"domates"}', 18, 0.9, 3.9, 0.2, 120, NULL, NULL, false),
('salatalık', '{"salatalık","salatalik","hıyar"}', 15, 0.7, 3.6, 0.1, 100, NULL, NULL, false),
('brokoli', '{"brokoli"}', 34, 2.8, 7, 0.4, NULL, NULL, 150, false),
('ıspanak', '{"ıspanak","ispanak"}', 23, 2.9, 3.6, 0.4, NULL, NULL, 150, false),
('sebze yemeği', '{"sebze yemeği","sebze yemegi","zeytinyağlı","türlü","turlu"}', 80, 2, 9, 4, NULL, NULL, 200, false),
('çorba sebzeli', '{"sebze çorbası","sebze corbasi"}', 45, 1.8, 7, 1.2, NULL, NULL, 250, true),
('zeytin', '{"zeytin","siyah zeytin","yeşil zeytin"}', 145, 1, 6, 13, 4, NULL, NULL, false),
('elma', '{"elma"}', 52, 0.3, 14, 0.2, 150, NULL, NULL, false),
('muz', '{"muz"}', 89, 1.1, 23, 0.3, 120, NULL, NULL, false),
('portakal', '{"portakal"}', 47, 0.9, 12, 0.1, 150, NULL, NULL, false),
('mandalina', '{"mandalina"}', 53, 0.8, 13, 0.3, 90, NULL, NULL, false),
('üzüm', '{"üzüm","uzum"}', 69, 0.7, 18, 0.2, NULL, NULL, 100, false),
('çilek', '{"çilek","cilek"}', 32, 0.7, 7.7, 0.3, NULL, NULL, 100, false),
('karpuz', '{"karpuz"}', 30, 0.6, 8, 0.2, NULL, NULL, 200, false),
('kavun', '{"kavun"}', 34, 0.8, 8, 0.2, NULL, NULL, 200, false),
('armut', '{"armut"}', 57, 0.4, 15, 0.1, 160, NULL, NULL, false),
('şeftali', '{"şeftali","seftali"}', 39, 0.9, 10, 0.3, 150, NULL, NULL, false),
('kayısı', '{"kayısı","kayisi"}', 48, 1.4, 11, 0.4, 35, NULL, NULL, false),
('avokado', '{"avokado","avocado"}', 160, 2, 9, 15, 150, NULL, NULL, false),
('fındık', '{"fındık","findik"}', 628, 15, 17, 61, NULL, NULL, 25, false),
('ceviz', '{"ceviz"}', 654, 15, 14, 65, NULL, NULL, 25, false),
('badem', '{"badem"}', 579, 21, 22, 50, NULL, NULL, 25, false),
('fıstık', '{"fıstık","fistik","yer fıstığı","antep fıstığı"}', 567, 26, 16, 49, NULL, NULL, 25, false),
('fıstık ezmesi', '{"fıstık ezmesi","fistik ezmesi","peanut butter"}', 588, 25, 20, 50, NULL, NULL, 20, false),
('cips', '{"cips","patates cipsi"}', 536, 7, 53, 34, NULL, NULL, 30, false),
('çikolata', '{"çikolata","cikolata","sütlü çikolata","bitter çikolata"}', 546, 7.6, 59, 31, NULL, NULL, 30, false),
('bisküvi', '{"bisküvi","biskuvi","kraker"}', 480, 7, 65, 20, 8, NULL, NULL, false),
('kek', '{"kek","pasta","cake"}', 350, 5, 50, 15, NULL, 80, NULL, false),
('baklava', '{"baklava"}', 430, 6, 50, 24, 50, NULL, NULL, false),
('sütlaç', '{"sütlaç","sutlac"}', 130, 3.5, 22, 3, NULL, NULL, 150, false),
('dondurma', '{"dondurma","ice cream"}', 207, 3.5, 24, 11, NULL, NULL, 100, false),
('bal', '{"bal","honey"}', 304, 0.3, 82, 0, NULL, NULL, 20, false),
('reçel', '{"reçel","recel","marmelat"}', 250, 0.4, 65, 0.1, NULL, NULL, 20, false),
('çay', '{"çay","cay","siyah çay","yeşil çay","bitki çayı"}', 1, 0, 0.2, 0, NULL, NULL, NULL, true),
('kahve', '{"kahve","türk kahvesi","filtre kahve","americano","espresso"}', 2, 0.1, 0, 0, NULL, NULL, NULL, true),
('sütlü kahve', '{"sütlü kahve","latte","cappuccino","kapuçino"}', 40, 2, 4, 1.5, NULL, NULL, NULL, true),
('kola', '{"kola","cola","gazoz","meşrubat"}', 42, 0, 10.6, 0, NULL, NULL, NULL, true),
('meyve suyu', '{"meyve suyu","portakal suyu","elma suyu"}', 45, 0.2, 11, 0.1, NULL, NULL, NULL, true),
('bira', '{"bira","beer"}', 43, 0.5, 3.6, 0, NULL, NULL, NULL, true),
('şarap', '{"şarap","sarap","wine"}', 83, 0.1, 2.6, 0, NULL, NULL, NULL, true),
('rakı', '{"rakı","raki","votka","viski","cin"}', 231, 0, 0, 0, NULL, NULL, NULL, true)
ON CONFLICT (food_key) DO NOTHING;

SELECT count(*) AS food_rows FROM food_reference;

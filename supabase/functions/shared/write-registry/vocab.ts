/**
 * write-registry/vocab.ts — every closed vocabulary a chat write can carry, with its Turkish
 * meaning (AI_MIMARI_V2 §4.1). Ids are what the DB stores; labels are what the model and the
 * user read. Replaces the scattered copies: PROFILE_ENUM_WHITELIST, CANONICAL_GOAL_TYPES,
 * VALID_MEAL_TYPES, the TR→EN injury maps and goal_suggestion's Turkish keys.
 *
 * The model picks an id from these lists; it can no longer send 'diz' where code compares 'knee'
 * (map-writes #29) or a Turkish goal key the other writer rejects (#40).
 */

/** Allergen taxonomy: EU/TR 14 + tree-nut subtypes. Free-form allergens go as `custom:<ad>`. */
export const ALLERGENS = {
  gluten: 'gluten (buğday, arpa, çavdar, yulaf)',
  crustacean: 'kabuklu deniz ürünü (karides, yengeç, ıstakoz, krill)',
  egg: 'yumurta',
  fish: 'balık',
  peanut: 'yer fıstığı',
  soy: 'soya',
  milk: 'süt ve süt ürünleri',
  tree_nut: 'sert kabuklu yemiş (genel)',
  hazelnut: 'fındık',
  walnut: 'ceviz',
  almond: 'badem',
  pistachio: 'antep fıstığı',
  cashew: 'kaju',
  celery: 'kereviz',
  mustard: 'hardal',
  sesame: 'susam',
  sulphite: 'sülfit',
  lupin: 'acı bakla (lupin)',
  mollusc: 'yumuşakça (midye, kalamar, ahtapot)',
} as const;
export type AllergenId = keyof typeof ALLERGENS;

/**
 * Stage A doc hints, ONLY for allergen ids whose Turkish word is not an obvious translation
 * (yer fıstığı vs antep fıstığı, krill → crustacean, acı bakla → lupin). The rest (egg, milk,
 * sesame, hazelnut…) the model maps itself; listing their Turkish names would only spend the
 * cached-prefix budget (§4.1). Labels for users stay in ALLERGENS.
 */
export const ALLERGEN_DOC_HINTS: Readonly<Partial<Record<AllergenId, string>>> = {
  gluten: 'buğday, arpa, çavdar, yulaf',
  crustacean: 'karides, yengeç, ıstakoz, krill',
  peanut: 'yer fıstığı',
  tree_nut: 'sert kabuklu, türü belirsiz',
  pistachio: 'antep fıstığı',
  lupin: 'acı bakla',
  mollusc: 'midye, kalamar, ahtapot',
};

/** Body regions an injury can affect / an exercise can load (ids = guardrails INJURY_KEYWORDS keys). */
export const BODY_PARTS = {
  knee: 'diz',
  back: 'sırt/bel',
  shoulder: 'omuz',
  ankle: 'ayak bileği',
  wrist: 'el bileği',
  elbow: 'dirsek',
  hip: 'kalça',
  neck: 'boyun',
  hamstring: 'arka bacak',
  quad: 'ön bacak',
  groin: 'kasık',
} as const;
export type BodyPartId = keyof typeof BODY_PARTS;

export const MEAL_TYPES = { breakfast: 'kahvaltı', lunch: 'öğle', dinner: 'akşam', snack: 'ara öğün' } as const;

export const WORKOUT_TYPES = {
  cardio: 'kardiyo (koşu, bisiklet, yürüyüş)',
  strength: 'ağırlık/kuvvet',
  flexibility: 'esneme, yoga, pilates',
  sports: 'takım/raket sporu, yüzme maçı vb.',
  mixed: 'karışık',
} as const;

export const INTENSITY = { low: 'hafif', moderate: 'orta', high: 'yüksek' } as const;

export const GENDER = { male: 'erkek', female: 'kadın', other: 'diğer' } as const;

export const ACTIVITY_LEVEL = {
  sedentary: 'hareketsiz (masa başı)',
  light: 'az hareketli',
  moderate: 'orta hareketli',
  active: 'hareketli',
  very_active: 'çok hareketli',
} as const;

/** goals.goal_type CHECK (migration 001) — the ONE goal vocabulary. */
export const GOAL_TYPES = {
  lose_weight: 'kilo vermek',
  gain_weight: 'kilo almak',
  gain_muscle: 'kas kazanmak',
  health: 'sağlık',
  maintain: 'kilosunu korumak',
  conditioning: 'kondisyon',
} as const;
export type GoalType = keyof typeof GOAL_TYPES;

export const CONSTRAINT_KINDS = {
  allergen: 'alerji',
  intolerance: 'intolerans',
  injury: 'sakatlık',
  surgery: 'ameliyat',
  condition: 'hastalık/kronik durum',
  medication: 'ilaç',
  dietary: 'beslenme kısıtı (vegan, helal…)',
} as const;
export type ConstraintKindId = keyof typeof CONSTRAINT_KINDS;

/** Canonical dietary subjects (multi-valued now: vegan + glutensiz can both be true). */
export const DIETARY_SUBJECTS = {
  vegan: 'vegan',
  vegetarian: 'vejetaryen',
  pescatarian: 'pesketaryen',
  halal: 'helal',
  kosher: 'koşer',
  gluten_free: 'glutensiz',
  lactose_free: 'laktozsuz',
} as const;

export const SEVERITY = {
  mild: 'hafif',
  moderate: 'orta',
  severe: 'ciddi (anafilaksi/ameliyat riski)',
  unknown: 'bilinmiyor — netleşene kadar ciddi sayılır',
} as const;

export const FOOD_PREFERENCE = {
  love: 'çok seviyor',
  like: 'seviyor',
  can_cook: 'yapabiliyor',
  dislike: 'sevmiyor',
  never: 'asla yemez (alerji değil)',
} as const;

export const LIFE_EVENT_TYPES = {
  wedding: 'düğün',
  engagement: 'nişan',
  vacation: 'tatil',
  beach: 'plaj/yaz',
  graduation: 'mezuniyet',
  birthday: 'doğum günü',
  reunion: 'buluşma',
  exam: 'sınav',
  photoshoot: 'çekim',
  competition: 'yarışma',
  other: 'diğer',
} as const;

/** profiles.periodic_state CHECK (migration 070) minus the program states owned by target_change. */
export const PERIODIC_STATES = {
  ramadan: 'ramazan/oruç',
  holiday: 'bayram/tatil dönemi',
  illness: 'hastalık',
  busy_work: 'yoğun iş dönemi',
  exam: 'sınav dönemi',
  pregnancy: 'hamilelik',
  breastfeeding: 'emzirme',
  injury: 'sakatlık dönemi',
  travel: 'seyahat',
  custom: 'diğer dönem',
  none: 'dönem bitti (temizle)',
} as const;

export const PLATEAU_STRATEGIES = {
  calorie_cycle: 'kalori döngüsü',
  refeed: 'refeed günü',
  tdee_recalc: 'TDEE yeniden hesap',
  maintenance_break: 'bakım molası',
  training_change: 'antrenman değişikliği',
} as const;

export const LAB_STATUS = { low: 'düşük', normal: 'normal', high: 'yüksek', unknown: 'belirtilmedi' } as const;

export const COMMITMENT_OUTCOMES = { kept: 'yaptı', missed: 'yapamadı', partial: 'kısmen' } as const;

export const RECIPE_CATEGORIES = MEAL_TYPES;

/** Shared enum vocabularies for profile columns (DB CHECK or ai-extractor canonical set). */
export const FREQUENCY = { never: 'hiç', rare: 'nadiren', weekly: 'haftalık', frequent: 'sık' } as const;
export const LEVEL_3 = { low: 'düşük', moderate: 'orta', high: 'yüksek' } as const;
export const SLEEP_QUALITY = { good: 'iyi', ok: 'idare eder', bad: 'kötü' } as const;

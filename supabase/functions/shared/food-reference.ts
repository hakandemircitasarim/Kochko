/**
 * food-reference.ts — deterministic Turkish food nutrition (target-architecture step 7).
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Today every logged meal's calories/macros are HALLUCINATED fresh by the LLM. Over a months-long
 * journey those per-meal estimate errors accumulate into the deficit ledger — the one number the
 * whole coaching arc is optimising — so the coach can be confidently, cumulatively wrong. The LLM
 * should MAP food text → a canonical food and SCALE by portion, not invent the chemistry.
 *
 * This module is the deterministic calculator: resolveFood(text) → canonical per-100g macros;
 * parsePortionToGrams(text) → grams via Turkish household measures; computeItemNutrition() →
 * kcal = grams/100 × per100g, done in code. Unresolved foods fall back to the model estimate,
 * tagged so the uncertainty is visible rather than laundered into false precision.
 *
 * Code is authoritative + fail-safe (no per-item DB round-trip). Migration 083 mirrors this seed
 * into food_reference / household_portions as the future growth + import surface.
 *
 * Values are per 100 g edible portion, cooked where a food is normally eaten cooked (pilav, makarna,
 * tavuk…). Sources: TÜRKOMP + USDA FDC rounded to whole numbers. This is a curated HEAD of the
 * distribution (the ~100 foods that cover most Turkish logging), not a complete database.
 */

export interface Per100g { kcal: number; p: number; c: number; f: number }
export interface FoodEntry {
  key: string;            // canonical Turkish name
  aliases: string[];      // spelling / inflection variants matched on
  per100g: Per100g;
  pieceG?: number;        // weight of one "adet/tane" (egg 50, apple 150…)
  sliceG?: number;        // weight of one "dilim" (bread 25, pizza 120…)
  portionG?: number;      // weight of one "porsiyon" if not the default
  mlPerCup?: number;      // for liquids: a "bardak" is this many ml (default 200)
  densityGperMl?: number; // liquid density (water/juice ~1.0, milk ~1.03, oil ~0.92)
  liquid?: boolean;
}

const F = (
  key: string, aliases: string[], kcal: number, p: number, c: number, f: number,
  extra: Partial<FoodEntry> = {},
): FoodEntry => ({ key, aliases, per100g: { kcal, p, c, f }, ...extra });

/** Curated seed. Keep names lowercase Turkish; aliases carry common misspellings/inflection stems. */
const FOODS: FoodEntry[] = [
  // ── Staples / grains (cooked) ──
  F('beyaz pilav', ['pilav', 'pirinç pilavı', 'pirinc pilavi', 'bulgur pilavı yerine'], 130, 2.4, 28, 0.3, { portionG: 180 }),
  F('bulgur pilavı', ['bulgur', 'bulgur pilavi'], 83, 3, 18, 0.2, { portionG: 180 }),
  F('makarna', ['makarna', 'spagetti', 'penne', 'erişte', 'eriste'], 158, 5.8, 31, 0.9, { portionG: 200 }),
  F('ekmek', ['ekmek', 'beyaz ekmek', 'somun'], 265, 9, 49, 3.2, { sliceG: 25 }),
  F('tam buğday ekmeği', ['tam buğday ekmeği', 'tam bugday ekmek', 'kepekli ekmek', 'esmer ekmek'], 247, 13, 41, 3.4, { sliceG: 28 }),
  F('simit', ['simit', 'gevrek'], 320, 9, 58, 5, { pieceG: 100 }),
  F('yulaf', ['yulaf', 'yulaf ezmesi', 'oatmeal'], 68, 2.4, 12, 1.4, { portionG: 220 }),
  F('patates', ['patates', 'haşlanmış patates', 'haslanmis patates', 'patates püresi', 'patates puresi'], 87, 2, 20, 0.1, { pieceG: 150, portionG: 150 }),
  F('patates kızartması', ['patates kızartması', 'patates kizartmasi', 'french fries', 'cips patates'], 312, 3.4, 41, 15, { portionG: 130 }),
  F('börek', ['börek', 'borek', 'su böreği', 'sigara böreği', 'kıymalı börek'], 300, 7, 30, 17, { sliceG: 120 }),
  F('pizza', ['pizza'], 266, 11, 33, 10, { sliceG: 120 }),
  F('lahmacun', ['lahmacun'], 240, 10, 33, 8, { pieceG: 130 }),
  F('mantı', ['mantı', 'manti'], 200, 8, 28, 6, { portionG: 250 }),

  // ── Legumes / soups ──
  F('mercimek çorbası', ['mercimek çorbası', 'mercimek corbasi', 'mercimek çorba'], 55, 3, 8, 1.2, { liquid: true, portionG: 250 }),
  F('mercimek', ['mercimek', 'kırmızı mercimek', 'yeşil mercimek'], 116, 9, 20, 0.4, { portionG: 200 }),
  F('nohut', ['nohut', 'nohut yemeği', 'humus değil'], 164, 8.9, 27, 2.6, { portionG: 200 }),
  F('kuru fasulye', ['kuru fasulye', 'fasulye', 'barbunya'], 130, 8, 22, 0.8, { portionG: 220 }),
  F('çorba', ['çorba', 'corba', 'tavuk çorbası', 'ezogelin', 'yayla çorbası'], 50, 2.5, 7, 1.5, { liquid: true, portionG: 250 }),

  // ── Protein / meat / fish ──
  F('tavuk göğsü', ['tavuk göğsü', 'tavuk gogsu', 'tavuk', 'ızgara tavuk', 'izgara tavuk', 'tavuk eti'], 165, 31, 0, 3.6, { portionG: 150 }),
  F('tavuk but', ['tavuk but', 'tavuk baget', 'tavuk kalça'], 209, 26, 0, 11, { portionG: 150 }),
  F('kırmızı et', ['kırmızı et', 'kirmizi et', 'dana eti', 'biftek', 'bonfile', 'et'], 250, 26, 0, 15, { portionG: 150 }),
  F('kıyma', ['kıyma', 'kiyma', 'kıymalı'], 240, 26, 0, 15, { portionG: 120 }),
  F('köfte', ['köfte', 'kofte', 'ızgara köfte'], 230, 18, 6, 15, { pieceG: 30, portionG: 150 }),
  F('kuzu eti', ['kuzu eti', 'kuzu', 'kuzu pirzola'], 294, 25, 0, 21, { portionG: 150 }),
  F('balık', ['balık', 'balik', 'levrek', 'çipura', 'cipura', 'hamsi', 'uskumru'], 130, 22, 0, 4.5, { portionG: 150 }),
  F('somon', ['somon', 'salmon'], 208, 20, 0, 13, { portionG: 150 }),
  F('ton balığı', ['ton balığı', 'ton baligi', 'tuna'], 116, 26, 0, 1, { portionG: 100 }),
  F('yumurta', ['yumurta', 'haşlanmış yumurta', 'omlet', 'menemen yumurta', 'sahanda yumurta'], 155, 13, 1.1, 11, { pieceG: 50 }),
  F('sucuk', ['sucuk'], 340, 20, 2, 28, { sliceG: 15 }),
  F('sosis', ['sosis', 'sausage'], 300, 12, 3, 27, { pieceG: 40 }),
  F('salam', ['salam', 'jambon', 'pastırma', 'pastirma'], 250, 18, 2, 19, { sliceG: 15 }),
  F('döner', ['döner', 'doner', 'et döner', 'tavuk döner', 'dürüm'], 215, 20, 5, 13, { portionG: 150 }),

  // ── Dairy ──
  F('süt', ['süt', 'sut', 'yarım yağlı süt', 'tam yağlı süt'], 61, 3.2, 4.8, 3.3, { liquid: true, densityGperMl: 1.03, mlPerCup: 200 }),
  F('yoğurt', ['yoğurt', 'yogurt'], 61, 3.5, 4.7, 3.3, { portionG: 200 }),
  F('süzme yoğurt', ['süzme yoğurt', 'suzme yogurt', 'yunan yoğurdu', 'labne'], 96, 9, 4, 5, { portionG: 150 }),
  F('ayran', ['ayran'], 38, 2, 3, 1.8, { liquid: true, mlPerCup: 200 }),
  F('beyaz peynir', ['beyaz peynir', 'peynir', 'feta'], 264, 14, 4, 21, { portionG: 30 }),
  F('kaşar peyniri', ['kaşar peyniri', 'kasar peyniri', 'kaşar', 'kasar'], 330, 25, 2, 26, { sliceG: 20 }),
  F('lor peyniri', ['lor peyniri', 'lor', 'çökelek'], 98, 11, 3, 4.3, { portionG: 60 }),
  F('kaymak', ['kaymak'], 330, 5, 3, 33, { portionG: 30 }),
  F('tereyağı', ['tereyağı', 'tereyag', 'tereyağ'], 717, 0.9, 0.1, 81, { portionG: 10 }),

  // ── Vegetables ──
  F('salata', ['salata', 'mevsim salata', 'çoban salata', 'yeşil salata'], 35, 1.5, 5, 1.2, { portionG: 150 }),
  F('domates', ['domates'], 18, 0.9, 3.9, 0.2, { pieceG: 120 }),
  F('salatalık', ['salatalık', 'salatalik', 'hıyar'], 15, 0.7, 3.6, 0.1, { pieceG: 100 }),
  F('brokoli', ['brokoli'], 34, 2.8, 7, 0.4, { portionG: 150 }),
  F('ıspanak', ['ıspanak', 'ispanak'], 23, 2.9, 3.6, 0.4, { portionG: 150 }),
  F('sebze yemeği', ['sebze yemeği', 'sebze yemegi', 'zeytinyağlı', 'türlü', 'turlu'], 80, 2, 9, 4, { portionG: 200 }),
  F('çorba sebzeli', ['sebze çorbası', 'sebze corbasi'], 45, 1.8, 7, 1.2, { liquid: true, portionG: 250 }),
  F('zeytin', ['zeytin', 'siyah zeytin', 'yeşil zeytin'], 145, 1, 6, 13, { pieceG: 4 }),

  // ── Fruit ──
  F('elma', ['elma'], 52, 0.3, 14, 0.2, { pieceG: 150 }),
  F('muz', ['muz'], 89, 1.1, 23, 0.3, { pieceG: 120 }),
  F('portakal', ['portakal'], 47, 0.9, 12, 0.1, { pieceG: 150 }),
  F('mandalina', ['mandalina'], 53, 0.8, 13, 0.3, { pieceG: 90 }),
  F('üzüm', ['üzüm', 'uzum'], 69, 0.7, 18, 0.2, { portionG: 100 }),
  F('çilek', ['çilek', 'cilek'], 32, 0.7, 7.7, 0.3, { portionG: 100 }),
  F('karpuz', ['karpuz'], 30, 0.6, 8, 0.2, { portionG: 200 }),
  F('kavun', ['kavun'], 34, 0.8, 8, 0.2, { portionG: 200 }),
  F('armut', ['armut'], 57, 0.4, 15, 0.1, { pieceG: 160 }),
  F('şeftali', ['şeftali', 'seftali'], 39, 0.9, 10, 0.3, { pieceG: 150 }),
  F('kayısı', ['kayısı', 'kayisi'], 48, 1.4, 11, 0.4, { pieceG: 35 }),
  F('avokado', ['avokado', 'avocado'], 160, 2, 9, 15, { pieceG: 150 }),

  // ── Nuts / snacks / sweets ──
  F('fındık', ['fındık', 'findik'], 628, 15, 17, 61, { portionG: 25 }),
  F('ceviz', ['ceviz'], 654, 15, 14, 65, { portionG: 25 }),
  F('badem', ['badem'], 579, 21, 22, 50, { portionG: 25 }),
  F('fıstık', ['fıstık', 'fistik', 'yer fıstığı', 'antep fıstığı'], 567, 26, 16, 49, { portionG: 25 }),
  F('fıstık ezmesi', ['fıstık ezmesi', 'fistik ezmesi', 'peanut butter'], 588, 25, 20, 50, { portionG: 20 }),
  F('cips', ['cips', 'patates cipsi'], 536, 7, 53, 34, { portionG: 30 }),
  F('çikolata', ['çikolata', 'cikolata', 'sütlü çikolata', 'bitter çikolata'], 546, 7.6, 59, 31, { portionG: 30 }),
  F('bisküvi', ['bisküvi', 'biskuvi', 'kraker'], 480, 7, 65, 20, { pieceG: 8 }),
  F('kek', ['kek', 'pasta', 'cake'], 350, 5, 50, 15, { sliceG: 80 }),
  F('baklava', ['baklava'], 430, 6, 50, 24, { pieceG: 50 }),
  F('sütlaç', ['sütlaç', 'sutlac'], 130, 3.5, 22, 3, { portionG: 150 }),
  F('dondurma', ['dondurma', 'ice cream'], 207, 3.5, 24, 11, { portionG: 100 }),
  F('bal', ['bal', 'honey'], 304, 0.3, 82, 0, { portionG: 20 }),
  F('reçel', ['reçel', 'recel', 'marmelat'], 250, 0.4, 65, 0.1, { portionG: 20 }),

  // ── Drinks ──
  F('çay', ['çay', 'cay', 'siyah çay', 'yeşil çay', 'bitki çayı'], 1, 0, 0.2, 0, { liquid: true, mlPerCup: 100 }),
  F('kahve', ['kahve', 'türk kahvesi', 'filtre kahve', 'americano', 'espresso'], 2, 0.1, 0, 0, { liquid: true, mlPerCup: 100 }),
  F('sütlü kahve', ['sütlü kahve', 'latte', 'cappuccino', 'kapuçino'], 40, 2, 4, 1.5, { liquid: true, mlPerCup: 200 }),
  F('kola', ['kola', 'cola', 'gazoz', 'meşrubat'], 42, 0, 10.6, 0, { liquid: true, mlPerCup: 200 }),
  F('meyve suyu', ['meyve suyu', 'portakal suyu', 'elma suyu'], 45, 0.2, 11, 0.1, { liquid: true, mlPerCup: 200 }),
  F('bira', ['bira', 'beer'], 43, 0.5, 3.6, 0, { liquid: true, mlPerCup: 330 }),
  F('şarap', ['şarap', 'sarap', 'wine'], 83, 0.1, 2.6, 0, { liquid: true, mlPerCup: 150 }),
  F('rakı', ['rakı', 'raki', 'votka', 'viski', 'cin'], 231, 0, 0, 0, { liquid: true, mlPerCup: 50 }),
];

// Build an alias → entry index once (module load).
const ALIAS_INDEX = new Map<string, FoodEntry>();
for (const food of FOODS) {
  for (const a of [food.key, ...food.aliases]) ALIAS_INDEX.set(normalizeName(a), food);
}

/** Lowercase (tr), strip punctuation, collapse whitespace. */
export function normalizeName(s: string): string {
  return (s ?? '')
    .toLocaleLowerCase('tr')
    .replace(/[^a-zçğıöşü0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip common Turkish noun suffixes to a comparison stem (light; enough for food matching). */
function stem(word: string): string {
  return word.replace(/(ları|leri|lar|ler|ımız|imiz|umuz|ümüz|ını|ini|unu|ünü|ıyla|iyle|nın|nin|nun|nün|ından|inden|dan|den|tan|ten|da|de|ta|te|ı|i|u|ü|a|e|sı|si|su|sü|lı|li|lu|lü)$/u, '');
}

/**
 * Resolve free food text → a canonical FoodEntry, or null. Tries: exact alias, then token-level
 * alias hit (so "ızgara tavuk göğsü" resolves via "tavuk göğsü"), then stemmed token match.
 */
export function resolveFood(text: string): FoodEntry | null {
  const norm = normalizeName(text);
  if (!norm) return null;
  const direct = ALIAS_INDEX.get(norm);
  if (direct) return direct;

  // Longest multi-word alias contained in the text wins (prefer 'tavuk göğsü' over 'tavuk').
  let best: FoodEntry | null = null;
  let bestLen = 0;
  for (const [alias, food] of ALIAS_INDEX) {
    if (alias.includes(' ') && norm.includes(alias) && alias.length > bestLen) { best = food; bestLen = alias.length; }
  }
  if (best) return best;

  // Single-token match (exact or stemmed) — require a whole-word hit, not substring.
  const tokens = norm.split(' ');
  const tokenSet = new Set(tokens);
  const stemSet = new Set(tokens.map(stem));
  for (const [alias, food] of ALIAS_INDEX) {
    if (alias.includes(' ')) continue;
    if (tokenSet.has(alias) || stemSet.has(stem(alias))) return food;
  }
  return null;
}

const NUM_WORDS: Record<string, number> = {
  'yarım': 0.5, 'yarim': 0.5, 'çeyrek': 0.25, 'ceyrek': 0.25,
  'bir': 1, 'birbuçuk': 1.5, 'bir buçuk': 1.5, 'iki': 2, 'üç': 3, 'uc': 3,
  'dört': 4, 'dort': 4, 'beş': 5, 'bes': 5, 'altı': 6, 'alti': 6,
  'yedi': 7, 'sekiz': 8, 'dokuz': 9, 'on': 10,
};

/** Parse a leading count from portion text ("2", "iki", "yarım", "1.5"). Default 1. */
function parseCount(norm: string): number {
  const numMatch = norm.match(/(\d+[.,]?\d*)/);
  if (numMatch) return parseFloat(numMatch[1].replace(',', '.'));
  for (const [w, n] of Object.entries(NUM_WORDS)) if (new RegExp('(^|\\s)' + w + '(\\s|$)').test(norm)) return n;
  return 1;
}

const SIZE_MULT: Record<string, number> = { 'küçük': 0.7, 'kucuk': 0.7, 'orta': 1.0, 'büyük': 1.4, 'buyuk': 1.4, 'kocaman': 1.6 };

/**
 * Convert a portion phrase for a resolved food into grams. Handles explicit weight (gram/kg),
 * volume for liquids (ml/litre/bardak/kupa), and Turkish household units (dilim/adet/kaşık/kase/
 * tabak/avuç/porsiyon) scaled by a leading count + size word. Falls back to the food's default
 * portion when the unit is unrecognised.
 */
export function parsePortionToGrams(portionText: string, food: FoodEntry): number {
  const norm = normalizeName(portionText);
  const count = parseCount(norm);
  let sizeMult = 1;
  for (const [w, m] of Object.entries(SIZE_MULT)) if (norm.includes(w)) sizeMult = m;

  // Explicit weight
  const kg = norm.match(/(\d+[.,]?\d*)\s*(kg|kilo)/);
  if (kg) return parseFloat(kg[1].replace(',', '.')) * 1000;
  const g = norm.match(/(\d+[.,]?\d*)\s*(gram|gr|g)\b/);
  if (g) return parseFloat(g[1].replace(',', '.'));

  // Explicit volume (liquids)
  const density = food.densityGperMl ?? 1.0;
  const lt = norm.match(/(\d+[.,]?\d*)\s*(litre|lt|l)\b/);
  if (lt) return parseFloat(lt[1].replace(',', '.')) * 1000 * density;
  const ml = norm.match(/(\d+[.,]?\d*)\s*(ml|mililitre)/);
  if (ml) return parseFloat(ml[1].replace(',', '.')) * density;

  const cupMl = food.mlPerCup ?? 200;
  const has = (u: string) => new RegExp('(^|\\s)' + u).test(norm);

  // Volume-ish household units
  if (has('su bardağı') || has('su bardagi')) return count * 200 * density;
  if (has('çay bardağı') || has('cay bardagi')) return count * 100 * density;
  if (has('kupa') || has('mug')) return count * 250 * density;
  if (has('bardak')) return count * cupMl * density;
  if (has('şişe') || has('sise')) return count * 500 * density;
  if (has('yemek kaşığı') || has('yemek kasigi')) return count * 15;
  if (has('tatlı kaşığı') || has('tatli kasigi')) return count * 8;
  if (has('çay kaşığı') || has('cay kasigi')) return count * 5;
  if (has('kaşık') || has('kasik')) return count * 15;

  // Solid household units
  if (has('dilim')) return count * (food.sliceG ?? 30) * sizeMult;
  if (has('adet') || has('tane')) return count * (food.pieceG ?? food.portionG ?? 100) * sizeMult;
  if (has('kase') || has('kâse')) return count * 250;
  if (has('tabak')) return count * (food.portionG ? food.portionG * 1.6 : 350);
  if (has('avuç') || has('avuc')) return count * 30;
  if (has('porsiyon')) return count * (food.portionG ?? 200) * sizeMult;

  // Bare count of a piece-food ("2 muz", "3 yumurta")
  if (food.pieceG && /(^|\s)(\d+|bir|iki|üç|uc|dört|dort|beş|bes|yarım|yarim)(\s|$)/.test(norm)) {
    return count * food.pieceG * sizeMult;
  }

  // Fallback: one default portion × count.
  const base = food.portionG ?? (food.liquid ? cupMl * density : 100);
  return count * base * sizeMult;
}

export interface ComputedNutrition {
  calories: number; protein_g: number; carbs_g: number; fat_g: number;
  grams: number; foodKey: string; source: 'reference';
}

/**
 * Deterministic per-item nutrition from canonical data. Returns null when the food can't be
 * resolved (caller keeps the model estimate). kcal = grams/100 × per100g — computed in code.
 */
export function computeItemNutrition(name: string, portionText: string): ComputedNutrition | null {
  const food = resolveFood(name);
  if (!food) return null;
  const grams = Math.max(0, parsePortionToGrams(portionText || '', food));
  if (grams <= 0) return null;
  const factor = grams / 100;
  const r = (v: number, d = 0) => Math.round(v * factor * (d ? 10 : 1)) / (d ? 10 : 1);
  return {
    calories: Math.round(food.per100g.kcal * factor),
    protein_g: r(food.per100g.p, 1),
    carbs_g: r(food.per100g.c, 1),
    fat_g: r(food.per100g.f, 1),
    grams: Math.round(grams),
    foodKey: food.key,
    source: 'reference',
  };
}

/** For seeding the DB mirror / audit. */
export function allFoods(): FoodEntry[] { return FOODS; }

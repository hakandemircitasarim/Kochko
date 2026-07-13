/**
 * Meal Prep Service
 * Spec 7.6: Toplu hazırlık planı
 *
 * Generates batch cooking plans, optimizes prep order,
 * consolidates shopping lists, tracks storage durations.
 */
import { supabase } from '@/lib/supabase';

export interface PrepItem {
  recipeName: string;
  quantity: string;
  storageDays: number;
  storageMethod: StorageMethod;
  storageInstructions: string;
  targetMeals: string[];
  prepTimeMin: number;
  cookTimeMin: number;
}

export type StorageMethod = 'fridge' | 'freezer' | 'room_temp';

export interface MealPrepPlan {
  prepDay: string;
  items: PrepItem[];
  prepOrder: PrepOrderStep[];
  totalPrepTime: number;
  totalCookTime: number;
  shoppingList: ConsolidatedItem[];
  containerSuggestion: ContainerSuggestion;
}

export interface PrepOrderStep {
  order: number;
  action: string;
  durationMin: number;
  reason_tr: string;
}

export interface ConsolidatedItem {
  item: string;
  totalAmount: string;
  category: 'protein' | 'sebze' | 'meyve' | 'tahil' | 'sut_urunleri' | 'yag' | 'baharat' | 'diger';
}

export interface ContainerSuggestion {
  totalContainers: number;
  largeContainers: number; // 1L+
  mediumContainers: number; // 500ml
  smallContainers: number; // 250ml
  note_tr: string;
}

// ─── Storage Duration Database ───

interface StorageInfo {
  fridge: number;  // days
  freezer: number; // days
  room_temp: number; // days
}

const STORAGE_TABLE: Record<string, StorageInfo> = {
  // Proteins
  tavuk: { fridge: 3, freezer: 90, room_temp: 0 },
  kiyma: { fridge: 2, freezer: 90, room_temp: 0 },
  balik: { fridge: 2, freezer: 60, room_temp: 0 },
  yumurta: { fridge: 7, freezer: 0, room_temp: 1 },
  kuru_baklagil: { fridge: 5, freezer: 90, room_temp: 0 },
  tofu: { fridge: 5, freezer: 60, room_temp: 0 },

  // Grains
  pirinc: { fridge: 5, freezer: 90, room_temp: 0 },
  makarna: { fridge: 4, freezer: 60, room_temp: 0 },
  bulgur: { fridge: 5, freezer: 90, room_temp: 0 },
  ekmek: { fridge: 7, freezer: 90, room_temp: 3 },

  // Vegetables
  salata: { fridge: 1, freezer: 0, room_temp: 0 },
  pismis_sebze: { fridge: 4, freezer: 60, room_temp: 0 },
  corba: { fridge: 5, freezer: 90, room_temp: 0 },
  sos: { fridge: 7, freezer: 90, room_temp: 0 },

  // General
  varsayilan: { fridge: 3, freezer: 60, room_temp: 0 },
};

// ─── Core Functions ───

export async function getMealPrepPrefs(userId: string): Promise<{
  active: boolean;
  prepDays: number[];
}> {
  const { data } = await supabase
    .from('profiles')
    .select('meal_prep_active, meal_prep_days')
    .eq('id', userId)
    .single();

  return {
    active: data?.meal_prep_active ?? false,
    prepDays: (data?.meal_prep_days as number[]) ?? [0],
  };
}

export async function setMealPrepPrefs(
  userId: string,
  active: boolean,
  prepDays: number[] = [0],
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ meal_prep_active: active, meal_prep_days: prepDays })
    .eq('id', userId);
  return { error: error?.message ?? null };
}

// ─── Dish classification heuristics (drive storage + timing per dish name) ───

const DISH_RULES: { match: RegExp; storageKey: string; prepTimeMin: number; cookTimeMin: number }[] = [
  { match: /çorba|corba/, storageKey: 'corba', prepTimeMin: 15, cookTimeMin: 35 },
  { match: /pilav|pirinç|pirinc/, storageKey: 'pirinc', prepTimeMin: 5, cookTimeMin: 20 },
  { match: /bulgur/, storageKey: 'bulgur', prepTimeMin: 5, cookTimeMin: 20 },
  { match: /makarna|spagetti|eriste|erişte/, storageKey: 'makarna', prepTimeMin: 5, cookTimeMin: 15 },
  { match: /tavuk|hindi/, storageKey: 'tavuk', prepTimeMin: 10, cookTimeMin: 25 },
  { match: /köfte|kofte|kıyma|kiyma|burger/, storageKey: 'kiyma', prepTimeMin: 15, cookTimeMin: 20 },
  { match: /balık|balik|somon|ton/, storageKey: 'balik', prepTimeMin: 10, cookTimeMin: 20 },
  { match: /yumurta|omlet|menemen/, storageKey: 'yumurta', prepTimeMin: 5, cookTimeMin: 10 },
  { match: /salata/, storageKey: 'salata', prepTimeMin: 10, cookTimeMin: 0 },
  { match: /mercimek|nohut|fasulye|barbunya/, storageKey: 'kuru_baklagil', prepTimeMin: 10, cookTimeMin: 40 },
  { match: /sebze|brokoli|kabak|ıspanak|ispanak|pırasa|pirasa/, storageKey: 'pismis_sebze', prepTimeMin: 10, cookTimeMin: 25 },
];

function classifyDish(name: string): { storageKey: string; prepTimeMin: number; cookTimeMin: number } {
  const lower = name.toLocaleLowerCase('tr');
  const rule = DISH_RULES.find(r => r.match.test(lower));
  return rule ?? { storageKey: 'varsayilan', prepTimeMin: 10, cookTimeMin: 20 };
}

const PREP_DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** Map weekly_plans.shopping_list (grouped or flat) to ConsolidatedItem[]. */
function shoppingListToConsolidated(raw: unknown): ConsolidatedItem[] {
  if (!Array.isArray(raw)) return [];
  const catMap: Record<string, ConsolidatedItem['category']> = {
    protein: 'protein', vegetable: 'sebze', fruit: 'meyve', dairy: 'sut_urunleri', grain: 'tahil', other: 'diger',
  };
  const out: ConsolidatedItem[] = [];
  for (const entry of raw as { category?: string; items?: { name?: string; amount?: string }[]; name?: string; amount?: string }[]) {
    const category = catMap[entry.category ?? 'other'] ?? 'diger';
    if (Array.isArray(entry.items)) {
      for (const item of entry.items) out.push({ item: item.name ?? '', totalAmount: item.amount ?? '', category });
    } else if (entry.name) {
      out.push({ item: entry.name, totalAmount: entry.amount ?? '', category });
    }
  }
  return out;
}

/**
 * Build the meal prep plan DETERMINISTICALLY from the persisted weekly menu.
 * (The old version free-texted ai-chat and cast its {message, actions, ...}
 * envelope to MealPrepPlan — plan.items was always undefined → crash. All the
 * building blocks below were already in this file; no AI call needed.)
 */
export async function generateMealPrepPlan(
  userId: string,
  weeklyPlanId: string,
): Promise<MealPrepPlan | null> {
  const { data: plan } = await supabase
    .from('weekly_plans')
    .select('plan_data, shopping_list')
    .eq('id', weeklyPlanId)
    .single();

  if (!plan?.plan_data) return null;

  const prefs = await getMealPrepPrefs(userId);
  if (!prefs.active) return null;

  // plan_data may be raw AI days (meal.name) or normalized (meal.suggestion.name).
  type AnyDay = { date?: string; meals?: { meal_type?: string; name?: string; suggestion?: { name: string } }[] };
  const days = (plan.plan_data as AnyDay[]) ?? [];
  const MEAL_TR: Record<string, string> = { breakfast: 'kahvaltı', lunch: 'öğle', dinner: 'akşam', snack: 'ara öğün' };
  const dishMap = new Map<string, { display: string; count: number; targetMeals: string[] }>();
  for (const day of days) {
    for (const meal of day.meals ?? []) {
      const name = meal.suggestion?.name ?? meal.name;
      if (!name) continue;
      const key = name.toLocaleLowerCase('tr').trim();
      if (!dishMap.has(key)) dishMap.set(key, { display: name, count: 0, targetMeals: [] });
      const e = dishMap.get(key)!;
      e.count++;
      e.targetMeals.push(`${dayNameShort(day.date)} ${MEAL_TR[meal.meal_type ?? ''] ?? meal.meal_type ?? ''}`.trim());
    }
  }

  const month = new Date().getMonth(); // 5..7 = Haziran-Ağustos
  const isSummer = month >= 5 && month <= 7;

  const items: PrepItem[] = [];
  for (const e of dishMap.values()) {
    const { storageKey, prepTimeMin, cookTimeMin } = classifyDish(e.display);
    const { days: storageDays } = calculateStorageDuration(storageKey, 'fridge', isSummer);
    // Batch-worthy: repeats during the week, or keeps well enough to cook ahead.
    if (storageDays === 0 || (e.count < 2 && storageDays < 3)) continue;
    items.push({
      recipeName: e.display,
      quantity: `${e.count} porsiyon`,
      storageDays,
      storageMethod: 'fridge',
      storageInstructions: `Buzdolabında ${storageDays} gün saklanabilir`,
      targetMeals: e.targetMeals,
      prepTimeMin,
      cookTimeMin: cookTimeMin * Math.max(1, Math.ceil(e.count / 4)), // big batches cook a bit longer
    });
  }
  // Most-repeated dishes first; cap the session at 6 dishes to keep prep day sane.
  items.sort((a, b) => b.targetMeals.length - a.targetMeals.length);
  const selected = items.slice(0, 6);
  if (selected.length === 0) return null;

  const prepOrder = generatePrepOrder(selected);
  return {
    prepDay: PREP_DAY_NAMES[prefs.prepDays[0] ?? 0] ?? 'Pazar',
    items: selected,
    prepOrder,
    totalPrepTime: selected.reduce((s, i) => s + i.prepTimeMin, 0),
    totalCookTime: Math.max(...selected.map(i => i.cookTimeMin), 0),
    shoppingList: shoppingListToConsolidated(plan.shopping_list),
    containerSuggestion: getContainerSuggestions(selected),
  };
}

function dayNameShort(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : PREP_DAY_NAMES[d.getUTCDay()];
}

// ─── Storage Duration ───

export function calculateStorageDuration(
  foodType: string,
  method: StorageMethod,
  isSummer: boolean,
): { days: number; warning_tr: string | null } {
  const key = foodType.toLowerCase().replace(/\s+/g, '_');
  const info = STORAGE_TABLE[key] ?? STORAGE_TABLE.varsayilan;
  let days = info[method];

  // Summer reduces fridge storage by 1 day
  if (isSummer && method === 'fridge') {
    days = Math.max(1, days - 1);
  }

  const warning = days === 0
    ? `${foodType} için ${method === 'room_temp' ? 'oda sıcaklığında' : method === 'freezer' ? 'dondurucuda' : 'buzdolabında'} saklama önerilmez.`
    : null;

  return { days, warning_tr: warning };
}

// Legacy compat
export function estimateStorageDays(foodType: string, isSummer: boolean): number {
  return calculateStorageDuration(foodType, 'fridge', isSummer).days;
}

// ─── Batch Cooking Optimization ───

export function optimizeBatchCooking(recipes: { name: string; ingredients: { name: string; amount: string }[]; prepTimeMin: number; cookTimeMin: number }[]): {
  commonIngredients: { ingredient: string; recipes: string[]; totalAmount: string }[];
  totalPrepTime: number;
  totalCookTime: number;
  parallelCookingPossible: boolean;
} {
  // Find common ingredients across recipes
  const ingredientMap = new Map<string, { recipes: string[]; amounts: string[] }>();

  for (const recipe of recipes) {
    for (const ing of recipe.ingredients) {
      const key = ing.name.toLowerCase().trim();
      if (!ingredientMap.has(key)) {
        ingredientMap.set(key, { recipes: [], amounts: [] });
      }
      const entry = ingredientMap.get(key)!;
      entry.recipes.push(recipe.name);
      entry.amounts.push(ing.amount);
    }
  }

  const commonIngredients = Array.from(ingredientMap.entries())
    .filter(([, v]) => v.recipes.length > 1)
    .map(([ingredient, v]) => ({
      ingredient,
      recipes: v.recipes,
      totalAmount: v.amounts.join(' + '),
    }));

  const totalPrepTime = recipes.reduce((s, r) => s + r.prepTimeMin, 0);
  const totalCookTime = Math.max(...recipes.map(r => r.cookTimeMin), 0); // Parallel cooking
  const parallelCookingPossible = recipes.length > 1;

  return { commonIngredients, totalPrepTime, totalCookTime, parallelCookingPossible };
}

// ─── Prep Order Algorithm ───

export function generatePrepOrder(items: PrepItem[]): PrepOrderStep[] {
  // Sort: longest cook time first, salads/raw last
  const sorted = [...items].sort((a, b) => {
    // Freezer items first (prep and store immediately)
    if (a.storageMethod === 'freezer' && b.storageMethod !== 'freezer') return -1;
    if (b.storageMethod === 'freezer' && a.storageMethod !== 'freezer') return 1;
    // Longest cook time first
    return b.cookTimeMin - a.cookTimeMin;
  });

  return sorted.map((item, index) => ({
    order: index + 1,
    action: `${item.recipeName} hazırla (${item.quantity})`,
    durationMin: item.prepTimeMin + item.cookTimeMin,
    reason_tr: index === 0
      ? 'En uzun pişirme süresi — fırında/ocakta pişerken diğer hazırlıklar yapılabilir'
      : item.storageMethod === 'freezer'
        ? 'Dondurulacak — erken hazırla, soğumaya zaman bırak'
        : item.storageDays <= 1
          ? 'Kısa ömürlü — en son hazırla'
          : `${item.storageDays} gün dayanır`,
  }));
}

// ─── Shopping List Consolidation ───

const CATEGORY_MAP: Record<string, ConsolidatedItem['category']> = {
  tavuk: 'protein', kiyma: 'protein', balik: 'protein', yumurta: 'protein', et: 'protein', ton: 'protein',
  sut: 'sut_urunleri', yogurt: 'sut_urunleri', peynir: 'sut_urunleri', tereyagi: 'sut_urunleri',
  pirinc: 'tahil', makarna: 'tahil', bulgur: 'tahil', ekmek: 'tahil', un: 'tahil', yulaf: 'tahil',
  zeytinyagi: 'yag', sivi_yag: 'yag',
  tuz: 'baharat', biber: 'baharat', kimyon: 'baharat', kekik: 'baharat',
  domates: 'sebze', biber_sebze: 'sebze', sogan: 'sebze', patates: 'sebze', havuc: 'sebze', brokoli: 'sebze',
  elma: 'meyve', muz: 'meyve', portakal: 'meyve',
};

function categorizeIngredient(name: string): ConsolidatedItem['category'] {
  const lower = name.toLowerCase();
  for (const [key, cat] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(key)) return cat;
  }
  return 'diger';
}

export function consolidateShoppingList(
  recipes: { ingredients: { name: string; amount: string }[] }[],
): ConsolidatedItem[] {
  const map = new Map<string, { amounts: string[]; category: ConsolidatedItem['category'] }>();

  for (const recipe of recipes) {
    for (const ing of recipe.ingredients) {
      const key = ing.name.toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, { amounts: [], category: categorizeIngredient(ing.name) });
      }
      map.get(key)!.amounts.push(ing.amount);
    }
  }

  return Array.from(map.entries())
    .map(([item, data]) => ({
      item,
      totalAmount: data.amounts.length === 1 ? data.amounts[0] : data.amounts.join(' + '),
      category: data.category,
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

// ─── Container Suggestions ───

export function getContainerSuggestions(items: PrepItem[]): ContainerSuggestion {
  let large = 0;
  let medium = 0;
  let small = 0;

  for (const item of items) {
    // Estimate based on quantity text
    const qty = parseInt(item.quantity) || 1;
    // FIX (ux-pass5): 'corba' (ASCII c) never matched real 'Çorba' names — toLowerCase keeps
    // the ç — and 'yahnni' was a typo, so the large-container branch was unreachable. Match
    // both the accented and aksansız forms (same convention as classifyDish's /çorba|corba/).
    const name = item.recipeName.toLowerCase();
    if (name.includes('çorba') || name.includes('corba') || name.includes('yahni')) {
      large += qty; // Soups/stews need large containers
    } else if (qty >= 3) {
      medium += qty;
    } else {
      small += qty;
    }
  }

  return {
    totalContainers: large + medium + small,
    largeContainers: large,
    mediumContainers: medium,
    smallContainers: small,
    note_tr: `${large > 0 ? `${large} büyük (1 L+), ` : ''}${medium > 0 ? `${medium} orta (500 ml), ` : ''}${small > 0 ? `${small} küçük (250 ml)` : ''} kutu hazırla.`.replace(/, $/, ''),
  };
}

// ─── Weekly Prep Schedule ───

export function getWeeklyPrepSchedule(
  prepDay: number, // 0=Sun ... 6=Sat
  mealCount: number,
  items: PrepItem[],
): { day: string; meals: string[]; note_tr: string }[] {
  const dayNames = PREP_DAY_NAMES; // tek kopya — 'Salı' düzeltmesi iki yerde tekrarlanmıştı
  const schedule: { day: string; meals: string[]; note_tr: string }[] = [];

  // Prep day
  schedule.push({
    day: dayNames[prepDay],
    meals: items.map(i => i.recipeName),
    note_tr: `Hazırlama günü: ${items.length} tarif, toplam ~${items.reduce((s, i) => s + i.prepTimeMin + i.cookTimeMin, 0)} dk`,
  });

  // Distribution across the week
  let itemIndex = 0;
  for (let d = 1; d <= 6; d++) {
    const dayIndex = (prepDay + d) % 7;
    const dayMeals: string[] = [];

    for (let m = 0; m < Math.ceil(mealCount / 2); m++) {
      if (itemIndex < items.length) {
        const item = items[itemIndex % items.length];
        if (d <= item.storageDays) {
          dayMeals.push(item.recipeName);
        }
        itemIndex++;
      }
    }

    if (dayMeals.length > 0) {
      schedule.push({
        day: dayNames[dayIndex],
        meals: dayMeals,
        note_tr: d >= Math.min(...items.map(i => i.storageDays)) ? 'Son tüketim günü yaklaşan tarifler var' : '',
      });
    }
  }

  return schedule;
}

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

export async function generateMealPrepPlan(
  userId: string,
  weeklyPlanId: string,
): Promise<MealPrepPlan | null> {
  const { data: plan } = await supabase
    .from('weekly_plans')
    .select('plan_data')
    .eq('id', weeklyPlanId)
    .single();

  if (!plan?.plan_data) return null;

  const prefs = await getMealPrepPrefs(userId);
  if (!prefs.active) return null;

  const { data: result } = await supabase.functions.invoke('ai-chat', {
    body: {
      message: `Haftalik menumdeki su yemeklerden toplu hazirlama plani olustur. Hangi yemekler onceden hazirlabilir, nasil saklanir, kac gun dayanir? Hazirlik sirasi ve toplam sure belirt. Menu: ${JSON.stringify(plan.plan_data)}`,
    },
  });

  return result as MealPrepPlan | null;
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
    ? `${foodType} icin ${method === 'room_temp' ? 'oda sicakliginda' : method === 'freezer' ? 'dondurucuda' : 'buzdolabinda'} saklama onerilmez.`
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
    action: `${item.recipeName} hazirla (${item.quantity})`,
    durationMin: item.prepTimeMin + item.cookTimeMin,
    reason_tr: index === 0
      ? 'En uzun pisirme suresi — firinda/ocakta pisirirken diger hazirliklar yapilabilir'
      : item.storageMethod === 'freezer'
        ? 'Dondurulacak — erken hazirla, sogumaya zaman birak'
        : item.storageDays <= 1
          ? 'Kisa omurlu — en son hazirla'
          : `${item.storageDays} gun dayanir`,
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
    if (item.recipeName.toLowerCase().includes('corba') || item.recipeName.toLowerCase().includes('yahnni')) {
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
    note_tr: `${large > 0 ? `${large} buyuk (1L+), ` : ''}${medium > 0 ? `${medium} orta (500ml), ` : ''}${small > 0 ? `${small} kucuk (250ml)` : ''} kutu hazirlayin.`.replace(/, $/, ''),
  };
}

// ─── Weekly Prep Schedule ───

export function getWeeklyPrepSchedule(
  prepDay: number, // 0=Sun ... 6=Sat
  mealCount: number,
  items: PrepItem[],
): { day: string; meals: string[]; note_tr: string }[] {
  const dayNames = ['Pazar', 'Pazartesi', 'Sali', 'Carsamba', 'Persembe', 'Cuma', 'Cumartesi'];
  const schedule: { day: string; meals: string[]; note_tr: string }[] = [];

  // Prep day
  schedule.push({
    day: dayNames[prepDay],
    meals: items.map(i => i.recipeName),
    note_tr: `Hazirlama gunu: ${items.length} tarif, toplam ~${items.reduce((s, i) => s + i.prepTimeMin + i.cookTimeMin, 0)} dk`,
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
        note_tr: d >= Math.min(...items.map(i => i.storageDays)) ? 'Son tuketim gunu yaklasan tarifler var' : '',
      });
    }
  }

  return schedule;
}

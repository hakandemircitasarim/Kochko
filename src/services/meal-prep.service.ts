/**
 * Meal Prep Service
 * Spec 7.6: Toplu hazırlık planı
 *
 * Generates batch cooking plans for users who meal prep on specific days.
 * Integrates with weekly menu to determine which meals can be prepped.
 */
import { supabase } from '@/lib/supabase';

export interface PrepItem {
  recipeName: string;
  quantity: string;
  storageDays: number;
  storageInstructions: string;
  targetMeals: string[]; // which days/meals this covers
}

export interface MealPrepPlan {
  prepDay: string;
  items: PrepItem[];
  totalPrepTime: number;
  shoppingList: { item: string; amount: string }[];
}

/**
 * Get user's meal prep preferences from profile.
 */
export async function getMealPrepPrefs(userId: string): Promise<{
  active: boolean;
  prepDays: number[]; // 0=Sunday, 1=Monday, etc.
}> {
  const { data } = await supabase
    .from('profiles')
    .select('meal_prep_active, meal_prep_days')
    .eq('id', userId)
    .single();

  return {
    active: data?.meal_prep_active ?? false,
    prepDays: (data?.meal_prep_days as number[]) ?? [0], // Default Sunday
  };
}

/**
 * Generate a meal prep plan based on the weekly menu.
 * AI handles the actual generation; this function structures the request.
 */
export async function generateMealPrepPlan(
  userId: string,
  weeklyPlanId: string
): Promise<MealPrepPlan | null> {
  const { data: plan } = await supabase
    .from('weekly_plans')
    .select('plan_data')
    .eq('id', weeklyPlanId)
    .single();

  if (!plan?.plan_data) return null;

  const prefs = await getMealPrepPrefs(userId);
  if (!prefs.active) return null;

  // Call AI to generate prep plan from weekly menu
  const { data: result } = await supabase.functions.invoke('ai-chat', {
    body: {
      message: `Haftalik menumdeki su yemeklerden toplu hazirlama plani olustur. Hangi yemekler onceden hazirlabilir, nasil saklanir, kac gun dayanir? Hazirlik sirasi ve toplam sure belirt. Menu: ${JSON.stringify(plan.plan_data)}`,
    },
  });

  return result as MealPrepPlan | null;
}

/**
 * Get storage duration estimate based on food type and season.
 * Spec 7.6: AI mevsime göre saklama süresini ayarlar.
 */
export function estimateStorageDays(foodType: string, isSummer: boolean): number {
  const baseStorage: Record<string, number> = {
    rice: 5, pasta: 4, chicken: 3, beef: 4, fish: 2,
    vegetables: 3, soup: 4, salad: 1, sauce: 5, eggs: 5,
  };

  const base = baseStorage[foodType] ?? 3;
  return isSummer ? Math.max(1, base - 1) : base;
}

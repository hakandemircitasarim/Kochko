/**
 * Meal Prep Service
 * Spec 7.6: Toplu hazırlık planı
 *
 * Generates meal prep plans from weekly menu,
 * considering storage times and seasonal adjustments.
 */
import { supabase } from '@/lib/supabase';
import type { DayPlan } from './weekly-plan.service';

export interface PrepItem {
  recipeName: string;
  servings: number;
  prepOrder: number;
  storageDays: number;
  storageNote: string;
  forDays: string[]; // which days this prep covers
  calories: number;
  protein_g: number;
}

export interface MealPrepPlan {
  prepDay: string; // e.g. "Pazar"
  items: PrepItem[];
  totalPrepTimeMin: number;
  tips: string[];
}

/**
 * Generate a meal prep plan from weekly menu.
 */
export function generateMealPrepPlan(
  weeklyPlan: DayPlan[],
  prepDays: string[],
  isSummer: boolean,
): MealPrepPlan[] {
  const plans: MealPrepPlan[] = [];

  for (const prepDay of prepDays) {
    const items: PrepItem[] = [];
    let order = 1;

    // Group similar meals across the week for batch cooking
    const mealGroups = new Map<string, { days: string[]; calories: number; protein_g: number }>();

    for (const day of weeklyPlan) {
      for (const meal of day.meals) {
        const key = meal.suggestion.name.toLowerCase();
        const existing = mealGroups.get(key);
        if (existing) {
          existing.days.push(day.dayName);
        } else {
          mealGroups.set(key, {
            days: [day.dayName],
            calories: meal.suggestion.calories,
            protein_g: meal.suggestion.protein_g,
          });
        }
      }
    }

    // Create prep items for meals that repeat 2+ times
    for (const [name, group] of mealGroups) {
      if (group.days.length >= 2) {
        const storageDays = isSummer ? 3 : 5; // shorter storage in summer
        items.push({
          recipeName: name,
          servings: group.days.length,
          prepOrder: order++,
          storageDays,
          storageNote: isSummer
            ? 'Yazin buzdolabinda max 3 gun, dondurucu 2 hafta'
            : 'Buzdolabinda max 5 gun, dondurucu 3 hafta',
          forDays: group.days,
          calories: group.calories,
          protein_g: group.protein_g,
        });
      }
    }

    plans.push({
      prepDay,
      items,
      totalPrepTimeMin: items.length * 25, // rough estimate
      tips: [
        'Once et/tavuk hazirliklariyla basla (en uzun pisirme suresi)',
        'Sebzeleri son hazirla (tazelik)',
        'Porsiyonlari kapaklara koyarken tartarak ol',
      ],
    });
  }

  return plans;
}

/**
 * Get user's meal prep settings.
 */
export async function getMealPrepSettings(userId: string): Promise<{ active: boolean; days: string[] }> {
  const { data } = await supabase
    .from('profiles')
    .select('meal_prep_active, meal_prep_days')
    .eq('id', userId)
    .single();

  return {
    active: data?.meal_prep_active ?? false,
    days: (data?.meal_prep_days as string[]) ?? [],
  };
}

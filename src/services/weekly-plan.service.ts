/**
 * Weekly Menu Planning Service — Spec 7.1, 7.3
 * Generates/manages weekly meal plans with shopping lists.
 * Integrates with meal prep (Spec 7.6).
 */
import { supabase } from '@/lib/supabase';

export interface WeeklyPlan {
  id: string;
  week_start: string;
  plan_data: DayPlan[];
  shopping_list: ShoppingItem[];
  generated_at: string;
}

export interface DayPlan {
  date: string;
  dayName: string;
  isTrainingDay: boolean;
  meals: {
    meal_type: string;
    suggestion: { name: string; calories: number; protein_g: number; prep_time_min?: number };
  }[];
}

export interface ShoppingItem {
  category: string; // protein, vegetable, fruit, dairy, grain, spice, other
  name: string;
  amount: string;
  checked: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  protein: 'Protein', vegetable: 'Sebze', fruit: 'Meyve',
  dairy: 'Sut Urunleri', grain: 'Tahil', spice: 'Baharat', other: 'Diger',
};

/**
 * Get current week's plan.
 */
export async function getCurrentWeeklyPlan(): Promise<WeeklyPlan | null> {
  const weekStart = getWeekStart();
  const { data } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('week_start', weekStart)
    .single();
  return data as WeeklyPlan | null;
}

/**
 * Get a specific week's plan.
 */
export async function getWeeklyPlan(weekStart: string): Promise<WeeklyPlan | null> {
  const { data } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('week_start', weekStart)
    .single();
  return data as WeeklyPlan | null;
}

/**
 * Generate a new weekly plan via AI.
 */
export async function generateWeeklyPlan(): Promise<{ data: WeeklyPlan | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('ai-plan', {
    body: { type: 'weekly' },
  });
  if (error) return { data: null, error: error.message };
  return { data: data as WeeklyPlan, error: null };
}

/**
 * Toggle a shopping list item's checked state.
 */
export async function toggleShoppingItem(planId: string, itemIndex: number, checked: boolean): Promise<void> {
  const { data } = await supabase.from('weekly_plans').select('shopping_list').eq('id', planId).single();
  if (!data) return;

  const list = (data.shopping_list as ShoppingItem[]) ?? [];
  if (list[itemIndex]) {
    list[itemIndex].checked = checked;
    await supabase.from('weekly_plans').update({ shopping_list: list }).eq('id', planId);
  }
}

/**
 * Get total macros for a day in the weekly plan.
 */
export function getDayTotals(day: DayPlan): { calories: number; protein: number } {
  return day.meals.reduce(
    (totals, m) => ({
      calories: totals.calories + m.suggestion.calories,
      protein: totals.protein + m.suggestion.protein_g,
    }),
    { calories: 0, protein: 0 },
  );
}

/**
 * Get shopping list grouped by category.
 */
export function getGroupedShoppingList(items: ShoppingItem[]): Record<string, ShoppingItem[]> {
  const groups: Record<string, ShoppingItem[]> = {};
  for (const item of items) {
    const cat = item.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }
  return groups;
}

/**
 * Get category label in Turkish.
 */
export function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/**
 * Calculate total shopping items (checked vs unchecked).
 */
export function getShoppingProgress(items: ShoppingItem[]): { checked: number; total: number; percent: number } {
  const total = items.length;
  const checked = items.filter(i => i.checked).length;
  return { checked, total, percent: total > 0 ? Math.round((checked / total) * 100) : 0 };
}

function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.setDate(diff)).toISOString().split('T')[0];
}

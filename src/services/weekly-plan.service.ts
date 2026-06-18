/**
 * Weekly Menu Planning Service
 * Spec 7.3: Haftalık menü planlama
 *
 * DB shape note: ai-plan persists plan_data as the AI's raw days array
 * ({date, is_training_day?, meals:[{meal_type,name,calories,protein_g}]}) and
 * shopping_list either GROUPED ({category, items:[{name,amount}]}) or flat.
 * normalizeWeeklyPlan converts every variant to the UI shape in ONE place so
 * the screen never sees a raw row (reading meal.suggestion.name off a raw row
 * used to crash the menu tab).
 */
import { supabase } from '@/lib/supabase';

export interface WeeklyPlan {
  id: string;
  week_start: string;
  plan_data: DayPlan[];
  shopping_list: ShoppingItem[];
  generated_at: string;
  approved_at: string | null;
  modification_request: string | null;
  revision_count: number;
}

export interface DayPlan {
  date: string;
  dayName: string;
  isTrainingDay?: boolean;
  meals: {
    meal_type: string;
    suggestion: { name: string; calories: number; protein_g: number; prep_time_min?: number };
  }[];
}

export interface ShoppingItem {
  category: string; // 'protein', 'vegetable', 'fruit', 'dairy', 'grain', 'other'
  name: string;
  amount: string;
  checked: boolean;
}

const DAY_NAMES_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

function dayNameFromDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : DAY_NAMES_TR[d.getUTCDay()];
}

type RawMeal = {
  meal_type?: string;
  // flat (AI output) …
  name?: string;
  calories?: number;
  protein_g?: number;
  // …or already-normalized
  suggestion?: { name: string; calories: number; protein_g: number; prep_time_min?: number };
};

type RawDay = {
  date?: string;
  dayName?: string;
  is_training_day?: boolean;
  isTrainingDay?: boolean;
  meals?: RawMeal[];
};

type RawShoppingEntry = {
  category?: string;
  // grouped (AI output) …
  items?: { name?: string; amount?: string; checked?: boolean }[];
  // …or already-flat
  name?: string;
  amount?: string;
  checked?: boolean;
};

function normalizeDays(raw: unknown): DayPlan[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawDay[]).map((day) => ({
    date: day.date ?? '',
    dayName: day.dayName ?? dayNameFromDate(day.date),
    isTrainingDay: day.isTrainingDay ?? day.is_training_day,
    meals: (day.meals ?? []).map((meal) => ({
      meal_type: meal.meal_type ?? 'snack',
      suggestion: meal.suggestion ?? {
        name: meal.name ?? '',
        calories: meal.calories ?? 0,
        protein_g: meal.protein_g ?? 0,
      },
    })),
  }));
}

function normalizeShoppingList(raw: unknown): ShoppingItem[] {
  if (!Array.isArray(raw)) return [];
  const flat: ShoppingItem[] = [];
  for (const entry of raw as RawShoppingEntry[]) {
    if (Array.isArray(entry.items)) {
      for (const item of entry.items) {
        flat.push({
          category: entry.category ?? 'other',
          name: item.name ?? '',
          amount: item.amount ?? '',
          checked: item.checked ?? false,
        });
      }
    } else {
      flat.push({
        category: entry.category ?? 'other',
        name: entry.name ?? '',
        amount: entry.amount ?? '',
        checked: entry.checked ?? false,
      });
    }
  }
  return flat;
}

function normalizeWeeklyPlan(row: Record<string, unknown> | null): WeeklyPlan | null {
  if (!row || !row.id) return null;
  return {
    id: row.id as string,
    week_start: row.week_start as string,
    plan_data: normalizeDays(row.plan_data),
    shopping_list: normalizeShoppingList(row.shopping_list),
    generated_at: row.generated_at as string,
    approved_at: (row.approved_at as string | null) ?? null,
    modification_request: (row.modification_request as string | null) ?? null,
    revision_count: (row.revision_count as number) ?? 0,
  };
}

export async function getCurrentWeeklyPlan(): Promise<WeeklyPlan | null> {
  const weekStart = getWeekStart();
  const { data, error } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('week_start', weekStart)
    .eq('status', 'active')
    .eq('plan_type', 'diet') // this path is the diet menu
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('getCurrentWeeklyPlan failed', error);
    return null;
  }
  return normalizeWeeklyPlan(data);
}

export async function generateWeeklyPlan(modificationRequest?: string): Promise<{ data: WeeklyPlan | null; error: string | null }> {
  const body: Record<string, unknown> = { type: 'weekly' };
  if (modificationRequest) body.modification_request = modificationRequest;
  const { error } = await supabase.functions.invoke('ai-plan', { body });
  // Never surface the raw supabase-js 'Edge Function returned a non-2xx status
  // code' to the user (e.g. on an OpenAI outage) — show a friendly Turkish msg.
  if (error) return { data: null, error: 'Menü şu an oluşturulamıyor, birazdan tekrar dene.' };
  // The function's response body is the raw AI JSON (no row id) — the persisted
  // weekly_plans row is the source of truth, so re-read it for the screen.
  const plan = await getCurrentWeeklyPlan();
  if (!plan) return { data: null, error: 'Plan kaydedilemedi. Tekrar dene.' };
  return { data: plan, error: null };
}

export async function approveWeeklyPlan(planId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('weekly_plans')
    .update({ approved_at: new Date().toISOString() })
    .eq('id', planId);
  return { error: error?.message ?? null };
}

export async function requestMenuModification(planId: string, request: string): Promise<{ data: WeeklyPlan | null; error: string | null }> {
  // Store the modification request, then regenerate
  const { error } = await supabase
    .from('weekly_plans')
    .update({ modification_request: request })
    .eq('id', planId);
  if (error) return { data: null, error: error.message };
  return generateWeeklyPlan(request);
}

export async function toggleShoppingItem(planId: string, itemIndex: number, checked: boolean): Promise<void> {
  const { data } = await supabase.from('weekly_plans').select('shopping_list').eq('id', planId).single();
  if (!data) return;

  // Normalize before indexing: the stored list may still be in the grouped AI
  // shape while the screen indexes the FLAT list. Persist the flat form back so
  // checked state has a stable home (normalize keeps handling both shapes).
  const list = normalizeShoppingList(data.shopping_list);
  if (list[itemIndex]) {
    list[itemIndex].checked = checked;
    await supabase.from('weekly_plans').update({ shopping_list: list }).eq('id', planId);
  }
}

function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.setDate(diff)).toISOString().split('T')[0];
}

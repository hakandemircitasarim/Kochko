/**
 * Weekly Menu Planning Service
 * Spec 7.3: Haftalık menü planlama
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
  isTrainingDay: boolean;
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
  return data as WeeklyPlan | null;
}

export async function generateWeeklyPlan(modificationRequest?: string): Promise<{ data: WeeklyPlan | null; error: string | null }> {
  const body: Record<string, unknown> = { type: 'weekly' };
  if (modificationRequest) body.modification_request = modificationRequest;
  const { data, error } = await supabase.functions.invoke('ai-plan', { body });
  if (error) return { data: null, error: error.message };
  return { data: data as WeeklyPlan, error: null };
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

  const list = (data.shopping_list as ShoppingItem[]) ?? [];
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

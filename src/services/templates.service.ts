/**
 * Meal Template Service
 * Spec Section 3.4: Favori öğün şablonları
 */
import { supabase } from '@/lib/supabase';

export interface MealTemplate {
  id: string;
  name: string;
  items: { name: string; portion: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }[];
  total_calories: number;
  total_protein: number;
  use_count: number;
  created_at: string;
}

export async function getTemplates(): Promise<MealTemplate[]> {
  const { data } = await supabase
    .from('meal_templates')
    .select('*')
    .order('use_count', { ascending: false });
  return (data ?? []) as MealTemplate[];
}

export async function createTemplate(
  name: string,
  items: MealTemplate['items']
): Promise<{ error: string | null }> {
  const totalCal = items.reduce((s, i) => s + i.calories, 0);
  const totalPro = items.reduce((s, i) => s + i.protein_g, 0);

  const { error } = await supabase.from('meal_templates').insert({
    name,
    items,
    total_calories: totalCal,
    total_protein: Math.round(totalPro),
  });

  return { error: error?.message ?? null };
}

export async function useTemplate(templateId: string): Promise<{ error: string | null }> {
  // Increment use count
  const { data: template } = await supabase
    .from('meal_templates')
    .select('use_count')
    .eq('id', templateId)
    .single();

  if (template) {
    await supabase
      .from('meal_templates')
      .update({ use_count: (template.use_count ?? 0) + 1 })
      .eq('id', templateId);
  }

  return { error: null };
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await supabase.from('meal_templates').delete().eq('id', templateId);
}

/**
 * Meal Template Service
 * Spec Section 3.4: Favori öğün şablonları
 * Spec 3.5: Tek dokunuşla tekrar giriş
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
  items: MealTemplate['items'],
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

/**
 * Use a template: increment count AND add items to today's meal log.
 * Spec 3.4: "tek dokunuşla tekrar girilebilir"
 */
export async function useTemplate(templateId: string): Promise<{ error: string | null }> {
  // Get template data
  const { data: template } = await supabase
    .from('meal_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (!template) return { error: 'Sablon bulunamadi.' };

  const t = template as MealTemplate;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Giris yapilmamis.' };

  const date = new Date().toISOString().split('T')[0];

  // Create meal log entry
  const { data: mealLog, error: mealError } = await supabase
    .from('meal_logs')
    .insert({
      user_id: user.id,
      date,
      meal_type: guessMealType(),
      raw_input: `[Sablon] ${t.name}`,
      input_method: 'template',
      confidence: 'high',
    })
    .select('id')
    .single();

  if (mealError || !mealLog) return { error: mealError?.message ?? 'Kayit olusturulamadi.' };

  // Add meal items
  const items = t.items.map(item => ({
    meal_log_id: mealLog.id,
    food_name: item.name,
    portion_text: item.portion,
    calories: item.calories,
    protein_g: item.protein_g,
    carbs_g: item.carbs_g,
    fat_g: item.fat_g,
    data_source: 'template',
  }));

  await supabase.from('meal_log_items').insert(items);

  // Increment use count
  await supabase
    .from('meal_templates')
    .update({ use_count: (t.use_count ?? 0) + 1 })
    .eq('id', templateId);

  return { error: null };
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await supabase.from('meal_templates').delete().eq('id', templateId);
}

/**
 * Guess meal type based on current hour.
 */
function guessMealType(): string {
  const hour = new Date().getHours();
  if (hour < 10) return 'breakfast';
  if (hour < 14) return 'lunch';
  if (hour < 18) return 'snack';
  return 'dinner';
}

/**
 * Meal Template Service
 * Spec Section 3.4: Favori öğün şablonları
 */
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { insertMealLogWithItems } from '@/services/meal-log.service';

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

  // meal_templates.user_id is NOT NULL + RLS WITH CHECK(auth.uid()=user_id)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Oturum bulunamadi.' };

  const { error } = await supabase.from('meal_templates').insert({
    user_id: user.id,
    name,
    items,
    total_calories: totalCal,
    total_protein: Math.round(totalPro),
  });

  return { error: error?.message ?? null };
}

export async function useTemplate(
  templateId: string,
  opts?: { mealType?: string; loggedForDate?: string },
): Promise<{ error: string | null }> {
  // Load the template with items so we can materialize a meal_log.
  const { data: template, error: loadErr } = await supabase
    .from('meal_templates')
    .select('id, name, items, use_count')
    .eq('id', templateId)
    .single();

  if (loadErr || !template) {
    return { error: loadErr?.message ?? 'Sablon bulunamadi.' };
  }

  const mealType = opts?.mealType ?? guessMealTypeForNow();
  // Effective (day-boundary-aware, local-tz) date — the raw UTC date put
  // late-evening template logs on tomorrow for UTC- users.
  const loggedForDate = opts?.loggedForDate ?? getEffectiveDate(new Date());
  const items = (template.items ?? []) as MealTemplate['items'];

  // Shared parent+items+rollback write sequence (meal-log.service). Review fix:
  // session resolution delegated to the helper too — the local copy had already
  // drifted ('bulunamadi' vs the helper's 'bulunamadı').
  const { error: writeErr } = await insertMealLogWithItems({
    rawInput: `[Sablon] ${template.name}`,
    mealType,
    loggedForDate,
    inputMethod: 'template',
    templateId,
    synced: true,
    items: items.map((i) => ({
      name: i.name,
      portionText: i.portion ?? '1 porsiyon',
      kcal: i.calories ?? 0,
      protein: i.protein_g ?? 0,
      carbs: i.carbs_g ?? 0,
      fat: i.fat_g ?? 0,
      dataSource: 'template',
    })),
  });
  if (writeErr) return { error: writeErr };

  // Increment use count only after a successful insert
  await supabase
    .from('meal_templates')
    .update({ use_count: (template.use_count as number ?? 0) + 1 })
    .eq('id', templateId);

  return { error: null };
}

function guessMealTypeForNow(): string {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h < 17) return 'snack';
  if (h < 22) return 'dinner';
  return 'snack';
}

export async function deleteTemplate(templateId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('meal_templates').delete().eq('id', templateId);
  if (error) console.error('[Templates] delete failed:', error.message);
  return { error: error?.message ?? null };
}

/**
 * Meal Template Service
 * Spec Section 3.4: Favori öğün şablonları
 */
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';

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

  // meal_logs.user_id is NOT NULL + RLS WITH CHECK(auth.uid()=user_id)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Oturum bulunamadi.' };

  // Create the parent meal_log row
  const { data: log, error: logErr } = await supabase
    .from('meal_logs')
    .insert({
      user_id: user.id,
      raw_input: `[Sablon] ${template.name}`,
      meal_type: mealType,
      logged_for_date: loggedForDate,
      input_method: 'template',
      template_id: templateId,
      synced: true,
    })
    .select('id')
    .single();

  if (logErr || !log) {
    return { error: logErr?.message ?? 'Kayit olusturulamadi.' };
  }

  // Insert each item linked to the parent meal_log
  if (items.length > 0) {
    const rows = items.map((i) => ({
      meal_log_id: log.id,
      food_name: i.name,
      portion_text: i.portion ?? '1 porsiyon',
      calories: i.calories ?? 0,
      protein_g: i.protein_g ?? 0,
      carbs_g: i.carbs_g ?? 0,
      fat_g: i.fat_g ?? 0,
      data_source: 'template',
    }));
    const { error: itemsErr } = await supabase.from('meal_log_items').insert(rows);
    if (itemsErr) {
      // Roll the empty log back so the user doesn't see a phantom entry
      await supabase.from('meal_logs').delete().eq('id', log.id);
      return { error: itemsErr.message };
    }
  }

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

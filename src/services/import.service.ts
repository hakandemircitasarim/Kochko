/**
 * Data Import Service
 * Spec 14.4: MyFitnessPal / Fatsecret / Samsung Health CSV/JSON import
 */
import { supabase } from '@/lib/supabase';

export type ImportSource = 'myfitnesspal' | 'fatsecret' | 'samsung_health' | 'generic_csv';

// meal_logs.meal_type is CHECK-constrained to lowercase EN values, but real
// exports carry capitalized EN ("Breakfast" — MyFitnessPal) or Turkish labels.
// Without this map every such row 23514-failed and imports ended at 0 records.
const MEAL_TYPE_ALIASES: Record<string, string> = {
  breakfast: 'breakfast', kahvalti: 'breakfast', 'kahvaltı': 'breakfast', sabah: 'breakfast',
  lunch: 'lunch', ogle: 'lunch', 'öğle': 'lunch', 'öğlen': 'lunch', oglen: 'lunch',
  dinner: 'dinner', aksam: 'dinner', 'akşam': 'dinner', supper: 'dinner',
  snack: 'snack', ara: 'snack', atistirma: 'snack', 'atıştırma': 'snack',
  'morning snack': 'snack', 'afternoon snack': 'snack', 'evening snack': 'snack',
};

function normalizeMealType(raw: string | undefined): string {
  const key = (raw ?? '').toLocaleLowerCase('tr').trim();
  if (!key) return 'snack';
  if (MEAL_TYPE_ALIASES[key]) return MEAL_TYPE_ALIASES[key];
  // partial match ("ara öğün", "öğle yemeği"…)
  for (const [alias, canonical] of Object.entries(MEAL_TYPE_ALIASES)) {
    if (key.includes(alias)) return canonical;
  }
  return 'snack';
}

export interface ImportResult {
  success: boolean;
  recordsImported: number;
  errors: string[];
}

/**
 * Import meal data from CSV text.
 * Expected format: date, meal_type, food_name, calories, protein_g
 */
export async function importMealsFromCSV(csvText: string): Promise<ImportResult> {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { success: false, recordsImported: 0, errors: ['Veri bulunamadi.'] };

  // meal_logs.user_id is NOT NULL + RLS WITH CHECK(auth.uid()=user_id)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, recordsImported: 0, errors: ['Oturum bulunamadi.'] };

  // Skip header
  const dataLines = lines.slice(1);
  const errors: string[] = [];
  let imported = 0;

  for (const line of dataLines) {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 5) { errors.push(`Hatali satir: ${line}`); continue; }

    const [date, mealType, foodName, caloriesStr, proteinStr] = parts;
    const calories = parseInt(caloriesStr);
    const protein = parseFloat(proteinStr);

    if (isNaN(calories)) { errors.push(`Gecersiz kalori: ${line}`); continue; }

    // Create meal log
    const { data: log, error: logErr } = await supabase.from('meal_logs').insert({
      user_id: user.id,
      raw_input: foodName,
      meal_type: normalizeMealType(mealType),
      logged_for_date: date,
      input_method: 'text',
      synced: true,
    }).select('id').single();

    if (logErr || !log) { errors.push(`Kayit olusturulamadi: ${line}`); continue; }

    const { error: itemErr } = await supabase.from('meal_log_items').insert({
      meal_log_id: log.id,
      food_name: foodName,
      portion_text: '1 porsiyon',
      calories,
      protein_g: protein || 0,
      carbs_g: 0,
      fat_g: 0,
      data_source: 'ai_estimate',
    });
    if (itemErr) {
      // Roll back the empty parent log so no orphan meal_log remains
      await supabase.from('meal_logs').delete().eq('id', log.id);
      errors.push(`Item eklenemedi: ${line}`);
      continue;
    }
    imported++;
  }

  return { success: imported > 0, recordsImported: imported, errors };
}

/**
 * Import weight data from CSV text.
 * Expected format: date, weight_kg
 */
export async function importWeightsFromCSV(csvText: string): Promise<ImportResult> {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { success: false, recordsImported: 0, errors: ['Veri bulunamadi.'] };

  // daily_metrics.user_id is NOT NULL + RLS WITH CHECK(auth.uid()=user_id)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, recordsImported: 0, errors: ['Oturum bulunamadi.'] };

  const dataLines = lines.slice(1);
  const errors: string[] = [];
  let imported = 0;

  for (const line of dataLines) {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 2) continue;

    const [date, weightStr] = parts;
    const weight = parseFloat(weightStr);
    if (isNaN(weight) || weight < 20 || weight > 300) { errors.push(`Gecersiz kilo: ${line}`); continue; }

    // No water_liters here: on the merge path the upsert REPLACES every given
    // column, so a hardcoded 0 silently wiped the day's existing water total.
    // (Fresh inserts get the column's DB default 0 anyway.)
    const { error: upsertErr } = await supabase.from('daily_metrics').upsert(
      { user_id: user.id, date, weight_kg: weight, synced: true },
      { onConflict: 'user_id,date' }
    );
    if (upsertErr) { errors.push(`Kilo kaydedilemedi: ${line}`); continue; }
    imported++;
  }

  return { success: imported > 0, recordsImported: imported, errors };
}

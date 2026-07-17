/**
 * Data Import Service
 * Spec 14.4: MyFitnessPal / Fatsecret / Samsung Health CSV/JSON import
 */
import { supabase } from '@/lib/supabase';
import { insertMealLogWithItems } from '@/services/meal-log.service';

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
  if (lines.length < 2) return { success: false, recordsImported: 0, errors: ['Veri bulunamadı.'] };

  // meal_logs.user_id is NOT NULL + RLS WITH CHECK(auth.uid()=user_id)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, recordsImported: 0, errors: ['Oturum bulunamadı.'] };

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

    if (isNaN(calories)) { errors.push(`Geçersiz kalori: ${line}`); continue; }

    // Shared parent+items+rollback write sequence (meal-log.service)
    const { error: writeErr, failedStep } = await insertMealLogWithItems({
      userId: user.id,
      rawInput: foodName,
      mealType: normalizeMealType(mealType),
      loggedForDate: date,
      inputMethod: 'text',
      synced: true,
      items: [{
        name: foodName,
        portionText: '1 porsiyon',
        // calories is smallint — clamp arbitrary CSV values so one bad row can't
        // 22003-overflow and fail the insert (#R4-14).
        kcal: Math.min(32767, Math.max(0, Math.round(calories || 0))),
        protein: protein || 0,
        carbs: 0,
        fat: 0,
        dataSource: 'ai_estimate',
      }],
    });
    if (writeErr) {
      errors.push(failedStep === 'items' ? `Öğe eklenemedi: ${line}` : `Kayıt oluşturulamadı: ${line}`);
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
  if (lines.length < 2) return { success: false, recordsImported: 0, errors: ['Veri bulunamadı.'] };

  // daily_metrics.user_id is NOT NULL + RLS WITH CHECK(auth.uid()=user_id)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, recordsImported: 0, errors: ['Oturum bulunamadı.'] };

  const dataLines = lines.slice(1);
  const errors: string[] = [];
  let imported = 0;

  for (const line of dataLines) {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 2) continue;

    const [date, weightStr] = parts;
    const weight = parseFloat(weightStr);
    if (isNaN(weight) || weight < 20 || weight > 300) { errors.push(`Geçersiz kilo: ${line}`); continue; }

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

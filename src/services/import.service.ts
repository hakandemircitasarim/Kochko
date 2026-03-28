/**
 * Data Import Service
 * Spec 14.4: MyFitnessPal / Fatsecret / Samsung Health CSV/JSON import
 */
import { supabase } from '@/lib/supabase';

export type ImportSource = 'myfitnesspal' | 'fatsecret' | 'samsung_health' | 'generic_csv';

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
    const { data: log } = await supabase.from('meal_logs').insert({
      raw_input: foodName,
      meal_type: mealType || 'snack',
      logged_for_date: date,
      input_method: 'text',
      synced: true,
    }).select('id').single();

    if (log) {
      await supabase.from('meal_log_items').insert({
        meal_log_id: log.id,
        food_name: foodName,
        portion_text: '1 porsiyon',
        calories,
        protein_g: protein || 0,
        carbs_g: 0,
        fat_g: 0,
        data_source: 'ai_estimate',
      });
      imported++;
    }
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

  const dataLines = lines.slice(1);
  const errors: string[] = [];
  let imported = 0;

  for (const line of dataLines) {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 2) continue;

    const [date, weightStr] = parts;
    const weight = parseFloat(weightStr);
    if (isNaN(weight) || weight < 20 || weight > 300) { errors.push(`Gecersiz kilo: ${line}`); continue; }

    await supabase.from('daily_metrics').upsert(
      { date, weight_kg: weight, water_liters: 0, synced: true },
      { onConflict: 'user_id,date' }
    );
    imported++;
  }

  return { success: imported > 0, recordsImported: imported, errors };
}

/**
 * Data Import Service — Spec 14.4
 * Import from MyFitnessPal, Fatsecret, Samsung Health, or generic CSV.
 * Auto-detects format, validates data, provides import summary.
 */
import { supabase } from '@/lib/supabase';

export type ImportSource = 'myfitnesspal' | 'fatsecret' | 'samsung_health' | 'generic_csv';

export interface ImportResult {
  success: boolean;
  recordsImported: number;
  recordsSkipped: number;
  errors: string[];
  summary: string;
}

/**
 * Auto-detect CSV format based on headers.
 */
export function detectCSVFormat(firstLine: string): ImportSource {
  const lower = firstLine.toLowerCase();
  if (lower.includes('food diary') || lower.includes('myfitnesspal')) return 'myfitnesspal';
  if (lower.includes('fatsecret')) return 'fatsecret';
  if (lower.includes('samsung') || lower.includes('s health')) return 'samsung_health';
  return 'generic_csv';
}

/**
 * Parse CSV text into rows, handling quoted fields.
 */
function parseCSV(text: string): string[][] {
  return text.split('\n')
    .filter(l => l.trim())
    .map(line => {
      // Simple CSV parse — handles basic cases
      const parts: string[] = [];
      let current = '';
      let inQuotes = false;
      for (const char of line) {
        if (char === '"') { inQuotes = !inQuotes; continue; }
        if (char === ',' && !inQuotes) { parts.push(current.trim()); current = ''; continue; }
        current += char;
      }
      parts.push(current.trim());
      return parts;
    });
}

/**
 * Import meal data from CSV.
 * Expected format: date, meal_type, food_name, calories, protein_g
 * Also handles: date, food_name, calories (minimal format)
 */
export async function importMealsFromCSV(csvText: string): Promise<ImportResult> {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return { success: false, recordsImported: 0, recordsSkipped: 0, errors: ['Veri bulunamadi.'], summary: '' };

  const headers = rows[0].map(h => h.toLowerCase());
  const dataRows = rows.slice(1);
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  // Detect column positions
  const dateCol = headers.findIndex(h => h.includes('date') || h.includes('tarih'));
  const mealCol = headers.findIndex(h => h.includes('meal') || h.includes('ogun') || h.includes('type'));
  const foodCol = headers.findIndex(h => h.includes('food') || h.includes('yemek') || h.includes('name'));
  const calCol = headers.findIndex(h => h.includes('cal') || h.includes('kcal') || h.includes('kalori'));
  const proCol = headers.findIndex(h => h.includes('protein') || h.includes('pro'));
  const carbCol = headers.findIndex(h => h.includes('carb') || h.includes('karb'));
  const fatCol = headers.findIndex(h => h.includes('fat') || h.includes('yag'));

  if (dateCol === -1 || calCol === -1) {
    return { success: false, recordsImported: 0, recordsSkipped: 0,
      errors: ['CSV basliklarinda "date/tarih" ve "calories/kcal/kalori" sutunlari bulunamadi.'],
      summary: `Bulunan basliklar: ${headers.join(', ')}` };
  }

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    try {
      const date = row[dateCol];
      const mealType = mealCol >= 0 ? mapMealType(row[mealCol]) : guessMealTypeByIndex(i, dataRows.length);
      const foodName = foodCol >= 0 ? row[foodCol] : 'Imported meal';
      const calories = parseInt(row[calCol]);
      const protein = proCol >= 0 ? parseFloat(row[proCol]) || 0 : 0;
      const carbs = carbCol >= 0 ? parseFloat(row[carbCol]) || 0 : 0;
      const fat = fatCol >= 0 ? parseFloat(row[fatCol]) || 0 : 0;

      if (!date || isNaN(calories) || calories <= 0) { skipped++; continue; }
      if (calories > 5000) { errors.push(`Satir ${i + 2}: ${calories} kcal cok yuksek, atlandi.`); skipped++; continue; }

      const { data: log } = await supabase.from('meal_logs').insert({
        raw_input: `[Import] ${foodName}`,
        meal_type: mealType,
        logged_for_date: normalizeDate(date),
        input_method: 'text',
        confidence: 'medium',
        synced: true,
      }).select('id').single();

      if (log) {
        await supabase.from('meal_log_items').insert({
          meal_log_id: log.id,
          food_name: foodName,
          portion_text: '1 porsiyon',
          calories, protein_g: protein, carbs_g: carbs, fat_g: fat,
          data_source: 'ai_estimate',
        });
        imported++;
      }
    } catch {
      errors.push(`Satir ${i + 2}: islenemedi.`);
      skipped++;
    }
  }

  return {
    success: imported > 0,
    recordsImported: imported,
    recordsSkipped: skipped,
    errors: errors.slice(0, 10), // Show max 10 errors
    summary: `${imported} ogun iceri aktarildi${skipped > 0 ? `, ${skipped} atlandi` : ''}${errors.length > 0 ? `. ${errors.length} hata.` : '.'}`,
  };
}

/**
 * Import weight data from CSV.
 * Expected format: date, weight_kg
 */
export async function importWeightsFromCSV(csvText: string): Promise<ImportResult> {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return { success: false, recordsImported: 0, recordsSkipped: 0, errors: ['Veri bulunamadi.'], summary: '' };

  const headers = rows[0].map(h => h.toLowerCase());
  const dataRows = rows.slice(1);
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  const dateCol = headers.findIndex(h => h.includes('date') || h.includes('tarih'));
  const weightCol = headers.findIndex(h => h.includes('weight') || h.includes('kilo') || h.includes('kg'));

  if (dateCol === -1 || weightCol === -1) {
    return { success: false, recordsImported: 0, recordsSkipped: 0,
      errors: ['CSV basliklarinda "date/tarih" ve "weight/kilo/kg" sutunlari bulunamadi.'],
      summary: `Bulunan basliklar: ${headers.join(', ')}` };
  }

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const date = row[dateCol];
    const weight = parseFloat(row[weightCol]);

    if (!date || isNaN(weight)) { skipped++; continue; }
    if (weight < 20 || weight > 350) { errors.push(`Satir ${i + 2}: ${weight}kg gecersiz aralik.`); skipped++; continue; }

    await supabase.from('daily_metrics').upsert(
      { date: normalizeDate(date), weight_kg: weight, synced: true },
      { onConflict: 'user_id,date' },
    );
    await supabase.from('weight_history').insert({ weight_kg: weight, recorded_at: normalizeDate(date) });
    imported++;
  }

  return {
    success: imported > 0,
    recordsImported: imported,
    recordsSkipped: skipped,
    errors: errors.slice(0, 10),
    summary: `${imported} tarti kaydi iceri aktarildi${skipped > 0 ? `, ${skipped} atlandi` : ''}.`,
  };
}

/**
 * Get expected CSV format templates for user reference.
 */
export function getCSVTemplates(): Record<string, string> {
  return {
    meals: 'tarih,ogun,yemek,kalori,protein\n2024-01-15,ogle,Tavuk salata,350,32\n2024-01-15,aksam,Makarna,500,18',
    weights: 'tarih,kilo\n2024-01-15,82.5\n2024-01-16,82.3',
  };
}

// Helpers

function mapMealType(raw: string): string {
  const lower = (raw ?? '').toLowerCase();
  if (lower.includes('breakfast') || lower.includes('kahvalti')) return 'breakfast';
  if (lower.includes('lunch') || lower.includes('ogle')) return 'lunch';
  if (lower.includes('dinner') || lower.includes('aksam')) return 'dinner';
  return 'snack';
}

function guessMealTypeByIndex(index: number, total: number): string {
  const position = index / total;
  if (position < 0.25) return 'breakfast';
  if (position < 0.5) return 'lunch';
  if (position < 0.75) return 'dinner';
  return 'snack';
}

function normalizeDate(dateStr: string): string {
  // Handle common date formats
  const cleaned = dateStr.replace(/\//g, '-');
  // If DD-MM-YYYY, convert to YYYY-MM-DD
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(cleaned)) {
    const [d, m, y] = cleaned.split('-');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return cleaned;
}

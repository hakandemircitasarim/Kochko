/**
 * Supplement Tracking Service — Spec 3.1
 * Logs supplements with macro impact, tracks daily totals,
 * provides supplement-drug interaction awareness (Spec 5.6).
 */
import { supabase } from '@/lib/supabase';

// Spec 3.1: Supplement parse detayları
const SUPPLEMENT_MACROS: Record<string, { calories: number; protein_g: number; note: string }> = {
  'protein tozu': { calories: 120, protein_g: 24, note: 'Tam makro etkisi gunluk toplama eklenir.' },
  'protein': { calories: 120, protein_g: 24, note: 'Tam makro etkisi gunluk toplama eklenir.' },
  'kreatin': { calories: 0, protein_g: 0, note: 'Kalori etkisi ihmal edilebilir ama sivi tutulumu tartiyi etkiler.' },
  'bcaa': { calories: 20, protein_g: 5, note: 'BCAA ~4 kcal/g, gunluk toplama eklenir.' },
  'omega-3': { calories: 25, protein_g: 0, note: '2-3g yag = 18-27 kcal.' },
  'omega3': { calories: 25, protein_g: 0, note: '2-3g yag = 18-27 kcal.' },
  'd vitamini': { calories: 0, protein_g: 0, note: 'Kalori etkisi yok, sadece takip.' },
  'vitamin d': { calories: 0, protein_g: 0, note: 'Kalori etkisi yok, sadece takip.' },
  'multivitamin': { calories: 0, protein_g: 0, note: 'Kalori etkisi yok, sadece takip.' },
  'magnezyum': { calories: 0, protein_g: 0, note: 'Kalori etkisi yok.' },
  'cinko': { calories: 0, protein_g: 0, note: 'Kalori etkisi yok.' },
  'zinc': { calories: 0, protein_g: 0, note: 'Kalori etkisi yok.' },
};

// Known supplement-drug interaction warnings (Spec 5.6)
const INTERACTION_WARNINGS: Record<string, string[]> = {
  'omega-3': ['kan sulandirici', 'aspirin', 'warfarin', 'coumadin'],
  'omega3': ['kan sulandirici', 'aspirin', 'warfarin', 'coumadin'],
  'd vitamini': ['tiazid', 'kalsiyum kanal'],
  'kreatin': ['bobrek ilaci', 'nsaid', 'ibuprofen'],
  'magnezyum': ['antibiyotik', 'bisfosfonat'],
};

export interface SupplementLog {
  id: string;
  supplement_name: string;
  amount: string;
  calories: number;
  protein_g: number;
  date: string;
  logged_at: string;
}

/**
 * Log a supplement with automatic macro estimation.
 */
export async function logSupplement(name: string, amount: string): Promise<{ calories: number; protein_g: number; note: string }> {
  const key = name.toLowerCase().trim();
  const macros = Object.entries(SUPPLEMENT_MACROS).find(([k]) => key.includes(k));
  const cal = macros ? macros[1].calories : 0;
  const pro = macros ? macros[1].protein_g : 0;
  const note = macros ? macros[1].note : 'Kalori etkisi bilinmiyor, sadece takip.';

  const date = new Date().toISOString().split('T')[0];
  await supabase.from('supplement_logs').insert({
    supplement_name: name, amount, date, calories: cal, protein_g: pro,
  });

  return { calories: cal, protein_g: pro, note };
}

/**
 * Get today's logged supplements.
 */
export async function getTodaySupplements(): Promise<SupplementLog[]> {
  const date = new Date().toISOString().split('T')[0];
  const { data } = await supabase.from('supplement_logs').select('*').eq('date', date).order('logged_at');
  return (data ?? []) as SupplementLog[];
}

/**
 * Get daily supplement totals (calories + protein).
 */
export async function getDailySupplementTotals(): Promise<{ totalCalories: number; totalProtein: number }> {
  const supplements = await getTodaySupplements();
  return {
    totalCalories: supplements.reduce((s, sup) => s + (sup.calories ?? 0), 0),
    totalProtein: supplements.reduce((s, sup) => s + (sup.protein_g ?? 0), 0),
  };
}

/**
 * Check supplement-drug interaction (Spec 5.6).
 * Returns warning message if interaction detected, null otherwise.
 */
export function checkSupplementDrugInteraction(
  supplementName: string,
  userMedications: string[],
): string | null {
  const key = supplementName.toLowerCase().trim();

  for (const [suppKey, drugs] of Object.entries(INTERACTION_WARNINGS)) {
    if (key.includes(suppKey)) {
      for (const med of userMedications) {
        const medLower = med.toLowerCase();
        for (const drug of drugs) {
          if (medLower.includes(drug)) {
            return `Hem ${supplementName} hem ${med} kullandigini goruyorum. Bu ikisinin etkilesimi konusunda doktorunla konusmani oneririm.`;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Delete a supplement log.
 */
export async function deleteSupplementLog(id: string): Promise<void> {
  await supabase.from('supplement_logs').delete().eq('id', id);
}

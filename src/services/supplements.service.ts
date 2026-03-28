/**
 * Supplement Tracking Service
 * Spec 3.1: Supplement/takviye kaydı
 */
import { supabase } from '@/lib/supabase';

export interface SupplementLog {
  id: string;
  supplement_name: string;
  amount: string;
  calories: number;
  protein_g: number;
  logged_for_date: string;
  logged_at: string;
}

// Known supplement macro effects (Spec 3.1)
const SUPPLEMENT_MACROS: Record<string, { calories: number; protein_g: number; carbs_g: number; fat_g: number }> = {
  protein_powder: { calories: 120, protein_g: 25, carbs_g: 3, fat_g: 1 },
  creatine: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  bcaa: { calories: 20, protein_g: 5, carbs_g: 0, fat_g: 0 },
  omega3: { calories: 25, protein_g: 0, carbs_g: 0, fat_g: 3 },
  vitamin_d: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  multivitamin: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
};

export async function logSupplement(name: string, amount: string): Promise<void> {
  const key = name.toLowerCase().replace(/\s+/g, '_');
  const macros = SUPPLEMENT_MACROS[key] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

  await supabase.from('supplement_logs').insert({
    supplement_name: name,
    amount,
    calories: macros.calories,
    protein_g: macros.protein_g,
    logged_for_date: new Date().toISOString().split('T')[0],
  });
}

export async function getTodaySupplements(): Promise<SupplementLog[]> {
  const date = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('supplement_logs')
    .select('*')
    .eq('logged_for_date', date)
    .order('logged_at');
  return (data ?? []) as SupplementLog[];
}

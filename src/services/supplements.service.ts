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

export async function getTodaySupplements(userId?: string): Promise<SupplementLog[]> {
  const date = new Date().toISOString().split('T')[0];
  let query = supabase
    .from('supplement_logs')
    .select('*')
    .eq('logged_for_date', date)
    .order('logged_at');
  if (userId) query = query.eq('user_id', userId);
  const { data } = await query;
  return (data ?? []) as SupplementLog[];
}

// ─── Creatine Water Retention Awareness ───

/**
 * Check if user is taking creatine and should be warned about water retention.
 * Kreatin kullanıyorsan tartı artışını su tutulumu olarak değerlendirir, panik yaratmaz.
 */
export async function checkCreatineWaterRetention(userId: string): Promise<{
  isOnCreatine: boolean;
  recentlyStarted: boolean;
  message: string | null;
}> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const { data: creatineLogs } = await supabase
    .from('supplement_logs')
    .select('logged_for_date')
    .eq('user_id', userId)
    .ilike('supplement_name', '%kreatin%')
    .gte('logged_for_date', thirtyDaysAgo)
    .order('logged_for_date');

  // Also check English spelling
  const { data: creatineLogsEn } = await supabase
    .from('supplement_logs')
    .select('logged_for_date')
    .eq('user_id', userId)
    .ilike('supplement_name', '%creatine%')
    .gte('logged_for_date', thirtyDaysAgo)
    .order('logged_for_date');

  const allLogs = [...(creatineLogs ?? []), ...(creatineLogsEn ?? [])] as { logged_for_date: string }[];

  if (allLogs.length === 0) {
    return { isOnCreatine: false, recentlyStarted: false, message: null };
  }

  // Check if recently started (first log within last 7 days)
  const firstLog = allLogs[0].logged_for_date;
  const recentlyStarted = firstLog >= sevenDaysAgo;

  let message: string | null = null;

  if (recentlyStarted) {
    message = 'Kreatin kullanmaya yeni baslamis gorunuyorsun. Ilk 1-2 haftada tartida 1-2kg artis gorebilirsin — bu YAG DEGIL, su tutulumudir. Panik yapma, normaldir.';
  } else if (allLogs.length >= 5) {
    message = 'Kreatin kullaniyorsun. Tartidaki artislar su tutulumundan kaynaklanabilir. Kilo takibinde bunu goz onunde bulundur.';
  }

  return {
    isOnCreatine: true,
    recentlyStarted,
    message,
  };
}

/**
 * Build creatine context for AI weight interpretation.
 * Used when user logs weight and is on creatine.
 */
export function getCreatineWeightContext(isOnCreatine: boolean, recentlyStarted: boolean): string {
  if (!isOnCreatine) return '';

  if (recentlyStarted) {
    return 'KREATIN NOTU: Kullanici yeni kreatin basladi. Tartidaki 1-2kg artis su tutulumudir, YAG DEGIL. Panik yaratma, normal oldugunu acikla.';
  }

  return 'KREATIN NOTU: Kullanici kreatin kullaniyor. Tarti degisimlerinde su tutulumu faktorunu dikkate al.';
}

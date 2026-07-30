/**
 * Supplement Tracking Service
 * Spec 3.1: Supplement/takviye kaydı
 */
import { getEffectiveDate } from '@/lib/day-boundary';
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

// Map user-facing / Turkish display names (quick-add pills, free text) to the
// canonical SUPPLEMENT_MACROS keys. Without this, 'Protein' / 'Kreatin' /
// 'Omega-3' / 'Multi' never match and the supplement logs 0 cal / 0 g protein.
const SUPPLEMENT_ALIASES: Record<string, string> = {
  protein: 'protein_powder',
  protein_tozu: 'protein_powder',
  whey: 'protein_powder',
  kreatin: 'creatine',
  omega: 'omega3',
  'omega-3': 'omega3',
  omega_3: 'omega3',
  balik_yagi: 'omega3',
  multi: 'multivitamin',
  'd-vitamini': 'vitamin_d',
  d_vitamini: 'vitamin_d',
};

export async function logSupplement(name: string, amount: string): Promise<{ error: string | null }> {
  const norm = name.toLowerCase().trim().replace(/\s+/g, '_');
  const key = SUPPLEMENT_ALIASES[norm] ?? norm;
  const macros = SUPPLEMENT_MACROS[key] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

  // supplement_logs.user_id is NOT NULL + RLS WITH CHECK(auth.uid()=user_id)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Oturum bulunamadi.' };

  const { error } = await supabase.from('supplement_logs').insert({
    user_id: user.id,
    supplement_name: name,
    amount,
    calories: macros.calories,
    protein_g: macros.protein_g,
    // ux-sweep (SU-01): efektif gün (04:00 sınırı) — UTC değil.
    logged_for_date: getEffectiveDate(new Date(), 4),
  });
  return { error: error?.message ?? null };
}

export async function getTodaySupplements(userId?: string): Promise<SupplementLog[]> {
  const date = getEffectiveDate(new Date(), 4);
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
    message = 'Kreatin kullanmaya yeni başlamış görünüyorsun. İlk 1-2 haftada tartıda 1-2 kg artış görebilirsin — bu YAĞ DEĞİL, su tutulumudur. Panik yapma, normaldir.';
  } else if (allLogs.length >= 5) {
    message = 'Kreatin kullanıyorsun. Tartıdaki artışlar su tutulumundan kaynaklanabilir. Kilo takibinde bunu göz önünde bulundur.';
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

/**
 * Weight Service
 * Tek "güncel kilo" yazım yolu — daily_metrics (bugünün satırı) ve profiles.weight_kg
 * HER ZAMAN birlikte güncellenir. (Canlıda görülen split-brain: Profil 80 gösterirken
 * dashboard 79.5 gösteriyordu, çünkü tartı kaydı yalnız daily_metrics'e yazıyordu.)
 */
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';

/**
 * Kullanıcının güncel kilosunu kaydeder:
 * 1) Bugünün daily_metrics satırına upsert (kullanıcının gün sınırı saatine göre —
 *    addWater / tartı kaydındaki mevcut effective-date kuralının aynısı),
 * 2) profiles.weight_kg güncellemesi.
 * İki yazım da zorunludur; herhangi biri başarısız olursa throw eder.
 *
 * `dayBoundaryHour` verilmezse (ör. profil store'a erişimi olmayan çağıranlar)
 * profiles.day_boundary_hour'dan okunur, o da yoksa 04:00 varsayılanı kullanılır.
 */
export async function updateCurrentWeight(
  userId: string,
  weightKg: number,
  dayBoundaryHour?: number,
): Promise<void> {
  // Bozuk değer iki tabloya birden yayılmasın — çağıranlar zaten 20–300 doğrular,
  // bu son savunma hattı.
  if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
    throw new Error(`updateCurrentWeight: geçersiz kilo değeri (${weightKg})`);
  }

  let boundary = dayBoundaryHour;
  if (typeof boundary !== 'number') {
    const { data } = await supabase
      .from('profiles')
      .select('day_boundary_hour')
      .eq('id', userId)
      .maybeSingle();
    boundary = typeof data?.day_boundary_hour === 'number' ? data.day_boundary_hour : 4;
  }
  const date = getEffectiveDate(new Date(), boundary);

  // İki yazım bağımsız tablolara gider — paralel koştur (mobil RTT'de yarı gecikme).
  const [metricsRes, profileRes] = await Promise.all([
    supabase.from('daily_metrics').upsert(
      { user_id: userId, date, weight_kg: weightKg, synced: true },
      { onConflict: 'user_id,date' },
    ),
    supabase
      .from('profiles')
      .update({ weight_kg: weightKg, updated_at: new Date().toISOString() })
      .eq('id', userId),
  ]);
  if (metricsRes.error) throw metricsRes.error;
  if (profileRes.error) throw profileRes.error;
}

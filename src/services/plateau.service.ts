/**
 * Plateau Detection Service
 * Spec 6.5: Plateau yönetimi
 *
 * Detects when weight has stalled for 3+ weeks (±0.3kg).
 * Provides strategy options for breaking through.
 */
import { supabase } from '@/lib/supabase';

export interface PlateauStatus {
  isInPlateau: boolean;
  weeksSinceChange: number;
  avgWeight: number | null;
  strategies: PlateauStrategy[];
  message: string;
}

export interface PlateauStrategy {
  id: string;
  name: string;
  description: string;
}

const STRATEGIES: PlateauStrategy[] = [
  { id: 'calorie_cycle', name: 'Kalori Dongusu', description: 'Hafta ici/hafta sonu farkli kalori araliği uygulanir. Metabolizma uyandirilir.' },
  { id: 'refeed', name: 'Refeed Gunu', description: 'Haftada 1 gun kalori bakim seviyesine cikarilir. Genellikle yogun antrenman gununde.' },
  { id: 'tdee_recalc', name: 'TDEE Yeniden Hesaplama', description: 'Mevcut kiloya gore TDEE yeniden hesaplanir. Kilo dustukce TDEE de duser.' },
  { id: 'maintenance_break', name: '2 Hafta Bakim', description: 'Kalori acigi tamamen kapatilir, 2 hafta bakim kalorilerinde yenir. Metabolik sifirlama.' },
  { id: 'training_change', name: 'Antrenman Degisikligi', description: 'Farkli antrenman tipi veya yogunluk. Vucudu yeni uyaranla karsilastirma.' },
];

/**
 * Detect plateau from weight data.
 * Spec 6.5: 3+ hafta ±0.3kg = plateau.
 */
export async function detectPlateau(userId: string): Promise<PlateauStatus> {
  const threeWeeksAgo = new Date(Date.now() - 21 * 86400000).toISOString().split('T')[0];

  const { data } = await supabase
    .from('daily_metrics')
    .select('weight_kg')
    .eq('user_id', userId)
    .gte('date', threeWeeksAgo)
    .not('weight_kg', 'is', null)
    .order('date');

  const weights = (data ?? []).map((d: { weight_kg: number }) => d.weight_kg);

  if (weights.length < 5) {
    return { isInPlateau: false, weeksSinceChange: 0, avgWeight: null, strategies: [], message: 'Yeterli tarti verisi yok.' };
  }

  const avg = weights.reduce((s: number, w: number) => s + w, 0) / weights.length;
  const maxDiff = Math.max(...weights.map((w: number) => Math.abs(w - avg)));

  if (maxDiff <= 0.3) {
    return {
      isInPlateau: true,
      weeksSinceChange: Math.floor(weights.length / 3),
      avgWeight: Math.round(avg * 10) / 10,
      strategies: STRATEGIES.slice(0, 3), // AI should pick best 1-2
      message: `${Math.floor(weights.length / 3)} haftadir ${avg.toFixed(1)}kg civarinda kaliyor. Plateau olabilir.`,
    };
  }

  return { isInPlateau: false, weeksSinceChange: 0, avgWeight: Math.round(avg * 10) / 10, strategies: [], message: '' };
}

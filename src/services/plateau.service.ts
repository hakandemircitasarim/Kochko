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
    .select('weight_kg, date')
    .eq('user_id', userId)
    .gte('date', threeWeeksAgo)
    .not('weight_kg', 'is', null)
    .order('date');

  // #journey: TREND-based detection, not max-deviation. The old `maxDiff <= 0.3kg from the
  // 21-day mean` gate MISSED real plateaus (honest daily weigh-ins jitter past 0.3kg from
  // water/food) and required >=5 weigh-ins (inert for the many users who weigh 2-4x/wk).
  // Now: compare the mean of the first third vs the last third of the window — a small NET
  // change over ~2+ weeks is a plateau regardless of day-to-day noise. Duration is computed
  // from CALENDAR dates, not sample count.
  const rows = (data ?? []) as { weight_kg: number; date: string }[];
  const weights = rows.map((r) => r.weight_kg);
  if (weights.length < 2) {
    return { isInPlateau: false, weeksSinceChange: 0, avgWeight: weights.length ? Math.round(weights[0] * 10) / 10 : null, strategies: [], message: 'Yeterli tarti verisi yok.' };
  }
  const avg = weights.reduce((s, w) => s + w, 0) / weights.length;
  const k = Math.max(1, Math.floor(weights.length / 3));
  const firstMean = weights.slice(0, k).reduce((s, w) => s + w, 0) / k;
  const lastMean = weights.slice(-k).reduce((s, w) => s + w, 0) / k;
  const netLoss = firstMean - lastMean; // > 0 = still losing
  const spanDays = Math.max(0, Math.round((Date.parse(rows[rows.length - 1].date) - Date.parse(rows[0].date)) / 86400000));
  const weeks = Math.max(1, Math.round(spanDays / 7));
  // Plateau = losing < 0.3kg net over the window (a healthy cut loses ~1.5-2kg over 3 weeks).
  const flat = netLoss < 0.3;
  const roundedAvg = Math.round(avg * 10) / 10;

  if (weights.length >= 5 && spanDays >= 12 && flat) {
    return {
      isInPlateau: true, weeksSinceChange: weeks, avgWeight: roundedAvg,
      strategies: STRATEGIES.slice(0, 3),
      message: `${weeks} haftadir ${avg.toFixed(1)}kg civarinda kaliyor. Plateau olabilir.`,
    };
  }
  // Low-data soft signal: 2-4 weigh-ins over >=12 days that are flat — nudge to weigh more.
  if (weights.length >= 2 && weights.length < 5 && spanDays >= 12 && flat) {
    return {
      isInPlateau: true, weeksSinceChange: weeks, avgWeight: roundedAvg,
      strategies: STRATEGIES.slice(0, 2),
      message: `Son ${weeks} haftada kilon ${avg.toFixed(1)}kg civarinda sabit gorunuyor. Daha sik tartilirsan durumu netlestirebiliriz.`,
    };
  }

  return { isInPlateau: false, weeksSinceChange: 0, avgWeight: roundedAvg, strategies: [], message: '' };
}

// ─── Strategy Selection (Phase 3) ───

export interface StrategyRecommendation {
  primary: PlateauStrategy;
  secondary: PlateauStrategy | null;
  reasoning: string;
}

/**
 * Select best 1-2 strategies based on user context.
 * AI-informed: considers training style, compliance, duration.
 */
export function selectBestStrategy(
  weeksSinceChange: number,
  trainingStyle: string | null,
  avgCompliance: number | null,
  currentCalorieDeficit: number
): StrategyRecommendation {
  const compliance = avgCompliance ?? 70;

  // High compliance + long plateau → metabolic adaptation likely
  if (compliance >= 80 && weeksSinceChange >= 4) {
    return {
      primary: STRATEGIES.find(s => s.id === 'maintenance_break')!,
      secondary: STRATEGIES.find(s => s.id === 'refeed')!,
      reasoning: `Uyumun yuksek (%${compliance}) ama ${weeksSinceChange} haftadir kilo degismiyor. Metabolik adaptasyon olabilir. 2 haftalik bakim molasi metabolizmayi sifirlayabilir.`,
    };
  }

  // Strength-focused user → training change effective
  if (trainingStyle === 'strength' || trainingStyle === 'powerlifting') {
    return {
      primary: STRATEGIES.find(s => s.id === 'training_change')!,
      secondary: STRATEGIES.find(s => s.id === 'calorie_cycle')!,
      reasoning: 'Guc antrenmanina odaklisin. Antrenman degisikligi (farkli split, farkli tekrar araliklari) vucudu yeni uyaranla karsilastirir.',
    };
  }

  // Low compliance → TDEE recalc (they may be eating more than logged)
  if (compliance < 65) {
    return {
      primary: STRATEGIES.find(s => s.id === 'tdee_recalc')!,
      secondary: null,
      reasoning: `Uyum orani dusuk (%${compliance}). Once TDEE'yi yeniden hesaplayalim ve kayit dogrulugunu arttiralim.`,
    };
  }

  // Default: calorie cycling + refeed
  return {
    primary: STRATEGIES.find(s => s.id === 'calorie_cycle')!,
    secondary: STRATEGIES.find(s => s.id === 'refeed')!,
    reasoning: 'Kalori dongusu metabolizmayi canlandirir. Haftada 1 refeed gunu de ekleyebiliriz.',
  };
}

/**
 * Apply selected plateau strategy — returns plan modifications.
 */
export function applyPlateauStrategy(
  strategyId: string,
  currentCalorieTarget: { min: number; max: number },
  currentProteinTarget: number
): { adjustedCalorie: { min: number; max: number }; adjustedProtein: number; instructions: string } {
  switch (strategyId) {
    case 'calorie_cycle':
      return {
        adjustedCalorie: {
          min: currentCalorieTarget.min - 200, // low days
          max: currentCalorieTarget.max + 200, // high days
        },
        adjustedProtein: currentProteinTarget,
        instructions: 'Hafta ici dusuk kalori, hafta sonu yuksek kalori. Ortalama ayni kalir ama metabolizma canlanir.',
      };
    case 'refeed':
      return {
        adjustedCalorie: currentCalorieTarget, // unchanged on normal days
        adjustedProtein: currentProteinTarget,
        instructions: 'Haftada 1 gun (antrenman gunu) kaloriyi bakim seviyesine cikar. Karbonhidrat agirlikli.',
      };
    case 'tdee_recalc':
      return {
        adjustedCalorie: {
          min: Math.round(currentCalorieTarget.min * 0.95),
          max: Math.round(currentCalorieTarget.max * 0.95),
        },
        adjustedProtein: currentProteinTarget,
        instructions: 'TDEE yeniden hesaplandi. Kalori araligi %5 dusuruldu. 2 hafta izle.',
      };
    case 'maintenance_break':
      return {
        adjustedCalorie: {
          min: currentCalorieTarget.max, // raise to maintenance
          max: currentCalorieTarget.max + 300,
        },
        adjustedProtein: currentProteinTarget,
        instructions: '2 hafta bakim kalorilerinde ye. Acik yok. Metabolik sifirlama. Sonra tekrar deficit.',
      };
    case 'training_change':
      return {
        adjustedCalorie: currentCalorieTarget,
        adjustedProtein: currentProteinTarget + 5,
        instructions: 'Antrenman programini degistir: farkli split, farkli tekrar araliklari, yeni hareketler.',
      };
    default:
      return {
        adjustedCalorie: currentCalorieTarget,
        adjustedProtein: currentProteinTarget,
        instructions: '',
      };
  }
}

/**
 * Check if plateau auto-trigger should fire.
 * Called from proactive service.
 */
export async function checkAutoTrigger(userId: string): Promise<{ shouldTrigger: boolean; status: PlateauStatus }> {
  const status = await detectPlateau(userId);
  return {
    shouldTrigger: status.isInPlateau && status.weeksSinceChange >= 3,
    status,
  };
}

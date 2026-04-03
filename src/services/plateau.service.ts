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

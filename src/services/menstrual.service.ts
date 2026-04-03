/**
 * Menstrual Cycle Tracking Service
 * Spec 2.1: Kadınlara özel döngü takibi ve otomatik ayarlama
 */
import { supabase } from '@/lib/supabase';

export type CyclePhase = 'follicular' | 'ovulation' | 'luteal' | 'menstrual';

export interface CycleStatus {
  active: boolean;
  currentPhase: CyclePhase | null;
  dayOfCycle: number | null;
  cycleLength: number;
  nextPeriodEstimate: string | null;
  phaseAdvice: string | null;
}

const PHASE_ADVICE: Record<CyclePhase, string> = {
  menstrual: 'Enerji en dusuk seviyede olabilir. Antrenman yogunlugu dusuruldu, hafif aktivite onerilir.',
  follicular: 'Enerji yukseliyor, karbonhidrat toleransi iyi. Yogun antrenmanlar icin uygun donem.',
  ovulation: 'Guc performansi zirve yapabilir. Agirlik antrenmaninda PR denemesi icin uygun.',
  luteal: 'Istah artabilir, su tutulumu olabilir. Kalori tabani +100-200 kcal yukseltildi. Tarti artisi normaldir.',
};

/**
 * Calculate current cycle phase from last period start date.
 * Simplified model based on average cycle lengths.
 */
export function calculateCycleStatus(
  lastPeriodStart: string | null,
  cycleLength: number
): CycleStatus {
  if (!lastPeriodStart) {
    return { active: false, currentPhase: null, dayOfCycle: null, cycleLength, nextPeriodEstimate: null, phaseAdvice: null };
  }

  const start = new Date(lastPeriodStart);
  const today = new Date();
  const daysSinceStart = Math.floor((today.getTime() - start.getTime()) / 86400000);
  const dayOfCycle = (daysSinceStart % cycleLength) + 1;

  // Phase calculation (approximate)
  // Menstrual: day 1-5
  // Follicular: day 6 - ovulation (cycle/2 - 1)
  // Ovulation: around day cycle/2
  // Luteal: ovulation+1 to end
  const ovulationDay = Math.round(cycleLength / 2);
  let currentPhase: CyclePhase;

  if (dayOfCycle <= 5) {
    currentPhase = 'menstrual';
  } else if (dayOfCycle <= ovulationDay - 2) {
    currentPhase = 'follicular';
  } else if (dayOfCycle <= ovulationDay + 1) {
    currentPhase = 'ovulation';
  } else {
    currentPhase = 'luteal';
  }

  // Next period estimate
  const nextPeriod = new Date(start);
  nextPeriod.setDate(nextPeriod.getDate() + Math.ceil(daysSinceStart / cycleLength) * cycleLength);
  const nextPeriodEstimate = nextPeriod.toISOString().split('T')[0];

  return {
    active: true,
    currentPhase,
    dayOfCycle,
    cycleLength,
    nextPeriodEstimate,
    phaseAdvice: PHASE_ADVICE[currentPhase],
  };
}

// ─── Phase Adjustments (Phase 3: Auto calorie/macro/training adjustments) ───

export interface PhaseAdjustments {
  calorieAdjust: number; // kcal to add/subtract from base
  proteinMultiplier: number; // multiply base protein by this
  waterAdjust: number; // liters to add
  trainingIntensityMax: 'high' | 'moderate' | 'low';
  trainingNote: string;
  weightNote: string | null; // explanation for weight fluctuations
}

const PHASE_ADJUSTMENTS: Record<CyclePhase, PhaseAdjustments> = {
  menstrual: {
    calorieAdjust: 0,
    proteinMultiplier: 1.0,
    waterAdjust: 0,
    trainingIntensityMax: 'low',
    trainingNote: 'Enerji en dusuk — hafif yuruyus, yoga veya tam dinlenme onerilir.',
    weightNote: null,
  },
  follicular: {
    calorieAdjust: 0,
    proteinMultiplier: 1.0,
    waterAdjust: 0,
    trainingIntensityMax: 'high',
    trainingNote: 'Enerji yukseliyor — yogun antrenman ve karbonhidrat icin ideal donem.',
    weightNote: null,
  },
  ovulation: {
    calorieAdjust: 0,
    proteinMultiplier: 1.0,
    waterAdjust: 0,
    trainingIntensityMax: 'high',
    trainingNote: 'Guc zirvede — PR denemeleri ve agir antrenman icin en uygun donem.',
    weightNote: null,
  },
  luteal: {
    calorieAdjust: 150, // +100-200 kcal
    proteinMultiplier: 1.05,
    waterAdjust: 0.2,
    trainingIntensityMax: 'moderate',
    trainingNote: 'Istah artabilir, normal. Antrenman yogunlugu orta seviyede tut.',
    weightNote: 'Su tutulumu nedeniyle tarti 0.5-1.5kg artabilir. Bu YAG DEGIL, gecicidir. Panik yapma.',
  },
};

/**
 * Get phase-specific adjustments for plan generation.
 * Used by ai-plan to modify calorie/protein/training targets.
 */
export function getPhaseAdjustments(phase: CyclePhase): PhaseAdjustments {
  return PHASE_ADJUSTMENTS[phase];
}

/**
 * Check if current phase is a water retention phase.
 * Used to contextualize weight changes.
 */
export function isWaterRetentionPhase(phase: CyclePhase): { isRetention: boolean; message: string | null } {
  if (phase === 'luteal') {
    return {
      isRetention: true,
      message: 'Luteal fazdasin — su tutulumu nedeniyle tarti artisi normal. Bu yag degil, adet baslayinca duser.',
    };
  }
  return { isRetention: false, message: null };
}

/**
 * Get full cycle context for AI plan/chat.
 */
export function getCycleContext(status: CycleStatus): string {
  if (!status.active || !status.currentPhase) return '';

  const adj = getPhaseAdjustments(status.currentPhase);
  const parts: string[] = [
    `## DONGU DURUMU`,
    `Faz: ${status.currentPhase} (gun ${status.dayOfCycle}/${status.cycleLength})`,
    `Tahmini sonraki adet: ${status.nextPeriodEstimate}`,
  ];

  if (adj.calorieAdjust !== 0) parts.push(`Kalori ayari: +${adj.calorieAdjust} kcal`);
  if (adj.waterAdjust > 0) parts.push(`Su hedefi: +${adj.waterAdjust}L`);
  parts.push(`Max antrenman: ${adj.trainingIntensityMax}`);
  parts.push(`Not: ${adj.trainingNote}`);
  if (adj.weightNote) parts.push(`Tarti notu: ${adj.weightNote}`);

  return parts.join('\n');
}

/**
 * Update menstrual tracking settings in profile.
 */
export async function updateMenstrualSettings(
  userId: string,
  tracking: boolean,
  cycleLength?: number,
  lastPeriodStart?: string
): Promise<void> {
  await supabase.from('profiles').update({
    menstrual_tracking: tracking,
    menstrual_cycle_length: cycleLength ?? null,
    menstrual_last_period_start: lastPeriodStart ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', userId);
}

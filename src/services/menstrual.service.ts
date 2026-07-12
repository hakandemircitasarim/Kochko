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
  menstrual: 'Enerji en düşük seviyede olabilir. Antrenman yoğunluğu düşürüldü, hafif aktivite önerilir.',
  follicular: 'Enerji yükseliyor, karbonhidrat toleransı iyi. Yoğun antrenmanlar için uygun dönem.',
  ovulation: 'Güç performansı zirve yapabilir. Ağırlık antrenmanında PR denemesi için uygun.',
  luteal: 'İştah artabilir, su tutulumu olabilir. Kalori tabanı +100-200 kcal yükseltildi. Tartı artışı normaldir.',
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
  // Guard invalid data: an unparseable/future start date or a non-positive cycle
  // length would yield a negative/garbage day-of-cycle and a wrong phase (#R5-13).
  if (Number.isNaN(start.getTime()) || daysSinceStart < 0 || cycleLength <= 0) {
    return { active: false, currentPhase: null, dayOfCycle: null, cycleLength, nextPeriodEstimate: null, phaseAdvice: null };
  }
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
    trainingNote: 'Enerji en düşük — hafif yürüyüş, yoga veya tam dinlenme önerilir.',
    weightNote: null,
  },
  follicular: {
    calorieAdjust: 0,
    proteinMultiplier: 1.0,
    waterAdjust: 0,
    trainingIntensityMax: 'high',
    trainingNote: 'Enerji yükseliyor — yoğun antrenman ve karbonhidrat için ideal dönem.',
    weightNote: null,
  },
  ovulation: {
    calorieAdjust: 0,
    proteinMultiplier: 1.0,
    waterAdjust: 0,
    trainingIntensityMax: 'high',
    trainingNote: 'Güç zirvede — PR denemeleri ve ağır antrenman için en uygun dönem.',
    weightNote: null,
  },
  luteal: {
    calorieAdjust: 150, // +100-200 kcal
    proteinMultiplier: 1.05,
    waterAdjust: 0.2,
    trainingIntensityMax: 'moderate',
    trainingNote: 'İştah artabilir, normal. Antrenman yoğunluğunu orta seviyede tut.',
    weightNote: 'Su tutulumu nedeniyle tartı 0,5-1,5 kg artabilir. Bu YAĞ DEĞİL, geçicidir. Panik yapma.',
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
      message: 'Luteal fazdasın — su tutulumu nedeniyle tartı artışı normal. Bu yağ değil, adet başlayınca düşer.',
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
  const { error } = await supabase.from('profiles').update({
    menstrual_tracking: tracking,
    menstrual_cycle_length: cycleLength ?? null,
    menstrual_last_period_start: lastPeriodStart ?? null,
    updated_at: new Date().toISOString(),
  } as never).eq('id', userId);
  if (error) throw new Error(error.message);
}

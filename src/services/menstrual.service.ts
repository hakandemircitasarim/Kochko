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

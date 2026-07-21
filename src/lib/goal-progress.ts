/**
 * Goal Progress Calculator
 * Spec 6.3: Goal tracking - tempo, progress, estimated completion.
 */

import type { Goal } from '@/types/database';

export type PaceStatus = 'ahead' | 'on_track' | 'behind' | 'stalled';

export interface GoalProgress {
  kgLost: number;           // positive = lost, negative = gained (for gain goals this is flipped)
  kgRemaining: number;      // always positive
  percentComplete: number;  // 0-100
  weeksElapsed: number;
  weeksRemaining: number;
  estimatedCompletionDate: string | null; // ISO date
  paceStatus: PaceStatus;
  tempoRatio: number;       // 1.0 = on pace, >1 = ahead, <1 = behind
  weeklyActualRate: number; // kg/week actual
  isGoalReached: boolean;
}

const GOAL_REACHED_THRESHOLD_KG = 0.5;
const KCAL_PER_KG = 7700; // approximate kcal in 1kg of body weight

/**
 * Calculate comprehensive goal progress.
 */
export function calculateGoalProgress(
  goal: Goal,
  currentWeight: number,
  startWeight: number,
): GoalProgress {
  const isLossGoal = goal.goal_type === 'lose_weight';
  const isGainGoal = goal.goal_type === 'gain_weight' || goal.goal_type === 'gain_muscle';
  // FIX (ux-readiness): fall back to startWeight (NOT currentWeight) when no scale target is set
  // (e.g. a gain_muscle goal saved without a target kilo) — else targetWeight==currentWeight makes
  // kgRemaining=0 and isGoalReached fires a false "Hedefine ulaştın! 🎉" on a brand-new goal.
  const hasTarget = goal.target_weight_kg != null;
  const targetWeight = goal.target_weight_kg ?? startWeight;

  // Calculate total change needed and achieved
  const totalChangeNeeded = Math.abs(startWeight - targetWeight);
  const actualChange = Math.abs(startWeight - currentWeight);

  // Direction check: are we moving the right way?
  const movingRight = isLossGoal
    ? currentWeight < startWeight
    : isGainGoal
      ? currentWeight > startWeight
      : true; // maintain/health/conditioning

  const kgLost = isLossGoal ? startWeight - currentWeight : currentWeight - startWeight;
  const kgRemaining = Math.max(0, isLossGoal
    ? currentWeight - targetWeight
    : isGainGoal
      ? targetWeight - currentWeight
      : 0);

  const percentComplete = totalChangeNeeded > 0
    ? (movingRight ? Math.min(100, Math.round((actualChange / totalChangeNeeded) * 100)) : 0)
    : hasTarget ? 100 : 0; // no distance: at-target(100) only if a target exists, else undefined(0)

  // Time calculations
  const createdAt = new Date(goal.created_at);
  const now = new Date();
  const weeksElapsed = Math.max(1, Math.round((now.getTime() - createdAt.getTime()) / (7 * 24 * 60 * 60 * 1000)));
  const targetWeeks = goal.target_weeks ?? 12;
  const weeksRemaining = Math.max(0, targetWeeks - weeksElapsed);

  // Tempo: actual weekly rate vs planned
  const weeklyActualRate = weeksElapsed > 0 ? actualChange / weeksElapsed : 0;
  const plannedRate = goal.weekly_rate ?? (totalChangeNeeded / targetWeeks);
  const tempoRatio = plannedRate > 0 ? weeklyActualRate / plannedRate : 1;

  // Pace status. Wrong-direction → 'stalled' regardless of how new the goal is: tempoRatio
  // is built from the UNSIGNED actualChange, so without this a week-1 user who GAINED on a
  // lose_weight goal read as 'on_track'/'ahead' (green check) next to a correct 0% bar.
  // FIX (ux-readiness): a brand-new goal with no weigh-in yet has currentWeight==startWeight, so
  // movingRight is false (strict <) and every day-1 lose_weight user saw a red "Duraklama" north-star.
  // Distinguish "no movement yet on a fresh goal" from a genuine plateau.
  const noChangeYet = actualChange < 0.1;
  let paceStatus: PaceStatus;
  if (noChangeYet && weeksElapsed <= 1) {
    paceStatus = 'on_track';
  } else if (!movingRight) {
    paceStatus = 'stalled';
  } else if (tempoRatio >= 0.85) {
    paceStatus = tempoRatio >= 1.3 ? 'ahead' : 'on_track';
  } else if (tempoRatio >= 0.5) {
    paceStatus = 'behind';
  } else {
    paceStatus = 'stalled';
  }

  // Estimated completion
  let estimatedCompletionDate: string | null = null;
  if (movingRight && weeklyActualRate > 0 && kgRemaining > 0) {
    const weeksToGo = kgRemaining / weeklyActualRate;
    const completionDate = new Date(now.getTime() + weeksToGo * 7 * 24 * 60 * 60 * 1000);
    estimatedCompletionDate = completionDate.toISOString().split('T')[0];
  }

  // Goal reached check — only when a real target exists AND there was a real distance to cover
  // (guards the false "reached" for a no-target gain goal, where kgRemaining is trivially 0).
  const isGoalReached = hasTarget && totalChangeNeeded > GOAL_REACHED_THRESHOLD_KG && kgRemaining <= GOAL_REACHED_THRESHOLD_KG;

  return {
    kgLost: Math.round(kgLost * 10) / 10,
    kgRemaining: Math.round(kgRemaining * 10) / 10,
    percentComplete,
    weeksElapsed,
    weeksRemaining,
    estimatedCompletionDate,
    paceStatus,
    tempoRatio: Math.round(tempoRatio * 100) / 100,
    weeklyActualRate: Math.round(weeklyActualRate * 100) / 100,
    isGoalReached,
  };
}

/**
 * Turkish summary text for goal progress.
 */
export function getGoalSummaryText(progress: GoalProgress, goalType: string): string {
  if (progress.isGoalReached) {
    return 'Hedefe ulaştın! Tebrikler!';
  }

  const direction = goalType === 'lose_weight' ? 'verdin' : 'aldin';
  const paceText: Record<PaceStatus, string> = {
    ahead: 'tempon çok iyi',
    on_track: 'tempon iyi, böyle devam',
    behind: 'biraz gerideyiz ama toparlanabilirsin',
    stalled: 'ilerleme durmuş, planı gözden geçirelim',
  };

  return `${String(Math.abs(progress.kgLost)).replace('.', ',')} kg ${direction}, hedefe ${String(progress.kgRemaining).replace('.', ',')} kg kaldı. ${paceText[progress.paceStatus]}.`;
}

/**
 * Check if goal is reached within threshold.
 */
export function isGoalReached(goal: Goal, currentWeight: number): boolean {
  if (!goal.target_weight_kg) return false;

  if (goal.goal_type === 'lose_weight') {
    return currentWeight <= goal.target_weight_kg + GOAL_REACHED_THRESHOLD_KG;
  }
  if (goal.goal_type === 'gain_weight' || goal.goal_type === 'gain_muscle') {
    return currentWeight >= goal.target_weight_kg - GOAL_REACHED_THRESHOLD_KG;
  }
  // maintain, health, conditioning
  return Math.abs(currentWeight - goal.target_weight_kg) <= GOAL_REACHED_THRESHOLD_KG;
}

/**
 * Calculate required daily deficit/surplus to reach goal on time.
 */
export function calculateRequiredDeficit(kgRemaining: number, weeksRemaining: number): number {
  if (weeksRemaining <= 0) return 0;
  const weeklyRate = kgRemaining / weeksRemaining;
  return Math.round((weeklyRate * KCAL_PER_KG) / 7); // kcal per day
}

/**
 * Validate goal safety (Spec 6.1 + 12.1).
 */
export function validateGoalSafety(
  goalType: string,
  weeklyRate: number,
  currentWeight: number,
  heightCm: number | null,
): { safe: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Max 1kg/week loss
  if (goalType === 'lose_weight' && weeklyRate > 1.0) {
    warnings.push('Haftada 1 kg\'dan fazla kilo kaybı önerilmez.');
  }

  // BMI check for weight loss
  if (goalType === 'lose_weight' && heightCm) {
    const heightM = heightCm / 100;
    const currentBMI = currentWeight / (heightM * heightM);
    if (currentBMI < 20) {
      warnings.push('BMI\'n zaten düşük. Kilo verme hedefi uygun olmayabilir.');
    }
  }

  // Max 0.5kg/week gain
  if ((goalType === 'gain_weight' || goalType === 'gain_muscle') && weeklyRate > 0.5) {
    warnings.push('Haftada 0,5 kg\'dan fazla kilo alımı yağ birikimine yol açabilir.');
  }

  return { safe: warnings.length === 0, warnings };
}

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
  const targetWeight = goal.target_weight_kg ?? currentWeight;

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
    ? Math.min(100, Math.round((actualChange / totalChangeNeeded) * 100 * (movingRight ? 1 : 0)))
    : 100;

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

  // Pace status
  let paceStatus: PaceStatus;
  if (!movingRight && weeksElapsed >= 2) {
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
  if (weeklyActualRate > 0 && kgRemaining > 0) {
    const weeksToGo = kgRemaining / weeklyActualRate;
    const completionDate = new Date(now.getTime() + weeksToGo * 7 * 24 * 60 * 60 * 1000);
    estimatedCompletionDate = completionDate.toISOString().split('T')[0];
  }

  // Goal reached check
  const isGoalReached = kgRemaining <= GOAL_REACHED_THRESHOLD_KG;

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
    return 'Hedefe ulastin! Tebrikler!';
  }

  const direction = goalType === 'lose_weight' ? 'verdin' : 'aldin';
  const paceText: Record<PaceStatus, string> = {
    ahead: 'tempon cok iyi',
    on_track: 'tempon iyi, boyle devam',
    behind: 'biraz gerideyiz ama toparlanabilirsin',
    stalled: 'ilerleme durmus, plani gozden gecirelim',
  };

  return `${Math.abs(progress.kgLost)}kg ${direction}, hedefe ${progress.kgRemaining}kg kaldi. ${paceText[progress.paceStatus]}.`;
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
    warnings.push('Haftada 1kg\'dan fazla kilo kaybi onerilmez.');
  }

  // BMI check for weight loss
  if (goalType === 'lose_weight' && heightCm) {
    const heightM = heightCm / 100;
    const currentBMI = currentWeight / (heightM * heightM);
    if (currentBMI < 20) {
      warnings.push('BMI\'niz zaten dusuk. Kilo verme hedefi uygun olmayabilir.');
    }
  }

  // Max 0.5kg/week gain
  if ((goalType === 'gain_weight' || goalType === 'gain_muscle') && weeklyRate > 0.5) {
    warnings.push('Haftada 0.5kg\'dan fazla kilo alimi yag birikimine yol acabilir.');
  }

  return { safe: warnings.length === 0, warnings };
}

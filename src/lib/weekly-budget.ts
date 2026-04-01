/**
 * Weekly Calorie Budget Engine
 * Spec Section 2.6
 *
 * Tracks daily calorie consumption against weekly budget.
 * Provides rebalancing suggestions when user overeats one day.
 */

interface DayData {
  date: string;
  consumed: number;
  target: number;
  isTrainingDay: boolean;
}

interface WeeklyBudget {
  totalBudget: number;
  consumed: number;
  remaining: number;
  daysLeft: number;
  avgRemainingPerDay: number;
  overBudget: boolean;
  rebalanceMessage: string | null;
  dailyBreakdown: DayData[];
}

/**
 * Calculate weekly budget from training/rest day targets.
 * Default: 4 training + 3 rest days (customizable).
 */
export function calculateWeeklyBudget(
  trainingDayAvg: number,
  restDayAvg: number,
  trainingDaysPerWeek: number = 4
): number {
  const restDays = 7 - trainingDaysPerWeek;
  return Math.round(trainingDayAvg * trainingDaysPerWeek + restDayAvg * restDays);
}

/**
 * Get current week's budget status.
 */
export function getWeeklyStatus(
  weeklyBudget: number,
  dailyData: DayData[],
  todayIndex: number // 0=Monday, 6=Sunday
): WeeklyBudget {
  const consumed = dailyData.reduce((s, d) => s + d.consumed, 0);
  const remaining = weeklyBudget - consumed;
  const daysLeft = 7 - todayIndex - 1; // days remaining after today
  const avgRemainingPerDay = daysLeft > 0 ? Math.round(remaining / daysLeft) : remaining;

  // Rebalancing message (Spec 2.6)
  let rebalanceMessage: string | null = null;
  const todayData = dailyData[todayIndex];

  if (todayData && todayData.consumed > todayData.target * 1.15) {
    // Today exceeded target by 15%+
    const excess = todayData.consumed - todayData.target;
    if (daysLeft > 0 && remaining > 0) {
      const dailyReduction = Math.round(excess / daysLeft);
      if (dailyReduction < 200) {
        rebalanceMessage = `Bugun ${excess} kcal fazla yedin ama haftalik butcende hala ${remaining} kcal marjin var. Kalan ${daysLeft} gunde gunluk ${dailyReduction} kcal azaltarak dengeleyebilirsin.`;
      }
    }
  }

  return {
    totalBudget: weeklyBudget,
    consumed,
    remaining: Math.max(0, remaining),
    daysLeft,
    avgRemainingPerDay: Math.max(0, avgRemainingPerDay),
    overBudget: remaining < 0,
    rebalanceMessage,
    dailyBreakdown: dailyData,
  };
}

// ─── Recovery Distribution (Phase 2) ───

export interface RecoveryDistribution {
  excessCalories: number;
  daysToDistribute: number;
  dailyReduction: number;
  adjustedDailyTargets: { date: string; originalTarget: number; adjustedTarget: number }[];
  isFeasible: boolean;
  message: string;
}

/**
 * Calculate how to distribute excess calories across remaining days.
 * Respects minimum calorie floors (1200 for women, 1400 for men).
 */
export function calculateRecoveryDistribution(
  excessCalories: number,
  remainingDays: DayData[],
  gender: string | null
): RecoveryDistribution {
  const floor = gender === 'female' ? 1200 : 1400;
  const daysToDistribute = remainingDays.length;

  if (daysToDistribute === 0) {
    return {
      excessCalories,
      daysToDistribute: 0,
      dailyReduction: 0,
      adjustedDailyTargets: [],
      isFeasible: false,
      message: 'Haftanin son gunu — yarin temiz bir sayfa ac.',
    };
  }

  const idealReduction = Math.round(excessCalories / daysToDistribute);

  // Check if reduction respects calorie floors
  const adjustedTargets = remainingDays.map(day => {
    const adjusted = Math.max(floor, day.target - idealReduction);
    const actualReduction = day.target - adjusted;
    return {
      date: day.date,
      originalTarget: day.target,
      adjustedTarget: adjusted,
      actualReduction,
    };
  });

  const totalActualReduction = adjustedTargets.reduce((s, d) => s + d.actualReduction, 0);
  const isFeasible = totalActualReduction >= excessCalories * 0.7; // 70%+ recovery is feasible
  const dailyReduction = Math.round(totalActualReduction / daysToDistribute);

  let message: string;
  if (isFeasible) {
    message = `Kalan ${daysToDistribute} gunde gunluk ${dailyReduction} kcal azaltarak hafta dengelenir.`;
  } else {
    message = `Tam dengeleme zor ama kalan gunlerde biraz dikkatli olursan etki minimuma iner. Stres yapma.`;
  }

  return {
    excessCalories,
    daysToDistribute,
    dailyReduction,
    adjustedDailyTargets: adjustedTargets.map(t => ({
      date: t.date,
      originalTarget: t.originalTarget,
      adjustedTarget: t.adjustedTarget,
    })),
    isFeasible,
    message,
  };
}

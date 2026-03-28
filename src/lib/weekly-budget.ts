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

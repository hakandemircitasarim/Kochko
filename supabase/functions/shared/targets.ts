/**
 * Timeline-honoring calorie deficit/surplus.
 *
 * The legacy math used a FIXED fraction of TDEE (lose = 0.85, i.e. a flat 15% cut) that ignored
 * how much the user wants to change and by WHEN (goals.target_weeks). Meanwhile the ETA / tempo
 * chart (goal-progress) is derived from goals.weekly_rate = |start-target| / target_weeks — a
 * DIFFERENT model — so the two drifted apart and a user who set an ambitious date perpetually
 * read "behind/stalled" against a deficit that was never sized to hit it.
 *
 * This derives the daily kcal delta from REMAINING kg / REMAINING weeks (so it re-converges on the
 * date at every monthly re-cut as weight drops), capped to a safe weekly rate. Returns a SIGNED
 * kcal/day (negative = eat below TDEE for loss, positive = above for gain), or null when there is
 * no usable timeline (caller then falls back to the fixed fraction). 7700 kcal ≈ 1 kg body mass.
 */
export function timelineDeficitKcal(opts: {
  goalType: string;
  currentWeight: number;
  targetWeight: number | null | undefined;
  targetWeeks: number | null | undefined;
  weeksElapsed: number;
}): number | null {
  const { goalType, currentWeight, targetWeight, targetWeeks, weeksElapsed } = opts;
  if (targetWeight == null || !targetWeeks || currentWeight == null) return null;
  const isLose = goalType === 'lose_weight';
  const isGain = goalType === 'gain_weight' || goalType === 'gain_muscle';
  if (!isLose && !isGain) return null; // maintain/health/conditioning have no deficit

  const remainingKg = Math.abs(currentWeight - targetWeight);
  const remainingWeeks = Math.max(1, targetWeeks - Math.max(0, weeksElapsed));
  const maxRate = isLose ? 1.0 : 0.5;          // safe ceiling: 1.0 kg/wk loss, 0.5 kg/wk gain
  const weeklyKg = Math.min(remainingKg / remainingWeeks, maxRate);
  const dailyKcal = (weeklyKg * 7700) / 7;
  return Math.round(isLose ? -dailyKcal : dailyKcal);
}

const ACTIVITY_MULT: Record<string, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };

/** Mifflin-St Jeor BMR. The SAME formula was re-inlined in ai-chat + ai-proactive + ai-plan. */
export function bmrMifflin(weightKg: number, heightCm: number, age: number, gender: string | null | undefined): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return gender === 'male' ? base + 5 : base - 161;
}

/** TDEE from BMR × activity multiplier (or a supplied dynamic multiplier). */
export function tdeeFrom(bmr: number, activityLevel: string | null | undefined, dynamicMultiplier?: number): number {
  return Math.round(bmr * (dynamicMultiplier ?? ACTIVITY_MULT[activityLevel ?? 'moderate'] ?? 1.55));
}

/**
 * THE single calorie-band shaper. Given a resolved daily target-calorie number, produce the full
 * training/rest band + weekly budget. Previously this exact formula (10% range width, 250 kcal
 * rest reduction, gender floor 1200/1400, 4 training + 3 rest weekly budget) was copy-pasted into
 * ai-chat recalculateTDEEIfNeeded, ai-proactive roll-forward, and src/lib/tdee.ts — the "MUST
 * mirror" comments were the symptom. One owner here; the client mirror keeps a parity test.
 */
export function computeCalorieBand(opts: { targetCalories: number; gender?: string | null }): {
  trainingMin: number; trainingMax: number; restMin: number; restMax: number; weeklyBudget: number;
} {
  const floor = opts.gender === 'female' ? 1200 : 1400;
  const target = opts.targetCalories;
  const rangeWidth = Math.round(target * 0.10);
  const trainingMin = Math.max(target - Math.round(rangeWidth / 2), floor);
  const trainingMax = Math.max(target + Math.round(rangeWidth / 2), trainingMin);
  const restMin = Math.max(trainingMin - 250, floor);
  const restMax = Math.max(trainingMax - 250, restMin);
  const weeklyBudget = 4 * Math.round((trainingMin + trainingMax) / 2) + 3 * Math.round((restMin + restMax) / 2);
  return { trainingMin, trainingMax, restMin, restMax, weeklyBudget };
}

/**
 * Resolve the day's target calories: timeline-derived when a goal timeline exists, else the
 * fixed-fraction fallback. Keeps one definition shared by ai-proactive + ai-chat re-cuts.
 */
export function resolveTargetCalories(opts: {
  tdee: number;
  goalType: string;
  fixedFactor: number; // e.g. 0.85 lose / 1.1 gain / 1.0 maintain
  currentWeight: number;
  targetWeight: number | null | undefined;
  targetWeeks: number | null | undefined;
  weeksElapsed: number;
}): number {
  const tl = timelineDeficitKcal(opts);
  if (tl != null) return Math.round(opts.tdee + tl);
  return Math.round(opts.tdee * opts.fixedFactor);
}

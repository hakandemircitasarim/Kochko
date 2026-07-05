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

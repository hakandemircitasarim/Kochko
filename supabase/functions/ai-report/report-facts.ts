/**
 * Pure fact helpers for the daily report (ai-report/index.ts). They live outside index.ts because
 * importing that file starts the HTTP server, which made every rule in it untestable.
 *
 * Each helper decides what the report model is TOLD as fact. The model repeats these lines as
 * truth, so a guess must never be phrased as data.
 */

/**
 * diff#10: kg still to go toward the goal, SIGNED by direction — <= 0 means reached or passed.
 * Math.abs made a lose goal at 70 kg read "0.6kg kaldi" at 69.4 kg and ask for more loss.
 * maintain/health keep the plain distance (no direction to pass).
 */
export function goalKgLeft(goalType: string | null | undefined, currentKg: number, targetKg: number): number {
  const left = goalType === 'lose_weight' ? currentKg - targetKg
    : goalType === 'gain_weight' || goalType === 'gain_muscle' ? targetKg - currentKg
    : Math.abs(currentKg - targetKg);
  return Math.abs(left) < 0.05 ? 0 : left; // float noise: 70.0 vs 70 is "hedefte", not "0.0kg kaldi"
}

/** diff#10: the HEDEF line of the daily report prompt. */
export function goalPromptLine(
  goalType: string, targetKg: number, currentKg: number, weeksElapsed: number, targetWeeks: number,
): string {
  const kgLeft = goalKgLeft(goalType, currentKg, targetKg);
  const weeksLeft = Math.max(0, targetWeeks - weeksElapsed);
  const leftTxt = kgLeft > 0 ? `${kgLeft.toFixed(1)}kg kaldi`
    : kgLeft < 0 ? `hedef ${(-kgLeft).toFixed(1)}kg gecildi` : 'hedefte';
  // An unknown pace ('?') made the model ramble about "net hafta sayısı"; state the case instead.
  const paceTxt = kgLeft <= 0 ? 'hedefe ulasildi (daha fazla kilo degisimi isteme; bakim/yeni hedef konusulabilir)'
    : weeksLeft > 0 ? `Gereken tempo: ${(kgLeft / weeksLeft).toFixed(2)}kg/hafta`
    : 'hedef suresi doldu (tempo yorumu yapma; yeni sure konusulabilir)';
  return `HEDEF: ${goalType} -> ${targetKg}kg | Simdi: ${currentKg}kg | ${leftTxt} | ${Math.min(weeksElapsed, targetWeeks)}/${targetWeeks} hafta | ${paceTxt}`;
}

/**
 * final2#17: a day with fewer meals than the user usually eats AND intake under the plan floor is
 * most likely a PARTIAL log, not under-eating (one logged dinner scored 19/100 as "982 kcal altında").
 * Also flagged when intake is under half the floor whatever the meal count. Only judged against a
 * real plan band; a day with no food log is handled separately (no food scoring at all).
 */
export function partialFoodLog(
  mealTypes: (string | null | undefined)[], usualMealsRaw: unknown, totalCal: number, calMin: number,
): { partial: boolean; logged: number; usual: number } {
  const logged = new Set(mealTypes.map((t) => t ?? 'unknown')).size;
  const n = Math.round(Number(usualMealsRaw));
  const usual = Number.isFinite(n) && n >= 1 && n <= 8 ? n : 3; // profiles.meal_count_preference DEFAULT 3
  const partial = mealTypes.length > 0 && calMin > 0 && totalCal < calMin
    && (logged < usual || totalCal < calMin * 0.5);
  return { partial, logged, usual };
}

/**
 * diff#9: the Antrenman line. No plan row is NOT a rest day — "dinlenme günü (antrenman beklenmiyor)"
 * for a plan-less date was repeated by the model as fact.
 */
export function workoutPromptLine(
  workoutCount: number, totalMin: number, plan: { plan_type?: string | null } | null | undefined,
): string {
  if (workoutCount > 0) return `${workoutCount} seans, ${totalMin} dk`;
  if (!plan) return 'plan yok, antrenman kaydi yok (dinlenme gunu oldugunu VARSAYMA; antrenman yorumu yapma)';
  return plan.plan_type === 'training' ? 'planli antrenman gunu, kayit yok' : 'dinlenme gunu (antrenman beklenmiyor)';
}

/**
 * diff#9: the day's water target — plan first, then profile. The 2.5 L fallback stays for scoring
 * (the dashboard uses the same default) but is flagged `known: false` so the prompt never presents
 * it as the user's own target.
 */
export function resolveWaterTarget(planLiters: unknown, profileLiters: unknown): { liters: number; known: boolean } {
  if (Number(planLiters) > 0) return { liters: Number(planLiters), known: true };
  if (Number(profileLiters) > 0) return { liters: Number(profileLiters), known: true };
  return { liters: 2.5, known: false };
}

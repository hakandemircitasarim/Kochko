/**
 * plan-targets.ts — the diet plan's numbers come from the SERVER, not from the model's arithmetic.
 *
 * WHY (live journey test, 2026-10-04): the chat diet plan computed its own TDEE, copied the prompt
 * template's sample targets (2000 kcal / 150 P / 200 C / 65 F), ignored the user's saved 2-meal
 * preference and protein setting, and gave Tuesday — a basketball evening — the LOWEST calories of
 * the week. The profile already holds the authoritative numbers (target-engine writes the calorie
 * bands); the plan must use them. This module turns profile + schedule into fixed targets, renders
 * them for the prompt, and enforces them on the returned snapshot.
 */

export interface PlanTargets {
  tdee: number | null;
  restKcal: number;
  trainingKcal: number;
  proteinG: number | null;
  mealsPerDay: number | null;
  /** 0 = Monday … 6 = Sunday */
  trainingDays: number[];
  trainingSource: 'workout_plan' | 'profile_text' | 'none';
}

export interface PlanTargetProfile {
  tdee_calculated?: number | null;
  calorie_range_rest_min?: number | null;
  calorie_range_rest_max?: number | null;
  calorie_range_training_min?: number | null;
  calorie_range_training_max?: number | null;
  weight_kg?: number | null;
  protein_per_kg?: number | null;
  meal_count_preference?: number | null;
  available_training_times?: string | null;
}

const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

// Order matters: "cumartesi" must be tested before "cuma", "pazartesi" before "pazar".
const DAY_PATTERNS: [RegExp, number][] = [
  [/pazartesi/, 0], [/sal[ıi]/, 1], [/[çc]ar[şs]amba/, 2], [/per[şs]embe/, 3],
  [/cumartesi/, 5], [/cuma(?!rtesi)/, 4], [/pazar(?!tesi)/, 6],
];

/** Weekday indexes named in free text ("salı ve perşembe akşamları" → [1, 3]). */
export function parseWeekdays(text: string | null | undefined): number[] {
  const t = (text ?? '').toLocaleLowerCase('tr');
  if (!t) return [];
  if (/hafta ?i[çc]i/.test(t)) return [0, 1, 2, 3, 4];
  if (/hafta ?sonu/.test(t)) return [5, 6];
  if (/her ?g[üu]n/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set<number>();
  for (const [re, i] of DAY_PATTERNS) if (re.test(t)) out.add(i);
  return [...out].sort((a, b) => a - b);
}

const mid = (a?: number | null, b?: number | null): number | null =>
  (a && b && a > 0 && b > 0) ? Math.round((a + b) / 2) : null;

/**
 * Fixed targets for a diet plan, or null when the profile has no calorie bands yet (then the model
 * keeps computing from the profile, exactly as before — this never makes things worse).
 */
export function computePlanTargets(p: PlanTargetProfile, workoutTrainingDays: number[] | null): PlanTargets | null {
  const rest = mid(p.calorie_range_rest_min, p.calorie_range_rest_max);
  if (!rest) return null;
  const training = mid(p.calorie_range_training_min, p.calorie_range_training_max) ?? rest;
  const w = Number(p.weight_kg);
  const perKg = Number(p.protein_per_kg) > 0 ? Number(p.protein_per_kg) : 1.6;
  const fromText = parseWeekdays(p.available_training_times);
  const trainingDays = workoutTrainingDays && workoutTrainingDays.length > 0 ? workoutTrainingDays : fromText;
  const meals = Number(p.meal_count_preference);
  return {
    tdee: Number(p.tdee_calculated) > 0 ? Number(p.tdee_calculated) : null,
    restKcal: rest,
    trainingKcal: training,
    proteinG: w > 0 ? Math.round(w * perKg) : null,
    mealsPerDay: meals >= 1 && meals <= 8 ? meals : null,
    trainingDays,
    trainingSource: workoutTrainingDays && workoutTrainingDays.length > 0 ? 'workout_plan' : fromText.length > 0 ? 'profile_text' : 'none',
  };
}

/** The prompt block: numbers to USE, not to derive. */
export function renderPlanTargets(t: PlanTargets): string {
  const days = t.trainingDays.length > 0
    ? `${t.trainingDays.map((i) => `${DAY_NAMES[i]} (day_index ${i})`).join(', ')} → bu günlere "target_kcal": ${t.trainingKcal}; diğer günlere "target_kcal": ${t.restKcal}.`
    : `Kayıtlı antrenman günü yok → her güne "target_kcal": ${t.restKcal}.`;
  return [
    '## PLAN HEDEFLERİ (SUNUCU — SABİT; KENDİN HESAPLAMA)',
    t.tdee ? `- TDEE (profil): ${t.tdee} kcal` : '',
    `- Dinlenme günü: ${t.restKcal} kcal | Antrenman günü: ${t.trainingKcal} kcal`,
    `- Antrenman günleri: ${days}`,
    t.proteinG ? `- Protein: günde ~${t.proteinG} g (kullanıcının ayarı)` : '',
    t.mealsPerDay ? `- Öğün sayısı: günde TAM ${t.mealsPerDay} ana öğün (kullanıcının kayıtlı tercihi); en fazla 1 ara öğün ekleyebilirsin.` : '',
    `- "targets" alanı: {"kcal": ${t.restKcal}${t.proteinG ? `, "protein": ${t.proteinG}` : ''}, ...}. Her günün öğün toplamı o günün target_kcal değerine otursun.`,
    '- "reasoning"de YALNIZCA bu sayıları kullan; farklı bir TDEE veya kalori hedefi yazma.',
  ].filter(Boolean).join('\n');
}

/**
 * Enforce the fixed targets on a parsed diet snapshot (before calorie reconciliation): the model may
 * still drift, so the stored plan carries the server's numbers regardless.
 */
export function applyPlanTargets(snap: Record<string, unknown>, t: PlanTargets): void {
  const targets = (snap.targets && typeof snap.targets === 'object') ? snap.targets as Record<string, unknown> : {};
  targets.kcal = t.restKcal;
  if (t.proteinG) targets.protein = t.proteinG;
  snap.targets = targets;
  const training = new Set(t.trainingDays);
  const days = (snap.days as Array<Record<string, unknown>> | undefined) ?? [];
  days.forEach((d, pos) => {
    const idx = Number.isInteger(Number(d.day_index)) ? Number(d.day_index) : pos;
    d.target_kcal = training.has(idx) ? t.trainingKcal : t.restKcal;
  });
}

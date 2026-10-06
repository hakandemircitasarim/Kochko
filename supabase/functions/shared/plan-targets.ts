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
import { bmrMifflin, computeMaintenanceBand, tdeeFrom } from './targets.ts';
import { getCalorieFloor } from './clinical-rules.ts';

export interface PlanTargets {
  tdee: number | null;
  restKcal: number;
  trainingKcal: number;
  proteinG: number | null;
  mealsPerDay: number | null;
  /** 0 = Monday … 6 = Sunday */
  trainingDays: number[];
  trainingSource: 'workout_plan' | 'profile_text' | 'none';
  /** Faz 0 #6: the ED gate raised these numbers to maintenance (the stored band sat lower). */
  heldAtMaintenance: boolean;
}

/** A calorie band as targets.ts shapes it (rest + training edges). */
export interface MaintenanceBand { restMin: number; restMax: number; trainingMin: number; trainingMax: number; }

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

const higher = (a: number | null, b: number | null): number | null =>
  a == null ? b : b == null ? a : Math.max(a, b);

/**
 * Fixed targets for a diet plan, or null when the profile has no calorie bands yet (then the model
 * keeps computing from the profile, exactly as before — this never makes things worse).
 * `holdAt` (Faz 0 #6): while deficitAllowed() refuses, pass maintenanceHoldBand() — the plan is then
 * BUILT at maintenance (§5.1 #8), so the approval gate never meets a plan it must refuse and its
 * "yeniden hazırla" offer cannot dead-end. It only raises: a stored band at/above it is kept as is.
 */
export function computePlanTargets(p: PlanTargetProfile, workoutTrainingDays: number[] | null, holdAt?: MaintenanceBand | null): PlanTargets | null {
  const storedRest = mid(p.calorie_range_rest_min, p.calorie_range_rest_max);
  const storedTraining = mid(p.calorie_range_training_min, p.calorie_range_training_max) ?? storedRest;
  const holdRest = holdAt ? mid(holdAt.restMin, holdAt.restMax) : null;
  const holdTraining = holdAt ? mid(holdAt.trainingMin, holdAt.trainingMax) : null;
  const rest = higher(storedRest, holdRest);
  if (!rest) return null;
  const training = higher(storedTraining, holdTraining) ?? rest;
  const raised = (hold: number | null, stored: number | null) => hold != null && (stored == null || hold > stored);
  const heldAtMaintenance = raised(holdRest, storedRest) || raised(holdTraining, storedTraining);
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
    heldAtMaintenance,
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
    t.heldAtMaintenance ? '- Bu hedefler şu an BAKIM seviyesinde tutuluyor: kalori açığı ya da kısıtlama önerme; planı bakım planı olarak anlat.' : '',
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

// ── Faz 0 #6 (mem#4): the numeric ED gate for diet plans ─────────────────────────────────────────

/**
 * "Maintenance" for the ED gate (§5.1 #8: no plan below maintenance at the CURRENT TDEE): the one
 * maintenance-band owner (computeMaintenanceBand: rest TDEE−100..+150, training TDEE..+350), floored
 * clinically. Deliberately NOT the stored calorie_range_rest_min — a band set before the tier rose can
 * be a plain deficit band, and even the band the ED cap writes (the deficit shaper run at goal
 * 'maintain') puts its rest-day edge 5% + 250 kcal under TDEE — judging by it waved deficits through.
 */
export function maintenanceHoldBand(tdee: number, gender?: string | null): MaintenanceBand {
  const floor = getCalorieFloor(gender);
  const m = computeMaintenanceBand(tdee);
  const restMin = Math.max(floor, m.restMin);
  const trainingMin = Math.max(floor, m.trainingMin);
  return { restMin, restMax: Math.max(restMin, m.restMax), trainingMin, trainingMax: Math.max(trainingMin, m.trainingMax) };
}

/** The TDEE the hold is computed from: the stored one, else Mifflin × activity from the profile. */
export function maintenanceTdee(p: {
  tdee_calculated?: number | null; weight_kg?: number | null; height_cm?: number | null;
  birth_year?: number | null; gender?: string | null; activity_level?: string | null;
}, nowYear = new Date().getFullYear()): number | null {
  const stored = Number(p.tdee_calculated);
  if (stored > 0) return Math.round(stored);
  const w = Number(p.weight_kg), h = Number(p.height_cm), by = Number(p.birth_year);
  if (!(w > 0 && h > 0 && by > 1900)) return null;
  const t = tdeeFrom(bmrMifflin(w, h, Math.max(18, nowYear - by), p.gender ?? null), p.activity_level ?? null);
  return Number.isFinite(t) && t > 0 ? t : null;
}

export interface MaintenanceVerdict {
  holds: boolean;
  /** The lowest edge a maintenance day may sit on (the band's restMin), when known. */
  floorKcal: number | null;
  /** The plan's lowest day (or week) target, when every day carried one. */
  lowestKcal: number | null;
}

/**
 * The plan-approval gate used while deficitAllowed() refuses: a diet plan passes iff its week target
 * and EVERY day sit at/above the maintenance band's floor (TDEE − 100, the lowest a maintenance day
 * goes — training days included). A day is judged by its server-fixed target_kcal (applyPlanTargets;
 * reconcileDietCalories keeps its meals within 7% of it), a day without one by its own total.
 * No band, no days or a day with no number → does not hold (fail closed).
 */
export function dietPlanHoldsMaintenance(
  planData: Record<string, unknown> | null | undefined,
  band: Pick<MaintenanceBand, 'restMin'> | null | undefined,
): MaintenanceVerdict {
  const floor = Number(band?.restMin);
  const floorKcal = floor > 0 ? floor : null;
  const days = Array.isArray(planData?.days) ? planData!.days as Array<Record<string, unknown>> : [];
  if (floorKcal == null || days.length === 0) return { holds: false, floorKcal, lowestKcal: null };
  let lowest = Infinity;
  for (const d of days) {
    const meals = Array.isArray(d.meals) ? d.meals as Array<Record<string, unknown>> : [];
    const mealSum = meals.reduce((s, m) => s + (Number(m.total_kcal) || 0), 0);
    const k = Number(d.target_kcal) > 0 ? Number(d.target_kcal) : Number(d.total_kcal) > 0 ? Number(d.total_kcal) : mealSum;
    if (!(k > 0)) return { holds: false, floorKcal, lowestKcal: null };
    lowest = Math.min(lowest, k);
  }
  const weekKcal = Number((planData?.targets as Record<string, unknown> | undefined)?.kcal);
  if (weekKcal > 0) lowest = Math.min(lowest, weekKcal);
  return { holds: lowest >= floorKcal, floorKcal, lowestKcal: Math.round(lowest) };
}

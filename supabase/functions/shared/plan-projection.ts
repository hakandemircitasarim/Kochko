/**
 * KOCHKO — Plan Projection (weekly_plans → daily_plans)
 *
 * ROOT FIX (Option A): The LIVE plan-creation path is chat (ai-chat plan_diet /
 * plan_workout), which writes `weekly_plans.plan_data` (a JSON snapshot). Every
 * "today" reader — dashboard.store, memory.ts Layer-3, ai-report, widget.service —
 * instead reads `daily_plans`, which is empty DB-wide. The two tables never sync,
 * so chat-created plans are invisible to the dashboard/context/reports.
 *
 * This module derives per-day `daily_plans` rows from the weekly_plans diet +
 * workout snapshots. It is called (best-effort) from the chat approve path right
 * after a draft weekly_plan is promoted to active.
 *
 * Everything here is intentionally defensive: any missing/NaN field falls back so
 * the NOT NULL columns (date, calorie_target_min/max, protein_target_g,
 * meal_suggestions) are always populated and no NaN is ever produced.
 */

// The deterministic protein floor lives with the other clinical constants (edge shared module,
// NOT a client type) so daily_plans gets a code-enforced g/kg minimum like the calorie floor.
import { getProteinFloorG } from './clinical-rules.ts';

// ---------------------------------------------------------------------------
// Local interfaces for the weekly_plans.plan_data shape (do NOT import client
// types — this is an edge function and the snapshot shape is owned here).
// ---------------------------------------------------------------------------

export interface DietItem {
  name?: string;
  grams?: number;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export interface DietMeal {
  meal_type?: string;
  time?: string;
  name?: string;
  total_kcal?: number;
  total_protein?: number;
  total_carbs?: number;
  total_fat?: number;
  items?: DietItem[];
}

export interface DietDay {
  day_index?: number;
  day_label?: string;
  total_kcal?: number;
  total_protein?: number;
  total_carbs?: number;
  total_fat?: number;
  meals?: DietMeal[];
}

export interface DietPlanData {
  plan_type?: string;
  week_start?: string;
  targets?: { kcal?: number; protein?: number; carbs?: number; fat?: number };
  reasoning?: string;
  version?: number;
  days?: DietDay[];
}

export interface WorkoutExercise {
  name?: string;
  sets?: number;
  reps?: number;
  weight_kg?: number;
  rest_sec?: number;
  notes?: string;
}

export interface WorkoutDay {
  day_index?: number;
  day_label?: string;
  rest_day?: boolean;
  focus?: string;
  // The live snapshot uses `estimated_duration_min` + `exercises`. Older / other
  // shapes may use `type`, `main`, `duration_min`. Handle all defensively.
  type?: string;
  estimated_duration_min?: number;
  duration_min?: number;
  exercises?: WorkoutExercise[];
  main?: Array<string | { name?: string }>;
}

export interface WorkoutPlanData {
  plan_type?: string;
  week_start?: string;
  reasoning?: string;
  version?: number;
  days?: WorkoutDay[];
}

export interface ProjectionProfile {
  weight_kg: number | null;
  weekly_calorie_budget: number | null;
  // FIX (audit AI-PLN-05): the CANONICAL weekly budget (used by ai-plan/index.ts,
  // widget.service.ts, service-contexts.ts and tdee.ts when weekly_calorie_budget is
  // unset) is 4×training-mid + 3×rest-mid — NOT caloriePoint*7. Carry the per-day
  // calorie ranges so this projection can reproduce that exact fallback and every
  // reader (dashboard ← daily_plans, home widget) agrees for a null-budget user.
  // Optional so existing callers that don't yet pass them still type-check; when
  // absent the projection degrades to the legacy caloriePoint*7 fallback.
  calorie_range_training_min?: number | null;
  calorie_range_training_max?: number | null;
  calorie_range_rest_min?: number | null;
  calorie_range_rest_max?: number | null;
}

export interface ProjectDailyPlanOpts {
  dietPlanData?: DietPlanData | null;
  workoutPlanData?: WorkoutPlanData | null;
  weekStart: string; // Monday of the plan week, 'YYYY-MM-DD'
  profile: ProjectionProfile;
  weekConsumed: number;
  /**
   * FIX (audit #11): target to use when the diet snapshot carries NO calorie target at all
   * (e.g. a WORKOUT-ONLY approval by a user with no diet plan). Previously such rows silently got
   * the KCAL_FLOOR=1000 placeholder + 0g protein — a fabricated target the user never agreed to.
   */
  fallbackCalorieTarget?: number | null;
  /**
   * Clinical calorie floor (getCalorieFloor(gender)). daily_plans is the SINGLE writer the whole
   * app reads, so clamping here keeps a sub-floor LLM plan from ever reaching the dashboard —
   * the guardrail previously existed only in the dormant ai-plan path.
   */
  calorieFloor?: number | null;
}

/** Row shape inserted into public.daily_plans. `version` is set by the caller. */
export interface DailyPlanInsert {
  date: string;
  plan_type: 'training' | 'rest';
  calorie_target_min: number;
  calorie_target_max: number;
  protein_target_g: number;
  carbs_target_g: number;
  fat_target_g: number;
  water_target_liters: number;
  focus_message: string | null;
  meal_suggestions: Array<{
    meal_type: string;
    options: Array<{
      name: string;
      description: string;
      calories: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      prep_time_min: number;
    }>;
  }>;
  snack_strategy: string | null;
  workout_plan: Record<string, unknown>;
  weekly_budget_total: number;
  weekly_budget_consumed: number;
  weekly_budget_remaining: number;
  status: 'approved';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KCAL_FLOOR = 1000; // sane floor when diet data is missing entirely
const CAL_WINDOW = 75; // ± window around the daily calorie point

/** Add N calendar days to a 'YYYY-MM-DD' date and return 'YYYY-MM-DD' (UTC). */
function addDays(isoDate: string, days: number): string {
  // Anchor at UTC noon to avoid any DST / midnight-rollover skew on +day math.
  const base = new Date(`${isoDate}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().split('T')[0];
}

/** Coerce to a finite number, else fallback. Guards against NaN/Infinity/null. */
function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Round to an integer, NaN-safe. */
function ri(v: unknown, fallback = 0): number {
  return Math.round(num(v, fallback));
}

/** Round to `dp` decimals, NaN-safe. */
function rd(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/**
 * FIX (audit AI-PLN-05): canonical weekly-budget fallback = 4×training-mid + 3×rest-mid,
 * matching ai-plan/index.ts (#S20), widget.service.ts (#14), service-contexts.ts and
 * tdee.ts (Spec 2.6). Returns 0 when the per-day ranges are unavailable so the caller can
 * fall back to the legacy caloriePoint*7 only as a last resort (keeps the dashboard, which
 * reads daily_plans, and the home widget in agreement for a null weekly_calorie_budget user).
 */
function canonicalWeeklyBudget(profile: ProjectionProfile): number {
  const trainMin = num(profile.calorie_range_training_min, NaN);
  const trainMax = num(profile.calorie_range_training_max, NaN);
  const restMin = num(profile.calorie_range_rest_min, NaN);
  const restMax = num(profile.calorie_range_rest_max, NaN);
  if (![trainMin, trainMax, restMin, restMax].every((v) => Number.isFinite(v) && v > 0)) {
    return 0;
  }
  const trainMid = Math.round((trainMin + trainMax) / 2);
  const restMid = Math.round((restMin + restMax) / 2);
  return (trainMid > 0 && restMid > 0) ? (4 * trainMid + 3 * restMid) : 0;
}

/**
 * FIX (audit CRITICAL: legacy menü uyumsuz şekil savunması): bu projeksiyon yalnız chat
 * plan_diet'in yazdığı OBJE-şekilli snapshot'ı ({targets, days:[{day_index, total_kcal, items}]})
 * okuyabilir. Legacy ai-plan haftalık-menü yolu DÜZ-DİZİ ({date, is_training_day,
 * meals:[{name, calories}]}) yazardı; o satır eskiden aynı (diet/active) satırı paylaşıyordu ve
 * buraya gelirse targets undefined → kalori KCAL_FLOOR(1000), day_index/total_kcal yok → makro 0
 * üretir, yani DOĞRU bağlamı bozardı. Artık menü ayrı plan_subtype satırına izole edildi; yine de
 * okuyucu defansif olsun: snapshot beklenmeyen (targets'sız) eski şekilse, uydurma 0/1000 değerler
 * üretmek yerine veriyi YOK SAY (null'a düş) ki var olan daily_plans bozulmasın.
 */
function isUsableDietShape(d: DietPlanData | null | undefined): d is DietPlanData {
  if (!d || typeof d !== 'object') return false;
  // Canonical chat shape always carries either a `targets` object or day-level totals
  // (`total_kcal`) on day_index-keyed days. The legacy flat shape has neither.
  const hasTargets = d.targets != null && typeof d.targets === 'object'
    && (Number.isFinite(Number(d.targets.kcal)) || Number.isFinite(Number(d.targets.protein)));
  if (hasTargets) return true;
  const days = Array.isArray(d.days) ? d.days : [];
  // Accept if any day looks canonical: has a day_index AND a total_kcal (the legacy flat
  // day shape uses `date`/`is_training_day`/`meals[].calories` and has neither).
  return days.some((day) =>
    day != null
    && typeof day === 'object'
    && Number.isFinite(Number((day as DietDay).day_index))
    && Number.isFinite(Number((day as DietDay).total_kcal)),
  );
}

// ---------------------------------------------------------------------------
// Main projection
// ---------------------------------------------------------------------------

/**
 * Derive one daily_plans row per day_index 0..6 from the weekly diet + workout
 * snapshots. Always returns exactly 7 rows (Monday..Sunday of `weekStart`).
 */
export function projectDailyPlanRows(opts: ProjectDailyPlanOpts): DailyPlanInsert[] {
  const { dietPlanData: rawDietPlanData, workoutPlanData, weekStart, profile, weekConsumed } = opts;

  // FIX (audit CRITICAL): beklenmeyen (legacy düz-dizi) diyet şekline karşı savun — okunamayan
  // şekli YOK SAY ki sahte 1000kcal/0g makro üretip mevcut bağlamı bozmayalım.
  const dietPlanData = isUsableDietShape(rawDietPlanData) ? rawDietPlanData : null;

  // FIX (audit CRITICAL): ne kullanılabilir diyet ne de antrenman verisi varsa, hiç satır
  // üretme. Çağıran yalnız writeRows.length > 0 iken yazdığından, boş dönüş var olan
  // daily_plans'ı OLDUĞU GİBİ korur (eski planı bozmadan güvenli düş).
  const hasWorkoutDays = Array.isArray(workoutPlanData?.days) && workoutPlanData!.days!.length > 0;
  if (!dietPlanData && !hasWorkoutDays) {
    return [];
  }

  const targets = dietPlanData?.targets ?? {};
  const dietDays = Array.isArray(dietPlanData?.days) ? dietPlanData!.days! : [];
  const workoutDays = Array.isArray(workoutPlanData?.days) ? workoutPlanData!.days! : [];

  // Plan-level macro fallbacks (used when a given day lacks its own totals).
  const planProtein = num(targets.protein, 0);
  const planCarbs = num(targets.carbs, 0);
  const planFat = num(targets.fat, 0);

  const weeklyConsumed = Math.max(0, ri(weekConsumed, 0));
  const weightKg = num(profile.weight_kg, 70);

  // FIX (audit AI-PLN-05): precompute the canonical 4×train-mid + 3×rest-mid budget once
  // (profile-level, not per-day) so the null-weekly_calorie_budget fallback below matches
  // ai-plan/widget instead of diverging via caloriePoint*7. 0 ⇒ ranges unavailable.
  const canonicalBudget = canonicalWeeklyBudget(profile);

  const rows: DailyPlanInsert[] = [];

  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);

    const dietDay = dietDays.find((d) => num(d?.day_index, -1) === i) ?? dietDays[i];
    const workoutDay = workoutDays.find((d) => num(d?.day_index, -1) === i) ?? workoutDays[i];

    // --- plan_type from workout rest_day (default 'rest') ---
    const restDay = workoutDay ? workoutDay.rest_day === true : true;
    const planType: 'training' | 'rest' = workoutDay ? (restDay ? 'rest' : 'training') : 'rest';

    // --- calorie targets ---
    // Prefer the plan-level daily TARGET (the negotiated TDEE goal, e.g. 1600) — NOT
    // the day's meal sum. The model's per-day meal totals routinely undershoot the
    // target, and daily_plans.calorie_target is the user's GOAL (what the dashboard
    // shows as "kalan kalori"), not the suggested-meal sum. Mirrors protein using
    // targets.protein. Fall back to the day total, then the absolute floor.
    let caloriePoint = num(targets.kcal, NaN);
    if (!Number.isFinite(caloriePoint) || caloriePoint <= 0) caloriePoint = num(dietDay?.total_kcal, NaN);
    // FIX (audit #11): prefer the caller's clinically-derived fallback (maintenance TDEE / existing
    // target) over the 1000-kcal placeholder, so a workout-only approval can't fabricate a starvation
    // target. KCAL_FLOOR stays as the last resort when the caller supplied nothing.
    if (!Number.isFinite(caloriePoint) || caloriePoint <= 0) {
      const fb = num(opts.fallbackCalorieTarget, NaN);
      caloriePoint = Number.isFinite(fb) && fb > 0 ? fb : KCAL_FLOOR;
    }
    caloriePoint = Math.round(caloriePoint);
    let calMin = caloriePoint - CAL_WINDOW;
    let calMax = caloriePoint + CAL_WINDOW;
    if (calMin < 1) calMin = 1;
    // Clinical floor clamp — daily_plans is the single source every reader trusts. FIX (adversarial):
    // clamping the MIDPOINT still shipped a sub-floor calorie_target_min (floor 1200 → min 1125), and
    // ai-report then scored that sub-floor day as perfectly compliant. Clamp the BAND EDGE, like
    // targets.ts computeCalorieBand does with trainingMin/restMin.
    const clinicalFloor = Math.round(num(opts.calorieFloor, 0));
    if (clinicalFloor > 0 && calMin < clinicalFloor) calMin = clinicalFloor;
    if (calMax < calMin) calMax = calMin;

    // --- macro targets (protein NOT NULL; never null) ---
    // Prefer the plan-level target, fall back to the day's own total, then 0.
    // FIX (completeness audit): clamp UP to the deterministic protein floor (1.6 g/kg bodyweight)
    // so daily_plans.protein_target_g carries the same code-enforced guarantee as the calorie floor,
    // instead of trusting whatever the LLM emitted (its prompt has no g/kg minimum).
    let proteinTarget = ri(targets.protein, ri(dietDay?.total_protein, Math.round(planProtein)));
    // Only when a diet plan actually exists: a workout-only projection has no diet target, so
    // proteinTarget stays 0 (the "no diet target" sentinel the daily report grades leniently) —
    // clamping it up would fabricate a ~1.6 g/kg goal the user was never given a diet to meet.
    if (dietPlanData) {
      const proteinFloorG = getProteinFloorG(weightKg);
      if (proteinTarget < proteinFloorG) proteinTarget = proteinFloorG;
    }
    const carbsTarget = ri(targets.carbs, ri(dietDay?.total_carbs, Math.round(planCarbs)));
    const fatTarget = ri(targets.fat, ri(dietDay?.total_fat, Math.round(planFat)));

    // --- water target ---
    const waterTarget = rd(weightKg * 0.033 + (planType === 'training' ? 0.75 : 0), 2);

    // --- focus message ---
    const focusMessage = typeof dietPlanData?.reasoning === 'string' && dietPlanData.reasoning.length > 0
      ? dietPlanData.reasoning
      : null;

    // --- meal_suggestions: wrap each meal as a 1-element options[] ---
    const meals = Array.isArray(dietDay?.meals) ? dietDay!.meals! : [];
    const mealSuggestions = meals.map((m) => ({
      meal_type: typeof m?.meal_type === 'string' ? m.meal_type : 'meal',
      options: [
        {
          name: typeof m?.name === 'string' ? m.name : '',
          description: '',
          calories: ri(m?.total_kcal, 0),
          protein_g: ri(m?.total_protein, 0),
          carbs_g: ri(m?.total_carbs, 0),
          fat_g: ri(m?.total_fat, 0),
          prep_time_min: 0,
        },
      ],
    }));

    // --- workout_plan jsonb ---
    let workoutPlan: Record<string, unknown> = {};
    if (workoutDay) {
      const rawExercises = Array.isArray(workoutDay.exercises)
        ? workoutDay.exercises
        : Array.isArray(workoutDay.main)
          ? workoutDay.main
          : [];
      const main = rawExercises
        .map((e) => (typeof e === 'string' ? e : (e?.name ?? '')))
        .filter((n) => typeof n === 'string' && n.length > 0);
      const duration = ri(workoutDay.duration_min, ri(workoutDay.estimated_duration_min, 0));
      workoutPlan = {
        type: typeof workoutDay.type === 'string' && workoutDay.type.length > 0
          ? workoutDay.type
          : restDay
            ? 'rest'
            : (typeof workoutDay.focus === 'string' && workoutDay.focus.length > 0 ? workoutDay.focus : 'strength'),
        main,
        duration_min: duration,
      };
    }

    // --- weekly budget ---
    // FIX (audit AI-PLN-05): prefer profiles.weekly_calorie_budget; when it is null, use the
    // CANONICAL 4×train-mid + 3×rest-mid (same as ai-plan #S20 / widget.service.ts #14 /
    // service-contexts.ts / tdee.ts Spec 2.6) so the dashboard (← daily_plans) and the home
    // widget agree. Only when the per-day ranges are also unavailable do we degrade to the
    // legacy caloriePoint*7 last resort.
    const weeklyTotal = profile.weekly_calorie_budget != null && Number.isFinite(Number(profile.weekly_calorie_budget))
      ? ri(profile.weekly_calorie_budget, caloriePoint * 7)
      : (canonicalBudget > 0 ? canonicalBudget : caloriePoint * 7);
    const weeklyRemaining = Math.max(0, weeklyTotal - weeklyConsumed);
    // Defence-in-depth with mig 094 (integer columns): clamp to a sane non-negative range so a
    // garbage value can never overflow even the widened column or show an absurd budget.
    const clampBudget = (n: number) => Math.max(0, Math.min(200000, Math.round(num(n, 0))));

    rows.push({
      date,
      plan_type: planType,
      calorie_target_min: calMin,
      calorie_target_max: calMax,
      protein_target_g: proteinTarget,
      carbs_target_g: carbsTarget,
      fat_target_g: fatTarget,
      water_target_liters: waterTarget,
      focus_message: focusMessage,
      meal_suggestions: mealSuggestions,
      snack_strategy: null,
      workout_plan: workoutPlan,
      weekly_budget_total: clampBudget(weeklyTotal),
      weekly_budget_consumed: clampBudget(weeklyConsumed),
      weekly_budget_remaining: clampBudget(weeklyRemaining),
      status: 'approved',
    });
  }

  return rows;
}

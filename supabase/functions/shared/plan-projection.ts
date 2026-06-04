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
}

export interface ProjectDailyPlanOpts {
  dietPlanData?: DietPlanData | null;
  workoutPlanData?: WorkoutPlanData | null;
  weekStart: string; // Monday of the plan week, 'YYYY-MM-DD'
  profile: ProjectionProfile;
  weekConsumed: number;
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

// ---------------------------------------------------------------------------
// Main projection
// ---------------------------------------------------------------------------

/**
 * Derive one daily_plans row per day_index 0..6 from the weekly diet + workout
 * snapshots. Always returns exactly 7 rows (Monday..Sunday of `weekStart`).
 */
export function projectDailyPlanRows(opts: ProjectDailyPlanOpts): DailyPlanInsert[] {
  const { dietPlanData, workoutPlanData, weekStart, profile, weekConsumed } = opts;

  const targets = dietPlanData?.targets ?? {};
  const dietDays = Array.isArray(dietPlanData?.days) ? dietPlanData!.days! : [];
  const workoutDays = Array.isArray(workoutPlanData?.days) ? workoutPlanData!.days! : [];

  // Plan-level macro fallbacks (used when a given day lacks its own totals).
  const planProtein = num(targets.protein, 0);
  const planCarbs = num(targets.carbs, 0);
  const planFat = num(targets.fat, 0);

  const weeklyConsumed = Math.max(0, ri(weekConsumed, 0));
  const weightKg = num(profile.weight_kg, 70);

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
    if (!Number.isFinite(caloriePoint) || caloriePoint <= 0) caloriePoint = KCAL_FLOOR;
    caloriePoint = Math.round(caloriePoint);
    let calMin = caloriePoint - CAL_WINDOW;
    let calMax = caloriePoint + CAL_WINDOW;
    if (calMin < 1) calMin = 1;
    if (calMax < calMin) calMax = calMin;

    // --- macro targets (protein NOT NULL; never null) ---
    // Prefer the plan-level target, fall back to the day's own total, then 0.
    const proteinTarget = ri(targets.protein, ri(dietDay?.total_protein, Math.round(planProtein)));
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
    const weeklyTotal = profile.weekly_calorie_budget != null && Number.isFinite(Number(profile.weekly_calorie_budget))
      ? ri(profile.weekly_calorie_budget, caloriePoint * 7)
      : caloriePoint * 7;
    const weeklyRemaining = Math.max(0, weeklyTotal - weeklyConsumed);

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
      weekly_budget_total: weeklyTotal,
      weekly_budget_consumed: weeklyConsumed,
      weekly_budget_remaining: weeklyRemaining,
      status: 'approved',
    });
  }

  return rows;
}

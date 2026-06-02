/**
 * Widget Data Provider Service
 * Spec 23: Home screen widget veri sağlayıcı.
 *
 * Aggregates data from daily_metrics, meal_log_items, daily_plans,
 * and profiles for a compact widget display. Also provides a
 * single-line Turkish summary formatter.
 */
import { supabase } from '@/lib/supabase';

// ────────────────────────────── Types ──────────────────────────────

export interface WidgetData {
  todayCalories: number;
  calorieTarget: number;
  todayProtein: number;
  proteinTarget: number;
  waterLiters: number;
  waterTarget: number;
  streak: number;
  steps: number;
  stepsTarget: number;
  focusMessage: string | null;
  weeklyBudgetRemaining: number | null;
}

// ────────────────────────────── Helpers ──────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeekISO(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // Monday-based
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

// ────────────────────────────── Main ──────────────────────────────

/**
 * Fetch all data a home screen widget needs for the given user.
 * Runs multiple lightweight queries in parallel.
 */
export async function getWidgetData(userId: string): Promise<WidgetData> {
  const today = todayISO();
  const weekStart = startOfWeekISO();

  // Fire all queries in parallel
  const [profileRes, metricsRes, mealsRes, planRes, weekMealsRes, streakRes] = await Promise.all([
    // 1. Profile for targets
    supabase
      .from('profiles')
      .select('calorie_range_training_min, calorie_range_training_max, protein_per_kg, weight_kg, water_target_liters')
      .eq('id', userId)
      .single(),

    // 2. Today's daily_metrics (keyed on `date`; there is no streak_days column)
    supabase
      .from('daily_metrics')
      .select('water_liters, steps, steps_source')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle(),

    // 3. Today's meal totals — meal_log_items has no user_id/date; scope via the meal_logs FK
    supabase
      .from('meal_log_items')
      .select('calories, protein_g, meal_logs!inner(user_id, logged_for_date, is_deleted)')
      .eq('meal_logs.user_id', userId)
      .eq('meal_logs.logged_for_date', today)
      .eq('meal_logs.is_deleted', false),

    // 4. Today's plan for focus message (latest version; daily_plans keys on `date`)
    supabase
      .from('daily_plans')
      .select('focus_message')
      .eq('user_id', userId)
      .eq('date', today)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),

    // 5. Week meals for weekly budget (via the meal_logs FK)
    supabase
      .from('meal_log_items')
      .select('calories, meal_logs!inner(user_id, logged_for_date, is_deleted)')
      .eq('meal_logs.user_id', userId)
      .gte('meal_logs.logged_for_date', weekStart)
      .lte('meal_logs.logged_for_date', today)
      .eq('meal_logs.is_deleted', false),

    // 6. Last 90 days of metric dates — derive the streak (no streak_days column exists)
    supabase
      .from('daily_metrics')
      .select('date')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(90),
  ]);

  // Extract profile data
  const profile = profileRes.data;
  const calorieTarget = profile
    ? Math.round(((profile.calorie_range_training_min ?? 1800) + (profile.calorie_range_training_max ?? 2200)) / 2)
    : 2000;
  const proteinTarget = profile && profile.protein_per_kg && profile.weight_kg
    ? Math.round(profile.protein_per_kg * profile.weight_kg)
    : 120;
  const waterTarget = profile?.water_target_liters ?? 2.5;

  // Sum today's meals
  const meals = (mealsRes.data ?? []) as { calories: number | null; protein_g: number | null }[];
  const todayCalories = meals.reduce((sum, m) => sum + (m.calories ?? 0), 0);
  const todayProtein = meals.reduce((sum, m) => sum + (m.protein_g ?? 0), 0);

  // Daily metrics
  const metrics = metricsRes.data;
  const waterLiters = metrics?.water_liters ?? 0;
  const steps = metrics?.steps ?? 0;

  // Streak: consecutive days ending today that have a daily_metrics row
  // (daily_metrics has no streak_days column — derive it, like analytics.service.ts).
  const streakDates = new Set(((streakRes.data ?? []) as { date: string }[]).map(d => d.date));
  let streak = 0;
  const cursor = new Date(today);
  while (streakDates.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Steps target (default 10000)
  const stepsTarget = 10000;

  // Focus message from today's plan
  const focusMessage = planRes.data?.focus_message ?? null;

  // Weekly budget remaining
  const weekMeals = (weekMealsRes.data ?? []) as { calories: number | null }[];
  const weekCalories = weekMeals.reduce((sum, m) => sum + (m.calories ?? 0), 0);
  const weeklyBudget = calorieTarget * 7;
  const weeklyBudgetRemaining = weeklyBudget - weekCalories;

  return {
    todayCalories: Math.round(todayCalories),
    calorieTarget,
    todayProtein: Math.round(todayProtein),
    proteinTarget,
    waterLiters: Math.round(waterLiters * 10) / 10,
    waterTarget,
    streak,
    steps,
    stepsTarget,
    focusMessage,
    weeklyBudgetRemaining: Math.round(weeklyBudgetRemaining),
  };
}

/**
 * Format widget data as a single-line Turkish summary suitable for
 * compact widget display or notification.
 *
 * Example: "1450/1800 kcal | 95g protein | 1.5L su | 7 gun seri"
 */
export function formatWidgetSummary(data: WidgetData): string {
  const parts: string[] = [
    `${data.todayCalories}/${data.calorieTarget} kcal`,
    `${data.todayProtein}g protein`,
    `${data.waterLiters}L su`,
  ];

  if (data.streak > 1) {
    parts.push(`${data.streak} gun seri`);
  }

  if (data.steps > 0) {
    parts.push(`${data.steps} adim`);
  }

  return parts.join(' | ');
}

/**
 * Format widget data as a compact JSON object suitable for native widget
 * bridge (e.g. expo-widgets or react-native-shared-group-preferences).
 */
export function serializeForNativeWidget(data: WidgetData): string {
  return JSON.stringify({
    cal: `${data.todayCalories}/${data.calorieTarget}`,
    pro: `${data.todayProtein}/${data.proteinTarget}g`,
    water: `${data.waterLiters}/${data.waterTarget}L`,
    streak: data.streak,
    steps: `${data.steps}/${data.stepsTarget}`,
    focus: data.focusMessage,
    budget: data.weeklyBudgetRemaining,
    ts: Date.now(),
  });
}

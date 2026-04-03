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
  const [profileRes, metricsRes, mealsRes, planRes, weekMealsRes] = await Promise.all([
    // 1. Profile for targets
    supabase
      .from('profiles')
      .select('calorie_range_training_min, calorie_range_training_max, protein_per_kg, weight_kg, water_target_liters')
      .eq('id', userId)
      .single(),

    // 2. Today's daily_metrics
    supabase
      .from('daily_metrics')
      .select('water_liters, steps, steps_source, streak_days')
      .eq('user_id', userId)
      .eq('log_date', today)
      .single(),

    // 3. Today's meal totals
    supabase
      .from('meal_log_items')
      .select('calories_kcal, protein_g')
      .eq('user_id', userId)
      .eq('log_date', today),

    // 4. Today's plan for focus message
    supabase
      .from('daily_plans')
      .select('focus_message')
      .eq('user_id', userId)
      .eq('plan_date', today)
      .single(),

    // 5. Week meals for weekly budget
    supabase
      .from('meal_log_items')
      .select('calories_kcal')
      .eq('user_id', userId)
      .gte('log_date', weekStart)
      .lte('log_date', today),
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
  const meals = mealsRes.data ?? [];
  const todayCalories = meals.reduce((sum, m) => sum + (m.calories_kcal ?? 0), 0);
  const todayProtein = meals.reduce((sum, m) => sum + (m.protein_g ?? 0), 0);

  // Daily metrics
  const metrics = metricsRes.data;
  const waterLiters = metrics?.water_liters ?? 0;
  const steps = metrics?.steps ?? 0;
  const streak = metrics?.streak_days ?? 0;

  // Steps target (default 10000)
  const stepsTarget = 10000;

  // Focus message from today's plan
  const focusMessage = planRes.data?.focus_message ?? null;

  // Weekly budget remaining
  const weekMeals = weekMealsRes.data ?? [];
  const weekCalories = weekMeals.reduce((sum, m) => sum + (m.calories_kcal ?? 0), 0);
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

/**
 * Calendar / Timeline Service
 * Spec 8.6: Takvim/zaman çizelgesi
 */
import { supabase } from '@/lib/supabase';

export interface DaySummary {
  date: string;
  hasData: boolean;
  compliance_score: number | null;
  calorie_actual: number | null;
  weight_kg: number | null;
  meal_count: number;
  workout_done: boolean;
}

/**
 * Get day summaries for a given month.
 */
export async function getMonthSummaries(year: number, month: number): Promise<DaySummary[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;

  const [reportsRes, metricsRes, mealsRes, workoutsRes] = await Promise.all([
    supabase.from('daily_reports').select('date, compliance_score, calorie_actual')
      .gte('date', startDate).lte('date', endDate),
    supabase.from('daily_metrics').select('date, weight_kg')
      .gte('date', startDate).lte('date', endDate),
    supabase.from('meal_logs').select('logged_for_date').eq('is_deleted', false)
      .gte('logged_for_date', startDate).lte('logged_for_date', endDate),
    supabase.from('workout_logs').select('logged_for_date')
      .gte('logged_for_date', startDate).lte('logged_for_date', endDate),
  ]);

  const reports = new Map((reportsRes.data ?? []).map((r: { date: string; compliance_score: number; calorie_actual: number }) => [r.date, r]));
  const metrics = new Map((metricsRes.data ?? []).map((m: { date: string; weight_kg: number }) => [m.date, m]));
  const mealDates = new Set((mealsRes.data ?? []).map((m: { logged_for_date: string }) => m.logged_for_date));
  const workoutDates = new Set((workoutsRes.data ?? []).map((w: { logged_for_date: string }) => w.logged_for_date));

  const summaries: DaySummary[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const report = reports.get(date) as { compliance_score: number; calorie_actual: number } | undefined;
    const metric = metrics.get(date) as { weight_kg: number } | undefined;

    summaries.push({
      date,
      hasData: mealDates.has(date) || workoutDates.has(date) || !!report || !!metric,
      compliance_score: report?.compliance_score ?? null,
      calorie_actual: report?.calorie_actual ?? null,
      weight_kg: metric?.weight_kg ?? null,
      meal_count: (mealsRes.data ?? []).filter((m: { logged_for_date: string }) => m.logged_for_date === date).length,
      workout_done: workoutDates.has(date),
    });
  }

  return summaries;
}

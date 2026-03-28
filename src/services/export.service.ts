/**
 * Data Export Service
 * Spec 18: Veri saklama, gizlilik - export kapasitesi
 */
import { Share } from 'react-native';
import { supabase } from '@/lib/supabase';

/**
 * Export all user data as JSON (Spec 18).
 * Includes profile, AI summary (Katman 2), logs, reports, preferences.
 */
export async function exportJSON(): Promise<void> {
  const [profile, goals, meals, workouts, metrics, reports, labs, prefs, summary, recipes, challenges, achievements] = await Promise.all([
    supabase.from('profiles').select('*').single(),
    supabase.from('goals').select('*'),
    supabase.from('meal_logs').select('*, meal_log_items(*)').eq('is_deleted', false).order('logged_at'),
    supabase.from('workout_logs').select('*, strength_sets(*)').order('logged_at'),
    supabase.from('daily_metrics').select('*').order('date'),
    supabase.from('daily_reports').select('*').order('date'),
    supabase.from('lab_values').select('*').order('measured_at'),
    supabase.from('food_preferences').select('*'),
    supabase.from('ai_summary').select('*').single(),
    supabase.from('saved_recipes').select('*'),
    supabase.from('challenges').select('*'),
    supabase.from('achievements').select('*'),
  ]);

  const data = {
    exported_at: new Date().toISOString(),
    profile: profile.data,
    ai_summary: summary.data,
    goals: goals.data ?? [],
    meal_logs: meals.data ?? [],
    workout_logs: workouts.data ?? [],
    daily_metrics: metrics.data ?? [],
    daily_reports: reports.data ?? [],
    lab_values: labs.data ?? [],
    food_preferences: prefs.data ?? [],
    saved_recipes: recipes.data ?? [],
    challenges: challenges.data ?? [],
    achievements: achievements.data ?? [],
  };

  await Share.share({ title: 'Kochko Export', message: JSON.stringify(data, null, 2) });
}

/**
 * Export daily metrics as CSV.
 */
export async function exportCSV(): Promise<void> {
  const [metricsRes, reportsRes] = await Promise.all([
    supabase.from('daily_metrics').select('date, weight_kg, water_liters, sleep_hours, steps, mood_score').order('date'),
    supabase.from('daily_reports').select('date, compliance_score, calorie_actual, protein_actual').order('date'),
  ]);

  const metrics = (metricsRes.data ?? []) as { date: string; weight_kg: number | null; water_liters: number; sleep_hours: number | null; steps: number | null; mood_score: number | null }[];
  const reports = (reportsRes.data ?? []) as { date: string; compliance_score: number; calorie_actual: number; protein_actual: number }[];

  const dates = new Set([...metrics.map(m => m.date), ...reports.map(r => r.date)]);
  let csv = 'Tarih,Kilo,Su(L),Uyku(sa),Adim,Mood,Uyum,Kalori,Protein\n';

  for (const date of [...dates].sort()) {
    const m = metrics.find(x => x.date === date);
    const r = reports.find(x => x.date === date);
    csv += `${date},${m?.weight_kg ?? ''},${m?.water_liters ?? ''},${m?.sleep_hours ?? ''},${m?.steps ?? ''},${m?.mood_score ?? ''},${r?.compliance_score ?? ''},${r?.calorie_actual ?? ''},${r?.protein_actual ?? ''}\n`;
  }

  await Share.share({ title: 'Kochko CSV', message: csv });
}

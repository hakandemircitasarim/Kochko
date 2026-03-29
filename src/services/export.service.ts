/**
 * Data Export Service — Spec 18.2
 * Full JSON/CSV export with optional Katman 2 (AI notes) inclusion.
 * KVKK Madde 20: Veri taşınabilirliği hakkı.
 */
import { Share } from 'react-native';
import { supabase } from '@/lib/supabase';

/**
 * Export all user data as JSON — Spec 18.2
 * Includes profile, AI summary (Katman 2), logs, reports, preferences.
 * User controls whether AI notes are included.
 */
export async function exportJSON(includeAISummary = true): Promise<void> {
  const [profile, goals, meals, workouts, metrics, reports, labs, prefs, summary, recipes, challenges, achievements, healthEvents, supplements] = await Promise.all([
    supabase.from('profiles').select('*').single(),
    supabase.from('goals').select('*'),
    supabase.from('meal_logs').select('*, meal_log_items(*)').eq('is_deleted', false).order('logged_at'),
    supabase.from('workout_logs').select('*, strength_sets(*)').order('logged_at'),
    supabase.from('daily_metrics').select('*').order('date'),
    supabase.from('daily_reports').select('*').order('date'),
    supabase.from('lab_values').select('*').order('measured_at'),
    supabase.from('food_preferences').select('*'),
    includeAISummary ? supabase.from('ai_summary').select('*').single() : { data: null },
    supabase.from('saved_recipes').select('*'),
    supabase.from('challenges').select('*'),
    supabase.from('achievements').select('*'),
    supabase.from('health_events').select('*'),
    supabase.from('supplement_logs').select('*').order('logged_at'),
  ]);

  const data = {
    exported_at: new Date().toISOString(),
    version: '1.0',
    format: 'kochko_full_export',
    profile: profile.data,
    ai_summary: includeAISummary ? summary.data : '[excluded_by_user]',
    goals: goals.data ?? [],
    health_events: healthEvents.data ?? [],
    meal_logs: meals.data ?? [],
    workout_logs: workouts.data ?? [],
    supplement_logs: supplements.data ?? [],
    daily_metrics: metrics.data ?? [],
    daily_reports: reports.data ?? [],
    lab_values: labs.data ?? [],
    food_preferences: prefs.data ?? [],
    saved_recipes: recipes.data ?? [],
    challenges: challenges.data ?? [],
    achievements: achievements.data ?? [],
    _meta: {
      total_meal_logs: (meals.data ?? []).length,
      total_workout_logs: (workouts.data ?? []).length,
      total_days_tracked: (metrics.data ?? []).length,
      includes_ai_notes: includeAISummary,
    },
  };

  await Share.share({ title: 'Kochko Export', message: JSON.stringify(data, null, 2) });
}

/**
 * Export daily metrics as CSV — tabular format for spreadsheets.
 */
export async function exportCSV(): Promise<void> {
  const [metricsRes, reportsRes] = await Promise.all([
    supabase.from('daily_metrics').select('date, weight_kg, water_liters, sleep_hours, steps, mood_score').order('date'),
    supabase.from('daily_reports').select('date, compliance_score, calorie_actual, protein_actual, carbs_actual, fat_actual, alcohol_calories').order('date'),
  ]);

  const metrics = (metricsRes.data ?? []) as Record<string, unknown>[];
  const reports = (reportsRes.data ?? []) as Record<string, unknown>[];

  const dates = new Set([...metrics.map(m => m.date as string), ...reports.map(r => r.date as string)]);

  let csv = 'Tarih,Kilo(kg),Su(L),Uyku(sa),Adim,Mood,Uyum(%),Kalori,Protein(g),Karb(g),Yag(g),Alkol(kcal)\n';

  for (const date of [...dates].sort()) {
    const m = metrics.find(x => x.date === date);
    const r = reports.find(x => x.date === date);

    const row = [
      date,
      m?.weight_kg ?? '',
      m?.water_liters ?? '',
      m?.sleep_hours ?? '',
      m?.steps ?? '',
      m?.mood_score ?? '',
      r?.compliance_score ?? '',
      r?.calorie_actual ?? '',
      r?.protein_actual ?? '',
      r?.carbs_actual ?? '',
      r?.fat_actual ?? '',
      r?.alcohol_calories ?? '',
    ].join(',');

    csv += row + '\n';
  }

  await Share.share({ title: 'Kochko CSV', message: csv });
}

/**
 * Export health professional report — Spec 8.7
 * Structured text format suitable for dietitians/doctors.
 * Excludes: chat history, mood notes, AI coaching notes (privacy).
 */
export async function exportHealthReport(
  dateFrom: string,
  dateTo: string,
): Promise<string> {
  const [profileRes, metricsRes, labsRes, workoutsRes, healthRes] = await Promise.all([
    supabase.from('profiles').select('height_cm, weight_kg, birth_year, gender, activity_level').single(),
    supabase.from('daily_metrics').select('*').gte('date', dateFrom).lte('date', dateTo).order('date'),
    supabase.from('lab_values').select('*').gte('measured_at', dateFrom).lte('measured_at', dateTo).order('measured_at'),
    supabase.from('workout_logs').select('workout_type, duration_min').gte('logged_for_date', dateFrom).lte('logged_for_date', dateTo),
    supabase.from('health_events').select('event_type, description, is_ongoing'),
  ]);

  const p = profileRes.data as Record<string, unknown> | null;
  const metrics = (metricsRes.data ?? []) as Record<string, unknown>[];
  const labs = (labsRes.data ?? []) as Record<string, unknown>[];
  const workouts = (workoutsRes.data ?? []) as Record<string, unknown>[];
  const events = (healthRes.data ?? []) as Record<string, unknown>[];

  const weights = metrics.filter(m => m.weight_kg != null);
  const avgSleep = metrics.filter(m => m.sleep_hours != null);

  let report = `KOCHKO SAGLIK RAPORU\n`;
  report += `Tarih araligi: ${dateFrom} - ${dateTo}\n`;
  report += `Olusturulma: ${new Date().toLocaleDateString('tr-TR')}\n\n`;

  report += `HASTA BILGISI\n`;
  report += `Boy: ${p?.height_cm ?? '-'} cm | Kilo: ${p?.weight_kg ?? '-'} kg | `;
  report += `Cinsiyet: ${p?.gender ?? '-'} | Aktivite: ${p?.activity_level ?? '-'}\n\n`;

  if (weights.length >= 2) {
    report += `KILO TRENDI\n`;
    report += `Baslangic: ${weights[0].weight_kg} kg → Son: ${weights[weights.length - 1].weight_kg} kg\n`;
    report += `Degisim: ${((weights[weights.length - 1].weight_kg as number) - (weights[0].weight_kg as number)).toFixed(1)} kg\n\n`;
  }

  if (avgSleep.length > 0) {
    const avg = avgSleep.reduce((s, m) => s + (m.sleep_hours as number), 0) / avgSleep.length;
    report += `UYKU ORTALAMASI: ${avg.toFixed(1)} saat/gun\n\n`;
  }

  if (workouts.length > 0) {
    report += `EGZERSIZ OZETI: ${workouts.length} antrenman kaydi\n\n`;
  }

  if (labs.length > 0) {
    report += `LAB DEGERLERI\n`;
    for (const lab of labs) {
      const flag = lab.is_out_of_range ? ' (!)' : '';
      report += `${lab.parameter_name}: ${lab.value} ${lab.unit}${flag}\n`;
    }
    report += '\n';
  }

  if (events.length > 0) {
    report += `SAGLIK GECMISI\n`;
    for (const ev of events) {
      report += `- [${ev.event_type}] ${ev.description}${ev.is_ongoing ? ' (devam ediyor)' : ''}\n`;
    }
    report += '\n';
  }

  report += `NOT: Bu rapor Kochko uygulamasi tarafindan otomatik olusturulmustur. `;
  report += `Sohbet gecmisi, mood notlari ve AI kocluk notlari gizlilik geregi dahil edilmemistir.\n`;

  return report;
}

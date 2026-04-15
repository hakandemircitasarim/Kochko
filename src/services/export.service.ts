/**
 * Data Export Service
 * Spec 18: Veri saklama, gizlilik - export kapasitesi
 */
import { Share } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
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
  ]).catch((err) => {
    console.error('exportJSON failed:', err);
    throw err;
  });

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

/**
 * Export report as PDF.
 * Uses expo-print to generate HTML->PDF and expo-sharing to share.
 */
export interface PDFReportData {
  title: string;
  period: string;
  compliance: number;
  weightChange: number | null;
  summary: string;
  insights: string[];
  weeklyData: { week: string; compliance: number; weight?: number | null }[];
}

export async function exportPDF(report: PDFReportData): Promise<void> {
  const insightsHtml = report.insights
    .map(i => `<li style="margin-bottom:6px;color:#333;">${i}</li>`)
    .join('');

  const weeklyRowsHtml = report.weeklyData
    .map(
      w =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${w.week}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">%${w.compliance}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${w.weight != null ? `${w.weight} kg` : '-'}</td>
        </tr>`
    )
    .join('');

  const complianceColor =
    report.compliance >= 80 ? '#22c55e' : report.compliance >= 50 ? '#f59e0b' : '#ef4444';

  const weightChangeText =
    report.weightChange != null
      ? `${report.weightChange > 0 ? '+' : ''}${report.weightChange.toFixed(1)} kg`
      : 'Veri yok';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 32px; color: #1a1a2e; background: #fff; }
    h1 { font-size: 24px; color: #1a1a2e; margin-bottom: 4px; }
    .period { font-size: 14px; color: #888; margin-bottom: 24px; }
    .metrics { display: flex; gap: 24px; margin-bottom: 24px; }
    .metric-card { flex: 1; background: #f8f9fa; border-radius: 12px; padding: 16px; text-align: center; }
    .metric-value { font-size: 28px; font-weight: 800; }
    .metric-label { font-size: 12px; color: #888; margin-top: 4px; }
    .section-title { font-size: 16px; font-weight: 700; color: #1a1a2e; margin: 20px 0 10px 0; border-bottom: 2px solid #6366f1; padding-bottom: 4px; }
    .summary { font-size: 14px; line-height: 1.6; color: #333; margin-bottom: 16px; }
    ul { padding-left: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { text-align: left; padding: 8px 12px; background: #6366f1; color: #fff; font-size: 13px; }
    td { font-size: 13px; color: #333; }
    .footer { margin-top: 32px; text-align: center; font-size: 11px; color: #aaa; }
  </style>
</head>
<body>
  <h1>${report.title}</h1>
  <div class="period">${report.period}</div>

  <div class="metrics">
    <div class="metric-card">
      <div class="metric-value" style="color:${complianceColor};">%${report.compliance}</div>
      <div class="metric-label">Ortalama Uyum</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">${weightChangeText}</div>
      <div class="metric-label">Kilo Degisimi</div>
    </div>
  </div>

  <div class="section-title">Ozet</div>
  <div class="summary">${report.summary}</div>

  ${
    insightsHtml
      ? `<div class="section-title">Onemli Noktalar</div><ul>${insightsHtml}</ul>`
      : ''
  }

  ${
    weeklyRowsHtml
      ? `<div class="section-title">Haftalik Veriler</div>
         <table>
           <thead><tr><th>Hafta</th><th>Uyum</th><th>Kilo</th></tr></thead>
           <tbody>${weeklyRowsHtml}</tbody>
         </table>`
      : ''
  }

  <div class="footer">Kochko - Yapay Zeka Destekli Beslenme Asistani</div>
</body>
</html>`;

  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}

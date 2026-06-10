/**
 * Data Export Service
 * Spec 18: Veri saklama, gizlilik - export kapasitesi
 */
import { Share } from 'react-native';
// legacy entrypoint: cacheDirectory/writeAsStringAsync string-API (the new
// SDK 54 File/Paths API renamed these; legacy keeps the stable surface)
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '@/lib/supabase';

/**
 * Export all user data as JSON (Spec 18 / KVKK Md.20 taşınabilirlik).
 * The old 12-table list omitted ~19 tables (chat history, plans, reports,
 * health events, supplements…) while the UI claimed a FULL export.
 * Includes profile, AI summary (Katman 2), logs, reports, preferences,
 * chat history, plans and social data. Written to a file and shared via the
 * system sheet — inlining the JSON into Share.share({message}) hit Android's
 * ~1MB binder limit for exactly the long-tenured users who need export most.
 */
export async function exportJSON(): Promise<void> {
  const queries = {
    profile: supabase.from('profiles').select('*').maybeSingle(),
    ai_summary: supabase.from('ai_summary').select('*').maybeSingle(),
    goals: supabase.from('goals').select('*'),
    // is_deleted dahil: soft-silinen kayıtlar da DB'de tutulan kişisel veridir.
    meal_logs: supabase.from('meal_logs').select('*, meal_log_items(*)').order('logged_at'),
    workout_logs: supabase.from('workout_logs').select('*, strength_sets(*)').order('logged_at'),
    daily_metrics: supabase.from('daily_metrics').select('*').order('date'),
    daily_reports: supabase.from('daily_reports').select('*').order('date'),
    weekly_reports: supabase.from('weekly_reports').select('*').order('week_start'),
    monthly_reports: supabase.from('monthly_reports').select('*').order('month_start'),
    daily_plans: supabase.from('daily_plans').select('*').order('date'),
    weekly_plans: supabase.from('weekly_plans').select('*').order('generated_at'),
    chat_sessions: supabase.from('chat_sessions').select('*').order('created_at'),
    chat_messages: supabase.from('chat_messages').select('*').order('created_at'),
    coaching_messages: supabase.from('coaching_messages').select('*').order('created_at'),
    health_events: supabase.from('health_events').select('*').order('created_at'),
    lab_values: supabase.from('lab_values').select('*').order('measured_at'),
    food_preferences: supabase.from('food_preferences').select('*'),
    supplement_logs: supabase.from('supplement_logs').select('*').order('logged_for_date'),
    weight_history: supabase.from('weight_history').select('*'),
    meal_templates: supabase.from('meal_templates').select('*'),
    user_venues: supabase.from('user_venues').select('*'),
    user_commitments: supabase.from('user_commitments').select('*'),
    ai_feedback: supabase.from('ai_feedback').select('*'),
    saved_recipes: supabase.from('saved_recipes').select('*'),
    challenges: supabase.from('challenges').select('*'),
    achievements: supabase.from('achievements').select('*'),
    coach_consents: supabase.from('coach_consents').select('*'),
    household_members: supabase.from('household_members').select('*'),
    subscriptions: supabase.from('subscriptions').select('*'),
    progress_photos: supabase.from('progress_photos').select('*'),
  } as const;

  const keys = Object.keys(queries) as (keyof typeof queries)[];
  const results = await Promise.all(Object.values(queries));

  // supabase-js never rejects — errors arrive in each result. Coalescing them
  // to [] produced silently-partial KVKK exports; collect them explicitly.
  const errors: string[] = [];
  const data: Record<string, unknown> = { exported_at: new Date().toISOString() };
  keys.forEach((key, i) => {
    const res = results[i] as { data: unknown; error: { message: string } | null };
    if (res.error) {
      // Tables that may not exist for this account (e.g. no membership rows)
      // legitimately return data; a real error must be visible in the export.
      errors.push(`${key}: ${res.error.message}`);
      data[key] = null;
    } else {
      data[key] = res.data ?? (key === 'profile' || key === 'ai_summary' ? null : []);
    }
  });
  if (errors.length > 0) data._export_errors = errors;

  const json = JSON.stringify(data, null, 2);
  const fileUri = `${FileSystem.cacheDirectory}kochko-export-${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(fileUri, json, { encoding: 'utf8' });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: 'Kochko Veri Exportu' });
  } else {
    await Share.share({ title: 'Kochko Export', message: json });
  }
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

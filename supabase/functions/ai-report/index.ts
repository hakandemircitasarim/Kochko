/**
 * AI REPORT GENERATION
 * Spec Section 8.1-8.3
 *
 * Generates daily and weekly reports.
 * Daily: compliance score, target check, deviation analysis, tomorrow action.
 * Weekly: weight trend, compliance avg, budget uyumu, strategy, plan revision.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion, TEMPERATURE } from '../shared/openai.ts';
import { supabaseAdmin, getUserId } from '../shared/supabase-admin.ts';
import { sanitizeText } from '../shared/guardrails.ts';

const DAILY_REPORT_SYSTEM = `Kullanicinin gunluk performansini degerlendir. Uyum puani (0-100) hesapla.

Puan hesabi:
- Kalori hedef araliginda: +30
- Protein hedefe ulasti: +20
- Antrenman yapildi: +20
- Su hedefine ulasti: +10
- Uyku 7+ saat: +10
- Adim hedefine ulasti: +10
Eksikleri orantili dus.

JSON formatinda:
{
  "compliance_score": sayi,
  "calorie_target_met": boolean,
  "protein_target_met": boolean,
  "workout_completed": boolean,
  "water_target_met": boolean,
  "steps_actual": sayi_veya_null,
  "sleep_impact": "uyku yorumu veya null",
  "water_impact": "su yorumu veya null",
  "deviation_reason": "stres|aclik|disarida_yemek|plansiz_atistirma|sosyal|alkol|yok",
  "weekly_budget_status": "haftalik butce durumu cumle",
  "tomorrow_action": "yarin icin tek en etkili aksiyon",
  "full_report": "2-3 cumle degerlendirme"
}`;

const MONTHLY_REPORT_SYSTEM = `Kullanicinin aylik performansini degerlendir. Son 4 haftanin verilerini analiz et.

JSON formatinda:
{
  "monthly_summary": "3-4 cumle aylik degerlendirme",
  "avg_compliance": sayi,
  "trend_direction": "yukselis|dusus|stabil",
  "weight_change_kg": sayi_veya_null,
  "risk_signals": ["risk1", "risk2"],
  "behavioral_patterns": ["pattern1", "pattern2"],
  "top_achievement": "ayin en buyuk basarisi",
  "deviation_distribution": {"stres": sayi, "aclik": sayi, "disarida_yemek": sayi, "plansiz_atistirma": sayi, "sosyal": sayi, "alkol": sayi, "yok": sayi},
  "next_month_focus": "gelecek ay odak noktasi 2-3 cumle"
}`;

const WEEKLY_REPORT_SYSTEM = `Kullanicinin haftalik performansini degerlendir.

JSON formatinda:
{
  "avg_compliance": sayi,
  "weekly_budget_compliance": boolean,
  "top_deviation": "en cok sapilan konu",
  "best_day": "tarih",
  "worst_day": "tarih",
  "strength_summary": "guc ozeti veya null",
  "ai_learning_note": "bu hafta seni daha iyi tanidim notu veya null",
  "next_week_strategy": "gelecek hafta stratejisi 2-3 cumle",
  "plan_revision": {"calorie_adj": sayi_veya_null, "protein_adj": sayi_veya_null, "workout_change": "text_veya_null"}
}`;

serve(async (req: Request) => {
  try {
    const userId = await getUserId(req);
    const { report_type, date } = await req.json();

    if (report_type === 'daily') {
      return await generateDailyReport(userId, date);
    } else if (report_type === 'weekly') {
      return await generateWeeklyReport(userId);
    } else if (report_type === 'monthly') {
      return await generateMonthlyReport(userId);
    }

    return respond({ error: 'report_type must be "daily", "weekly", or "monthly"' }, 400);
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});

async function generateDailyReport(userId: string, date?: string) {
  const reportDate = date ?? new Date().toISOString().split('T')[0];

  // Fetch today's data
  const [planRes, mealsRes, workoutsRes, metricsRes, goalRes] = await Promise.all([
    supabaseAdmin.from('daily_plans').select('calorie_target_min, calorie_target_max, protein_target_g').eq('user_id', userId).eq('date', reportDate).limit(1).single(),
    supabaseAdmin.from('meal_logs').select('id').eq('user_id', userId).eq('logged_for_date', reportDate).eq('is_deleted', false),
    supabaseAdmin.from('workout_logs').select('duration_min').eq('user_id', userId).eq('logged_for_date', reportDate),
    supabaseAdmin.from('daily_metrics').select('*').eq('user_id', userId).eq('date', reportDate).single(),
    supabaseAdmin.from('goals').select('goal_type, target_weight_kg, weekly_rate, target_weeks, created_at').eq('user_id', userId).eq('is_active', true).limit(1).single(),
  ]);

  // Sum calories/protein from meal items
  const mealIds = (mealsRes.data ?? []).map((m: { id: string }) => m.id);
  let totalCal = 0, totalPro = 0, totalCarb = 0, totalFat = 0, totalAlcCal = 0;
  if (mealIds.length > 0) {
    const { data: items } = await supabaseAdmin
      .from('meal_log_items')
      .select('calories, protein_g, carbs_g, fat_g, alcohol_g')
      .in('meal_log_id', mealIds);
    for (const i of (items ?? []) as { calories: number; protein_g: number; carbs_g: number; fat_g: number; alcohol_g: number }[]) {
      totalCal += i.calories;
      totalPro += i.protein_g;
      totalCarb += i.carbs_g;
      totalFat += i.fat_g;
      totalAlcCal += (i.alcohol_g ?? 0) * 7;
    }
  }

  const plan = planRes.data;
  const metrics = metricsRes.data;
  const workouts = workoutsRes.data ?? [];
  const totalWorkoutMin = workouts.reduce((s: number, w: { duration_min: number }) => s + (w.duration_min || 0), 0);

  const prompt = `Tarih: ${reportDate}
Hedefler: Kalori ${plan?.calorie_target_min ?? '?'}-${plan?.calorie_target_max ?? '?'} kcal | Protein ${plan?.protein_target_g ?? '?'}g
Gerceklesen: Kalori ${totalCal} kcal | Protein ${Math.round(totalPro)}g | Karb ${Math.round(totalCarb)}g | Yag ${Math.round(totalFat)}g | Alkol ${totalAlcCal} kcal
Antrenman: ${workouts.length > 0 ? `${workouts.length} seans, ${totalWorkoutMin} dk` : 'yapilmadi'}
Su: ${metrics?.water_liters ?? 0}L | Uyku: ${metrics?.sleep_hours ?? '?'}sa | Adim: ${metrics?.steps ?? '?'} | Mood: ${metrics?.mood_score ?? '?'}/5
${(() => {
  const g = goalRes.data;
  if (!g || !g.target_weight_kg || !metrics?.weight_kg) return '';
  const tw = g.target_weight_kg as number;
  const cw = metrics.weight_kg as number;
  const kgLeft = Math.abs(cw - tw);
  const created = new Date(g.created_at as string);
  const weeksElapsed = Math.max(1, Math.round((Date.now() - created.getTime()) / (7*24*60*60*1000)));
  const targetWeeks = (g.target_weeks as number) ?? 12;
  const weeksLeft = Math.max(0, targetWeeks - weeksElapsed);
  const pace = kgLeft > 0 && weeksLeft > 0 ? (kgLeft / weeksLeft).toFixed(2) : '?';
  return `HEDEF: ${g.goal_type} -> ${tw}kg | Simdi: ${cw}kg | ${kgLeft.toFixed(1)}kg kaldi | ${weeksElapsed}/${targetWeeks} hafta | Gereken tempo: ${pace}kg/hafta`;
})()}`;

  const report = await chatCompletion<Record<string, unknown>>(
    [{ role: 'system', content: DAILY_REPORT_SYSTEM }, { role: 'user', content: prompt }],
    { temperature: TEMPERATURE.analyst, maxTokens: 1500, jsonMode: true }
  );

  // Sanitize
  if (typeof report.full_report === 'string') report.full_report = sanitizeText(report.full_report).clean;
  if (typeof report.tomorrow_action === 'string') report.tomorrow_action = sanitizeText(report.tomorrow_action).clean;

  // Clamp compliance
  report.compliance_score = Math.max(0, Math.min(100, Math.round(report.compliance_score as number)));

  // Store
  await supabaseAdmin.from('daily_reports').upsert({
    user_id: userId, date: reportDate,
    compliance_score: report.compliance_score,
    calorie_actual: totalCal, protein_actual: Math.round(totalPro),
    carbs_actual: Math.round(totalCarb), fat_actual: Math.round(totalFat),
    alcohol_calories: totalAlcCal,
    calorie_target_met: report.calorie_target_met,
    protein_target_met: report.protein_target_met,
    workout_completed: report.workout_completed,
    water_target_met: report.water_target_met,
    steps_actual: report.steps_actual ?? metrics?.steps,
    sleep_impact: report.sleep_impact,
    water_impact: report.water_impact,
    deviation_reason: report.deviation_reason,
    weekly_budget_status: report.weekly_budget_status,
    tomorrow_action: report.tomorrow_action,
    full_report: report.full_report,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,date' });

  return respond(report);
}

async function generateWeeklyReport(userId: string) {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(now); weekStart.setDate(now.getDate() + mondayOffset - 7);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const wsStr = weekStart.toISOString().split('T')[0];
  const weStr = weekEnd.toISOString().split('T')[0];

  const [reportsRes, metricsRes] = await Promise.all([
    supabaseAdmin.from('daily_reports').select('*').eq('user_id', userId).gte('date', wsStr).lte('date', weStr).order('date'),
    supabaseAdmin.from('daily_metrics').select('date, weight_kg, water_liters, sleep_hours, steps').eq('user_id', userId).gte('date', wsStr).lte('date', weStr).order('date'),
  ]);

  const reports = reportsRes.data ?? [];
  const metrics = metricsRes.data ?? [];

  const prompt = `Hafta: ${wsStr} - ${weStr}
Raporlar: ${reports.map((r: { date: string; compliance_score: number; deviation_reason: string }) => `${r.date}: uyum ${r.compliance_score}, sapma: ${r.deviation_reason ?? 'yok'}`).join('\n') || 'rapor yok'}
Metrikler: ${metrics.map((m: { date: string; weight_kg: number | null; sleep_hours: number | null }) => `${m.date}: ${m.weight_kg ?? '-'}kg, uyku ${m.sleep_hours ?? '-'}sa`).join('\n') || 'veri yok'}`;

  const report = await chatCompletion<Record<string, unknown>>(
    [{ role: 'system', content: WEEKLY_REPORT_SYSTEM }, { role: 'user', content: prompt }],
    { temperature: TEMPERATURE.analyst, maxTokens: 2000, jsonMode: true }
  );

  if (typeof report.next_week_strategy === 'string') report.next_week_strategy = sanitizeText(report.next_week_strategy).clean;

  const weights = metrics.filter((m: { weight_kg: number | null }) => m.weight_kg).map((m: { date: string; weight_kg: number }) => ({ date: m.date, kg: m.weight_kg }));

  await supabaseAdmin.from('weekly_reports').upsert({
    user_id: userId, week_start: wsStr,
    weight_trend: weights,
    avg_compliance: report.avg_compliance,
    weekly_budget_compliance: report.weekly_budget_compliance,
    top_deviation: report.top_deviation,
    best_day: report.best_day,
    worst_day: report.worst_day,
    strength_summary: report.strength_summary,
    ai_learning_note: report.ai_learning_note,
    next_week_strategy: report.next_week_strategy,
    plan_revision: report.plan_revision,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,week_start' });

  return respond(report);
}

async function generateMonthlyReport(userId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const msStr = monthStart.toISOString().split('T')[0];
  const meStr = monthEnd.toISOString().split('T')[0];

  const [weeklyRes, dailyRes, metricsRes] = await Promise.all([
    supabaseAdmin.from('weekly_reports').select('*').eq('user_id', userId).gte('week_start', msStr).lte('week_start', meStr).order('week_start'),
    supabaseAdmin.from('daily_reports').select('date, compliance_score, deviation_reason').eq('user_id', userId).gte('date', msStr).lte('date', meStr).order('date'),
    supabaseAdmin.from('daily_metrics').select('date, weight_kg').eq('user_id', userId).gte('date', msStr).lte('date', meStr).order('date'),
  ]);

  const weeklyReports = weeklyRes.data ?? [];
  const dailyReports = dailyRes.data ?? [];
  const metrics = metricsRes.data ?? [];

  // Calculate stats
  const avgCompliance = dailyReports.length > 0
    ? Math.round(dailyReports.reduce((s: number, r: { compliance_score: number }) => s + (r.compliance_score ?? 0), 0) / dailyReports.length)
    : 0;

  const weights = metrics.filter((m: { weight_kg: number | null }) => m.weight_kg != null).map((m: { date: string; weight_kg: number }) => ({ date: m.date, kg: m.weight_kg }));
  const weightChange = weights.length >= 2 ? weights[weights.length - 1].kg - weights[0].kg : null;

  // Deviation distribution
  const devDist: Record<string, number> = {};
  for (const r of dailyReports as { deviation_reason?: string }[]) {
    const reason = r.deviation_reason ?? 'yok';
    devDist[reason] = (devDist[reason] ?? 0) + 1;
  }

  const prompt = `Ay: ${msStr} - ${meStr}
Ortalama Uyum: %${avgCompliance}
Kilo Degisimi: ${weightChange !== null ? `${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)}kg` : 'veri yok'}
Sapma Dagilimi: ${JSON.stringify(devDist)}
Haftalik Raporlar: ${weeklyReports.map((wr: { week_start: string; avg_compliance: number; next_week_strategy: string }) => `${wr.week_start}: uyum %${wr.avg_compliance}, strateji: ${wr.next_week_strategy ?? '-'}`).join('\n') || 'rapor yok'}
Gunluk Uyum: ${dailyReports.map((r: { date: string; compliance_score: number }) => `${r.date}: %${r.compliance_score}`).join(', ') || 'veri yok'}`;

  const report = await chatCompletion<Record<string, unknown>>(
    [{ role: 'system', content: MONTHLY_REPORT_SYSTEM }, { role: 'user', content: prompt }],
    { temperature: TEMPERATURE.analyst, maxTokens: 2500, jsonMode: true }
  );

  // Sanitize text fields
  if (typeof report.monthly_summary === 'string') report.monthly_summary = sanitizeText(report.monthly_summary).clean;
  if (typeof report.top_achievement === 'string') report.top_achievement = sanitizeText(report.top_achievement).clean;
  if (typeof report.next_month_focus === 'string') report.next_month_focus = sanitizeText(report.next_month_focus).clean;
  if (Array.isArray(report.risk_signals)) {
    report.risk_signals = report.risk_signals.map((s: unknown) => typeof s === 'string' ? sanitizeText(s).clean : s);
  }
  if (Array.isArray(report.behavioral_patterns)) {
    report.behavioral_patterns = report.behavioral_patterns.map((s: unknown) => typeof s === 'string' ? sanitizeText(s).clean : s);
  }

  // Clamp compliance
  if (typeof report.avg_compliance === 'number') {
    report.avg_compliance = Math.max(0, Math.min(100, Math.round(report.avg_compliance)));
  }

  await supabaseAdmin.from('monthly_reports').upsert({
    user_id: userId,
    month_start: msStr,
    avg_compliance: report.avg_compliance ?? avgCompliance,
    weight_change_kg: report.weight_change_kg ?? weightChange,
    trend_direction: report.trend_direction,
    monthly_summary: report.monthly_summary,
    risk_signals: report.risk_signals,
    behavioral_patterns: report.behavioral_patterns,
    top_achievement: report.top_achievement,
    deviation_distribution: report.deviation_distribution,
    next_month_focus: report.next_month_focus,
    weight_trend: weights,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,month_start' });

  return respond(report);
}

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

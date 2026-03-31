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
    }

    return respond({ error: 'report_type must be "daily" or "weekly"' }, 400);
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

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

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
import { updateLayer2 } from '../shared/memory.ts';

// Goal-type-based compliance weights (Spec 8.1 deepening)
function getComplianceWeights(goalType: string): Record<string, number> {
  switch (goalType) {
    case 'lose_weight': return { calorie: 40, protein: 25, workout: 20, water: 10, sleep: 5, mood: 0 };
    case 'gain_muscle': return { calorie: 20, protein: 35, workout: 30, water: 5, sleep: 10, mood: 0 };
    case 'gain_weight': return { calorie: 25, protein: 30, workout: 25, water: 5, sleep: 10, mood: 5 };
    case 'health':      return { calorie: 20, protein: 15, workout: 20, water: 20, sleep: 15, mood: 10 };
    case 'maintain':    return { calorie: 25, protein: 20, workout: 20, water: 15, sleep: 15, mood: 5 };
    default:            return { calorie: 30, protein: 20, workout: 20, water: 10, sleep: 10, mood: 10 };
  }
}

const DAILY_REPORT_SYSTEM = `Kullanicinin gunluk performansini degerlendir. Uyum puani (0-100) hesapla.
Onemli: Puan agirliklari kullanicinin hedef turune gore degisir (prompt'ta AGIRLIKLAR satirinda verilir).

Puan hesabi (AGIRLIKLAR satirindaki yuzdelere gore):
- Kalori hedef araliginda: AGIRLIK'a gore
- Protein hedefe ulasti: AGIRLIK'a gore
- Antrenman yapildi: AGIRLIK'a gore
- Su hedefine ulasti: AGIRLIK'a gore
- Uyku 7+ saat: AGIRLIK'a gore
- Adim/Mood: AGIRLIK'a gore
Eksikleri orantili dus.
Yarin icin 1 SPESIFIK, UYGULANABILIR aksiyon ver (genel tavsiye degil).

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
    const { report_type, date, force } = await req.json();
    const forceRegen = force === true;

    if (report_type === 'daily') {
      return await generateDailyReport(userId, date, forceRegen);
    } else if (report_type === 'weekly') {
      return await generateWeeklyReport(userId, forceRegen);
    } else if (report_type === 'monthly') {
      return await generateMonthlyReport(userId, forceRegen);
    } else if (report_type === 'all_time') {
      return await generateAllTimeReport(userId);
    }

    return respond({ error: 'report_type must be "daily", "weekly", "monthly", or "all_time"' }, 400);
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});

/**
 * Server-side report cache (cost control): every authed JWT could previously
 * loop ai-report and burn AI tokens — each call re-ran chatCompletion even
 * when the period's row already existed. Now the persisted row IS the cache:
 * return it unless the client explicitly asks force:true, and even then apply
 * a short cooldown so a stuck retry-loop can't spend money.
 */
const FORCE_COOLDOWN_MS = 5 * 60 * 1000;

function cacheHit(row: Record<string, unknown> | null, force: boolean): boolean {
  if (!row) return false;
  if (!force) return true;
  const gen = row.generated_at ? new Date(row.generated_at as string).getTime() : 0;
  return Date.now() - gen < FORCE_COOLDOWN_MS;
}

async function generateDailyReport(userId: string, date?: string, force = false) {
  const reportDate = date ?? new Date().toISOString().split('T')[0];

  // Cache: the persisted row for this date, unless force (with cooldown).
  const { data: cached } = await supabaseAdmin
    .from('daily_reports').select('*')
    .eq('user_id', userId).eq('date', reportDate).maybeSingle();
  if (cacheHit(cached, force)) return respond(cached);

  // Fetch today's data
  const [planRes, mealsRes, workoutsRes, metricsRes, goalRes] = await Promise.all([
    supabaseAdmin.from('daily_plans').select('calorie_target_min, calorie_target_max, protein_target_g, water_target_liters').eq('user_id', userId).eq('date', reportDate).limit(1).maybeSingle(),
    supabaseAdmin.from('meal_logs').select('id').eq('user_id', userId).eq('logged_for_date', reportDate).eq('is_deleted', false),
    supabaseAdmin.from('workout_logs').select('duration_min').eq('user_id', userId).eq('logged_for_date', reportDate),
    supabaseAdmin.from('daily_metrics').select('*').eq('user_id', userId).eq('date', reportDate).maybeSingle(),
    supabaseAdmin.from('goals').select('goal_type, target_weight_kg, weekly_rate, target_weeks, created_at').eq('user_id', userId).eq('is_active', true).limit(1).maybeSingle(),
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

  // Goal-based compliance weights
  const goalType = goalRes.data?.goal_type as string ?? 'health';
  const weights = getComplianceWeights(goalType);

  const prompt = `Tarih: ${reportDate}
AGIRLIKLAR: Kalori=%${weights.calorie} Protein=%${weights.protein} Antrenman=%${weights.workout} Su=%${weights.water} Uyku=%${weights.sleep} Mood=%${weights.mood} (Hedef: ${goalType})
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

  // Clamp compliance (coerce to a finite number first so a missing/NaN value
  // can never reach the NOT NULL column)
  const rawCompliance = Number(report.compliance_score);
  report.compliance_score = Number.isFinite(rawCompliance)
    ? Math.max(0, Math.min(100, Math.round(rawCompliance)))
    : 0;

  // Backfill NOT NULL columns so a model omission can't violate the constraint
  if (typeof report.tomorrow_action !== 'string' || !report.tomorrow_action) report.tomorrow_action = '-';
  if (typeof report.full_report !== 'string' || !report.full_report) report.full_report = 'Rapor oluşturulamadı.';

  // Compute the target-met booleans DETERMINISTICALLY from the actuals we already summed —
  // the LLM was deciding these and could contradict the very numbers shown beside the
  // checkmark (e.g. green "Kalori met" next to 2400 kcal over an 1800-2000 target).
  const calorieTargetMet = (plan?.calorie_target_min != null && plan?.calorie_target_max != null)
    ? (totalCal >= plan.calorie_target_min && totalCal <= plan.calorie_target_max)
    : (report.calorie_target_met ?? false);
  const proteinTargetMet = (plan?.protein_target_g != null)
    ? (Math.round(totalPro) >= plan.protein_target_g)
    : (report.protein_target_met ?? false);
  const workoutCompleted = workouts.length > 0;
  const waterTargetMet = (plan?.water_target_liters != null)
    ? ((metrics?.water_liters ?? 0) >= plan.water_target_liters)
    : (report.water_target_met ?? false);

  // Store
  const { error: upsertErr } = await supabaseAdmin.from('daily_reports').upsert({
    user_id: userId, date: reportDate,
    compliance_score: report.compliance_score,
    calorie_actual: totalCal, protein_actual: Math.round(totalPro),
    carbs_actual: Math.round(totalCarb), fat_actual: Math.round(totalFat),
    alcohol_calories: totalAlcCal,
    calorie_target_met: calorieTargetMet,
    protein_target_met: proteinTargetMet,
    workout_completed: workoutCompleted,
    water_target_met: waterTargetMet,
    steps_actual: report.steps_actual ?? metrics?.steps,
    sleep_impact: report.sleep_impact,
    water_impact: report.water_impact,
    deviation_reason: report.deviation_reason,
    weekly_budget_status: report.weekly_budget_status,
    tomorrow_action: report.tomorrow_action,
    full_report: report.full_report,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,date' });
  if (upsertErr) {
    console.error('[ai-report] daily_reports upsert failed:', upsertErr.message);
    return respond({ error: 'Rapor kaydedilemedi: ' + upsertErr.message }, 500);
  }

  return respond(report);
}

async function generateWeeklyReport(userId: string, force = false) {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(now); weekStart.setDate(now.getDate() + mondayOffset - 7);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const wsStr = weekStart.toISOString().split('T')[0];
  const weStr = weekEnd.toISOString().split('T')[0];

  // Cache: the persisted row for this week, unless force (with cooldown).
  const { data: cached } = await supabaseAdmin
    .from('weekly_reports').select('*')
    .eq('user_id', userId).eq('week_start', wsStr).maybeSingle();
  if (cacheHit(cached, force)) return respond(cached);

  // For alcohol comparison
  const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(weekStart.getDate() - 7);
  const prevWeekEnd = new Date(weekStart); prevWeekEnd.setDate(weekStart.getDate() - 1);
  const pwsStr = prevWeekStart.toISOString().split('T')[0];
  const pweStr = prevWeekEnd.toISOString().split('T')[0];

  const [reportsRes, metricsRes, prevReportsRes] = await Promise.all([
    supabaseAdmin.from('daily_reports').select('*').eq('user_id', userId).gte('date', wsStr).lte('date', weStr).order('date'),
    supabaseAdmin.from('daily_metrics').select('date, weight_kg, water_liters, sleep_hours, steps').eq('user_id', userId).gte('date', wsStr).lte('date', weStr).order('date'),
    supabaseAdmin.from('daily_reports').select('date, alcohol_calories').eq('user_id', userId).gte('date', pwsStr).lte('date', pweStr),
  ]);

  const reports = reportsRes.data ?? [];
  const metrics = metricsRes.data ?? [];

  // Alcohol summary (Spec 3.1, 8.2)
  const thisWeekAlcRows = reports as { date: string; alcohol_calories: number | null }[];
  const thisWeekAlcTotal = thisWeekAlcRows.reduce((s, r) => s + (r.alcohol_calories ?? 0), 0);
  const prevWeekAlcTotal = ((prevReportsRes.data ?? []) as { alcohol_calories: number | null }[])
    .reduce((s, r) => s + (r.alcohol_calories ?? 0), 0);

  // Classify weekday vs weekend alcohol (0=Sun, 5=Fri, 6=Sat in JS)
  let weekdayAlc = 0, weekendAlc = 0;
  for (const r of thisWeekAlcRows) {
    const d = new Date(r.date).getDay();
    const isWeekend = d === 0 || d === 5 || d === 6;
    if (isWeekend) weekendAlc += (r.alcohol_calories ?? 0);
    else weekdayAlc += (r.alcohol_calories ?? 0);
  }

  const prompt = `Hafta: ${wsStr} - ${weStr}
Raporlar: ${reports.map((r: { date: string; compliance_score: number; deviation_reason: string }) => `${r.date}: uyum ${r.compliance_score}, sapma: ${r.deviation_reason ?? 'yok'}`).join('\n') || 'rapor yok'}
Metrikler: ${metrics.map((m: { date: string; weight_kg: number | null; sleep_hours: number | null }) => `${m.date}: ${m.weight_kg ?? '-'}kg, uyku ${m.sleep_hours ?? '-'}sa`).join('\n') || 'veri yok'}
Alkol: bu hafta ${thisWeekAlcTotal}kcal (ici ${weekdayAlc}, sonu ${weekendAlc}) | gecen hafta ${prevWeekAlcTotal}kcal`;

  const report = await chatCompletion<Record<string, unknown>>(
    [{ role: 'system', content: WEEKLY_REPORT_SYSTEM }, { role: 'user', content: prompt }],
    { temperature: TEMPERATURE.analyst, maxTokens: 2000, jsonMode: true }
  );

  // Default the NOT NULL next_week_strategy before the upsert so an omitted key
  // can't violate the constraint.
  report.next_week_strategy = (typeof report.next_week_strategy === 'string' && report.next_week_strategy.trim())
    ? sanitizeText(report.next_week_strategy).clean
    : '-';

  // best_day / worst_day are DATE columns; the prompt asks for a free-form "tarih"
  // so the model may emit "" or a weekday name ("Pazartesi"), which 22007-fails the
  // whole upsert. Accept only an ISO date inside this week's range, else null.
  const validDay = (v: unknown): string | null =>
    (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= wsStr && v <= weStr) ? v : null;
  const bestDay = validDay(report.best_day);
  const worstDay = validDay(report.worst_day);

  const weights = metrics.filter((m: { weight_kg: number | null }) => m.weight_kg).map((m: { date: string; weight_kg: number }) => ({ date: m.date, kg: m.weight_kg }));

  // avg_compliance + weekly_budget_compliance computed DETERMINISTICALLY (the LLM was
  // guessing both — and the weekly prompt contains NO calorie/budget data at all, so its
  // budget verdict was a coin-flip). Mirrors the monthly path + the Progress tab.
  const avgCompliance = reports.length
    ? Math.max(0, Math.min(100, Math.round(reports.reduce((s: number, r: { compliance_score?: number }) => s + (r.compliance_score ?? 0), 0) / reports.length)))
    : 0;
  const weekConsumed = reports.reduce((s: number, r: { calorie_actual?: number }) => s + (r.calorie_actual ?? 0), 0);
  const { data: budgetProfile } = await supabaseAdmin.from('profiles').select('weekly_calorie_budget').eq('id', userId).maybeSingle();
  const weeklyBudget = budgetProfile?.weekly_calorie_budget as number | null;
  const weeklyBudgetCompliance = (weeklyBudget != null && weeklyBudget > 0) ? (weekConsumed <= weeklyBudget) : null;

  const { error: wrErr } = await supabaseAdmin.from('weekly_reports').upsert({
    user_id: userId, week_start: wsStr,
    weight_trend: weights,
    avg_compliance: avgCompliance,
    weekly_budget_compliance: weeklyBudgetCompliance,
    top_deviation: report.top_deviation,
    best_day: bestDay,
    worst_day: worstDay,
    strength_summary: report.strength_summary,
    ai_learning_note: report.ai_learning_note,
    alcohol_total_calories: thisWeekAlcTotal,
    next_week_strategy: report.next_week_strategy,
    plan_revision: report.plan_revision,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,week_start' });
  if (wrErr) {
    console.error('[ai-report] weekly_reports upsert failed:', wrErr.message);
    return respond({ error: 'Haftalik rapor kaydedilemedi: ' + wrErr.message }, 500);
  }

  // Sync weekly learning to Layer 2 (ai_summary) for long-term memory
  if (report.ai_learning_note) {
    const dateStr = new Date().toISOString().split('T')[0];
    const { data: existingSummary } = await supabaseAdmin
      .from('ai_summary').select('coaching_notes').eq('user_id', userId).maybeSingle();
    const existingNotes = (existingSummary?.coaching_notes as string) ?? '';
    const weeklyNote = `[${dateStr} haftalık] ${report.ai_learning_note}`;
    updateLayer2(userId, {
      coaching_notes: existingNotes ? `${existingNotes}\n${weeklyNote}` : weeklyNote,
    }).catch((err: Error) => console.error('[ai-report] Layer2 weekly learning write failed:', err.message));
  }

  return respond(report);
}

async function generateMonthlyReport(userId: string, force = false) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const msStr = monthStart.toISOString().split('T')[0];
  const meStr = monthEnd.toISOString().split('T')[0];

  // Cache: the persisted row for this month, unless force (with cooldown).
  const { data: cached } = await supabaseAdmin
    .from('monthly_reports').select('*')
    .eq('user_id', userId).eq('month_start', msStr).maybeSingle();
  if (cacheHit(cached, force)) return respond(cached);

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

  // monthly_reports.trend_direction CHECK accepts the Turkish set (migration 036).
  // Guard against AI drift so a stray value can't silently fail the whole upsert.
  const VALID_TRENDS = ['yukselis', 'dusus', 'stabil'];
  const trendDir = VALID_TRENDS.includes(report.trend_direction as string) ? (report.trend_direction as string) : 'stabil';

  // Coerce + clamp AI-provided numerics defensively (covers numeric strings the typeof clamp above misses)
  const safeCompliance = Math.max(0, Math.min(100, Math.round(Number(report.avg_compliance ?? avgCompliance)) || 0));
  const rawWeightChange = report.weight_change_kg ?? weightChange;
  const safeWeightChange = rawWeightChange == null ? null : Math.max(-999, Math.min(999, Number(rawWeightChange) || 0));

  const { error: monthlyErr } = await supabaseAdmin.from('monthly_reports').upsert({
    user_id: userId,
    month_start: msStr,
    avg_compliance: safeCompliance,
    weight_change_kg: safeWeightChange,
    trend_direction: trendDir,
    monthly_summary: report.monthly_summary,
    risk_signals: report.risk_signals,
    behavioral_patterns: report.behavioral_patterns,
    top_achievement: report.top_achievement,
    // Persist the ground-truth tally the code already computed, not the model's
    // reconstruction (the LLM drops/renames keys and fudges counts).
    deviation_distribution: devDist,
    next_month_focus: report.next_month_focus,
    weight_trend: weights,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,month_start' });
  if (monthlyErr) {
    console.error('[ai-report] monthly_reports upsert failed:', monthlyErr.message);
    return respond({ error: 'Aylik rapor kaydedilemedi: ' + monthlyErr.message }, 500);
  }

  return respond(report);
}

// ─── All-Time Report (Phase 4) ───

async function generateAllTimeReport(userId: string) {
  const [dailyRes, metricsRes, goalsRes, streakRes, strengthRes] = await Promise.all([
    supabaseAdmin.from('daily_reports')
      .select('date, compliance_score')
      .eq('user_id', userId)
      .order('date'),
    supabaseAdmin.from('daily_metrics')
      .select('date, weight_kg')
      .eq('user_id', userId)
      .not('weight_kg', 'is', null)
      .order('date'),
    supabaseAdmin.from('goals')
      .select('goal_type, target_weight_kg, created_at, is_active')
      .eq('user_id', userId)
      .order('created_at'),
    supabaseAdmin.from('daily_reports')
      .select('compliance_score')
      .eq('user_id', userId)
      .gte('compliance_score', 70)
      .order('date'),
    // strength_sets has no user_id/logged_for_date — scope via the workout_logs FK and order by
    // weight so the first row per exercise is that exercise's heaviest set (lifetime PR).
    supabaseAdmin.from('strength_sets')
      .select('exercise_name, weight_kg, reps, workout_logs!inner(user_id)')
      .eq('workout_logs.user_id', userId)
      .not('weight_kg', 'is', null)
      .order('weight_kg', { ascending: false })
      .limit(200),
  ]);

  const reports = (dailyRes.data ?? []) as { date: string; compliance_score: number }[];
  const weights = (metricsRes.data ?? []) as { date: string; weight_kg: number }[];
  const goals = (goalsRes.data ?? []) as { goal_type: string; target_weight_kg: number | null; created_at: string; is_active: boolean }[];

  // Lifetime stats
  const totalDays = reports.length;
  const avgCompliance = totalDays > 0
    ? Math.round(reports.reduce((s, r) => s + r.compliance_score, 0) / totalDays)
    : 0;

  // Weight journey
  const firstWeight = weights.length > 0 ? weights[0].weight_kg : null;
  const lastWeight = weights.length > 0 ? weights[weights.length - 1].weight_kg : null;
  const totalWeightChange = firstWeight && lastWeight ? Math.round((lastWeight - firstWeight) * 10) / 10 : null;

  // Best streak
  let maxStreak = 0;
  let currentStreak = 0;
  for (const r of reports) {
    if (r.compliance_score >= 70) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  // First activity date
  const firstDate = reports.length > 0 ? reports[0].date : null;
  const daysSinceStart = firstDate ? Math.floor((Date.now() - new Date(firstDate).getTime()) / 86400000) : 0;

  // Lifetime strength PRs: heaviest set per exercise (rows already ordered by weight desc).
  const strengthSets = (strengthRes.data ?? []) as { exercise_name: string; weight_kg: number | null; reps: number }[];
  const bestLifts: { exercise: string; weight_kg: number; reps: number }[] = [];
  const seenLifts = new Set<string>();
  for (const s of strengthSets) {
    if (s.weight_kg == null || seenLifts.has(s.exercise_name)) continue;
    seenLifts.add(s.exercise_name);
    bestLifts.push({ exercise: s.exercise_name, weight_kg: s.weight_kg, reps: s.reps });
  }

  const allTimeReport = {
    total_days_tracked: totalDays,
    days_since_start: daysSinceStart,
    avg_compliance: avgCompliance,
    total_weight_change_kg: totalWeightChange,
    first_weight_kg: firstWeight,
    current_weight_kg: lastWeight,
    longest_streak: maxStreak,
    goals_completed: goals.filter(g => !g.is_active).length,
    goals_active: goals.filter(g => g.is_active).length,
    best_lifts: bestLifts.slice(0, 5),
    weight_journey: weights.length > 10
      ? weights.filter((_, i) => i % Math.ceil(weights.length / 10) === 0).map(w => ({ date: w.date, kg: w.weight_kg }))
      : weights.map(w => ({ date: w.date, kg: w.weight_kg })),
  };

  return respond(allTimeReport);
}

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

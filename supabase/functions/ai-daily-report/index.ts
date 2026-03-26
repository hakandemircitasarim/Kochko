/**
 * Edge Function: Generate end-of-day report.
 * Analyzes today's logs vs plan targets, produces compliance score and coaching.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion } from '../shared/openai.ts';
import { supabaseAdmin, getUserId } from '../shared/supabase-admin.ts';
import { sanitizeText } from '../shared/guardrails.ts';

const SYSTEM_PROMPT = `Sen Kochko yaşam tarzı koçusun. Gün sonu performans değerlendirmesi yapıyorsun.
Net, direkt, operasyonel ol. Abartılı motivasyon yok.
Yanıtını SADECE JSON formatında ver.`;

serve(async (req: Request) => {
  try {
    const userId = await getUserId(req);
    const { date } = await req.json();
    const reportDate = date ?? new Date().toISOString().split('T')[0];

    // Fetch today's data in parallel
    const [planRes, mealsRes, workoutsRes, metricsRes] = await Promise.all([
      supabaseAdmin.from('daily_plans').select('*').eq('user_id', userId).eq('date', reportDate).single(),
      supabaseAdmin
        .from('meal_logs')
        .select('*, meal_log_items(*)')
        .eq('user_id', userId)
        .gte('logged_at', `${reportDate}T00:00:00`)
        .lte('logged_at', `${reportDate}T23:59:59`),
      supabaseAdmin
        .from('workout_logs')
        .select('*')
        .eq('user_id', userId)
        .gte('logged_at', `${reportDate}T00:00:00`)
        .lte('logged_at', `${reportDate}T23:59:59`),
      supabaseAdmin.from('daily_metrics').select('*').eq('user_id', userId).eq('date', reportDate).single(),
    ]);

    const plan = planRes.data;
    const meals = mealsRes.data ?? [];
    const workouts = workoutsRes.data ?? [];
    const metrics = metricsRes.data;

    // Calculate actuals
    let totalCalories = 0;
    let totalProtein = 0;
    for (const meal of meals) {
      for (const item of (meal as { meal_log_items: { calories: number; protein_g: number }[] }).meal_log_items ?? []) {
        totalCalories += item.calories;
        totalProtein += item.protein_g;
      }
    }

    const totalWorkoutMin = workouts.reduce((sum: number, w: { duration_min: number }) => sum + (w.duration_min || 0), 0);
    const goalRes = await supabaseAdmin.from('goals').select('daily_steps_target, daily_water_target').eq('user_id', userId).eq('is_active', true).single();
    const goal = goalRes.data;

    const userPrompt = `Bugün: ${reportDate}

Hedefler:
- Kalori: ${plan?.calorie_target_min ?? 1400}-${plan?.calorie_target_max ?? 1800} kcal
- Protein: ${plan?.protein_target_g ?? 100}g
- Su: ${goal?.daily_water_target ?? 2.0}L
- Adım: ${goal?.daily_steps_target ?? 8000}

Gerçekleşen:
- Kalori: ${totalCalories} kcal
- Protein: ${Math.round(totalProtein)}g
- Antrenman: ${workouts.length > 0 ? `${workouts.length} seans, toplam ${totalWorkoutMin} dk` : 'yapılmadı'}
- Su: ${metrics?.water_liters ?? 0}L
- Uyku: ${metrics?.sleep_hours ?? 'girilmemiş'}
- Adım: ${metrics?.steps ?? 'girilmemiş'}
- Tartı: ${metrics?.weight_kg ?? 'girilmemiş'}
- Not: ${metrics?.mood_note ?? 'yok'}

Öğünler: ${meals.map((m: { meal_type: string; raw_input: string }) => `[${m.meal_type}] ${m.raw_input}`).join(', ') || 'kayıt yok'}

JSON formatında rapor üret: compliance_score (0-100), calorie_target_met, protein_target_met, workout_completed, sleep_impact, water_impact, deviation_reason, tomorrow_action, full_report.`;

    interface ReportResult {
      compliance_score: number;
      calorie_target_met: boolean;
      protein_target_met: boolean;
      workout_completed: boolean;
      sleep_impact: string | null;
      water_impact: string | null;
      deviation_reason: string | null;
      tomorrow_action: string;
      full_report: string;
    }

    const report = await chatCompletion<ReportResult>(
      SYSTEM_PROMPT,
      userPrompt,
      { temperature: 0.3 }
    );

    // Sanitize text
    const { clean: cleanReport } = sanitizeText(report.full_report);
    const { clean: cleanAction } = sanitizeText(report.tomorrow_action);
    report.full_report = cleanReport;
    report.tomorrow_action = cleanAction;

    // Clamp compliance score
    report.compliance_score = Math.max(0, Math.min(100, Math.round(report.compliance_score)));

    // Store in database
    await supabaseAdmin.from('daily_reports').upsert({
      user_id: userId,
      date: reportDate,
      compliance_score: report.compliance_score,
      calorie_actual: totalCalories,
      calorie_target_met: report.calorie_target_met,
      protein_actual: Math.round(totalProtein),
      protein_target_met: report.protein_target_met,
      workout_completed: report.workout_completed,
      sleep_impact: report.sleep_impact,
      water_impact: report.water_impact,
      deviation_reason: report.deviation_reason,
      tomorrow_action: report.tomorrow_action,
      full_report: report.full_report,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,date' });

    return new Response(JSON.stringify(report), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

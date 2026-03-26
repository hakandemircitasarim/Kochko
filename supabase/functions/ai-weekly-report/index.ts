/**
 * Edge Function: Generate weekly report.
 * Analyzes the past 7 days and produces strategy for next week.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion } from '../shared/openai.ts';
import { supabaseAdmin, getUserId } from '../shared/supabase-admin.ts';
import { sanitizeText } from '../shared/guardrails.ts';

const SYSTEM_PROMPT = `Sen Kochko yaşam tarzı koçusun. Haftalık değerlendirme yapıyorsun.
Veri temelli, direkt, operasyonel ol.
Yanıtını SADECE JSON formatında ver.`;

serve(async (req: Request) => {
  try {
    const userId = await getUserId(req);

    // Calculate week bounds (Monday to Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + mondayOffset - 7); // Last week's Monday
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    // Fetch week data
    const [reportsRes, metricsRes, goalRes] = await Promise.all([
      supabaseAdmin
        .from('daily_reports')
        .select('date, compliance_score, deviation_reason, calorie_actual, protein_actual')
        .eq('user_id', userId)
        .gte('date', weekStartStr)
        .lte('date', weekEndStr)
        .order('date'),
      supabaseAdmin
        .from('daily_metrics')
        .select('date, weight_kg, water_liters, sleep_hours, steps')
        .eq('user_id', userId)
        .gte('date', weekStartStr)
        .lte('date', weekEndStr)
        .order('date'),
      supabaseAdmin.from('goals').select('*').eq('user_id', userId).eq('is_active', true).single(),
    ]);

    const reports = reportsRes.data ?? [];
    const metrics = metricsRes.data ?? [];
    const goal = goalRes.data;

    const weights = metrics.filter((m: { weight_kg: number | null }) => m.weight_kg).map((m: { date: string; weight_kg: number }) => ({ date: m.date, kg: m.weight_kg }));
    const avgCompliance = reports.length > 0
      ? Math.round(reports.reduce((sum: number, r: { compliance_score: number }) => sum + r.compliance_score, 0) / reports.length)
      : 0;

    const deviations = reports
      .filter((r: { deviation_reason: string | null }) => r.deviation_reason && r.deviation_reason !== 'yok')
      .map((r: { deviation_reason: string }) => r.deviation_reason);

    const userPrompt = `Hafta: ${weekStartStr} - ${weekEndStr}

Kilo trendi: ${weights.map((w: { date: string; kg: number }) => `${w.date}: ${w.kg}kg`).join(', ') || 'veri yok'}
Ortalama uyum: ${avgCompliance}/100
Sapmalar: ${deviations.join(', ') || 'yok'}
Hedef: ${goal ? `${goal.target_weight_kg}kg, ${goal.daily_calorie_min}-${goal.daily_calorie_max}kcal` : 'belirlenmemiş'}

Günlük raporlar:
${reports.map((r: { date: string; compliance_score: number; calorie_actual: number; deviation_reason: string | null }) => `${r.date}: uyum ${r.compliance_score}, ${r.calorie_actual}kcal, sapma: ${r.deviation_reason ?? 'yok'}`).join('\n') || 'rapor yok'}

JSON ver:
{
  "avg_compliance": sayı,
  "top_deviation": "en çok sapılan konu",
  "next_week_strategy": "gelecek hafta stratejisi - 2-3 cümle",
  "plan_revision": { "calorie_adjustment": sayı veya null, "protein_adjustment": sayı veya null, "workout_volume_change": "increase"|"maintain"|"decrease"|null }
}`;

    interface WeeklyResult {
      avg_compliance: number;
      top_deviation: string;
      next_week_strategy: string;
      plan_revision: Record<string, unknown>;
    }

    const result = await chatCompletion<WeeklyResult>(
      SYSTEM_PROMPT,
      userPrompt,
      { temperature: 0.3, maxTokens: 1500 }
    );

    // Sanitize
    const { clean } = sanitizeText(result.next_week_strategy);
    result.next_week_strategy = clean;

    // Store
    await supabaseAdmin.from('weekly_reports').upsert({
      user_id: userId,
      week_start: weekStartStr,
      weight_trend: weights,
      avg_compliance: result.avg_compliance,
      top_deviation: result.top_deviation,
      next_week_strategy: result.next_week_strategy,
      plan_revision: result.plan_revision,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,week_start' });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

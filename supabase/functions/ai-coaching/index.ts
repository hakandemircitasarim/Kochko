/**
 * Edge Function: Generate micro-coaching messages.
 * Triggered after meal/workout logging or by scheduled checks.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion } from '../shared/openai.ts';
import { supabaseAdmin, getUserId } from '../shared/supabase-admin.ts';
import { sanitizeText } from '../shared/guardrails.ts';

const SYSTEM_PROMPT = `Sen Kochko yaşam tarzı koçusun. Kısa, direkt mikro koçluk mesajı üretiyorsun.
1-2 cümle yeter. Operasyonel ol: ne yapılacağını söyle.
Emoji kullanma. Abartılı motivasyon yok.
Yanıtını SADECE JSON formatında ver.`;

serve(async (req: Request) => {
  try {
    const userId = await getUserId(req);
    const { trigger } = await req.json();
    const today = new Date().toISOString().split('T')[0];
    const hour = new Date().getHours();

    // Fetch current state
    const [planRes, metricsRes, mealsRes, profileRes] = await Promise.all([
      supabaseAdmin.from('daily_plans').select('calorie_target_min, calorie_target_max, protein_target_g').eq('user_id', userId).eq('date', today).single(),
      supabaseAdmin.from('daily_metrics').select('water_liters, sleep_hours').eq('user_id', userId).eq('date', today).single(),
      supabaseAdmin
        .from('meal_logs')
        .select('meal_log_items(calories, protein_g)')
        .eq('user_id', userId)
        .gte('logged_at', `${today}T00:00:00`)
        .lte('logged_at', `${today}T23:59:59`),
      supabaseAdmin.from('profiles').select('night_eating_risk, sweet_craving_risk').eq('id', userId).single(),
    ]);

    const plan = planRes.data;
    const metrics = metricsRes.data;
    const profile = profileRes.data;

    // Calculate current totals
    let currentCalories = 0;
    let currentProtein = 0;
    for (const meal of (mealsRes.data ?? [])) {
      for (const item of ((meal as { meal_log_items: { calories: number; protein_g: number }[] }).meal_log_items ?? [])) {
        currentCalories += item.calories;
        currentProtein += item.protein_g;
      }
    }

    const userPrompt = `Tetikleyici: ${trigger}
Saat: ${hour}:00
Bugün yenen: ${currentCalories} kcal / hedef: ${plan?.calorie_target_min ?? 1400}-${plan?.calorie_target_max ?? 1800}
Bugün protein: ${Math.round(currentProtein)}g / hedef: ${plan?.protein_target_g ?? 100}g
Su: ${metrics?.water_liters ?? 0}L
Dünkü uyku: ${metrics?.sleep_hours ?? '?'} saat
Gece yeme riski: ${profile?.night_eating_risk ? 'VAR' : 'yok'}
Tatlı krizi riski: ${profile?.sweet_craving_risk ? 'VAR' : 'yok'}

JSON ver: { "message": "1-2 cümle", "priority": "low"|"medium"|"high" }`;

    interface CoachingResult {
      message: string;
      priority: 'low' | 'medium' | 'high';
    }

    const result = await chatCompletion<CoachingResult>(
      SYSTEM_PROMPT,
      userPrompt,
      { temperature: 0.4, maxTokens: 300 }
    );

    // Sanitize
    const { clean } = sanitizeText(result.message);
    result.message = clean;

    // Store the coaching message
    await supabaseAdmin.from('coaching_messages').insert({
      user_id: userId,
      message_type: 'micro',
      content: result.message,
      trigger,
      read: false,
    });

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

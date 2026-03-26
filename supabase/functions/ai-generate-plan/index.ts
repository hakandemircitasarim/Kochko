/**
 * Edge Function: Generate daily plan using OpenAI.
 * Fetches user context, generates plan, applies guardrails, stores result.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion } from '../shared/openai.ts';
import { supabaseAdmin, getUserId } from '../shared/supabase-admin.ts';
import { validatePlan, sanitizeText } from '../shared/guardrails.ts';

const SYSTEM_PROMPT = `Sen Kochko, kişisel yaşam tarzı koçusun. Türkçe konuşursun.
Yaşam tarzı koçusun, diyetisyen veya doktor DEĞİLSİN.
ASLA tıbbi teşhis, tanı veya tedavi önerisi yapma.
Kullanıcının sevmediği yiyecekleri ASLA önerme.
Her öğün için 2-3 seçenek sun.
Yanıtını SADECE JSON formatında ver.`;

serve(async (req: Request) => {
  try {
    const userId = await getUserId(req);
    const today = new Date().toISOString().split('T')[0];
    const dayOfWeek = new Date().toLocaleDateString('tr-TR', { weekday: 'long' });

    // Fetch user context in parallel
    const [profileRes, goalRes, prefsRes, healthRes, metricsRes] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').eq('id', userId).single(),
      supabaseAdmin.from('goals').select('*').eq('user_id', userId).eq('is_active', true).single(),
      supabaseAdmin.from('food_preferences').select('*').eq('user_id', userId),
      supabaseAdmin.from('health_events').select('description').eq('user_id', userId),
      supabaseAdmin
        .from('daily_metrics')
        .select('weight_kg, sleep_hours, steps')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(14),
    ]);

    const profile = profileRes.data;
    if (!profile) {
      return new Response(
        JSON.stringify({ error: 'Profile not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const goal = goalRes.data;
    const prefs = prefsRes.data ?? [];
    const healthEvents = (healthRes.data ?? []).map((h: { description: string }) => h.description);
    const recentMetrics = metricsRes.data ?? [];

    // Calculate averages
    const weights = recentMetrics.filter((m: { weight_kg: number | null }) => m.weight_kg).map((m: { weight_kg: number }) => m.weight_kg);
    const sleeps = recentMetrics.filter((m: { sleep_hours: number | null }) => m.sleep_hours).map((m: { sleep_hours: number }) => m.sleep_hours);
    const steps = recentMetrics.filter((m: { steps: number | null }) => m.steps).map((m: { steps: number }) => m.steps);

    const currentWeight = weights.length > 0 ? weights[0] : profile.weight_kg;
    const avgSleep = sleeps.length > 0 ? sleeps.reduce((a: number, b: number) => a + b, 0) / sleeps.length : null;
    const avgSteps = steps.length > 0 ? Math.round(steps.reduce((a: number, b: number) => a + b, 0) / steps.length) : null;

    const neverFoods = prefs
      .filter((f: { preference: string }) => f.preference === 'never' || f.preference === 'dislike')
      .map((f: { food_name: string }) => f.food_name);
    const lovedFoods = prefs
      .filter((f: { preference: string }) => f.preference === 'love' || f.preference === 'like')
      .map((f: { food_name: string }) => f.food_name);

    const age = profile.birth_year ? new Date().getFullYear() - profile.birth_year : null;

    const userPrompt = `Kullanıcı profili:
- Cinsiyet: ${profile.gender ?? '?'}, Yaş: ${age ?? '?'}, Boy: ${profile.height_cm ?? '?'}cm, Kilo: ${currentWeight ?? '?'}kg
- Aktivite: ${profile.activity_level ?? '?'}, Ekipman: ${profile.equipment_access ?? 'ev'}
- Yemek yapma: ${profile.cooking_skill ?? 'basit'}, Bütçe: ${profile.budget_level ?? 'orta'}
- Gece yeme riski: ${profile.night_eating_risk ? 'EVET' : 'hayır'}, Tatlı krizi: ${profile.sweet_craving_risk ? 'EVET' : 'hayır'}
- Notlar: ${profile.important_notes ?? 'yok'}

Hedef: ${goal ? `${goal.target_weight_kg}kg, ${goal.daily_calorie_min}-${goal.daily_calorie_max}kcal, protein>${goal.daily_protein_min}g` : 'belirlenmemiş'}

Sağlık geçmişi: ${healthEvents.length > 0 ? healthEvents.join('; ') : 'yok'}
Son 14 gün uyku ort: ${avgSleep?.toFixed(1) ?? '?'} saat, adım ort: ${avgSteps ?? '?'}

ASLA ÖNERME: ${neverFoods.join(', ') || 'yok'}
Sevdiği: ${lovedFoods.join(', ') || 'belirtilmemiş'}

Bugün: ${dayOfWeek}

JSON formatında günlük plan üret: calorie_target_min, calorie_target_max, protein_target_g, focus_message, meal_suggestions (her öğün 2-3 seçenek), snack_strategy, workout_plan (warmup, main[], cooldown, duration_min, rpe, heart_rate_zone).`;

    const plan = await chatCompletion<Record<string, unknown>>(
      SYSTEM_PROMPT,
      userPrompt,
      { model: 'gpt-4o-mini', temperature: 0.4, maxTokens: 3000 }
    );

    // Apply guardrails
    const guardrailResult = validatePlan(plan, profile.gender, currentWeight);
    const finalPlan = { ...plan, ...guardrailResult.modified };

    // Sanitize text fields
    if (typeof finalPlan.focus_message === 'string') {
      const { clean } = sanitizeText(finalPlan.focus_message);
      finalPlan.focus_message = clean;
    }
    if (typeof finalPlan.snack_strategy === 'string') {
      const { clean } = sanitizeText(finalPlan.snack_strategy);
      finalPlan.snack_strategy = clean;
    }

    // Store in database (upsert for today)
    await supabaseAdmin.from('daily_plans').upsert({
      user_id: userId,
      date: today,
      calorie_target_min: finalPlan.calorie_target_min,
      calorie_target_max: finalPlan.calorie_target_max,
      protein_target_g: finalPlan.protein_target_g,
      focus_message: finalPlan.focus_message,
      meal_suggestions: finalPlan.meal_suggestions,
      snack_strategy: finalPlan.snack_strategy,
      workout_plan: finalPlan.workout_plan,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,date' });

    return new Response(JSON.stringify(finalPlan), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

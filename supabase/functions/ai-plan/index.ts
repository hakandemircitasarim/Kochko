/**
 * AI PLAN GENERATION
 * Spec Section 7.1-7.4
 *
 * Generates daily nutrition + workout plan using full user context.
 * Called when user requests plan or on morning schedule.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion, TEMPERATURE } from '../shared/openai.ts';
import { supabaseAdmin, getUserId } from '../shared/supabase-admin.ts';
import { buildFullContext } from '../shared/memory.ts';
import { checkAllergens, validateCalories, sanitizeText } from '../shared/guardrails.ts';

const PLAN_SYSTEM = `Sen Kochko plan yapicisisin. Kullanicinin profiline, hedefine ve gecmis verilerine gore gunluk beslenme + antrenman plani olustur.

KURALLAR:
- Her ogun icin 2-3 secenek sun
- Alerjen listesindeki hicbir yiyecegi ONERME
- IF aktifse ogunleri yeme penceresine sigdir
- Antrenman/dinlenme gunu ayrimi yap
- Haftalik butce baglamini goster
- Protein zamanlamasini dikkate al (antrenman oncesi karb, sonrasi protein)
- Pisirilme yontemi ve hazirlik suresi belirt

JSON formati:
{
  "plan_type": "training" | "rest",
  "calorie_target_min": sayi,
  "calorie_target_max": sayi,
  "protein_target_g": sayi,
  "carbs_target_g": sayi,
  "fat_target_g": sayi,
  "water_target_liters": sayi,
  "focus_message": "bugunku tek kritik odak - 1 cumle",
  "meal_suggestions": [
    {"meal_type": "breakfast|lunch|dinner|snack",
     "options": [{"name": "ad", "description": "kisa tarif", "calories": sayi, "protein_g": sayi, "carbs_g": sayi, "fat_g": sayi, "prep_time_min": sayi}]}
  ],
  "snack_strategy": "atistirma yonetimi",
  "workout_plan": {
    "type": "cardio|strength|flexibility|mixed|rest",
    "warmup": "isinma",
    "main": ["egzersiz 1 - set x rep x kg", "egzersiz 2"],
    "cooldown": "soguma",
    "duration_min": sayi,
    "rpe": sayi,
    "heart_rate_zone": "dusuk|orta|yuksek",
    "strength_targets": [{"exercise": "hareket", "sets": sayi, "reps": sayi, "weight_kg": sayi}]
  },
  "weekly_budget_consumed": sayi,
  "weekly_budget_remaining": sayi
}`;

serve(async (req: Request) => {
  try {
    const userId = await getUserId(req);
    const today = new Date().toISOString().split('T')[0];

    // Build context
    const ctx = await buildFullContext(userId);

    // Get allergens for post-validation
    const { data: prefs } = await supabaseAdmin
      .from('food_preferences')
      .select('food_name, is_allergen')
      .eq('user_id', userId)
      .eq('is_allergen', true);
    const allergens = (prefs ?? []).map((p: { food_name: string }) => p.food_name);

    // Get profile gender for calorie validation
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('gender').eq('id', userId).single();

    const prompt = `${ctx.layer1}\n\n${ctx.layer2}\n\n${ctx.layer3}\n\nBugunku plani olustur.`;

    const plan = await chatCompletion<Record<string, unknown>>(
      [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: prompt },
      ],
      { temperature: TEMPERATURE.plan, maxTokens: 3000, jsonMode: true }
    );

    // Guardrail: validate calories
    const calMin = plan.calorie_target_min as number;
    const calCheck = validateCalories(calMin, profile?.gender);
    if (!calCheck.valid) {
      plan.calorie_target_min = calCheck.corrected;
    }

    // Guardrail: allergen check on meal suggestions
    const meals = plan.meal_suggestions as { options: { name: string; description: string }[] }[];
    if (meals && allergens.length > 0) {
      for (const meal of meals) {
        meal.options = meal.options.filter(opt => {
          const check = checkAllergens(`${opt.name} ${opt.description}`, allergens);
          return check.passed;
        });
      }
    }

    // Guardrail: sanitize text fields
    if (typeof plan.focus_message === 'string') {
      plan.focus_message = sanitizeText(plan.focus_message as string).clean;
    }
    if (typeof plan.snack_strategy === 'string') {
      plan.snack_strategy = sanitizeText(plan.snack_strategy as string).clean;
    }

    // Calculate weekly budget
    const { data: weekMeals } = await supabaseAdmin
      .from('meal_log_items')
      .select('calories')
      .in('meal_log_id',
        (await supabaseAdmin.from('meal_logs').select('id').eq('user_id', userId)
          .gte('logged_for_date', getWeekStart(today)).lte('logged_for_date', today)).data?.map((m: { id: string }) => m.id) ?? []
      );

    const weekConsumed = (weekMeals ?? []).reduce((s: number, i: { calories: number }) => s + i.calories, 0);
    const avgDailyTarget = Math.round((plan.calorie_target_min + plan.calorie_target_max) / 2);
    const weeklyBudgetTotal = avgDailyTarget * 7;
    const weeklyBudgetRemaining = weeklyBudgetTotal - weekConsumed;

    // Store plan (version 1 for new plans, upsert by user_id+date)
    await supabaseAdmin.from('daily_plans').upsert({
      user_id: userId,
      date: today,
      version: 1,
      plan_type: plan.plan_type ?? 'rest',
      calorie_target_min: plan.calorie_target_min,
      calorie_target_max: plan.calorie_target_max,
      protein_target_g: plan.protein_target_g,
      carbs_target_g: plan.carbs_target_g,
      fat_target_g: plan.fat_target_g,
      water_target_liters: plan.water_target_liters,
      focus_message: plan.focus_message,
      meal_suggestions: plan.meal_suggestions,
      snack_strategy: plan.snack_strategy,
      workout_plan: plan.workout_plan,
      weekly_budget_total: weeklyBudgetTotal,
      weekly_budget_consumed: weekConsumed,
      weekly_budget_remaining: weeklyBudgetRemaining,
      status: 'draft',
      generated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,date,version' });

    return new Response(JSON.stringify(plan), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

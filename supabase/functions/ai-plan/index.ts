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
import { validatePlanOutput } from '../shared/output-validator.ts';
import { getPeriodicCalorieAdjustment, isIFCompatible, buildPeriodicPlanContext, getSeasonalContext } from '../shared/periodic-config.ts';

const PLAN_SYSTEM = `Sen Kochko plan yapicisisin. Kullanicinin profiline, hedefine ve gecmis verilerine gore gunluk beslenme + antrenman plani olustur.

KURALLAR:
- Her ogun icin 2-3 secenek sun
- Alerjen listesindeki hicbir yiyecegi ONERME
- IF aktifse VE donemsel durumla celismiyorsa ogunleri yeme penceresine sigdir
- DONEMSEL DURUM aktifse ayarlamalari MUTLAKA uygula (kalori, protein, antrenman yogunlugu)
- Ramazanda: ogunleri iftar-sahur penceresine sigdir, sahur karbonhidrat agirlikli
- Mevsimsel oneriler sun (yaz=salata/soguk, kis=corba/sicak)
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

const WEEKLY_PLAN_SYSTEM = `Sen Kochko haftalik plan yapicisisin. Kullanicinin profiline, hedefine ve gecmis verilerine gore 7 gunluk beslenme menusu ve alisveris listesi olustur.

KURALLAR:
- Her gun icin antrenman/dinlenme gunu ayrimi yap
- Her ogun icin tek bir oneri sun (gunluk plandan farkli olarak secenek degil, tek menu)
- Alerjen listesindeki hicbir yiyecegi ONERME
- Haftalik kalori ve makro dengesini koru
- Malzemeleri verimli kullan (bir gunden kalan malzeme baska gun kullanilsin)
- Mevsimsel ve butceye uygun secimler yap
- Alisveris listesini kategorilere ayir

JSON formati:
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "meals": [
        {"meal_type": "breakfast|lunch|dinner|snack", "name": "yemek adi", "calories": sayi, "protein_g": sayi}
      ]
    }
  ],
  "shopping_list": [
    {
      "category": "protein|vegetable|fruit|dairy|grain|other",
      "items": [{"name": "malzeme adi", "amount": "miktar"}]
    }
  ]
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

    // Get profile for calorie validation and periodic state
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('gender, weight_kg, periodic_state, periodic_state_start, periodic_state_end, if_active, tdee_calculated, calorie_range_rest_min')
      .eq('id', userId).single();

    // Build periodic + seasonal context
    const periodicContext = buildPeriodicPlanContext(profile ?? {});
    const seasonal = getSeasonalContext();
    const seasonalLine = `MEVSIM: ${seasonal.season}${seasonal.isRamadan ? ' | RAMAZAN DONEMI' : ''} | Oneriler: ${seasonal.suggestions_tr.join(', ')}`;

    // Goal-based calorie context (Spec 6.3)
    let goalContext = '';
    const { data: activeGoal } = await supabaseAdmin
      .from('goals').select('goal_type, target_weight_kg, target_weeks, weekly_rate, created_at')
      .eq('user_id', userId).eq('is_active', true).order('phase_order').limit(1).single();
    if (activeGoal && profile?.weight_kg && profile?.tdee_calculated) {
      const tw = activeGoal.target_weight_kg as number | null;
      const cw = profile.weight_kg as number;
      const rate = activeGoal.weekly_rate as number | null;
      if (tw && rate) {
        const dailyDeficit = Math.round((rate * 7700) / 7); // kcal/day
        const isLoss = activeGoal.goal_type === 'lose_weight';
        goalContext = `\nHEDEF BAZLI KALORI: ${isLoss ? 'Acik' : 'Fazla'} ${dailyDeficit} kcal/gun (haftalik ${rate}kg ${isLoss ? 'kayip' : 'artis'} icin). Mevcut: ${cw}kg -> Hedef: ${tw}kg`;
      }
    }

    const prompt = `${ctx.layer1}\n\n${ctx.layer2}\n\n${ctx.layer3}\n\n${periodicContext}\n${seasonalLine}${goalContext}\n\nBugunku plani olustur.`;

    const plan = await chatCompletion<Record<string, unknown>>(
      [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: prompt },
      ],
      { temperature: TEMPERATURE.plan, maxTokens: 3000, jsonMode: true }
    );

    // Structured output validation (Spec 5.29)
    const validated = validatePlanOutput(plan);

    // Guardrail: apply periodic calorie adjustment (code-enforced, not prompt-dependent)
    const periodicAdj = getPeriodicCalorieAdjustment(profile?.periodic_state);
    if (periodicAdj !== 0) {
      plan.calorie_target_min = (plan.calorie_target_min as number) + periodicAdj;
      plan.calorie_target_max = (plan.calorie_target_max as number) + periodicAdj;
    }

    // Guardrail: validate calories (after periodic adjustment)
    const calMin = plan.calorie_target_min as number;
    const calCheck = validateCalories(calMin, profile?.gender);
    if (!calCheck.valid) {
      plan.calorie_target_min = calCheck.corrected;
    }

    // Guardrail: IF compatibility check — skip IF validation if periodic state conflicts
    if (profile?.if_active && !isIFCompatible(profile?.periodic_state)) {
      // Don't enforce IF window when periodic state overrides it
      plan._if_overridden = true;
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
    plan.weekly_budget_consumed = weekConsumed;

    // Get current version for today (Spec 7.3: plan versioning)
    const { data: existingPlan } = await supabaseAdmin
      .from('daily_plans').select('version')
      .eq('user_id', userId).eq('date', today)
      .order('version', { ascending: false }).limit(1).single();
    const nextVersion = (existingPlan?.version ?? 0) + 1;

    // Store plan with version
    await supabaseAdmin.from('daily_plans').insert({
      user_id: userId,
      date: today,
      version: nextVersion,
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
      weekly_budget_total: plan.weekly_budget_total,
      weekly_budget_consumed: weekConsumed,
      weekly_budget_remaining: plan.weekly_budget_remaining,
      status: 'draft',
      generated_at: new Date().toISOString(),
    });

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

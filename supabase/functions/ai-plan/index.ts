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
- Proteini ogunlere ESIT dagit (ornegin 3 ogun = her ogunde ~30g protein, tek seferde 90g degil)
- Protein zamanlamasini dikkate al (antrenman oncesi karb, sonrasi protein)
- Pisirilme yontemi ve hazirlik suresi belirt
- Plan degistiyse veya reddedildiyse NE DEGISTI ve NEDEN degisti kisa acikla (focus_message icinde)

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

    // Parse request body for type and rejection_context
    let body: { type?: string; rejection_context?: string } = {};
    try {
      body = await req.json();
    } catch {
      // No body or invalid JSON — default to daily
    }

    // Route to weekly or daily plan generation
    if (body.type === 'weekly') {
      const result = await generateWeeklyPlan(userId, today);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }

    // === DAILY PLAN GENERATION ===

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

    // D3: Goal-based workout type emphasis
    let goalWorkoutContext = '';
    if (activeGoal?.goal_type) {
      if (activeGoal.goal_type === 'lose_weight') {
        goalWorkoutContext = '\nANTRENMAN ODAGI: Hedef kilo verme — kardio ve HIIT agirlikli antrenman oner, guc calismasini tamamlayici tut.';
      } else if (activeGoal.goal_type === 'gain_muscle') {
        goalWorkoutContext = '\nANTRENMAN ODAGI: Hedef kas kazanimi — guc antrenmanini on plana al, kardioyu minimum tut (haftada 1-2 hafif seans).';
      } else if (activeGoal.goal_type === 'health') {
        goalWorkoutContext = '\nANTRENMAN ODAGI: Hedef genel saglik — karisik program: mobilite, hafif kardio ve fonksiyonel hareketler oner.';
      }
    }

    // Fetch strength records from ai_summary for strength/mixed workout plans
    let strengthContext = '';
    const { data: aiSummaryStrength } = await supabaseAdmin
      .from('ai_summary')
      .select('strength_records')
      .eq('user_id', userId)
      .single();
    const strengthRecords = aiSummaryStrength?.strength_records as Record<string, { last_weight: number; last_reps: number; '1rm'?: number }> | null;
    if (strengthRecords && Object.keys(strengthRecords).length > 0) {
      const lines = Object.entries(strengthRecords).map(
        ([exercise, data]) => `Son antrenman: ${exercise} ${data.last_reps}x@${data.last_weight}kg`
      );
      strengthContext = `\nGUC GECMISI:\n${lines.join('\n')}`;
    }

    // D2: Progressive overload — check last 3 sessions for compound lifts
    const COMPOUND_LIFTS = ['squat', 'bench_press', 'deadlift'];
    const progressionLines: string[] = [];
    for (const lift of COMPOUND_LIFTS) {
      const { data: recentSets } = await supabaseAdmin
        .from('strength_sets')
        .select('reps, logged_at')
        .eq('user_id', userId)
        .eq('exercise', lift)
        .order('logged_at', { ascending: false })
        .limit(3);
      if (recentSets && recentSets.length >= 2) {
        const TARGET_REPS = 8;
        let consecutiveSuccesses = 0;
        for (const set of recentSets as { reps: number }[]) {
          if (set.reps >= TARGET_REPS) consecutiveSuccesses++;
          else break;
        }
        if (consecutiveSuccesses >= 2) {
          progressionLines.push(`PROGRESIF YUKLENME: ${lift} icin ${consecutiveSuccesses} ardisik basarili seans. Bir sonraki seans icin +2.5kg oner.`);
        }
      }
    }
    if (progressionLines.length > 0) {
      strengthContext += `\n${progressionLines.join('\n')}`;
    }

    // Deload check: if 6+ weeks since last deload
    let deloadContext = '';
    const { data: recentDeload } = await supabaseAdmin
      .from('daily_plans')
      .select('date')
      .eq('user_id', userId)
      .like('workout_plan->type', '%deload%')
      .order('date', { ascending: false })
      .limit(1)
      .single();
    if (!recentDeload) {
      // No deload ever found — check how many weeks of training exist
      const { count } = await supabaseAdmin
        .from('workout_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('logged_for_date', new Date(Date.now() - 42 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
      if ((count ?? 0) >= 6) {
        deloadContext = '\nDELOAD HAFTASI - yogunlugu %60-70\'e dusur';
      }
    } else {
      const daysSinceDeload = Math.floor((Date.now() - new Date(recentDeload.date).getTime()) / (24 * 60 * 60 * 1000));
      if (daysSinceDeload >= 42) { // 6 weeks
        deloadContext = '\nDELOAD HAFTASI - yogunlugu %60-70\'e dusur';
      }
    }

    // D1: Sleep check — query yesterday's daily_metrics for sleep data
    let sleepWarning = '';
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const { data: yesterdaySleep } = await supabaseAdmin
      .from('daily_metrics')
      .select('sleep_hours, sleep_quality')
      .eq('user_id', userId)
      .eq('date', yesterday)
      .single();
    if (yesterdaySleep) {
      const sleepHours = yesterdaySleep.sleep_hours as number | null;
      const sleepQuality = yesterdaySleep.sleep_quality as string | null;
      if ((sleepHours !== null && sleepHours < 6) || sleepQuality === 'bad') {
        const hoursDisplay = sleepHours !== null ? `${sleepHours}` : '?';
        const qualityDisplay = sleepQuality ?? 'bilinmiyor';
        sleepWarning = `\nUYKU UYARISI: Kullanici dun ${hoursDisplay} saat uyumus (kalite: ${qualityDisplay}). Yogun antrenman ONERME, hafif aktivite/mobilite oner.`;
      }
    }

    // Rejection context: if user rejected previous plan
    let rejectionLine = '';
    if (body.rejection_context) {
      rejectionLine = `\nONCEKI PLAN REDDEDILDI. Sebep: ${body.rejection_context}. Yeni plan buna gore farkli olmali.`;
    }

    // Persona + learned context from AI summary (Faz 5a deepening)
    let personaContext = '';
    const { data: aiSummary } = await supabaseAdmin
      .from('ai_summary').select('user_persona, learned_meal_times, portion_calibration')
      .eq('user_id', userId).single();

    if (aiSummary) {
      const persona = aiSummary.user_persona as string | null;
      if (persona) {
        const personaInstructions: Record<string, string> = {
          minimalist: 'PERSONA: minimalist — Kisa ve oz plan, detay verme',
          veri_odakli: 'PERSONA: veri_odakli — Detayli makro dagilimi ve sayilar goster',
          motivasyon_bagimlisi: 'PERSONA: motivasyon — Motive edici mesajlar ekle',
          disiplinli: 'PERSONA: disiplinli — Kesin hedefler ve kurallar belirt',
        };
        personaContext += `\n${personaInstructions[persona] ?? ''}`;
      }
      const mealTimes = aiSummary.learned_meal_times as Record<string, string> | null;
      if (mealTimes && Object.keys(mealTimes).length > 0) {
        const labels: Record<string, string> = { breakfast: 'kahvalti', lunch: 'ogle', dinner: 'aksam', snack: 'atistirma' };
        personaContext += `\nOGUN SAATLERI: ${Object.entries(mealTimes).map(([k, v]) => `${labels[k] ?? k} ${v}`).join(', ')}`;
      }
      const portions = aiSummary.portion_calibration as Record<string, number> | null;
      if (portions && Object.keys(portions).length > 0) {
        personaContext += `\nPORSIYON: ${Object.entries(portions).map(([k, v]) => `${k}=${v}g`).join(', ')}`;
      }
    }

    // Cycle phase adjustments (Phase 3: Kadın kullanıcılara özel)
    let cycleContext = '';
    if (profile?.menstrual_tracking && profile?.menstrual_last_period_start && profile?.menstrual_cycle_length) {
      const cycleLength = profile.menstrual_cycle_length as number;
      const lastStart = profile.menstrual_last_period_start as string;
      const daysSince = Math.floor((Date.now() - new Date(lastStart).getTime()) / 86400000);
      const dayOfCycle = (daysSince % cycleLength) + 1;
      const ovDay = Math.round(cycleLength / 2);
      let phase: string;
      if (dayOfCycle <= 5) phase = 'menstrual';
      else if (dayOfCycle <= ovDay - 2) phase = 'follicular';
      else if (dayOfCycle <= ovDay + 1) phase = 'ovulation';
      else phase = 'luteal';

      const phaseAdj: Record<string, { cal: number; water: number; maxIntensity: string; note: string }> = {
        menstrual: { cal: 0, water: 0, maxIntensity: 'low', note: 'Enerji dusuk — hafif aktivite' },
        follicular: { cal: 0, water: 0, maxIntensity: 'high', note: 'Yogun antrenman icin ideal' },
        ovulation: { cal: 0, water: 0, maxIntensity: 'high', note: 'Guc zirvede — PR gunleri' },
        luteal: { cal: 150, water: 0.2, maxIntensity: 'moderate', note: 'Istah artisi normal, su tutulumu olabilir' },
      };
      const adj = phaseAdj[phase];
      cycleContext = `\nDONGU FAZI: ${phase} (gun ${dayOfCycle}/${cycleLength}) | Kalori: +${adj.cal}kcal | Su: +${adj.water}L | Max antrenman: ${adj.maxIntensity} | ${adj.note}`;
    }

    // Plateau context (Phase 3)
    let plateauContext = '';
    const threeWeeksAgo = new Date(Date.now() - 21 * 86400000).toISOString().split('T')[0];
    const { data: recentWeights } = await supabaseAdmin
      .from('daily_metrics').select('weight_kg')
      .eq('user_id', userId).gte('date', threeWeeksAgo).not('weight_kg', 'is', null);
    if (recentWeights && recentWeights.length >= 5) {
      const wts = recentWeights.map((d: { weight_kg: number }) => d.weight_kg);
      const avgW = wts.reduce((s: number, w: number) => s + w, 0) / wts.length;
      const maxDiff = Math.max(...wts.map((w: number) => Math.abs(w - avgW)));
      if (maxDiff <= 0.3) {
        plateauContext = `\nPLATEAU TESPIT: ${Math.floor(wts.length / 3)}+ hafta ~${avgW.toFixed(1)}kg. Strateji onerisi gerekebilir.`;
      }
    }

    const prompt = `${ctx.layer1}\n\n${ctx.layer2}\n\n${ctx.layer3}\n\n${periodicContext}\n${seasonalLine}${goalContext}${goalWorkoutContext}${sleepWarning}${strengthContext}${deloadContext}${personaContext}${cycleContext}${plateauContext}${rejectionLine}\n\nBugunku plani olustur.`;

    const plan = await chatCompletion<Record<string, unknown>>(
      [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: prompt },
      ],
      { temperature: TEMPERATURE.plan, maxTokens: 3000, jsonMode: true }
    );

    // Structured output validation (Spec 5.29)
    const validated = validatePlanOutput(plan);
    Object.assign(plan, validated.corrected);

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

/**
 * Generate a 7-day weekly plan with shopping list.
 */
async function generateWeeklyPlan(userId: string, today: string): Promise<Record<string, unknown>> {
  const ctx = await buildFullContext(userId);

  // Get allergens
  const { data: prefs } = await supabaseAdmin
    .from('food_preferences')
    .select('food_name, is_allergen')
    .eq('user_id', userId)
    .eq('is_allergen', true);
  const allergens = (prefs ?? []).map((p: { food_name: string }) => p.food_name);

  // Get profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('gender, weight_kg, periodic_state, periodic_state_start, periodic_state_end, if_active, tdee_calculated')
    .eq('id', userId).single();

  const periodicContext = buildPeriodicPlanContext(profile ?? {});
  const seasonal = getSeasonalContext();
  const seasonalLine = `MEVSIM: ${seasonal.season}${seasonal.isRamadan ? ' | RAMAZAN DONEMI' : ''} | Oneriler: ${seasonal.suggestions_tr.join(', ')}`;

  // Strength context
  let strengthContext = '';
  const { data: aiSummary } = await supabaseAdmin
    .from('ai_summary')
    .select('strength_records')
    .eq('user_id', userId)
    .single();
  const strengthRecords = aiSummary?.strength_records as Record<string, { last_weight: number; last_reps: number; '1rm'?: number }> | null;
  if (strengthRecords && Object.keys(strengthRecords).length > 0) {
    const lines = Object.entries(strengthRecords).map(
      ([exercise, data]) => `Son antrenman: ${exercise} ${data.last_reps}x@${data.last_weight}kg`
    );
    strengthContext = `\nGUC GECMISI:\n${lines.join('\n')}`;
  }

  const weekStart = getWeekStart(today);

  // Fetch user's favorite and frequently used recipes to include in plan prompt
  let savedRecipesContext = '';
  try {
    const { data: favRecipes } = await supabaseAdmin
      .from('saved_recipes')
      .select('title, total_calories, total_protein, category')
      .eq('user_id', userId)
      .or('is_favorite.eq.true,use_count.gt.2')
      .order('use_count', { ascending: false })
      .limit(10);
    if (favRecipes && favRecipes.length > 0) {
      const lines = (favRecipes as { title: string; total_calories: number | null; total_protein: number | null }[])
        .map(r => `- ${r.title} (${r.total_calories ?? '?'} kcal, ${r.total_protein ?? '?'}g protein)`);
      savedRecipesContext = `\n\nKULLANICININ FAVORI TARIFLERI:\n${lines.join('\n')}`;
    }
  } catch { /* non-critical */ }

  const prompt = `${ctx.layer1}\n\n${ctx.layer2}\n\n${ctx.layer3}\n\n${periodicContext}\n${seasonalLine}${strengthContext}${savedRecipesContext}\n\nHafta baslangici: ${weekStart}. 7 gunluk menu ve alisveris listesi olustur.`;

  const weeklyPlan = await chatCompletion<Record<string, unknown>>(
    [
      { role: 'system', content: WEEKLY_PLAN_SYSTEM },
      { role: 'user', content: prompt },
    ],
    { temperature: TEMPERATURE.plan, maxTokens: 5000, jsonMode: true }
  );

  // Allergen check on weekly plan meals
  const days = weeklyPlan.days as { meals: { name: string }[] }[] | undefined;
  if (days && allergens.length > 0) {
    for (const day of days) {
      day.meals = day.meals.filter(meal => {
        const check = checkAllergens(meal.name, allergens);
        return check.passed;
      });
    }
  }

  // Store in weekly_plans table using plan_data field
  await supabaseAdmin.from('weekly_plans').upsert(
    {
      user_id: userId,
      week_start: weekStart,
      plan_data: weeklyPlan.days,
      shopping_list: weeklyPlan.shopping_list ?? [],
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,week_start' }
  );

  return weeklyPlan;
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

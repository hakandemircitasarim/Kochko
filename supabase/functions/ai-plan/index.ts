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
import { updateLayer2 } from '../shared/memory.ts';
// #arch S1: ai-plan now uses the SAME context builder as chat (context-builders.ts) instead of a
// second divergent one in memory.ts. context-builders surfaces the fuller constraint set
// (dietary_restriction/digestive_issues/hormone_conditions/disliked_exercises) so plans honor them.
import { buildContextFromPlan } from '../shared/context-builders.ts';
import { getActiveConstraints } from '../shared/constraints.ts';
import { writeTurnLog } from '../shared/turn-log.ts';
import type { UsageReceipt } from '../shared/openai.ts';
import type { RetrievalPlan } from '../shared/retrieval-planner.ts';

// A 'full' retrieval preset for plan generation: all L1 focuses, full L2, 14d of logs, no chat.
const PLAN_GEN_RETRIEVAL: RetrievalPlan = {
  layer1: 'full',
  layer1Focus: ['nutrition', 'training', 'health', 'demographics'],
  layer2: 'full',
  layer2Focus: ['patterns', 'persona', 'preferences', 'strength', 'habits'],
  layer3: { daysBack: 14, scope: ['meals', 'workouts', 'metrics', 'reports'], detailLevel: 'summary' },
  layer4MaxMessages: 0,
  contextMeta: { confidenceLevel: 'medium', missingDataTypes: [], daysWithCompleteData: 0, isGreetingFastPath: false },
};
import { checkAllergens, validateCalories, sanitizeText, checkWeightVelocity, validateExercise, MAX_WORKOUT_DURATION_MIN, extractInjuredBodyParts, filterExercisesByInjury, filterExercisesByEquipment } from '../shared/guardrails.ts';
import { validatePlanOutput } from '../shared/output-validator.ts';
import { getPeriodicCalorieAdjustment, isIFCompatible, buildPeriodicPlanContext, getSeasonalContext } from '../shared/periodic-config.ts';
import { isActivePremium } from '../shared/premium.ts';

// FIX (audit AI-PLN-02): master switch for the DORMANT daily-plan generator. Daily plans are now
// produced by the chat plan flow → shared/plan-projection.ts (the single source of truth for
// daily_plans), so this edge function's daily branch must NOT run — a row written here lands in
// the legacy shape with a higher version and overrides the projection. Kept `false`; flipping it
// on would resurrect ~600 lines of guardrails that duplicate plan-projection.ts. Typed as
// `boolean` (not the literal `false`) so the dormant block below stays type-checked rather than
// being seen as unreachable. Re-enable ONLY together with a scheduler + routing through projection.
const DAILY_GENERATOR_ENABLED: boolean = false;

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
- KISITLAMA (dietary_restriction) varsa MUTLAKA uy: vejetaryen→et/tavuk/balik yok; vegan→tum hayvansal (et/tavuk/balik/yumurta/sut/peynir/bal) yok; pesketaryen→et/tavuk yok (balik olur); helal→domuz/jambon/salam/alkol yok; glutensiz→bugday/makarna/ekmek yok; laktozsuz→sut/peynir/yogurt yok
- "ASLA ONERME" listesindeki sevilmeyen yiyecekleri de KULLANMA
- SAGLIK notu varsa (Sindirim/IBS, Hormonal/PCOS-tiroid) menuyu ona gore uyarla (IBS→dusuk-FODMAP, baharatli/yagli azalt; PCOS/insulin→dusuk glisemik, rafine seker azalt)
- Haftalik kalori ve makro dengesini koru
- Malzemeleri verimli kullan (bir gunden kalan malzeme baska gun kullanilsin)
- Mevsimsel ve butceye uygun secimler yap
- Alisveris listesini kategorilere ayir

JSON formati:
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "is_training_day": true,
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
    let body: { type?: string; rejection_context?: string; modification_request?: string } = {};
    try {
      body = await req.json();
    } catch {
      // No body or invalid JSON — default to daily
    }

    // Route to weekly or daily plan generation
    if (body.type === 'weekly') {
      // Weekly menu is a premium feature (premium-gate.ts weekly_menu_planning).
      // The gate must live HERE: the screen called the edge function directly,
      // so a free account could burn AI tokens generating weekly menus.
      const { data: tierProfile } = await supabaseAdmin
        .from('profiles').select('premium, premium_expires_at').eq('id', userId).maybeSingle();
      // Honor premium_expires_at (cron grace window) — match ai-chat:72/991 gates.
      if (!isActivePremium(tierProfile)) {
        return new Response(
          JSON.stringify({ error: 'needs_premium', message: 'Haftalık menü planlama Premium özelliğidir.' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const result = await generateWeeklyPlan(userId, today, body.modification_request);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }

    // FIX (audit AI-PLN-02): the DAILY generator below is DORMANT. The only production caller is
    // weekly-plan.service.ts (always body={type:'weekly'}, handled above); no cron or other edge
    // function invokes ai-plan with a daily body, and periodic.service.ts:217-222 deliberately
    // REMOVED the legacy daily auto-invocation because a daily_plans row written here lands in the
    // OLD shape with a higher version and OVERRIDES the chat-plan projection — now the single source
    // of truth (shared/plan-projection.ts). The whole daily branch (~600 lines: goal/TDEE/allergy/
    // injury/periodic/velocity guardrails that duplicate plan-projection.ts) therefore runs for no
    // user. To prevent accidental reactivation from writing a divergent legacy row, the daily entry
    // point is gated off and refuses early. The code is kept (behind `DAILY_GENERATOR_ENABLED`)
    // for reference / future cron wiring; if re-enabled it MUST be routed through the projection
    // path so live daily_plans honor goal/velocity/injury/equipment constraints in one place.
    if (!DAILY_GENERATOR_ENABLED) {
      return new Response(
        JSON.stringify({
          error: 'daily_plan_disabled',
          message: 'Günlük plan üretimi sohbet planı üzerinden yapılıyor; bu uç nokta yalnızca haftalık menü içindir.',
        }),
        { status: 410, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // === DAILY PLAN GENERATION (DORMANT — see AI-PLN-02 note above) ===

    // FIX (audit AI-MDL-04/HIGH): the daily-plan path ran a gpt-4o generation with NO rate limit
    // and NO free-tier cap — a free account could spam this edge function for unbounded AI cost.
    // Premium is unlimited; free users get a generous rolling-24h cap on plan generations
    // (normal use — one weekly projection ≈7 rows + a few regens — never reaches it). Reject
    // BEFORE building context / calling the model so abuse costs nothing.
    {
      const { data: tierP } = await supabaseAdmin
        .from('profiles').select('premium, premium_expires_at').eq('id', userId).maybeSingle();
      if (!isActivePremium(tierP)) {
        const since = new Date(Date.now() - 86400000).toISOString();
        const { count: genCount } = await supabaseAdmin
          .from('daily_plans')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('generated_at', since);
        if ((genCount ?? 0) >= 30) {
          return new Response(
            JSON.stringify({ error: 'rate_limited', message: 'Bugünlük plan oluşturma limitine ulaştın. Biraz sonra yenilenecek — sınırsız plan için Premium\'a geçebilirsin.' }),
            { status: 429, headers: { 'Content-Type': 'application/json' } },
          );
        }
      }
    }

    // Build context
    const ctx = await buildContextFromPlan(userId, PLAN_GEN_RETRIEVAL);

    // Yesterday's plan for diff context (Spec 7.1: "Plan degistiyse NE DEGISTI + NEDEN aciklansın")
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const { data: yesterdayPlan } = await supabaseAdmin
      .from('daily_plans')
      .select('calorie_target_min, calorie_target_max, protein_target_g, workout_plan, plan_type, focus_message')
      .eq('user_id', userId)
      .eq('date', yesterday)
      .maybeSingle();

    // Get allergens for post-validation — #arch L1 (step 1b): UNION the typed SAFETY SPINE
    // (user_constraints) with legacy food_preferences so a plan can never suggest a food the
    // user is allergic to, even if only one store recorded it.
    const [{ data: prefs }, spineAllergens] = await Promise.all([
      supabaseAdmin.from('food_preferences').select('food_name, is_allergen')
        .eq('user_id', userId).eq('is_allergen', true),
      getActiveConstraints(userId, ['allergen', 'intolerance']),
    ]);
    const allergens = [...new Set([
      ...(prefs ?? []).map((p: { food_name: string }) => p.food_name),
      ...spineAllergens.map((c) => c.subject),
    ].filter(Boolean))];

    // Get profile for calorie validation and periodic state
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('gender, weight_kg, periodic_state, periodic_state_start, periodic_state_end, if_active, tdee_calculated, calorie_range_rest_min, calorie_range_rest_max, calorie_range_training_min, calorie_range_training_max, equipment_access, pregnancy_trimester, menstrual_tracking, menstrual_last_period_start, menstrual_cycle_length, weekly_calorie_budget')
      .eq('id', userId).maybeSingle();

    // Build periodic + seasonal context
    const periodicContext = buildPeriodicPlanContext(profile ?? {});
    const seasonal = getSeasonalContext();
    const seasonalLine = `MEVSIM: ${seasonal.season}${seasonal.isRamadan ? ' | RAMAZAN DONEMI' : ''} | Oneriler: ${seasonal.suggestions_tr.join(', ')}`;

    // Goal-based calorie context (Spec 6.3)
    let goalContext = '';
    const { data: activeGoal } = await supabaseAdmin
      .from('goals').select('goal_type, target_weight_kg, target_weeks, weekly_rate, created_at')
      .eq('user_id', userId).eq('is_active', true).order('phase_order').limit(1).maybeSingle();
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

    // D3: Goal-based workout type emphasis (mirrors strength.service.ts getGoalBasedWorkoutType)
    let goalWorkoutContext = '';
    if (activeGoal?.goal_type) {
      const goalType = activeGoal.goal_type as string;
      const GOAL_WORKOUT: Record<string, string> = {
        lose_weight: 'Hedef kilo verme — kardio/HIIT agirlikli (3x kardio + 2x guc). Kas kaybini onlemek icin guc antrenmanini birakma.',
        gain_muscle: 'Hedef kas kazanimi — guc agirlikli (4x guc + 1x hafif kardio). Progresif yuklenmeye odaklan.',
        gain_weight: 'Hedef kilo alma — agir bilesik hareketler (squat, deadlift, bench). Kardioyu minimumda tut.',
        health: 'Hedef genel saglik — dengeli program (2x guc + 2x kardio + 1x yoga/mobilite).',
        conditioning: 'Hedef kondisyon — kardio ve HIIT (3x orta tempo kardio + 2x HIIT).',
        maintain: 'Hedef bakim — mevcut formu koruyan karisik program (2x guc + 2x kardio).',
      };
      const focus = GOAL_WORKOUT[goalType];
      if (focus) {
        goalWorkoutContext = `\nANTRENMAN ODAGI: ${focus}`;
      }
    }

    // Fetch strength records from ai_summary for strength/mixed workout plans
    let strengthContext = '';
    const { data: aiSummaryStrength } = await supabaseAdmin
      .from('ai_summary')
      .select('strength_records')
      .eq('user_id', userId)
      .maybeSingle();
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
        .select('reps, created_at, workout_logs!inner(user_id)')
        .eq('exercise_name', lift)
        .eq('workout_logs.user_id', userId)
        .order('created_at', { ascending: false })
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
    // ->> (text), not -> (jsonb): LIKE has no jsonb operator — the old query
    // 42883-failed on every call and the error was silently swallowed, so the
    // "days since last deload" branch was unreachable.
    const { data: recentDeload, error: deloadErr } = await supabaseAdmin
      .from('daily_plans')
      .select('date')
      .eq('user_id', userId)
      .like('workout_plan->>type', '%deload%')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (deloadErr) console.error('[ai-plan] deload lookup failed:', deloadErr.message);
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

    // D1: Sleep check — query yesterday's daily_metrics for sleep data (reuses `yesterday` from the diff block above)
    let sleepWarning = '';
    const { data: yesterdaySleep } = await supabaseAdmin
      .from('daily_metrics')
      .select('sleep_hours, sleep_quality')
      .eq('user_id', userId)
      .eq('date', yesterday)
      .maybeSingle();
    if (yesterdaySleep) {
      const sleepHours = yesterdaySleep.sleep_hours as number | null;
      const sleepQuality = yesterdaySleep.sleep_quality as string | null;
      if ((sleepHours !== null && sleepHours < 6) || sleepQuality === 'bad') {
        const hoursDisplay = sleepHours !== null ? `${sleepHours}` : '?';
        const qualityDisplay = sleepQuality ?? 'bilinmiyor';
        sleepWarning = `\nUYKU UYARISI: Kullanici dun ${hoursDisplay} saat uyumus (kalite: ${qualityDisplay}). Yogun antrenman ONERME, hafif aktivite/mobilite oner.`;
      }
    }

    // Saved recipes context (daily plan) — mirror of weekly plan logic.
    // Favorites + frequently used are suggested to the AI so it can prefer them
    // when picking today's meals.
    let savedRecipesContext = '';
    try {
      const { data: favRecipes } = await supabaseAdmin
        .from('saved_recipes')
        .select('title, total_calories, total_protein, category, prep_time_min')
        .eq('user_id', userId)
        .or('is_favorite.eq.true,use_count.gt.2')
        .order('use_count', { ascending: false })
        .limit(8);
      if (favRecipes && favRecipes.length > 0) {
        const lines = (favRecipes as { title: string; total_calories: number | null; total_protein: number | null; category: string | null; prep_time_min: number | null }[])
          .map(r => `- ${r.title} (${r.total_calories ?? '?'}kcal, ${r.total_protein ?? '?'}g protein${r.category ? `, ${r.category}` : ''}${r.prep_time_min ? `, ${r.prep_time_min}dk` : ''})`);
        savedRecipesContext = `\nKAYITLI TARIFLER (mumkunse bugunku planda tercih et):\n${lines.join('\n')}`;
      }
    } catch { /* non-critical */ }

    // Rejection context: if user rejected previous plan
    let rejectionLine = '';
    if (body.rejection_context) {
      rejectionLine = `\nONCEKI PLAN REDDEDILDI. Sebep: ${body.rejection_context}. Yeni plan buna gore farkli olmali.`;
      // Persist rejection learning to Layer 2 (coaching_note)
      const dateStr = new Date().toISOString().split('T')[0];
      const { data: existingSummary } = await supabaseAdmin
        .from('ai_summary').select('coaching_notes').eq('user_id', userId).maybeSingle();
      const existingNotes = (existingSummary?.coaching_notes as string) ?? '';
      const rejectionNote = `[${dateStr}] Plan reddedildi: ${body.rejection_context}`;
      updateLayer2(userId, {
        coaching_notes: existingNotes ? `${existingNotes}\n${rejectionNote}` : rejectionNote,
      }).catch((err: Error) => console.error('[ai-plan] Layer2 rejection write failed:', err.message));
    }

    // Persona + learned context from AI summary (Faz 5a deepening)
    let personaContext = '';
    const { data: aiSummary } = await supabaseAdmin
      .from('ai_summary').select('user_persona, learned_meal_times, portion_calibration')
      .eq('user_id', userId).maybeSingle();

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
    if (profile?.menstrual_tracking && profile?.menstrual_last_period_start && profile?.menstrual_cycle_length
        && new Date(profile.menstrual_last_period_start as string).getTime() <= Date.now()) {
      // Guard: a future/invalid last-period date would yield a negative day-of-cycle and a
      // bogus 'menstrual' phase (#R2-M1). The <=now check rejects both future and NaN dates.
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

    // Return flow plan lightening (Spec 10.5) — first 3 days after medium+ gap: gentler target
    // Looks at last user chat_message; if gap was >=8 days, softens today's calorie/protein
    // targets by ~15-25% depending on gap length. Expires after 3 days of reactivation.
    let returnLightening = 0; // percentage to reduce deficit
    try {
      const { data: recentMsgs } = await supabaseAdmin
        .from('chat_messages')
        .select('created_at')
        .eq('user_id', userId).eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(2);
      const msgs = (recentMsgs ?? []) as { created_at: string }[];
      if (msgs.length >= 2) {
        const gap = Math.floor((new Date(msgs[0].created_at).getTime() - new Date(msgs[1].created_at).getTime()) / 86400000);
        const daysSinceReturn = Math.floor((Date.now() - new Date(msgs[0].created_at).getTime()) / 86400000);
        // Active in last 3 days AND came back after 8+ day gap
        if (gap >= 8 && daysSinceReturn <= 3) {
          returnLightening = gap > 30 ? 25 : 20;
        }
      }
    } catch { /* non-critical */ }

    // Multi-phase gradual transition (Spec 6.7) — interpolate calorie range day-by-day over 7 days
    const { data: tProfile } = await supabaseAdmin
      .from('profiles')
      .select('phase_transition_start_date, phase_transition_from_rest_min, phase_transition_from_rest_max, phase_transition_to_rest_min, phase_transition_to_rest_max')
      .eq('id', userId).maybeSingle();
    if (tProfile?.phase_transition_start_date) {
      const startDate = new Date(tProfile.phase_transition_start_date as string);
      const daysSince = Math.floor((Date.now() - startDate.getTime()) / 86400000);
      if (daysSince >= 0 && daysSince <= 6) {
        const progress = (daysSince + 1) / 7;
        const fromMin = tProfile.phase_transition_from_rest_min as number;
        const fromMax = tProfile.phase_transition_from_rest_max as number;
        const toMin = tProfile.phase_transition_to_rest_min as number;
        const toMax = tProfile.phase_transition_to_rest_max as number;
        const interpMin = Math.round(fromMin + (toMin - fromMin) * progress);
        const interpMax = Math.round(fromMax + (toMax - fromMax) * progress);
        const { error: transitionErr } = await supabaseAdmin.from('profiles').update({
          calorie_range_rest_min: interpMin,
          calorie_range_rest_max: interpMax,
        }).eq('id', userId);
        if (transitionErr) throw new Error('profiles transition update failed: ' + transitionErr.message);
        // FIX (audit AI-PLN-04): in-memory profile, transition UPDATE'inden sonra BAYAT kalıyordu;
        // velocity maintenance tabanı (calorie_range_rest_min) ve haftalık-bütçe restMid fallback'i
        // geçiş-öncesi aralıktan hesaplanıyordu. In-memory nesneyi de interpolated değerlere senkronla.
        if (profile) {
          profile.calorie_range_rest_min = interpMin;
          profile.calorie_range_rest_max = interpMax;
        }
      } else if (daysSince > 6) {
        // Transition complete: snap to final and clear transition markers
        const { error: transitionDoneErr } = await supabaseAdmin.from('profiles').update({
          calorie_range_rest_min: tProfile.phase_transition_to_rest_min,
          calorie_range_rest_max: tProfile.phase_transition_to_rest_max,
          phase_transition_start_date: null,
          phase_transition_from_rest_min: null,
          phase_transition_from_rest_max: null,
          phase_transition_to_rest_min: null,
          phase_transition_to_rest_max: null,
        }).eq('id', userId);
        if (transitionDoneErr) throw new Error('profiles transition completion update failed: ' + transitionDoneErr.message);
        // FIX (audit AI-PLN-04): geçiş tamamlandığında da in-memory profile'ı final değerlere senkronla
        // (aksi halde son geçiş gününde velocity tabanı/restMid hâlâ geçiş-öncesi aralıktan hesaplanırdı).
        if (profile) {
          profile.calorie_range_rest_min = tProfile.phase_transition_to_rest_min as number;
          profile.calorie_range_rest_max = tProfile.phase_transition_to_rest_max as number;
        }
      }
    }

    // Equipment access context (Spec 7.2) — home / gym / both
    let equipmentContext = '';
    const equipAccess = (profile?.equipment_access as string | null) ?? 'home';
    if (equipAccess === 'home') {
      equipmentContext = '\nEKIPMAN: SADECE EV. Barbell/squat rack/bench press/cable machine ONERME. Alternatifler: dumbbell, resistance band, bodyweight, pullup bar. Ornek: barbell squat yerine goblet squat, bench press yerine pushup/band press, deadlift yerine single-leg deadlift.';
    } else if (equipAccess === 'gym') {
      equipmentContext = '\nEKIPMAN: SPOR SALONU. Tum makine + free weight kullanilabilir.';
    } else if (equipAccess === 'both') {
      equipmentContext = '\nEKIPMAN: Hem ev hem salon mevcut.';
    }

    // Active injury context (Spec 12.2, 15.7) — health_events with type=injury, is_ongoing=true
    let injuryContext = '';
    let injuredBodyParts: string[] = [];
    const { data: activeInjuries } = await supabaseAdmin
      .from('health_events')
      .select('description')
      .eq('user_id', userId)
      .eq('event_type', 'injury')
      .eq('is_ongoing', true);
    if (activeInjuries && activeInjuries.length > 0) {
      const descs = activeInjuries.map((e: { description: string }) => e.description);
      injuredBodyParts = extractInjuredBodyParts(descs);
      if (injuredBodyParts.length > 0) {
        injuryContext = `\nSAKATLIK UYARISI: Aktif sakatliklar: ${descs.join('; ')}. Etkilenen bolgeler: ${injuredBodyParts.join(', ')}. BU BOLGELERI yukleyen egzersizler ONERME (squat, deadlift, lunge, koşu vs ilgili bolgeye gore). Alternatif olarak ust vucut izolasyon, yuzme, elips, isometric oner.`;
      }
    }

    // Yesterday plan diff context (Spec 7.1)
    let diffContext = '';
    if (yesterdayPlan) {
      const y = yesterdayPlan as { calorie_target_min: number | null; calorie_target_max: number | null; protein_target_g: number | null; workout_plan: { type?: string } | null; plan_type: string | null };
      const yMid = y.calorie_target_min && y.calorie_target_max ? Math.round((y.calorie_target_min + y.calorie_target_max) / 2) : null;
      const yWorkoutType = y.workout_plan?.type ?? null;
      diffContext = `\nDUN PLANI: ${yMid ? `${yMid}kcal` : 'yok'}${y.protein_target_g ? `, ${y.protein_target_g}g protein` : ''}${yWorkoutType ? `, antrenman: ${yWorkoutType}` : ''} (${y.plan_type ?? 'bilinmiyor'}).\nBUGUNKU PLANI DUNDEN FARKLI KILAN HERHANGI BIR SEY varsa (antrenman gunu/dinlenme gunu degismesi, uyku yetersizligi, sakatlik, plateau, hedef ayarlamasi vb.), focus_message icinde NET BICIMDE belirt: "Dun X, bugun Y. Sebep: Z." Fark yoksa genel bir tek-odak ver.`;
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

    const prompt = `${ctx.layer1}\n\n${ctx.layer2}\n\n${ctx.layer3}\n\n${periodicContext}\n${seasonalLine}${goalContext}${goalWorkoutContext}${sleepWarning}${strengthContext}${deloadContext}${personaContext}${cycleContext}${equipmentContext}${injuryContext}${diffContext}${plateauContext}${savedRecipesContext}${rejectionLine}\n\nBugunku plani olustur.`;

    let dailyRc: UsageReceipt | null = null;
    const plan = await chatCompletion<Record<string, unknown>>(
      [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: prompt },
      ],
      { temperature: TEMPERATURE.plan, maxTokens: 3000, jsonMode: true, onReceipt: (r) => { dailyRc = r; } }
    );
    // #arch step 5: plan generation is the priciest LLM call — log its cost/model/latency too.
    writeTurnLog(userId, 'ai-plan', 'plan_daily', dailyRc).then(() => {}, () => {});

    // Structured output validation (Spec 5.29)
    const validated = validatePlanOutput(plan);
    Object.assign(plan, validated.corrected);
    // FIX (audit AI-PLN-03/AI-EXT-06): validated.errors içindeki öğün-kalorisi-vs-hedef,
    // makro-kalori tutarlılığı ve protein-eşit-dağılım uyarıları output'u mutate etmediği için
    // sessizce kayboluyordu. Retry döngüsü ekleyip plan üretimini ağırlaştırmadan en azından bu
    // sapmaları logla — böylece hedeften kayan/proteini yığan planlar gözlemlenebilir kalsın.
    if (!validated.valid && validated.errors.length > 0) {
      console.warn('[ai-plan] plan validation warnings:', validated.errors.join(' | '));
    }

    // Guardrail: apply periodic calorie adjustment (code-enforced, not prompt-dependent)
    const periodicAdj = getPeriodicCalorieAdjustment(profile?.periodic_state, {
      pregnancyTrimester: profile?.pregnancy_trimester as number | null,
    });
    if (periodicAdj !== 0) {
      plan.calorie_target_min = (plan.calorie_target_min as number) + periodicAdj;
      plan.calorie_target_max = (plan.calorie_target_max as number) + periodicAdj;
    }

    // Guardrail: validate calories (after periodic adjustment)
    const calMin = plan.calorie_target_min as number;
    const calCheck = validateCalories(calMin, profile?.gender);
    if (!calCheck.valid) {
      plan.calorie_target_min = calCheck.corrected;
      // #S18: lifting only the MIN to the gender floor can leave min > max when a negative
      // periodic adjustment (ramadan -150, injury -100) already pushed a low-TDEE user's max
      // below the floor. Re-clamp max up so the band never inverts (mirrors tdee.ts:130).
      plan.calorie_target_max = Math.max(plan.calorie_target_max as number, calCheck.corrected);
    }

    // Guardrail: weight velocity check (Spec 12.1 — max 1kg/week loss)
    // If user losing too fast, raise calorie floor toward maintenance.
    const { data: velocityWeights } = await supabaseAdmin
      .from('daily_metrics')
      .select('date, weight_kg')
      .eq('user_id', userId)
      .not('weight_kg', 'is', null)
      .gte('date', new Date(Date.now() - 21 * 86400000).toISOString().split('T')[0])
      .order('date');
    if (velocityWeights && velocityWeights.length >= 2) {
      const vel = checkWeightVelocity(
        velocityWeights.map((w: { date: string; weight_kg: number }) => ({ date: w.date, kg: w.weight_kg }))
      );
      if (!vel.safe) {
        // Raise calorie target toward maintenance to slow loss
        const maintenanceMin = (profile?.calorie_range_rest_min as number | null) ?? (calCheck.corrected + 300);
        plan.calorie_target_min = Math.max(plan.calorie_target_min as number, maintenanceMin);
        plan.calorie_target_max = Math.max(plan.calorie_target_max as number, maintenanceMin + 200);
        plan._velocity_warning = vel.warning;
        const existingFocus = (plan.focus_message as string) ?? '';
        plan.focus_message = `${vel.warning} ${existingFocus}`.trim();
      }
    }

    // Guardrail: workout duration cap (Spec 12.2 — max 120 min)
    const workout = plan.workout_plan as { duration_min?: number; main?: string[]; type?: string; rpe?: number; heart_rate_zone?: string } | undefined;
    if (workout && typeof workout.duration_min === 'number' && workout.duration_min > MAX_WORKOUT_DURATION_MIN) {
      workout.duration_min = MAX_WORKOUT_DURATION_MIN;
      plan._workout_duration_capped = true;
    }

    // Safety-net diff note: if yesterday differed significantly and AI didn't say so, append
    if (yesterdayPlan) {
      const y = yesterdayPlan as { calorie_target_min: number | null; calorie_target_max: number | null; plan_type: string | null; workout_plan: { type?: string } | null };
      const yMid = y.calorie_target_min && y.calorie_target_max ? Math.round((y.calorie_target_min + y.calorie_target_max) / 2) : null;
      const tMin = plan.calorie_target_min as number | undefined;
      const tMax = plan.calorie_target_max as number | undefined;
      const tMid = tMin && tMax ? Math.round((tMin + tMax) / 2) : null;

      const parts: string[] = [];
      if (yMid && tMid && Math.abs(yMid - tMid) >= 150) {
        const dir = tMid > yMid ? 'yukseldi' : 'dustu';
        parts.push(`Kalori hedefi dun ${yMid} -> bugun ${tMid} (${dir})`);
      }
      const yType = y.plan_type;
      const tType = plan.plan_type as string | undefined;
      if (yType && tType && yType !== tType) {
        parts.push(`${yType === 'training' ? 'Dun antrenman' : 'Dun dinlenme'} -> ${tType === 'training' ? 'bugun antrenman' : 'bugun dinlenme'}`);
      }
      const yWorkout = y.workout_plan?.type;
      const tWorkout = workout?.type;
      if (yWorkout && tWorkout && yWorkout !== tWorkout) {
        parts.push(`Antrenman tipi: ${yWorkout} -> ${tWorkout}`);
      }

      const focus = (plan.focus_message as string) ?? '';
      const mentionsDiff = /dun|dün|-\>|farkli|farklı|degisti|değişti/i.test(focus);
      if (parts.length > 0 && !mentionsDiff) {
        plan.focus_message = focus
          ? `${focus} | ${parts.join(', ')}.`
          : `${parts.join(', ')}.`;
        plan._plan_diff = parts;
      }
    }

    // Return-flow lightening: soften deficit for first 3 days after long gap (Spec 10.5)
    if (returnLightening > 0 && profile?.tdee_calculated) {
      const tdee = profile.tdee_calculated as number;
      const curMin = plan.calorie_target_min as number;
      const curMax = plan.calorie_target_max as number;
      // Move targets 20% of the way back toward TDEE (halves the deficit)
      const shift = Math.round((tdee - (curMin + curMax) / 2) * (returnLightening / 100));
      plan.calorie_target_min = curMin + shift;
      plan.calorie_target_max = curMax + shift;
      plan._return_lightening = returnLightening;
      const existingFocus = (plan.focus_message as string) ?? '';
      plan.focus_message = existingFocus
        ? `${existingFocus} (Dönüşün ilk günleri — plan bugün biraz daha esnek.)`
        : 'Hoş geldin! İlk birkaç gün biraz daha esnek bir plan.';
    }

    // Guardrail: deterministic water target (Spec 2.7, 14.2)
    // base = weight * 0.033L; +0.75L training day; +0.4L summer (Jun-Aug)
    if (profile?.weight_kg) {
      const isTrainingDay = (plan.plan_type as string) === 'training';
      const month = new Date().getMonth() + 1;
      const isSummer = month >= 6 && month <= 8;
      let computed = (profile.weight_kg as number) * 0.033;
      if (isTrainingDay) computed += 0.75;
      if (isSummer) computed += 0.4;
      plan.water_target_liters = Math.round(computed * 10) / 10;
    }

    // Guardrail: equipment-aware exercise filter (Spec 7.2)
    if (workout && Array.isArray(workout.main)) {
      const { safe: equipSafe, excluded: equipExcluded } = filterExercisesByEquipment(workout.main, equipAccess);
      if (equipExcluded.length > 0) {
        workout.main = equipSafe;
        plan._equipment_excluded = equipExcluded;
        const lines = equipExcluded.map(e => e.alternative ? `${e.exercise} → ${e.alternative}` : e.exercise);
        const note = `Ev ekipmanıyla yapilamayacak egzersizler cikarildi: ${lines.join(', ')}.`;
        const existingFocus = (plan.focus_message as string) ?? '';
        plan.focus_message = existingFocus ? `${existingFocus} ${note}` : note;
      }
    }

    // Guardrail: injury-based exercise filter (Spec 12.2, 15.7)
    if (workout && Array.isArray(workout.main) && injuredBodyParts.length > 0) {
      const { safe, excluded } = filterExercisesByInjury(workout.main, injuredBodyParts);
      if (excluded.length > 0) {
        workout.main = safe;
        plan._injury_excluded = excluded;
        const note = `Sakatlik nedeniyle cikarilan: ${excluded.map(e => e.exercise).join(', ')}. Alternatif hafif izolasyon veya yuzme oneriyoruz.`;
        const existingFocus = (plan.focus_message as string) ?? '';
        plan.focus_message = existingFocus ? `${existingFocus} ${note}` : note;
      }
    }

    // Guardrail: exercise safety (sleep-aware intensity)
    if (workout) {
      const sleepHours = (yesterdaySleep?.sleep_hours as number | null) ?? null;
      const { count: consecutiveHardDays } = await supabaseAdmin
        .from('workout_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('intensity', 'high')
        .gte('logged_for_date', new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0]);
      const rpe = typeof workout.rpe === 'number' ? workout.rpe : 0;
      const intensity = (rpe >= 8 || workout.heart_rate_zone === 'yuksek') ? 'yuksek' : 'orta';
      const exCheck = validateExercise(
        workout.duration_min ?? 0,
        intensity,
        sleepHours,
        consecutiveHardDays ?? 0
      );
      if (!exCheck.safe) {
        plan._exercise_warnings = exCheck.warnings;
      }
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

    // Calculate weekly budget. #S19: exclude soft-deleted meals — every other reader filters
    // is_deleted=false; without it a user's DELETED meal keeps counting against the dashboard
    // weekly budget until the next regeneration.
    const { data: weekMeals } = await supabaseAdmin
      .from('meal_log_items')
      .select('calories')
      .in('meal_log_id',
        (await supabaseAdmin.from('meal_logs').select('id').eq('user_id', userId)
          .eq('is_deleted', false)
          .gte('logged_for_date', getWeekStart(today)).lte('logged_for_date', today)).data?.map((m: { id: string }) => m.id) ?? []
      );

    const weekConsumed = (weekMeals ?? []).reduce((s: number, i: { calories: number }) => s + i.calories, 0);
    plan.weekly_budget_consumed = weekConsumed;

    // Weekly budget total + remaining are computed in code (not trusted from the LLM, which is
    // never given a numeric budget). Use profiles.weekly_calorie_budget as the real total;
    // #S20: fall back to the CANONICAL 4×training-mid + 3×rest-mid (matching widget.service.ts /
    // service-contexts.ts / the onboarding writer) — NOT planMid*7, which diverged so the
    // dashboard and home widget showed different weekly budgets for an unset-budget user.
    const trainMid = Math.round((((profile?.calorie_range_training_min as number | null) ?? (plan.calorie_target_min as number) ?? 0)
      + ((profile?.calorie_range_training_max as number | null) ?? (plan.calorie_target_max as number) ?? 0)) / 2);
    const restMid = Math.round((((profile?.calorie_range_rest_min as number | null) ?? (plan.calorie_target_min as number) ?? 0)
      + ((profile?.calorie_range_rest_max as number | null) ?? (plan.calorie_target_max as number) ?? 0)) / 2);
    const canonicalFallback = (trainMid > 0 && restMid > 0) ? (4 * trainMid + 3 * restMid) : 0;
    const weeklyBudgetTotal = (profile?.weekly_calorie_budget as number | null) ?? canonicalFallback;
    const weeklyBudgetRemaining = Math.max(0, weeklyBudgetTotal - weekConsumed);
    plan.weekly_budget_total = weeklyBudgetTotal;
    plan.weekly_budget_remaining = weeklyBudgetRemaining;

    // #S18: final invariant — no calorie mutation above may leave the band inverted.
    if ((plan.calorie_target_min as number) > (plan.calorie_target_max as number)) {
      plan.calorie_target_max = plan.calorie_target_min;
    }

    // Get current version for today (Spec 7.3: plan versioning)
    const { data: existingPlan } = await supabaseAdmin
      .from('daily_plans').select('version')
      .eq('user_id', userId).eq('date', today)
      .order('version', { ascending: false }).limit(1).maybeSingle();
    const nextVersion = (existingPlan?.version ?? 0) + 1;

    // Store plan with version
    const { error: dailyPlanErr } = await supabaseAdmin.from('daily_plans').insert({
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
      weekly_budget_total: weeklyBudgetTotal,
      weekly_budget_consumed: weekConsumed,
      weekly_budget_remaining: weeklyBudgetRemaining,
      status: 'draft',
      generated_at: new Date().toISOString(),
    });
    if (dailyPlanErr) throw new Error('daily_plans insert failed: ' + dailyPlanErr.message);

    return new Response(JSON.stringify(plan), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});

/**
 * Generate a 7-day weekly plan with shopping list.
 */
async function generateWeeklyPlan(userId: string, today: string, modificationRequest?: string): Promise<Record<string, unknown>> {
  const ctx = await buildContextFromPlan(userId, PLAN_GEN_RETRIEVAL);

  // Get allergens — #arch L1 (step 1b): UNION the typed SAFETY SPINE with legacy food_preferences.
  const [{ data: prefs }, spineAllergens] = await Promise.all([
    supabaseAdmin.from('food_preferences').select('food_name, is_allergen')
      .eq('user_id', userId).eq('is_allergen', true),
    getActiveConstraints(userId, ['allergen', 'intolerance']),
  ]);
  const allergens = [...new Set([
    ...(prefs ?? []).map((p: { food_name: string }) => p.food_name),
    ...spineAllergens.map((c) => c.subject),
  ].filter(Boolean))];

  // Get profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('gender, weight_kg, periodic_state, periodic_state_start, periodic_state_end, if_active, tdee_calculated')
    .eq('id', userId).maybeSingle();

  const periodicContext = buildPeriodicPlanContext(profile ?? {});
  const seasonal = getSeasonalContext();
  const seasonalLine = `MEVSIM: ${seasonal.season}${seasonal.isRamadan ? ' | RAMAZAN DONEMI' : ''} | Oneriler: ${seasonal.suggestions_tr.join(', ')}`;

  // Strength context
  let strengthContext = '';
  const { data: aiSummary } = await supabaseAdmin
    .from('ai_summary')
    .select('strength_records')
    .eq('user_id', userId)
    .maybeSingle();
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

  // FIX (audit CRITICAL: legacy menü, chat-onaylı diyeti EZİYOR): bu legacy haftalık-menü
  // yolu, chat plan_diet'in yazdığı OBJE-şekilli ({targets, days:[{day_index, total_kcal,
  // items}]}) tek aktif diyet satırını DÜZ-DİZİ menü çıktısıyla eziyordu; plan-projection o
  // satırı targets/day_index/total_kcal ile okuduğundan kalori 1000'e, protein 0'a düşüyordu.
  // Çözüm: legacy menüyü plan_subtype='weekly_menu' ALT-SATIRINA izole et — chat-onaylı diyet
  // satırı (plan_subtype IS NULL) ASLA bu yoldan dokunulmaz. Şema izolasyonu (plan_subtype
  // kolonu + uniq_active_plan_per_type'ın COALESCE(plan_subtype,'core') ile yeniden tanımı)
  // ayrı migration 055 ile gelir; bu kod 055 olsun/olmasın güvenlidir (aşağıya bkz.).
  const WEEKLY_MENU_SUBTYPE = 'weekly_menu';

  // Fetch existing active weekly-menu row to preserve approval state + increment revision_count.
  // Migration 030 dropped the (user_id, week_start) UNIQUE in favour of a partial unique
  // index (uniq_active_plan_per_type) of one active plan per (user, plan_type), so we
  // scope to the active row instead of week_start (which could match archived rows).
  // FIX (audit CRITICAL): plan_subtype='weekly_menu' ile daralt — chat diyet satırını DEĞİL.
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('weekly_plans')
    .select('id, revision_count, approved_at')
    .eq('user_id', userId)
    .eq('plan_type', 'diet')
    .eq('status', 'active')
    .eq('plan_subtype', WEEKLY_MENU_SUBTYPE)
    .maybeSingle();
  // FIX (audit CRITICAL): koruyucu guard — plan_subtype kolonu canlıda henüz yoksa (migration
  // 055 deploy edilmeden bu kod yayına girerse) PostgREST 42703 döner. O durumda eski davranışa
  // (chat satırını ezme) SESSİZCE geri dönmek tam da kapattığımız bug'dır; bunun yerine yazmayı
  // REDDEDIP açık bir hata döndür ki veri-bütünlüğü korunsun.
  if (existingErr) {
    throw new Error(
      'weekly_plans plan_subtype isolation not available (migration 055 not applied?) — refusing to write weekly menu to avoid overwriting the chat-approved diet plan: ' +
        existingErr.message,
    );
  }

  const modLine = modificationRequest
    ? `\n\nMENU DEGISIKLIK TALEBI: "${modificationRequest}". Bu talebi dikkate alarak sadece ilgili ogun/gunleri degistir, kalanlari koru.`
    : '';

  const prompt = `${ctx.layer1}\n\n${ctx.layer2}\n\n${ctx.layer3}\n\n${periodicContext}\n${seasonalLine}${strengthContext}${savedRecipesContext}${modLine}\n\nHafta baslangici: ${weekStart}. 7 gunluk menu ve alisveris listesi olustur.`;

  let weeklyRc: UsageReceipt | null = null;
  const weeklyPlan = await chatCompletion<Record<string, unknown>>(
    [
      { role: 'system', content: WEEKLY_PLAN_SYSTEM },
      { role: 'user', content: prompt },
    ],
    { temperature: TEMPERATURE.plan, maxTokens: 5000, jsonMode: true, onReceipt: (r) => { weeklyRc = r; } }
  );
  // #arch step 5: log the weekly plan generation cost/model/latency.
  writeTurnLog(userId, 'ai-plan', 'plan_weekly', weeklyRc).then(() => {}, () => {});

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

  // Store in weekly_plans table. Regeneration resets approved_at and bumps revision_count.
  // FIX (audit CRITICAL): the (now subtype-aware) uniq_active_plan_per_type partial index allows
  // ONE active 'core' chat-diet row AND one active 'weekly_menu' row per user simultaneously
  // (COALESCE(plan_subtype,'core')). On regeneration we UPDATE the existing active weekly_menu
  // row in place; a fresh user gets an INSERT with plan_subtype='weekly_menu' so the chat-diet
  // ('core') row is never touched.
  const nextRevision = (existing?.revision_count ?? 0) + (existing ? 1 : 0);
  if (existing?.id) {
    const { error: updateErr } = await supabaseAdmin
      .from('weekly_plans')
      .update({
        week_start: weekStart,
        plan_data: weeklyPlan.days,
        shopping_list: weeklyPlan.shopping_list ?? [],
        generated_at: new Date().toISOString(),
        approved_at: null,
        modification_request: modificationRequest ?? null,
        revision_count: nextRevision,
        stale_reason: null, // #arch step 12 (audit #9): fresh content clears any belief-change staleness
      })
      .eq('id', existing.id);
    if (updateErr) throw new Error('weekly_plans update failed: ' + updateErr.message);
  } else {
    const { error: insertErr } = await supabaseAdmin
      .from('weekly_plans')
      .insert({
        user_id: userId,
        week_start: weekStart,
        plan_type: 'diet',
        // FIX (audit CRITICAL): legacy menüyü alt-satıra izole et — chat diyet satırını ezme.
        plan_subtype: WEEKLY_MENU_SUBTYPE,
        status: 'active',
        plan_data: weeklyPlan.days,
        shopping_list: weeklyPlan.shopping_list ?? [],
        generated_at: new Date().toISOString(),
        approved_at: null,
        modification_request: modificationRequest ?? null,
        revision_count: nextRevision,
      });
    if (insertErr) throw new Error('weekly_plans insert failed: ' + insertErr.message);
  }

  return weeklyPlan;
}

// FIX (audit AI/HIGH: week_start TZ ayrışması): UTC-noon ankrajlı, getUTCDay tabanlı
// Pazartesi hesabı — ai-chat'teki kanonik getWeekStart (index.ts:1785) ile BİREBİR aynı.
// Eski sürüm new Date(dateStr) (UTC gece-yarısı) + LOKAL getDay/getDate/setDate kullanıyordu;
// runtime TZ'ye duyarlıydı ve istemcinin (cihaz-yerel) hesabıyla ayrışabiliyordu. UTC-noon
// ankrajı gece-yarısı/DST kaymasını eler; istemci de aynı algoritmayı kullanacak şekilde
// hizalandı (weekly-plan.service.ts) ve aralık sorgusuyla küçük TZ kaymalarını tolere eder.
function getWeekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  return d.toISOString().split('T')[0];
}

/**
 * PROACTIVE AI COACH
 * Spec Section 5.3, 10.1-10.4
 *
 * Scheduled cron job. Checks all users, sends smart nudges.
 * Triggers: silence, commitment follow-ups, pattern timing, risk windows, milestones.
 * Max 2-3 proactive messages per user per day.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion, TEMPERATURE } from '../shared/openai.ts';
import { supabaseAdmin } from '../shared/supabase-admin.ts';
import { sanitizeText } from '../shared/guardrails.ts';
import { isIFCompatible, getSeasonalContext, type PeriodicState } from '../shared/periodic-config.ts';

const NUDGE_PROMPT = `Sen Kochko kocusun. Kullanicinin durumunu degerlendir.
SADECE gercekten gerekli oldugunda mesaj uret. Spam YAPMA.
Samimi, kisa (1-2 cumle), operasyonel ol. Emoji yok.
Gerekli degilse: {"send": false}
Gerekli ise: {"send": true, "message": "mesaj", "trigger": "neden", "priority": "low|medium|high"}`;

serve(async (req: Request) => {
  try {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, gender, night_eating_risk, coach_tone, if_active, if_eating_start, if_eating_end, periodic_state, periodic_state_start, periodic_state_end, push_token, notification_prefs, weekly_calorie_budget')
      .eq('onboarding_completed', true);

    if (!profiles?.length) return respond({ processed: 0, sent: 0 });

    const now = new Date();
    const hour = now.getHours();
    const today = now.toISOString().split('T')[0];
    const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday
    let totalSent = 0;

    // Check if Ramadan is approaching (weekly check)
    const seasonal = getSeasonalContext();

    // --- Adaptive Difficulty (Spec 5.34) - Monday morning check ---
    if (dayOfWeek === 1 && hour >= 6 && hour <= 8) {
      for (const profile of profiles as { id: string }[]) {
        try {
          await adjustAdaptiveDifficulty(profile.id, now);
        } catch { /* non-critical */ }
      }
    }

    for (const profile of profiles as { id: string; night_eating_risk: boolean; coach_tone: string; if_active: boolean; periodic_state: string | null; periodic_state_start: string | null; periodic_state_end: string | null; push_token: string | null; notification_prefs: Record<string, unknown> | null; weekly_calorie_budget: number | null }[]) {
      // Max messages per day check
      const { count } = await supabaseAdmin
        .from('coaching_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .gte('created_at', `${today}T00:00:00`);
      const dailyLimit = (profile.notification_prefs?.dailyLimit as number | undefined) ?? 5;
      if ((count ?? 0) >= dailyLimit) continue;

      // Gather state
      const [lastMealRes, lastChatRes, commitmentsRes, summaryRes] = await Promise.all([
        supabaseAdmin.from('meal_logs').select('logged_at').eq('user_id', profile.id).order('logged_at', { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from('chat_messages').select('created_at').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from('user_commitments').select('commitment').eq('user_id', profile.id).eq('status', 'pending').lte('follow_up_at', now.toISOString()).limit(3),
        supabaseAdmin.from('ai_summary').select('behavioral_patterns, general_summary').eq('user_id', profile.id).maybeSingle(),
      ]);

      const hoursSinceMeal = lastMealRes.data?.logged_at
        ? (now.getTime() - new Date(lastMealRes.data.logged_at).getTime()) / 3600000 : 999;
      const hoursSinceChat = lastChatRes.data?.created_at
        ? (now.getTime() - new Date(lastChatRes.data.created_at).getTime()) / 3600000 : 999;
      const dueCommitments = (commitmentsRes.data ?? []) as { commitment: string }[];
      const patterns = (summaryRes.data?.behavioral_patterns as { type: string; description: string }[]) ?? [];

      const nightRisk = profile.night_eating_risk && hour >= 21 && hour <= 23;

      // T3.13: Plateau detection for proactive messaging
      let plateauInfo = '';
      if (hour >= 8 && hour <= 10) { // Check once in the morning
        const threeWeeksAgo = new Date(Date.now() - 21 * 86400000).toISOString().split('T')[0];
        const { data: weights } = await supabaseAdmin
          .from('daily_metrics').select('weight_kg')
          .eq('user_id', profile.id).gte('date', threeWeeksAgo)
          .not('weight_kg', 'is', null);
        if (weights && weights.length >= 5) {
          const ws = weights.map((w: { weight_kg: number }) => w.weight_kg);
          const avg = ws.reduce((s: number, w: number) => s + w, 0) / ws.length;
          const maxDiff = Math.max(...ws.map((w: number) => Math.abs(w - avg)));
          if (maxDiff <= 0.3) {
            plateauInfo = `TETIK: PLATEAU - ${ws.length} kayitla ${avg.toFixed(1)}kg civarinda durgun`;
          }
        }
      }

      // T3.17: Goal tracking + Maintenance band check
      let maintenanceInfo = '';
      let goalTempoInfo = '';
      const { data: activeGoal } = await supabaseAdmin
        .from('goals').select('target_weight_kg, start_weight_kg, goal_type, weekly_rate, target_weeks, created_at')
        .eq('user_id', profile.id).eq('is_active', true).maybeSingle();
      if (activeGoal?.target_weight_kg) {
        const { data: latestWeight } = await supabaseAdmin
          .from('daily_metrics').select('weight_kg')
          .eq('user_id', profile.id).not('weight_kg', 'is', null)
          .order('date', { ascending: false }).limit(1).maybeSingle();
        if (latestWeight?.weight_kg) {
          const diff = Math.abs(latestWeight.weight_kg - activeGoal.target_weight_kg);
          const goalReached = activeGoal.goal_type === 'lose_weight'
            ? latestWeight.weight_kg <= activeGoal.target_weight_kg + 0.5
            : activeGoal.goal_type === 'maintain'
              ? true
              : latestWeight.weight_kg >= activeGoal.target_weight_kg - 0.5;

          if (goalReached && activeGoal.goal_type !== 'maintain') {
            // Goal reached - celebrate + suggest maintenance
            maintenanceInfo = `TETIK: HEDEFE ULASILDI - hedef ${activeGoal.target_weight_kg}kg, simdi ${latestWeight.weight_kg}kg. Tebrik et ve bakim modunu oner!`;
            // Check for multi-phase: auto-advance
            const { data: nextPhase } = await supabaseAdmin
              .from('goals').select('id, goal_type, phase_label, weekly_rate')
              .eq('user_id', profile.id).eq('is_active', false)
              .gt('phase_order', 1).order('phase_order').limit(1).maybeSingle();
            if (nextPhase) {
              // Auto-advance to next phase
              await supabaseAdmin.from('goals').update({ is_active: false }).eq('user_id', profile.id).eq('is_active', true);
              await supabaseAdmin.from('goals').update({ is_active: true }).eq('id', nextPhase.id);
              maintenanceInfo += ` | FAZ GECISI: Sonraki faz aktif edildi: ${nextPhase.phase_label ?? nextPhase.goal_type}`;

              // Gradual 7-day calorie transition: interpolate from old phase to new phase (day 1 of 7)
              try {
                const { data: profileCalories } = await supabaseAdmin
                  .from('profiles')
                  .select('calorie_range_rest_min, calorie_range_rest_max, calorie_range_training_min, calorie_range_training_max, tdee_calculated')
                  .eq('id', profile.id)
                  .maybeSingle();
                if (profileCalories && profileCalories.tdee_calculated) {
                  const tdee = profileCalories.tdee_calculated as number;
                  const nextGoal = nextPhase as { goal_type: string; weekly_rate?: number };
                  const nextRate = (nextGoal.weekly_rate as number | null) ?? 0.5;
                  const dailyDelta = Math.round((nextRate * 7700) / 7);
                  const nextCalOffset = nextGoal.goal_type === 'lose_weight' ? -dailyDelta
                    : nextGoal.goal_type === 'gain_weight' || nextGoal.goal_type === 'gain_muscle' ? dailyDelta
                    : 0;
                  // Current ranges
                  const oldRestMin = profileCalories.calorie_range_rest_min as number;
                  const oldRestMax = profileCalories.calorie_range_rest_max as number;
                  const oldTrainMin = profileCalories.calorie_range_training_min as number;
                  const oldTrainMax = profileCalories.calorie_range_training_max as number;
                  // Target ranges for new phase (based on TDEE +/- delta)
                  const newRestMin = tdee + nextCalOffset - 100;
                  const newRestMax = tdee + nextCalOffset + 100;
                  const newTrainMin = tdee + nextCalOffset + 100;
                  const newTrainMax = tdee + nextCalOffset + 300;
                  // Day 1 of 7 interpolation (progress = 1/7)
                  const progress = 1 / 7;
                  const transRestMin = Math.round(oldRestMin + (newRestMin - oldRestMin) * progress);
                  const transRestMax = Math.round(oldRestMax + (newRestMax - oldRestMax) * progress);
                  const transTrainMin = Math.round(oldTrainMin + (newTrainMin - oldTrainMin) * progress);
                  const transTrainMax = Math.round(oldTrainMax + (newTrainMax - oldTrainMax) * progress);
                  await supabaseAdmin.from('profiles').update({
                    calorie_range_rest_min: transRestMin,
                    calorie_range_rest_max: transRestMax,
                    calorie_range_training_min: transTrainMin,
                    calorie_range_training_max: transTrainMax,
                    updated_at: new Date().toISOString(),
                  }).eq('id', profile.id);
                }
              } catch { /* transition calc non-critical */ }
            }
          } else if (goalReached && diff > 1.5) {
            maintenanceInfo = `TETIK: BAKIM BANDI ASILDI - hedef ${activeGoal.target_weight_kg}kg, simdi ${latestWeight.weight_kg}kg`;

            // Mini-cut suggestion: check if band exceeded for 2+ consecutive weigh-ins
            try {
              const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
              const { data: recentWeighIns } = await supabaseAdmin
                .from('daily_metrics')
                .select('weight_kg, date')
                .eq('user_id', profile.id)
                .not('weight_kg', 'is', null)
                .gte('date', twoDaysAgo)
                .order('date', { ascending: false })
                .limit(3);
              if (recentWeighIns && recentWeighIns.length >= 2) {
                const targetKg = activeGoal.target_weight_kg as number;
                const allExceeded = recentWeighIns.every(
                  (w: { weight_kg: number }) => (w.weight_kg as number) > targetKg + 1.5
                );
                if (allExceeded) {
                  await supabaseAdmin.from('coaching_messages').insert({
                    user_id: profile.id,
                    content: 'MINI CUT ONERISI: Hedef kilonun 1.5kg ustundesin. 2-4 haftalik mini cut donemi onerilir.',
                    trigger_type: 'mini_cut_suggestion',
                    priority: 'high',
                    read: false,
                    push_sent: false,
                  });
                }
              }
            } catch { /* mini-cut check non-critical */ }
          }

          // Tempo tracking (weekly check)
          if (!goalReached && activeGoal.weekly_rate && hour >= 8 && hour <= 10 && now.getDay() === 1) {
            const weeksElapsed = Math.max(1, Math.round((Date.now() - new Date(activeGoal.created_at as string).getTime()) / (7*24*60*60*1000)));
            const expectedChange = (activeGoal.weekly_rate as number) * weeksElapsed;
            const goalStartWeight = (activeGoal.start_weight_kg as number) ?? (latestWeight.weight_kg as number);
            const actualChange = Math.abs((latestWeight.weight_kg as number) - goalStartWeight);
            const tempoRatio = expectedChange > 0 ? actualChange / expectedChange : 1;
            if (tempoRatio < 0.5) {
              goalTempoInfo = `TETIK: YAVAS TEMPO - hedef haftada ${activeGoal.weekly_rate}kg ama gercek tempo cok yavas (oran: ${tempoRatio.toFixed(2)})`;
            } else if (tempoRatio > 1.5) {
              goalTempoInfo = `TETIK: HIZLI KAYIP - haftada ${(actualChange / weeksElapsed).toFixed(2)}kg, guvenli olmayabilir`;
            }
          }
        }
      }

      // Reinforcement message: congratulate maintenance users at milestone weeks (4, 12, 24)
      if (hour >= 8 && hour <= 10) {
        try {
          const { data: achievement } = await supabaseAdmin
            .from('achievements')
            .select('achieved_at')
            .eq('user_id', profile.id)
            .eq('achievement_type', 'goal_reached')
            .order('achieved_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (achievement?.achieved_at) {
            const weeksSinceGoalReached = Math.max(0, Math.round(
              (Date.now() - new Date(achievement.achieved_at as string).getTime()) / (7 * 24 * 60 * 60 * 1000)
            ));
            if (weeksSinceGoalReached === 4 || weeksSinceGoalReached === 12 || weeksSinceGoalReached === 24) {
              let reinforcementMsg: string;
              if (weeksSinceGoalReached >= 24) {
                reinforcementMsg = '6 aydir hedef kilonda tutunuyorsun! Bu inanilmaz bir basari. Cogul insan bunu basaramaz.';
              } else if (weeksSinceGoalReached >= 12) {
                reinforcementMsg = '3 aydir bakim modunda basarilisin. Aliskanliklarinin gucunun kaniti bu.';
              } else {
                reinforcementMsg = '1 aydir hedef kilonda kalmaya devam ediyorsun. Harika gidiyorsun!';
              }
              // Only send once per milestone (check not already sent this week)
              const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
              const { count: alreadySent } = await supabaseAdmin
                .from('coaching_messages')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', profile.id)
                .eq('trigger_type', 'reinforcement_milestone')
                .gte('created_at', oneWeekAgo);
              if ((alreadySent ?? 0) === 0) {
                await supabaseAdmin.from('coaching_messages').insert({
                  user_id: profile.id,
                  content: reinforcementMsg,
                  trigger_type: 'reinforcement_milestone',
                  priority: 'medium',
                  read: false,
                  push_sent: false,
                });
              }
            }
          }
        } catch { /* reinforcement check non-critical */ }
      }

      // Return flow detection (Phase 3: Geri dönüş akışı)
      let returnFlowInfo = '';
      const daysSinceChat = Math.round(hoursSinceChat / 24);
      if (daysSinceChat >= 3 && daysSinceChat < 7) {
        returnFlowInfo = 'TETIK: 3+ GUN SESSIZ - hafif, yargilamayan bildirim gonder';
      } else if (daysSinceChat >= 7 && daysSinceChat < 30) {
        returnFlowInfo = 'TETIK: 7+ GUN SESSIZ - kisisel bildirim, gecmis basarilarina referans ver';
      } else if (daysSinceChat >= 30) {
        returnFlowInfo = 'TETIK: 30+ GUN SESSIZ - "Seni ozledik" mesaji, geri donus plani hazirla';
      }

      // Cycle phase transition notification (Phase 3: Kadın kullanıcılara özel)
      let cycleTransitionInfo = '';
      const prof = profile as Record<string, unknown>;
      if (prof.menstrual_tracking && prof.menstrual_last_period_start && prof.menstrual_cycle_length) {
        const cycleLen = prof.menstrual_cycle_length as number;
        const lastStart = prof.menstrual_last_period_start as string;
        const daysSincePeriod = Math.floor((Date.now() - new Date(lastStart).getTime()) / 86400000);
        const dayOfCycle = (daysSincePeriod % cycleLen) + 1;
        const ovDay = Math.round(cycleLen / 2);

        // Notify on phase transitions
        if (dayOfCycle === 6) cycleTransitionInfo = 'TETIK: DONGU GECISI - Folikuler faza gecis. Enerji artacak, yogun antrenman uygun.';
        else if (dayOfCycle === ovDay - 1) cycleTransitionInfo = 'TETIK: DONGU GECISI - Ovulasyon yaklasıyor. Guc zirvesi, PR denemesi icin uygun.';
        else if (dayOfCycle === ovDay + 2) cycleTransitionInfo = 'TETIK: DONGU GECISI - Luteal faza gecis. Istah artabilir, su tutulumu normal. Tarti artisi YAG DEGIL.';
        else if (dayOfCycle === cycleLen - 1) cycleTransitionInfo = 'TETIK: DONGU GECISI - Adet yaklasıyor. Enerji dusebilir, hafif aktivite oner.';
      }

      // Predictive: Snack pattern detection (14-day window)
      let snackPatternInfo = '';
      {
        const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
        const { data: snackLogs } = await supabaseAdmin
          .from('meal_logs')
          .select('created_at')
          .eq('user_id', profile.id)
          .eq('meal_type', 'snack')
          .eq('is_deleted', false)
          .gte('logged_for_date', fourteenDaysAgo);
        if (snackLogs && snackLogs.length > 0) {
          const hourCounts: Record<number, number> = {};
          for (const s of snackLogs as { created_at: string }[]) {
            const h = new Date(s.created_at).getHours();
            hourCounts[h] = (hourCounts[h] ?? 0) + 1;
          }
          for (const [h, cnt] of Object.entries(hourCounts)) {
            if (cnt >= 5) {
              snackPatternInfo += `ATISTIRMA RISKI: Saat ${h}'te sik atistirma tespit edildi. `;
            }
          }
          snackPatternInfo = snackPatternInfo.trim();
        }
      }

      // Predictive: Alcohol risk (Friday check – past 4 Fri/Sat deviation_reason)
      let alcoholRiskInfo = '';
      if (now.getDay() === 5) {
        const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
        const { data: alcoholReports } = await supabaseAdmin
          .from('daily_reports')
          .select('date, deviation_reason')
          .eq('user_id', profile.id)
          .gte('date', fourWeeksAgo);
        if (alcoholReports) {
          let alcoholDeviations = 0;
          for (const r of alcoholReports as { date: string; deviation_reason: string | null }[]) {
            const d = new Date(r.date).getDay();
            if ((d === 5 || d === 6) && r.deviation_reason?.includes('alkol')) {
              alcoholDeviations++;
            }
          }
          if (alcoholDeviations >= 2) {
            alcoholRiskInfo = `ALKOL-SAPMA RISKI: Son 4 haftanin 2'sinde cuma/cumartesi alkol sapmasi.`;
          }
        }
      }

      // Predictive: Motivation drop (chat message frequency this week vs last)
      let motivationDropInfo = '';
      {
        const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
        const [thisWeekChat, lastWeekChat] = await Promise.all([
          supabaseAdmin.from('chat_messages').select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id).gte('created_at', oneWeekAgo),
          supabaseAdmin.from('chat_messages').select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id).gte('created_at', twoWeeksAgo).lt('created_at', oneWeekAgo),
        ]);
        const thisCount = thisWeekChat.count ?? 0;
        const lastCount = lastWeekChat.count ?? 0;
        if (lastCount > 5 && thisCount < lastCount * 0.6) {
          const dropPct = Math.round(((lastCount - thisCount) / lastCount) * 100);
          motivationDropInfo = `MOTIVASYON DUSUSU: Mesaj sikligi %${dropPct} azaldi.`;
        }
      }

      const context = `Saat: ${hour}:00 | Koc tonu: ${profile.coach_tone ?? 'balanced'}
Son ogun: ${hoursSinceMeal < 999 ? `${Math.round(hoursSinceMeal)}sa once` : 'hic yok'}
Son konusma: ${hoursSinceChat < 999 ? `${Math.round(hoursSinceChat)}sa once` : 'hic yok'}
Gece riski: ${nightRisk ? 'AKTIF' : 'yok'}
${dueCommitments.length > 0 ? `TAKIP: ${dueCommitments.map(c => `"${c.commitment}"`).join(', ')}` : ''}
${patterns.length > 0 ? `Kaliplar: ${patterns.map(p => p.description).join('; ')}` : ''}
${hoursSinceMeal > 8 && hour >= 9 && hour <= 22 ? 'TETIK: Uzun suredir ogun yok' : ''}
${hoursSinceChat > 48 ? 'TETIK: 2+ gundur sessiz' : ''}
${plateauInfo}
${maintenanceInfo}
${goalTempoInfo}
${returnFlowInfo}
${cycleTransitionInfo}
${(() => {
  // Weekend Risk (Spec 5.35) - Friday evening check
  const triggers: string[] = [];
  if (now.getDay() === 5 && hour >= 17 && hour <= 19) {
    const bp = (summaryRes.data?.behavioral_patterns as { type: string; description: string }[]) ?? [];
    const weekendPattern = bp.find(p => p.type === 'weekend_deviation' || p.description?.toLowerCase().includes('hafta sonu'));
    if (weekendPattern) {
      triggers.push('TETIK: HAFTA SONU RISKI - gecmiste hafta sonlari sapma egilimi');
    }
  }
  // Habit check (Spec 5.35)
  const habits = (summaryRes.data as Record<string, unknown>)?.habit_progress as { habit: string; status: string; streak: number; weekly_compliance?: number }[] | null;
  if (habits && habits.length > 0) {
    const activeHabit = habits.find(h => h.status === 'active');
    if (activeHabit && activeHabit.streak >= 14 && (activeHabit.weekly_compliance ?? 0) >= 80) {
      triggers.push(`TETIK: ALISKANLIK ILERLEME - "${activeHabit.habit}" ${activeHabit.streak} gundur suruyor (%80+), sonraki aliskanlik onerisi yap`);
    }
  }
  // Recovery trigger: high soreness + low sleep
  const { data: todayMetrics } = await supabaseAdmin
    .from('daily_metrics').select('muscle_soreness, sleep_hours')
    .eq('user_id', profile.id).eq('date', today).maybeSingle();
  if (todayMetrics?.muscle_soreness === 'severe' && ((todayMetrics?.sleep_hours as number) ?? 8) < 6) {
    triggers.push('TETIK: DINLENME GEREKLI - Kas agrisi yuksek ve uyku yetersiz, bugun hafif aktivite veya dinlenme oner');
  }

  // Binge recovery: yesterday compliance very low
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const { data: yesterdayReport } = await supabaseAdmin
    .from('daily_reports').select('compliance_score')
    .eq('user_id', profile.id).eq('date', yesterdayStr).maybeSingle();
  if (yesterdayReport && (yesterdayReport.compliance_score as number) < 30) {
    triggers.push('TETIK: DESTEK GUNU - Dun zorlandi, bugun destekleyici ve yargisiz ol');
  }

  // Calorie creep: check 2-week trend
  if (hour >= 8 && hour <= 10 && dayOfWeek === 3) { // Wednesday morning
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
    const { data: recentReports } = await supabaseAdmin
      .from('daily_reports').select('date, calorie_actual')
      .eq('user_id', profile.id).gte('date', twoWeeksAgo).order('date');
    if (recentReports && recentReports.length >= 10) {
      const half = Math.floor(recentReports.length / 2);
      const week1Avg = recentReports.slice(0, half).reduce((s, r) => s + (r.calorie_actual as number), 0) / half;
      const week2Avg = recentReports.slice(half).reduce((s, r) => s + (r.calorie_actual as number), 0) / (recentReports.length - half);
      if (week2Avg > week1Avg * 1.05) {
        triggers.push(`TETIK: PORSIYON DIKKAT - Son 2 haftada kademeli kalori artisi (${Math.round(week1Avg)} → ${Math.round(week2Avg)} kcal)`);
      }
    }
  }

  // Mid-week budget warning: Wednesday or Thursday
  if ((dayOfWeek === 3 || dayOfWeek === 4) && profile.weekly_calorie_budget) {
    const weeklyBudget = profile.weekly_calorie_budget as number;
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Monday
    const weekStartStr = startOfWeek.toISOString().split('T')[0];
    const { data: weekMealLogs } = await supabaseAdmin
      .from('meal_logs')
      .select('meal_log_items(calories)')
      .eq('user_id', profile.id)
      .eq('is_deleted', false)
      .gte('logged_for_date', weekStartStr);
    if (weekMealLogs) {
      let totalConsumed = 0;
      for (const log of weekMealLogs as { meal_log_items: { calories: number }[] }[]) {
        for (const item of log.meal_log_items ?? []) {
          totalConsumed += item.calories ?? 0;
        }
      }
      const pct = Math.round((totalConsumed / weeklyBudget) * 100);
      if (totalConsumed >= weeklyBudget * 0.7) {
        triggers.push(`TETIK: HAFTALIK BUTCE UYARISI — Haftanin ortasinda butcenin %${pct}'i tukendi. Kalan gunler icin dikkatli planlama oner.`);
      }
    }
  }

  return triggers.join('\n');
})()}
${(() => {
  const triggers: string[] = [];
  const ps = profile.periodic_state as PeriodicState | null;

  if (ps) {
    // Transition check: end date approaching
    if (profile.periodic_state_end) {
      const daysLeft = Math.ceil((new Date(profile.periodic_state_end).getTime() - now.getTime()) / 86400000);
      if (daysLeft <= 0) {
        triggers.push(`TETIK: DONEM DOLDU - ${ps} donemi sona erdi, gecis plani olustur`);
        // Auto-clear expired state
        supabaseAdmin.from('profiles').update({
          periodic_state: null, periodic_state_start: null, periodic_state_end: null,
          updated_at: new Date().toISOString(),
        }).eq('id', profile.id).then(() => {});
      } else if (daysLeft <= 3) {
        triggers.push(`TETIK: GECIS YAKLASYOR - ${ps} donemi ${daysLeft} gun icinde bitiyor`);
      }
    }

    // No end date set and active >7 days
    if (!profile.periodic_state_end && profile.periodic_state_start) {
      const daysActive = Math.ceil((now.getTime() - new Date(profile.periodic_state_start).getTime()) / 86400000);
      if (daysActive > 7) {
        triggers.push(`TETIK: TARIH EKSIK - ${ps} donemi ${daysActive} gundur aktif ama bitis tarihi yok`);
      }
    }

    // IF conflict safety net
    if (profile.if_active && !isIFCompatible(ps)) {
      triggers.push(`TETIK: IF CELISKISI - ${ps} doneminde IF aktif olmamali`);
    }

    // Ramadan specific: pre-iftar reminder
    if (ps === 'ramadan' && hour >= 15 && hour <= 17) {
      triggers.push('TETIK: RAMAZAN IFTAR - Iftar yaklasıyor, su hazirligi ve hafif baslangic hatırlat');
    }

    // Illness: long time no food
    if (ps === 'illness' && hoursSinceMeal > 6 && hour >= 9 && hour <= 22) {
      triggers.push('TETIK: HASTALIK BESLENME - Uzun suredir bir sey yememis, hafif besin hatırlat');
    }
  } else {
    // Ramadan approaching (no periodic state active)
    if (seasonal.isRamadanApproaching && now.getDay() === 1) { // Monday check
      triggers.push('TETIK: RAMAZAN YAKLASYOR - Ramazan modunu aktive etmeyi hatırlat');
    }
  }

  return triggers.join('\n');
})()}
${snackPatternInfo}
${alcoholRiskInfo}
${motivationDropInfo}`;

      interface NudgeResult { send: boolean; message?: string; trigger?: string; priority?: string; }

      const result = await chatCompletion<NudgeResult>(
        [{ role: 'system', content: NUDGE_PROMPT }, { role: 'user', content: context }],
        { temperature: TEMPERATURE.coaching, maxTokens: 200, jsonMode: true }
      );

      if (result.send && result.message) {
        const { clean } = sanitizeText(result.message);
        await supabaseAdmin.from('coaching_messages').insert({
          user_id: profile.id, content: clean,
          trigger_type: result.trigger ?? 'proactive',
          priority: result.priority ?? 'medium', read: false,
          push_sent: !!profile.push_token,
        });

        // Send push notification via Expo Push API (Spec 10.1)
        if (profile.push_token) {
          const prefs = profile.notification_prefs as { quietStart?: string; quietEnd?: string; enabled?: boolean } | null;
          const shouldSend = prefs?.enabled !== false && !isQuietHour(prefs?.quietStart ?? '23:00', prefs?.quietEnd ?? '07:00', hour);
          if (shouldSend) {
            try {
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  to: profile.push_token,
                  title: 'Kochko',
                  body: clean,
                  sound: 'default',
                  data: { type: 'coaching', trigger: result.trigger },
                }),
              });
            } catch { /* push non-critical */ }
          }
        }

        // Mark commitments as followed up
        for (const c of dueCommitments) {
          await supabaseAdmin.from('user_commitments')
            .update({ status: 'followed_up' })
            .eq('user_id', profile.id)
            .eq('commitment', c.commitment)
            .eq('status', 'pending');
        }
        totalSent++;

        // Send push notification for the coaching message
        try {
          await sendPushNotification(
            profile.id,
            'Kochko',
            clean,
            { type: result.trigger ?? 'proactive' }
          );
        } catch { /* push non-critical */ }
      }
    }

    // --- Re-engagement loop (Spec 10.4) ---
    const reengagementMessages: Record<string, { title: string; body: string }> = {
      '3day': {
        title: 'Seni ozledik!',
        body: 'Birlikte nerede kalmistik? Kisa bir merhaba yeter.',
      },
      '7day': {
        title: 'Bir haftadir gormuyoruz',
        body: 'Hedeflerin seni bekliyor. Tek bir adim yeterli, geri donmeye ne dersin?',
      },
      '14day': {
        title: 'Hala buradayiz',
        body: 'Iki haftadir uzaktasin. Planini guncellememizi ister misin?',
      },
      '30day': {
        title: 'Yeniden baslayalim mi?',
        body: 'Bir ay oldu. Sifirdan baslamak da cesaret ister - hazirsan buradayiz.',
      },
    };

    for (const profile of profiles as { id: string; push_token: string | null; notification_prefs: Record<string, unknown> | null }[]) {
      try {
        const { data: lastChat } = await supabaseAdmin
          .from('chat_messages')
          .select('created_at')
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!lastChat?.created_at) continue;

        const daysSinceActivity = (now.getTime() - new Date(lastChat.created_at).getTime()) / 86400000;
        const level = getReengagementLevel(daysSinceActivity);

        if (level === 'none' || level === 'stopped') continue;

        // Check if re-engagement already sent today
        const { count: reengagementToday } = await supabaseAdmin
          .from('coaching_messages')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .eq('trigger_type', `reengagement_${level}`)
          .gte('created_at', `${today}T00:00:00`);

        if ((reengagementToday ?? 0) > 0) continue;

        const msg = reengagementMessages[level];
        if (!msg) continue;

        await supabaseAdmin.from('coaching_messages').insert({
          user_id: profile.id,
          content: msg.body,
          trigger_type: `reengagement_${level}`,
          priority: level === '30day' ? 'high' : 'medium',
          read: false,
        });

        try {
          await sendPushNotification(profile.id, msg.title, msg.body, { type: 'reengagement', level });
        } catch { /* push non-critical */ }

        totalSent++;
      } catch { /* non-critical per user */ }
    }

    // T1.38: Auto-trigger daily report for users at day boundary (Spec 8.1)
    if (hour >= 4 && hour <= 6) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      for (const profile of profiles as { id: string }[]) {
        // Check if yesterday's report already exists
        const { data: existingReport } = await supabaseAdmin
          .from('daily_reports').select('id')
          .eq('user_id', profile.id).eq('date', yesterdayStr).maybeSingle();

        if (!existingReport) {
          // Trigger report generation by calling ai-report function internally
          try {
            const reportUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-report`;
            await fetch(reportUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                'x-user-id': profile.id,
              },
              body: JSON.stringify({ type: 'daily', date: yesterdayStr }),
            });
          } catch { /* non-critical */ }
        }
      }
    }

    // T1.38: Auto-trigger weekly report on Monday mornings
    if (dayOfWeek === 1 && hour >= 6 && hour <= 8) {
      for (const profile of profiles as { id: string }[]) {
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - 7);
        const weekStartStr = weekStart.toISOString().split('T')[0];

        const { data: existingWeekly } = await supabaseAdmin
          .from('weekly_reports').select('id')
          .eq('user_id', profile.id).eq('week_start', weekStartStr).maybeSingle();

        if (!existingWeekly) {
          try {
            const reportUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-report`;
            await fetch(reportUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                'x-user-id': profile.id,
              },
              body: JSON.stringify({ type: 'weekly' }),
            });
          } catch { /* non-critical */ }
        }
      }
    }

    return respond({ processed: profiles.length, sent: totalSent });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});

/**
 * Spec 5.34: Adaptive Difficulty
 * Weekly Monday morning check. Adjusts calorie range and protein based on compliance.
 */
async function adjustAdaptiveDifficulty(userId: string, now: Date) {
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0];
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];

  const { data: reports } = await supabaseAdmin
    .from('daily_reports')
    .select('date, compliance_score')
    .eq('user_id', userId)
    .gte('date', fourteenDaysAgo)
    .order('date');

  if (!reports || reports.length < 7) return; // not enough data

  const allScores = reports.map((r: { compliance_score: number }) => r.compliance_score);
  const avgAll = allScores.reduce((s: number, v: number) => s + v, 0) / allScores.length;

  // Check last 7 days separately
  const recentReports = reports.filter((r: { date: string }) => r.date >= sevenDaysAgo);
  const recentScores = recentReports.map((r: { compliance_score: number }) => r.compliance_score);
  const avgRecent = recentScores.length > 0 ? recentScores.reduce((s: number, v: number) => s + v, 0) / recentScores.length : 0;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('calorie_range_training_min, calorie_range_training_max, calorie_range_rest_min, calorie_range_rest_max, protein_per_kg, weight_kg, gender')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) return;

  let adjustment: 'increase' | 'decrease' | null = null;

  // 2+ weeks at 85%+ → tighten
  if (reports.length >= 14 && avgAll >= 85) {
    adjustment = 'increase';
  }
  // 1+ week under 60% → widen
  else if (recentScores.length >= 7 && avgRecent < 60) {
    adjustment = 'decrease';
  }

  if (!adjustment) return;

  const factor = adjustment === 'increase' ? 0.05 : -0.05;
  const proteinDelta = adjustment === 'increase' ? 5 : -5;

  const tMin = profile.calorie_range_training_min as number;
  const tMax = profile.calorie_range_training_max as number;
  const rMin = profile.calorie_range_rest_min as number;
  const rMax = profile.calorie_range_rest_max as number;
  const proteinPerKg = (profile.protein_per_kg as number) ?? 1.8;
  const weightKg = (profile.weight_kg as number) ?? 70;
  const minCal = profile.gender === 'female' ? 1200 : 1400;

  // Tighten = narrow range (increase min, decrease max); Widen = opposite
  const newTMin = Math.max(minCal, Math.round(tMin + tMin * factor));
  const newTMax = Math.round(tMax - tMax * factor);
  const newRMin = Math.max(minCal, Math.round(rMin + rMin * factor));
  const newRMax = Math.round(rMax - rMax * factor);
  const newProteinPerKg = Math.max(1.2, Math.round((proteinPerKg + proteinDelta / weightKg) * 100) / 100);

  // Safety: min must be less than max
  if (newTMin >= newTMax || newRMin >= newRMax) return;

  await supabaseAdmin.from('profiles').update({
    calorie_range_training_min: newTMin,
    calorie_range_training_max: newTMax,
    calorie_range_rest_min: newRMin,
    calorie_range_rest_max: newRMax,
    protein_per_kg: newProteinPerKg,
    protein_target_g: Math.round(weightKg * newProteinPerKg),
    updated_at: new Date().toISOString(),
  }).eq('id', userId);

  // Send trigger as coaching message
  const triggerMsg = adjustment === 'increase'
    ? 'TETIK: ZORLUK AYARLANDI - arttirildi'
    : 'TETIK: ZORLUK AYARLANDI - azaltildi';

  await supabaseAdmin.from('coaching_messages').insert({
    user_id: userId,
    content: adjustment === 'increase'
      ? 'Citayi yukseltiyorum! Son 2 haftada harika bir uyum gosterdin. Kalori araligini biraz daraltip protein hedefini artiriyorum.'
      : 'Eski seviyeye donuyoruz, rahat ol. Bu hafta hedefler biraz esnek olacak, tekrar ritim yakala.',
    trigger_type: triggerMsg,
    priority: 'medium',
    read: false,
  });

  // A9: Reverse diet — write escalating calorie targets during first 4 weeks post-goal
  // Each Monday: +125 kcal/week from current deficit toward TDEE.
  try {
    const { data: rdProfile } = await supabaseAdmin
      .from('profiles')
      .select('calorie_range_rest_min, calorie_range_rest_max, tdee_calculated')
      .eq('id', userId)
      .maybeSingle();
    if (rdProfile?.tdee_calculated) {
      const { data: goalAchievement } = await supabaseAdmin
        .from('achievements')
        .select('achieved_at')
        .eq('user_id', userId)
        .eq('achievement_type', 'goal_reached')
        .order('achieved_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (goalAchievement?.achieved_at) {
        const weeksSinceGoal = Math.floor(
          (now.getTime() - new Date(goalAchievement.achieved_at as string).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );
        if (weeksSinceGoal >= 0 && weeksSinceGoal < 4) {
          const tdee = rdProfile.tdee_calculated as number;
          const currentMin = rdProfile.calorie_range_rest_min as number;
          const newMin = Math.round(Math.min(tdee - 100, currentMin + 125));
          const newMax = Math.round(Math.min(tdee + 100, newMin + 200));
          await supabaseAdmin.from('profiles').update({
            calorie_range_rest_min: newMin,
            calorie_range_rest_max: newMax,
            updated_at: now.toISOString(),
          }).eq('id', userId);
        }
      }
    }
  } catch { /* reverse diet calc non-critical */ }

  // A10: Pattern confidence decay — weekly decay for behavioral patterns not seen in 30+ days
  try {
    const { data: summaryRow } = await supabaseAdmin
      .from('ai_summary')
      .select('behavioral_patterns')
      .eq('user_id', userId)
      .maybeSingle();
    if (summaryRow?.behavioral_patterns) {
      const patterns = summaryRow.behavioral_patterns as {
        type?: string; description?: string; confidence?: number; status?: string; last_occurred?: string;
      }[];
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
      let changed = false;
      const updatedPatterns = patterns.map(p => {
        if (p.status !== 'active') return p;
        const lastOccurred = p.last_occurred ?? '';
        if (lastOccurred < thirtyDaysAgo) {
          const currentConf = p.confidence ?? 1.0;
          const newConf = Math.max(0.3, Math.round((currentConf - 0.1) * 100) / 100);
          changed = true;
          return { ...p, confidence: newConf, status: newConf <= 0.3 ? 'resolved' : 'active' };
        }
        return p;
      });
      if (changed) {
        await supabaseAdmin.from('ai_summary').update({
          behavioral_patterns: updatedPatterns,
          updated_at: now.toISOString(),
        }).eq('user_id', userId);
      }
    }
  } catch { /* pattern decay non-critical */ }
}

// ─── Push Notification Helpers ───

function isQuietHour(quietStart: string, quietEnd: string, currentHour: number): boolean {
  const [sH] = quietStart.split(':').map(Number);
  const [eH] = quietEnd.split(':').map(Number);
  if (sH > eH) {
    // Overnight: e.g., 23:00 - 07:00
    return currentHour >= sH || currentHour < eH;
  }
  return currentHour >= sH && currentHour < eH;
}

/**
 * Spec 10.4: Re-engagement level based on days since last activity.
 */
function getReengagementLevel(days: number): 'none' | '3day' | '7day' | '14day' | '30day' | 'stopped' {
  if (days < 3) return 'none';
  if (days < 7) return '3day';
  if (days < 14) return '7day';
  if (days < 30) return '14day';
  if (days < 31) return '30day';
  return 'stopped';
}

/**
 * Check if current time falls within quiet hours.
 * Handles overnight ranges (e.g. 23:00 to 07:00).
 */
function isQuietHour(quietStart: string, quietEnd: string): boolean {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = quietStart.split(':').map(Number);
  const [endH, endM] = quietEnd.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes > endMinutes) {
    // Crosses midnight: e.g. 23:00 - 07:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Spec 10.2: Send push notification via Expo Push API.
 * Checks user prefs and quiet hours before sending.
 */
async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<boolean> {
  // Fetch push token and notification prefs from profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('push_token, notification_prefs')
    .eq('id', userId)
    .maybeSingle();

  if (!profile?.push_token) return false;

  const prefs = (profile.notification_prefs as Record<string, unknown>) ?? {};

  // Check if notifications are enabled
  if (prefs.enabled === false) return false;

  // Check quiet hours
  const quietStart = (prefs.quietStart as string) ?? '23:00';
  const quietEnd = (prefs.quietEnd as string) ?? '07:00';
  if (isQuietHour(quietStart, quietEnd)) return false;

  // Send via Expo Push API
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: profile.push_token,
        title,
        body,
        data: data ?? {},
        sound: 'default',
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

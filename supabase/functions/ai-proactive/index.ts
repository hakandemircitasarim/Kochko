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
      .select('id, gender, night_eating_risk, coach_tone, if_active, if_eating_start, if_eating_end, periodic_state, periodic_state_start, periodic_state_end')
      .eq('onboarding_completed', true);

    if (!profiles?.length) return respond({ processed: 0, sent: 0 });

    const now = new Date();
    const hour = now.getHours();
    const today = now.toISOString().split('T')[0];
    let totalSent = 0;

    // Check if Ramadan is approaching (weekly check)
    const seasonal = getSeasonalContext();

    for (const profile of profiles as { id: string; night_eating_risk: boolean; coach_tone: string; if_active: boolean; periodic_state: string | null; periodic_state_start: string | null; periodic_state_end: string | null }[]) {
      // Max messages per day check
      const { count } = await supabaseAdmin
        .from('coaching_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .gte('created_at', `${today}T00:00:00`);
      if ((count ?? 0) >= 3) continue;

      // Gather state
      const [lastMealRes, lastChatRes, commitmentsRes, summaryRes] = await Promise.all([
        supabaseAdmin.from('meal_logs').select('logged_at').eq('user_id', profile.id).order('logged_at', { ascending: false }).limit(1).single(),
        supabaseAdmin.from('chat_messages').select('created_at').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(1).single(),
        supabaseAdmin.from('user_commitments').select('commitment').eq('user_id', profile.id).eq('status', 'pending').lte('follow_up_at', now.toISOString()).limit(3),
        supabaseAdmin.from('ai_summary').select('behavioral_patterns, general_summary').eq('user_id', profile.id).single(),
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
        .from('goals').select('target_weight_kg, goal_type, weekly_rate, target_weeks, created_at')
        .eq('user_id', profile.id).eq('is_active', true).single();
      if (activeGoal?.target_weight_kg) {
        const { data: latestWeight } = await supabaseAdmin
          .from('daily_metrics').select('weight_kg')
          .eq('user_id', profile.id).not('weight_kg', 'is', null)
          .order('date', { ascending: false }).limit(1).single();
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
              .from('goals').select('id, goal_type, phase_label')
              .eq('user_id', profile.id).eq('is_active', false)
              .gt('phase_order', 1).order('phase_order').limit(1).single();
            if (nextPhase) {
              // Auto-advance to next phase
              await supabaseAdmin.from('goals').update({ is_active: false }).eq('user_id', profile.id).eq('is_active', true);
              await supabaseAdmin.from('goals').update({ is_active: true }).eq('id', nextPhase.id);
              maintenanceInfo += ` | FAZ GECISI: Sonraki faz aktif edildi: ${nextPhase.phase_label ?? nextPhase.goal_type}`;
            }
          } else if (goalReached && diff > 1.5) {
            maintenanceInfo = `TETIK: BAKIM BANDI ASILDI - hedef ${activeGoal.target_weight_kg}kg, simdi ${latestWeight.weight_kg}kg`;
          }

          // Tempo tracking (weekly check)
          if (!goalReached && activeGoal.weekly_rate && hour >= 8 && hour <= 10 && now.getDay() === 1) {
            const weeksElapsed = Math.max(1, Math.round((Date.now() - new Date(activeGoal.created_at as string).getTime()) / (7*24*60*60*1000)));
            const expectedChange = (activeGoal.weekly_rate as number) * weeksElapsed;
            const actualChange = Math.abs((latestWeight.weight_kg as number) - 80); // approximate start weight from profile
            const tempoRatio = expectedChange > 0 ? actualChange / expectedChange : 1;
            if (tempoRatio < 0.5) {
              goalTempoInfo = `TETIK: YAVAS TEMPO - hedef haftada ${activeGoal.weekly_rate}kg ama gercek tempo cok yavas (oran: ${tempoRatio.toFixed(2)})`;
            } else if (tempoRatio > 1.5) {
              goalTempoInfo = `TETIK: HIZLI KAYIP - haftada ${(actualChange / weeksElapsed).toFixed(2)}kg, guvenli olmayabilir`;
            }
          }
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
})()}`;

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
        });

        // Mark commitments as followed up
        for (const c of dueCommitments) {
          await supabaseAdmin.from('user_commitments')
            .update({ status: 'followed_up' })
            .eq('user_id', profile.id)
            .eq('commitment', c.commitment)
            .eq('status', 'pending');
        }
        totalSent++;
      }
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
          .eq('user_id', profile.id).eq('date', yesterdayStr).single();

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
    const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday
    if (dayOfWeek === 1 && hour >= 6 && hour <= 8) {
      for (const profile of profiles as { id: string }[]) {
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - 7);
        const weekStartStr = weekStart.toISOString().split('T')[0];

        const { data: existingWeekly } = await supabaseAdmin
          .from('weekly_reports').select('id')
          .eq('user_id', profile.id).eq('week_start', weekStartStr).single();

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

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

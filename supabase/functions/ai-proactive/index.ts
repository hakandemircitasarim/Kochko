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
import type { UsageReceipt } from '../shared/openai.ts';
import { writeTurnLog } from '../shared/turn-log.ts';
import { supabaseAdmin } from '../shared/supabase-admin.ts';
import { sanitizeText } from '../shared/guardrails.ts';
import { denyIfNotCron, cronHeaders } from '../shared/cron-auth.ts';
import { isIFCompatible, getSeasonalContext, type PeriodicState } from '../shared/periodic-config.ts';
import { getPredictiveRiskContext, getAdaptiveDifficultyContext } from '../shared/service-contexts.ts';
import { getEffectiveDateForUser, shiftDateString } from '../shared/day-boundary.ts';
import { projectDailyPlanRows, type ProjectionProfile } from '../shared/plan-projection.ts';
import { resolveTargetCalories, computeCalorieBand, computeMaintenanceBand, bmrMifflin, tdeeFrom } from '../shared/targets.ts';
import { applyTargetAdjust } from '../shared/target-engine.ts';
import { VOICE_RULES } from '../shared/voice.ts';
import { getCalorieFloor } from '../shared/clinical-rules.ts';
import { deficitAllowed } from '../shared/safety-state.ts';
import { HABIT_CATALOG, normalizeHabitEntry, deriveHabitStats, readyForNextHabit } from '../shared/habits.ts';
import { activePatterns } from '../shared/patterns.ts';
import { gateUserText, loadUserSafety, type UserSafetySnapshot } from '../shared/output-gate.ts';

/**
 * Start of the user's LOCAL calendar day expressed as a UTC ISO instant — for windowing a
 * created_at (timestamptz) anti-spam cap. Using raw UTC midnight let a wide-offset user's daily
 * cap reset mid-day (e.g. UTC-8: UTC midnight = 16:00 local), so they could receive ~2x the
 * intended pushes/nudges. Falls back to a rolling 24h window when tz is missing/invalid — both
 * are immune to the UTC-rollover gaming.
 */
function localDayStartIso(tz: string | null | undefined, now: Date): string {
  try {
    if (!tz) throw new Error('no tz');
    const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const offsetMs = now.getTime() - local.getTime();
    return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()) + offsetMs).toISOString();
  } catch {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  }
}

// F4/B4-ses (TUTARLILIK-11): same voice as the chat coach — this cron used to be a second
// personality ("Harika gidiyorsun!" while chat bans it as a cliché).
const NUDGE_PROMPT = `Sen Kochko kocusun. Kullanicinin durumunu degerlendir.
SADECE gercekten gerekli oldugunda mesaj uret. Spam YAPMA.
Samimi, kisa (1-2 cumle), operasyonel ol.

${VOICE_RULES}

Yanitini yalnizca JSON olarak ver:
Gerekli degilse: {"send": false}
Gerekli ise: {"send": true, "message": "mesaj", "trigger": "neden", "priority": "low|medium|high"}`;

serve(async (req: Request) => {
  const denied = denyIfNotCron(req);
  if (denied) return denied;
  try {
    // Ops backfill flag (cron-secret-gated like everything here): force the
    // daily 4-6 UTC block (reports + challenge evaluation) outside its window —
    // e.g. re-run a missed night, or verify the evaluator after a deploy.
    let forceDaily = false;
    try {
      const body = await req.json();
      forceDaily = body?.force_daily === true;
    } catch { /* empty body is the normal cron case */ }

    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, gender, night_eating_habit, coach_tone, if_active, if_eating_start, if_eating_end, periodic_state, periodic_state_start, periodic_state_end, push_token, notification_prefs, weekly_calorie_budget, wake_time, sleep_time, work_start, home_timezone, active_timezone, day_boundary_hour, menstrual_tracking, menstrual_last_period_start, menstrual_cycle_length')
      .eq('onboarding_completed', true)
      .order('id'); // #L19: stable order so the rotating window below covers the whole fleet

    if (!profiles?.length) return respond({ processed: 0, sent: 0 });

    const now = new Date();
    const utcHour = now.getUTCHours();
    const today = now.toISOString().split('T')[0];
    const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday
    let totalSent = 0;
    // FIX (adversarial): 13 trigger sites `totalSent++` unconditionally even when the gate SUPPRESSED
    // the write, so the cron reported nudges it never stored. The helper keeps the honest tallies;
    // reset per request (module scope survives warm invocations).
    nudgeStats.inserted = 0; nudgeStats.suppressed = 0;

    // ── #journey-CRITICAL: daily_plans ROLL-FORWARD + calorie RE-CUT ──────────────
    // Plan approval projects ONLY the approval week; nothing re-projected it, so from
    // day 8 the losing-weight user had NO per-day plan for the rest of the 90 days. Once
    // per day, for every onboarded user whose TODAY row is missing, re-project the active
    // plan onto the current week and re-cut the daily target to the user's CURRENT calorie
    // band (which tracks their weight loss), so the plan never goes stale/empty.
    if (forceDaily || (utcHour >= 0 && utcHour <= 6)) {
      const toISO = (d: Date) => d.toISOString().split('T')[0];
      const mondayOf = (dateStr: string) => { const d = new Date(dateStr + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return toISO(d); };
      const addDaysISO = (dateStr: string, n: number) => { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return toISO(d); };
      let rolledForward = 0;
      // #organism: retire life events whose date has passed so the coach's snapshot only ever
      // surfaces upcoming ones (housekeeping; the snapshot query already filters by date too).
      await supabaseAdmin.from('life_events').update({ is_active: false }).lt('event_date', today).eq('is_active', true).then(() => {}, () => {});
      for (const profile of profiles as { id: string }[]) {
        try {
          const uid = profile.id;
          // #journey LOW: project onto the user's EFFECTIVE day (tz + day_boundary), not raw UTC —
          // otherwise for a non-UTC / traveling user the rolled-forward daily_plans row lands on the
          // wrong calendar date and the dashboard (which queries the effective date) shows a blank day.
          const { data: prof } = await supabaseAdmin.from('profiles').select('weight_kg, birth_year, height_cm, gender, activity_level, weekly_calorie_budget, calorie_range_training_min, calorie_range_training_max, calorie_range_rest_min, calorie_range_rest_max, tdee_last_weight, tdee_last_date, maintenance_mode, periodic_state, active_timezone, home_timezone, day_boundary_hour').eq('id', uid).maybeSingle();
          const rfTz = (prof?.active_timezone as string | null) ?? (prof?.home_timezone as string | null) ?? null;
          const userToday = getEffectiveDateForUser(rfTz, (prof?.day_boundary_hour as number | null) ?? null, now);
          const { data: todayRow } = await supabaseAdmin.from('daily_plans').select('id').eq('user_id', uid).eq('date', userToday).limit(1).maybeSingle();
          if (todayRow) continue; // idempotent: today already has a plan
          const { data: planRows } = await supabaseAdmin.from('weekly_plans').select('plan_type, plan_data').eq('user_id', uid).eq('status', 'active').is('plan_subtype', null);
          const dietRow = (planRows ?? []).find((r: { plan_type: string }) => r.plan_type === 'diet');
          const workoutRow = (planRows ?? []).find((r: { plan_type: string }) => r.plan_type === 'workout');
          if (!dietRow && !workoutRow) continue; // user never approved a plan
          const weekStart = mondayOf(userToday);
          const weekEnd = addDaysISO(weekStart, 6);
          let dietData = (dietRow?.plan_data ?? null) as Record<string, unknown> | null;
          let rMin = prof?.calorie_range_rest_min as number | null;
          let rMax = prof?.calorie_range_rest_max as number | null;
          // #journey: TDEE re-cut DRIVER. profiles.calorie_range only updated on a manual chat
          // weight-log, so a user who stops weighing kept the target from their heaviest weight
          // (deficit erodes as they get lighter). Recompute the band from the latest weigh-in
          // when it's changed >=1.5kg or 21+ days stale, so the plan re-cuts even without a
          // same-day chat log. Skipped in maintenance (the reverse-diet ramp owns the band there).
          if (prof && prof.birth_year && prof.height_cm && prof.gender && prof.maintenance_mode !== true && prof.periodic_state !== 'maintenance') {
            const { data: lw } = await supabaseAdmin.from('daily_metrics').select('weight_kg, date').eq('user_id', uid).not('weight_kg', 'is', null).order('date', { ascending: false }).limit(1).maybeSingle();
            const curW = lw?.weight_kg as number | null;
            const lastW = prof.tdee_last_weight as number | null;
            const lastD = prof.tdee_last_date as string | null;
            const daysSince = lastD ? Math.floor((Date.now() - Date.parse(lastD)) / 86400000) : 999;
            if (curW && (!lastW || Math.abs(curW - lastW) >= 1.5 || daysSince >= 21)) {
              const age = new Date().getUTCFullYear() - (prof.birth_year as number);
              // #arch S1: shared BMR/TDEE + band owner (targets.ts) — was inline copies here.
              const tdee = tdeeFrom(bmrMifflin(curW, prof.height_cm as number, age, prof.gender as string | null), prof.activity_level as string | null);
              const { data: g } = await supabaseAdmin.from('goals').select('goal_type, target_weight_kg, target_weeks, created_at').eq('user_id', uid).eq('is_active', true).maybeSingle();
              const gType = (g?.goal_type as string) ?? 'maintain';
              const factor = gType === 'lose_weight' ? 0.85 : (gType === 'gain_weight' || gType === 'gain_muscle') ? 1.1 : 1.0;
              // #journey HIGH: size the deficit to the user's remaining kg / remaining weeks (capped
              // to a safe rate) so the re-cut converges on their chosen DATE. Falls back to the factor.
              const weeksElapsed = g?.created_at ? Math.max(0, Math.floor((Date.now() - Date.parse(g.created_at as string)) / (7 * 86400000))) : 0;
              const target = resolveTargetCalories({ tdee, goalType: gType, fixedFactor: factor, currentWeight: curW, targetWeight: g?.target_weight_kg as number | null, targetWeeks: g?.target_weeks as number | null, weeksElapsed, gender: prof.gender as string | null });
              const band = computeCalorieBand({ targetCalories: target, gender: prof.gender as string | null });
              const tMin = band.trainingMin, tMax = band.trainingMax, rrMin = band.restMin, rrMax = band.restMax, budget = band.weeklyBudget;
              // F3/C3 (target-engine): this re-cut LOWERS the band with NO SafetyState check — the
              // one writer that could still deficit-tighten an amber/red ED user from a cron. The
              // engine gates it; on refusal the old band (and stale tdee stamps, so it retries and
              // re-gates next week) stay put.
              const adj = await applyTargetAdjust({
                userId: uid, today: userToday,
                band: { restMin: rrMin, restMax: rrMax, trainingMin: tMin, trainingMax: tMax, weeklyBudget: budget },
                source: 'proactive_recalc',
                reason: `Haftalık roll-forward: TDEE ${tdee} kcal @ ${curW}kg (hedef ${gType})`,
                profileExtras: { tdee_calculated: tdee, tdee_last_weight: curW, tdee_last_date: today },
              });
              if (adj.ok && adj.allowed) { rMin = adj.newRestMin ?? rrMin; rMax = adj.newRestMax ?? rrMax; }
            }
          }
          const curTarget = (rMin && rMax) ? Math.round((rMin + rMax) / 2) : null;
          if (dietData && curTarget && dietData.targets && typeof dietData.targets === 'object') {
            const t = dietData.targets as Record<string, unknown>;
            const old = Number(t.kcal);
            if (Number.isFinite(old) && old > 0 && Math.abs(curTarget - old) / old > 0.03) {
              const f = curTarget / old;
              dietData = { ...dietData, targets: { ...t, kcal: curTarget, protein: Math.round(Number(t.protein) || 0), carbs: Math.round((Number(t.carbs) || 0) * f), fat: Math.round((Number(t.fat) || 0) * f) } };
            }
          }
          const { data: wm } = await supabaseAdmin.from('meal_logs').select('id').eq('user_id', uid).gte('logged_for_date', weekStart).lte('logged_for_date', weekEnd);
          const ids = (wm ?? []).map((m: { id: string }) => m.id);
          let weekConsumed = 0;
          if (ids.length) { const { data: wi } = await supabaseAdmin.from('meal_log_items').select('calories').in('meal_log_id', ids); weekConsumed = (wi ?? []).reduce((s: number, it: { calories: number | null }) => s + (it.calories ?? 0), 0); }
          const rows = projectDailyPlanRows({
            // deno-lint-ignore no-explicit-any
            dietPlanData: dietData as any,
            // deno-lint-ignore no-explicit-any
            workoutPlanData: (workoutRow?.plan_data ?? null) as any,
            weekStart,
            profile: {
              weight_kg: (prof?.weight_kg as number | null) ?? null,
              weekly_calorie_budget: (prof?.weekly_calorie_budget as number | null) ?? null,
              calorie_range_training_min: (prof?.calorie_range_training_min as number | null) ?? null,
              calorie_range_training_max: (prof?.calorie_range_training_max as number | null) ?? null,
              calorie_range_rest_min: rMin ?? null,
              calorie_range_rest_max: rMax ?? null,
            } as ProjectionProfile,
            weekConsumed,
            // FIX (adversarial HIGH): this writer owns daily_plans from day 8 of every plan onward and
            // passed NEITHER guard — so a workout-only user got the 1000-kcal placeholder (925/1075 +
            // 0 g protein) back every week, and a sub-floor LLM target reached the table unclamped.
            fallbackCalorieTarget: (() => {
              const lo = Number(rMin), hi = Number(rMax);
              if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > 0) return Math.round((lo + hi) / 2);
              const tMin = Number(prof?.calorie_range_training_min), tMax = Number(prof?.calorie_range_training_max);
              if (Number.isFinite(tMin) && Number.isFinite(tMax) && tMin > 0 && tMax > 0) return Math.round((tMin + tMax) / 2);
              return null;
            })(),
            calorieFloor: getCalorieFloor(prof?.gender as string | null),
          });
          const writeRows = rows.filter((r) => r.date >= userToday && r.date <= weekEnd).map((r) => ({ ...r, user_id: uid, version: 1 }));
          if (writeRows.length) {
            const { error: e } = await supabaseAdmin.rpc('project_daily_plans', { p_user: uid, p_lower: userToday, p_end: weekEnd, p_rows: writeRows });
            if (!e) rolledForward++;
          }
        } catch (e) { console.error('[rollforward] failed', profile.id, (e as Error).message); }
      }
      console.log('[rollforward] re-projected daily_plans for', rolledForward, 'users');
    }

    // #L19: the fleet is processed SERIALLY with a per-user LLM call; a large fleet hit the
    // 150s request idle limit (504) mid-pass and, with unrotated ordering, the SAME tail users
    // were skipped every hourly run. Bound each run to a window and ROTATE it by the UTC hour
    // so every user is covered across the day instead of starved. (Most users are gated out by
    // the per-user local-time check anyway, so the effective LLM load per run is far smaller.)
    const FLEET_WINDOW = 40;
    let fleet = profiles as typeof profiles;
    if (fleet.length > FLEET_WINDOW) {
      const windowCount = Math.ceil(fleet.length / FLEET_WINDOW);
      // FIX (audit AI-PRO-02): rotate by a full hour-epoch counter, not utcHour.
      // utcHour only ranges 0..23, so once the fleet exceeds 24*FLEET_WINDOW=960
      // users, windowCount > 24 and (utcHour % windowCount) could never reach
      // windows 24..windowCount-1 — those tail users were starved every hour of
      // every day. The hour-epoch slot cycles through ALL windows over time.
      const slot = Math.floor(now.getTime() / 3600000) % windowCount;
      const startIdx = slot * FLEET_WINDOW;
      fleet = fleet.slice(startIdx, startIdx + FLEET_WINDOW);
    }

    /**
     * Get user's current local hour based on their timezone.
     * Falls back to UTC+3 (Turkey) if no timezone set.
     */
    function getUserLocalHour(profile: { home_timezone?: string | null; active_timezone?: string | null }): number {
      const tz = (profile.active_timezone ?? profile.home_timezone) as string | undefined;
      if (tz) {
        try {
          const localTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
          return localTime.getHours();
        } catch { /* invalid timezone, fall through */ }
      }
      return (utcHour + 3) % 24; // default Turkey UTC+3
    }

    /**
     * Check if current time is appropriate for this user.
     * Uses wake_time and sleep_time from profile.
     * Only sends nudges between wake_time+30min and sleep_time-1h.
     */
    function isAppropriateTime(profile: { wake_time?: string; sleep_time?: string }, localHour: number): boolean {
      const wakeHour = profile.wake_time ? parseInt(profile.wake_time.split(':')[0]) : 7;
      const sleepHour = profile.sleep_time ? parseInt(profile.sleep_time.split(':')[0]) : 23;
      // Allow nudges from wake hour until 1h before sleep
      return localHour >= wakeHour && localHour <= sleepHour - 1;
    }

    function isWakeUpHour(profile: { wake_time?: string }, localHour: number): boolean {
      const wakeHour = profile.wake_time ? parseInt(profile.wake_time.split(':')[0]) : 7;
      return localHour === wakeHour;
    }

    // Check if Ramadan is approaching (weekly check)
    const seasonal = getSeasonalContext();

    // --- Adaptive Difficulty (Spec 5.34) - Monday morning check (per-user timezone) ---
    if (dayOfWeek === 1) {
      for (const profile of profiles as { id: string; home_timezone?: string; active_timezone?: string }[]) {
        const localH = getUserLocalHour(profile);
        if (localH < 6 || localH > 8) continue;
        try {
          await adjustAdaptiveDifficulty(profile.id, now);
        } catch { /* non-critical */ }
      }
    }

    // --- Pre-snack-hour nudge (Spec 14.2) — 15-60 min before detected peak ---
    // Reads ai_summary.snacking_hours (populated weekly by ai-extractor) and
    // sends a soft "bir bardak su ic" nudge if the user's local hour matches
    // (peakHour - 1). One nudge per day.
    for (const profile of profiles as { id: string; home_timezone?: string; active_timezone?: string }[]) {
      const localH = getUserLocalHour(profile);

      try {
        const { data: summary } = await supabaseAdmin
          .from('ai_summary')
          .select('snacking_hours')
          .eq('user_id', profile.id)
          .maybeSingle();
        const snackHours = (summary?.snacking_hours as number[] | null) ?? [];
        if (snackHours.length === 0) continue;

        // Fire when current local hour is exactly 1 hour before a peak
        const match = snackHours.find(h => h - 1 === localH);
        if (match === undefined) continue;

        // Dedupe: only once per day per peak
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const { count: alreadySent } = await supabaseAdmin
          .from('coaching_messages')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .eq('trigger_type','snack_hour_nudge')
          .gte('created_at', dayStart.toISOString());
        if ((alreadySent ?? 0) > 0) continue;

        await insertCoachingMessage({
          user_id: profile.id,
          trigger_type: 'snack_hour_nudge',
          priority: 'low',
          // FIX (final sweep): aksansız → proper Turkish, meaning unchanged.
          content: `Saat ${match}:00 civarında atıştırma yapma eğilimin var. Bir bardak su iç, 5 dakika bekle — istersen o zaman yine değerlendir.`,
        });
        totalSent++;
      } catch { /* non-critical */ }
    }

    // --- Motivation dip early warning (Spec 5.14, 10.1) — daily evening ---
    // Last 7 days log frequency < 50% of last 30-day baseline → soft "tek bir şey" nudge.
    for (const profile of profiles as { id: string; home_timezone?: string; active_timezone?: string }[]) {
      const localH = getUserLocalHour(profile);
      if (localH < 18 || localH > 20) continue; // evening check

      try {
        const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
        const { count: alreadySent } = await supabaseAdmin
          .from('coaching_messages')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .eq('trigger_type','motivation_dip')
          .gte('created_at', threeDaysAgo);
        if ((alreadySent ?? 0) > 0) continue;

        // Count meal_logs in last 7 vs prior 23 days
        const sevenAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
        const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        const { count: last7 } = await supabaseAdmin
          .from('meal_logs')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .eq('is_deleted', false)
          .gte('logged_for_date', sevenAgo);
        const { count: last30 } = await supabaseAdmin
          .from('meal_logs')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .eq('is_deleted', false)
          .gte('logged_for_date', thirtyAgo);

        const prior23 = (last30 ?? 0) - (last7 ?? 0);
        if (prior23 < 10) continue; // not enough baseline to compare

        const baselinePerDay = prior23 / 23;
        const recentPerDay = (last7 ?? 0) / 7;
        if (recentPerDay >= baselinePerDay * 0.5) continue; // still healthy

        await insertCoachingMessage({
          user_id: profile.id,
          trigger_type: 'motivation_dip',
          priority: 'low',
          // FIX (final sweep): aksansız → proper Turkish, meaning unchanged.
          content: `Son haftada biraz yavaşladın — olur böyle dönemler, hiç sorun değil. Bugün sadece tek şey: bir şey ye ve kaydet. O kadar. Yarın devam ederiz.`,
        });
        totalSent++;
      } catch { /* non-critical */ }
    }

    // --- Alcohol next-day pattern (Spec 5.14) — Saturday morning ---
    // Detect pattern: Friday alkol → Saturday skip-meal / düşük compliance.
    // Last 4 weeks. If pattern present, Saturday morning gentle message.
    if (dayOfWeek === 6) { // Saturday
      for (const profile of profiles as { id: string; home_timezone?: string; active_timezone?: string }[]) {
        const localH = getUserLocalHour(profile);
        if (localH < 8 || localH > 11) continue;

        try {
          const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
          const { count: alreadySent } = await supabaseAdmin
            .from('coaching_messages')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id)
            .eq('trigger_type','alcohol_next_day')
            .gte('created_at', weekAgo);
          if ((alreadySent ?? 0) > 0) continue;

          // Last 4 Fridays: did user log alcohol? And what was Saturday's compliance?
          const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
          const { data: reports } = await supabaseAdmin
            .from('daily_reports')
            .select('date, compliance_score, alcohol_calories')
            .eq('user_id', profile.id)
            .gte('date', fourWeeksAgo);
          if (!reports || reports.length < 10) continue;

          type R = { date: string; compliance_score: number; alcohol_calories: number | null };
          const byDate: Record<string, R> = {};
          for (const r of reports as R[]) byDate[r.date] = r;

          let friAlcoholCount = 0;
          let satDipAfterAlcoholCount = 0;
          let satDipSum = 0;
          for (const r of reports as R[]) {
            const d = new Date(r.date);
            if (d.getDay() !== 5) continue; // Friday only
            const hadAlcohol = (r.alcohol_calories ?? 0) >= 50;
            if (!hadAlcohol) continue;
            friAlcoholCount++;
            const satDate = new Date(d.getTime() + 86400000).toISOString().split('T')[0];
            const sat = byDate[satDate];
            if (sat && sat.compliance_score < 60) {
              satDipAfterAlcoholCount++;
              satDipSum += sat.compliance_score;
            }
          }

          // Need 2+ Fridays with alcohol, and 60%+ of them followed by dip
          if (friAlcoholCount < 2) continue;
          if (satDipAfterAlcoholCount / friAlcoholCount < 0.6) continue;

          // Was yesterday (Friday) an alcohol day?
          const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
          const yesterday = byDate[yesterdayStr];
          const alcoholYesterday = yesterday ? (yesterday.alcohol_calories ?? 0) >= 50 : false;
          if (!alcoholYesterday) continue;

          await insertCoachingMessage({
            user_id: profile.id,
            trigger_type: 'alcohol_next_day',
            priority: 'low',
            // FIX (final sweep): aksansız → proper Turkish, meaning unchanged.
            content: `Geçmişte cuma içki → cumartesi öğün atlama kalıbını gördük. Bugün kahvaltıyı atlamamaya çalışalım — protein ağırlıklı hafif bir şey yeter. Su 2 bardak.`,
          });
          totalSent++;

          // Persist pattern to ai_summary so future prompts remember
          await supabaseAdmin.rpc('ai_summary_merge', {
            p_user_id: profile.id,
            p_patch: { alcohol_pattern: `Cuma ickili → cumartesi ogle ogun atlama egilimi (${Math.round((satDipAfterAlcoholCount / friAlcoholCount) * 100)}% ornekte gozlendi).` },
          }).then(() => {}, () => {});
        } catch { /* non-critical */ }
      }
    }

    // --- Weekly budget 70% warning (Spec 6.2) — Wednesday evening ---
    // Pazartesi'den o ana kadar tüketilen kaloriler haftalık bütçenin %70'ini geçmişse uyar.
    if (dayOfWeek === 3) { // Wednesday
      for (const profile of profiles as { id: string; home_timezone?: string; active_timezone?: string; weekly_calorie_budget: number | null }[]) {
        const localH = getUserLocalHour(profile);
        if (localH < 19 || localH > 21) continue;
        const weeklyBudget = profile.weekly_calorie_budget;
        if (!weeklyBudget || weeklyBudget <= 0) continue;

        try {
          // Avoid duplicate this week
          const thisWeekStart = new Date();
          const dow = thisWeekStart.getDay();
          const mondayOffset = dow === 0 ? -6 : 1 - dow;
          thisWeekStart.setDate(thisWeekStart.getDate() + mondayOffset);
          thisWeekStart.setHours(0, 0, 0, 0);

          const { count: alreadySent } = await supabaseAdmin
            .from('coaching_messages')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id)
            .eq('trigger_type','weekly_budget_70')
            .gte('created_at', thisWeekStart.toISOString());
          if ((alreadySent ?? 0) > 0) continue;

          // Sum daily_reports.calorie_actual since Monday
          const { data: weekReports } = await supabaseAdmin
            .from('daily_reports')
            .select('calorie_actual')
            .eq('user_id', profile.id)
            .gte('date', thisWeekStart.toISOString().split('T')[0]);
          const consumed = ((weekReports ?? []) as { calorie_actual: number }[])
            .reduce((s, r) => s + (r.calorie_actual ?? 0), 0);
          const pct = consumed / weeklyBudget;
          if (pct < 0.70) continue;

          const remaining = Math.max(0, weeklyBudget - consumed);
          const daysLeft = 7 - 3; // Thu, Fri, Sat, Sun
          const perDay = Math.round(remaining / daysLeft);
          await insertCoachingMessage({
            user_id: profile.id,
            trigger_type: 'weekly_budget_70',
            priority: 'medium',
            // FIX (final sweep): aksansız → proper Turkish, meaning unchanged.
            content: `Haftalık bütçenin %${Math.round(pct * 100)}'i tükendi (${consumed}/${weeklyBudget} kcal). Kalan 4 güne ${perDay} kcal/gün düşerse dengede kalırsın.`,
          });
          totalSent++;
        } catch { /* non-critical */ }
      }
    }

    // --- Weekend drift warning (Spec 5.14, 14.1) — Friday morning ---
    // If last 4 weeks show weekend compliance 15+ points below weekday, send proactive nudge.
    if (dayOfWeek === 5) { // Friday
      for (const profile of profiles as { id: string; home_timezone?: string; active_timezone?: string }[]) {
        const localH = getUserLocalHour(profile);
        if (localH < 8 || localH > 11) continue;

        try {
          // Avoid double-sending this week
          const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
          const { count: alreadySent } = await supabaseAdmin
            .from('coaching_messages')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id)
            .eq('trigger_type','weekend_drift')
            .gte('created_at', weekAgo);
          if ((alreadySent ?? 0) > 0) continue;

          const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
          const { data: reports } = await supabaseAdmin
            .from('daily_reports')
            .select('date, compliance_score')
            .eq('user_id', profile.id)
            .gte('date', fourWeeksAgo);
          if (!reports || reports.length < 14) continue;

          const weekdayScores: number[] = [];
          const weekendScores: number[] = [];
          for (const r of reports as { date: string; compliance_score: number }[]) {
            const dow = new Date(r.date).getDay();
            // FIX (AI-behaviour #16): Friday (5) was bucketed as WEEKEND, which both diluted the
            // weekend signal and made weekday-specific drift ("her cuma/pazartesi") unreachable.
            if (dow === 0 || dow === 6) weekendScores.push(r.compliance_score);
            else weekdayScores.push(r.compliance_score);
          }
          if (weekendScores.length < 4 || weekdayScores.length < 8) continue;

          const avgWeekday = weekdayScores.reduce((s, v) => s + v, 0) / weekdayScores.length;
          const avgWeekend = weekendScores.reduce((s, v) => s + v, 0) / weekendScores.length;
          const gap = avgWeekday - avgWeekend;
          if (gap < 15) continue;

          await insertCoachingMessage({
            user_id: profile.id,
            trigger_type: 'weekend_drift',
            priority: 'medium',
            // FIX (final sweep): aksansız → proper Turkish, meaning unchanged.
            content: `Son 4 hafta sonu ortalama %${Math.round(avgWeekend)} uyum, hafta içi %${Math.round(avgWeekday)}. Bu hafta sonu için küçük bir plan yapalım mı? Cuma akşamı hafif yersen cumartesi öğle daha rahat olur.`,
          });
          totalSent++;
        } catch { /* non-critical */ }
      }
    }

    // --- Inactivity re-engagement (Spec 10.1) — 3/7/30-day silent user check ---
    // Looks at last chat_messages OR meal_log (whichever is more recent) and fires
    // at exactly 3, 7, 30 days to avoid spamming. Tone escalates by gap length.
    for (const profile of profiles as { id: string; home_timezone?: string; active_timezone?: string }[]) {
      const localH = getUserLocalHour(profile);
      if (localH < 10 || localH > 12) continue;

      try {
        const [lastChatRes, lastMealRes] = await Promise.all([
          supabaseAdmin.from('chat_messages')
            .select('created_at').eq('user_id', profile.id).eq('role', 'user')
            .order('created_at', { ascending: false }).limit(1).maybeSingle(),
          supabaseAdmin.from('meal_logs')
            .select('logged_at').eq('user_id', profile.id).eq('is_deleted', false)
            .order('logged_at', { ascending: false }).limit(1).maybeSingle(),
        ]);
        const lastActivity = Math.max(
          lastChatRes.data ? new Date(lastChatRes.data.created_at as string).getTime() : 0,
          lastMealRes.data ? new Date(lastMealRes.data.logged_at as string).getTime() : 0,
        );
        if (lastActivity === 0) continue; // brand-new user, skip

        const daysSilent = Math.floor((Date.now() - lastActivity) / 86400000);
        // Only fire at exactly 3, 7, or 30 — not every day after
        const tier = daysSilent === 3 ? 'short' : daysSilent === 7 ? 'medium' : daysSilent === 30 ? 'long' : null;
        if (!tier) continue;

        // Dedupe: one re-engagement per tier per 60d
        const sixtyAgo = new Date(Date.now() - 60 * 86400000).toISOString();
        const { count: alreadySent } = await supabaseAdmin
          .from('coaching_messages')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .eq('trigger_type',`reengagement_${tier}`)
          .gte('created_at', sixtyAgo);
        if ((alreadySent ?? 0) > 0) continue;

        let message = '';
        if (tier === 'short') {
          message = '3 gündür kayıt yok — her şey yolunda mı? Küçük bir kayıt bile ivmeyi korur.';
        } else if (tier === 'medium') {
          // Reference past wins if any
          const { data: achievements } = await supabaseAdmin
            .from('achievements').select('achievement_type').eq('user_id', profile.id).limit(3);
          // FIX (final sweep): aksansız → proper Turkish, meaning unchanged.
          const winRef = (achievements?.length ?? 0) > 0 ? ` ${achievements?.length} başarı kazanmışsın, bunu kaybetme.` : '';
          message = `Bir haftadır konuşmadık.${winRef} Tek bir öğün kaydıyla geri dönebiliriz, baskı yok.`;
        } else {
          message = 'Bir ay oldu. Bugün sadece bir su veya bir kayıt. O kadar. Nereden devam edelim?';
        }

        // FIX (adversarial): the gate's result was discarded, so a SUPPRESSED nudge still fired a
        // push and still incremented totalSent — reintroducing the phantom-push bug the main loop
        // explicitly guards against ("never push a message that was not stored").
        const reIns = await insertCoachingMessage({
          user_id: profile.id,
          trigger_type: `reengagement_${tier}`,
          priority: tier === 'long' ? 'medium' : 'low',
          content: message,
        });
        if (!reIns.ok) continue;

        // Push notification (folded in from the former parallel re-engagement loop)
        // FIX (final sweep): push titles are user-visible — aksansız → proper Turkish.
        const reengageTitle = tier === 'short' ? 'Seni özledik!'
          : tier === 'medium' ? 'Bir haftadır görmüyoruz'
          : 'Yeniden başlayalım mı?';
        try {
          await sendPushNotification(profile.id, reengageTitle, message, { type: 'reengagement', tier });
        } catch { /* push non-critical */ }

        totalSent++;
      } catch { /* non-critical */ }
    }

    // --- Periodic state end transition (Spec 9) — morning check ---
    // If user's periodic_state_end is 3 days away, send a gentle transition heads-up.
    // If state has already ended, auto-clear and resume.
    // FIX (final sweep): user-facing TR labels for the periodic_state enum — the end-message
    // interpolated the RAW enum ("busy_work donemin bitti"). Shared by both the end and the
    // 3-day-warning paths; extended with the enum values the old inline ternary chain missed.
    const PERIODIC_STATE_LABELS: Record<string, string> = {
      ramadan: 'Ramazan',
      illness: 'Hastalık dönemi',
      pregnancy: 'Hamilelik',
      travel: 'Seyahat',
      holiday: 'Tatil',
      busy_work: 'Yoğun iş dönemi',
      exam: 'Sınav dönemi',
      injury: 'Sakatlık dönemi',
      custom: 'Özel dönem',
    };
    for (const profile of profiles as { id: string; home_timezone?: string; active_timezone?: string; periodic_state: string | null; periodic_state_end: string | null }[]) {
      if (!profile.periodic_state) continue;
      const localH = getUserLocalHour(profile);
      if (localH < 8 || localH > 10) continue;

      try {
        // Auto-end: clear periodic_state when end date has passed
        if (profile.periodic_state_end && new Date(profile.periodic_state_end) < new Date()) {
          // Snapshot period summary to ai_summary.seasonal_notes BEFORE clearing state
          // (Spec 9: gecmis donem hafizasi for reference in next similar period)
          try {
            const { data: startProfile } = await supabaseAdmin
              .from('profiles').select('periodic_state_start, weight_kg').eq('id', profile.id).maybeSingle();
            const startDate = (startProfile?.periodic_state_start as string | null) ?? null;
            const currentWeight = (startProfile?.weight_kg as number | null) ?? null;

            if (startDate) {
              // Average compliance during period
              const { data: periodReports } = await supabaseAdmin
                .from('daily_reports').select('compliance_score')
                .eq('user_id', profile.id)
                .gte('date', startDate)
                .lte('date', profile.periodic_state_end);
              const reports = (periodReports ?? []) as { compliance_score: number }[];
              const avgCompliance = reports.length > 0
                ? Math.round(reports.reduce((s, r) => s + r.compliance_score, 0) / reports.length)
                : null;

              // Start weight
              const { data: startWeight } = await supabaseAdmin
                .from('daily_metrics').select('weight_kg').eq('user_id', profile.id)
                .gte('date', startDate).not('weight_kg', 'is', null)
                .order('date').limit(1).maybeSingle();
              const weightDelta = (currentWeight !== null && startWeight?.weight_kg)
                ? +(currentWeight - (startWeight.weight_kg as number)).toFixed(1)
                : null;

              const year = new Date().getFullYear();
              const summary = `[${profile.periodic_state}_${year}] ${startDate}-${profile.periodic_state_end}${weightDelta !== null ? `, kilo degisim ${weightDelta > 0 ? '+' : ''}${weightDelta}kg` : ''}${avgCompliance !== null ? `, ortalama uyum %${avgCompliance}` : ''}.`;

              const { data: existing } = await supabaseAdmin
                .from('ai_summary').select('seasonal_notes').eq('user_id', profile.id).maybeSingle();
              const prev = (existing?.seasonal_notes as string) ?? '';
              await supabaseAdmin.rpc('ai_summary_merge', {
                p_user_id: profile.id,
                p_patch: { seasonal_notes: prev ? `${prev}\n${summary}` : summary },
              }).then(() => {}, () => {});
            }
          } catch { /* snapshot non-critical */ }

          await supabaseAdmin.from('profiles').update({
            periodic_state: null,
            periodic_state_start: null,
            periodic_state_end: null,
          }).eq('id', profile.id);

          // Auto-resume paused challenges (mirrors periodic_state_update 'none')
          await supabaseAdmin.from('challenges').update({
            status: 'active', paused_at: null,
          }).eq('user_id', profile.id).eq('status', 'paused').then(() => {}, () => {});

          // FIX (final sweep): raw enum leaked to the user ("busy_work donemin bitti") — use the
          // shared TR label map + proper Turkish copy.
          const endLabel = PERIODIC_STATE_LABELS[profile.periodic_state] ?? profile.periodic_state;
          await insertCoachingMessage({
            user_id: profile.id,
            trigger_type: 'periodic_end',
            priority: 'medium',
            content: `${endLabel} bitti. Normal plana dönüyoruz — duraklatılmış challenge'lar yeniden aktif.`,
          });
          totalSent++;
          continue;
        }

        // Heads-up: 3 days before end
        if (profile.periodic_state_end) {
          const daysUntilEnd = Math.floor((new Date(profile.periodic_state_end).getTime() - Date.now()) / 86400000);
          if (daysUntilEnd !== 3) continue;

          // Dedupe
          const { count: alreadySent } = await supabaseAdmin
            .from('coaching_messages')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id)
            .eq('trigger_type','periodic_transition_3d')
            .gte('created_at', new Date(Date.now() - 4 * 86400000).toISOString());
          if ((alreadySent ?? 0) > 0) continue;

          // FIX (final sweep): reuse the shared TR label map (covers busy_work/exam/injury/custom
          // which the old inline chain leaked raw) + proper Turkish copy.
          const stateLabel = PERIODIC_STATE_LABELS[profile.periodic_state] ?? profile.periodic_state;

          const advice = profile.periodic_state === 'ramadan'
            ? 'Sonraki 3 günde normal öğün saatlerine geç, IF\'yi kademeli yeniden etkinleştirelim.'
            : profile.periodic_state === 'illness'
            ? 'Sonraki 3 günde hafif antrenmanla geri başlayıp, kalori hedefine yavaş yaklaşalım.'
            : 'Sonraki 3 günde normal rutine kademeli dönüş planlayalım.';

          await insertCoachingMessage({
            user_id: profile.id,
            trigger_type: 'periodic_transition_3d',
            priority: 'medium',
            content: `${stateLabel} 3 gün sonra bitiyor. ${advice}`,
          });
          totalSent++;
        }
      } catch { /* non-critical */ }
    }

    // --- Habit introduction + auto-stacking (Spec 5.35) — morning once per day ---
    // Sequence of habits in order of difficulty. We introduce the first one once
    // the user has been active for ≥3 days (enough to start tracking). Subsequent
    // habits are stacked when prior habit hits ≥80% compliance for 2 weeks.
    // AI-behaviour #14: ONE catalog, shared with the chat coach (shared/habits.ts). This array used
    // to live here only, which is how cron and chat ended up with two habit vocabularies.
    const HABIT_SEQUENCE = HABIT_CATALOG;
    for (const profile of profiles as { id: string; home_timezone?: string; active_timezone?: string }[]) {
      const localH = getUserLocalHour(profile);
      if (localH < 8 || localH > 10) continue;

      try {
        // Check if we already introduced a habit today
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const { count: alreadyIntroduced } = await supabaseAdmin
          .from('coaching_messages')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .in('trigger_type',['habit_introduce', 'habit_stack'])
          .gte('created_at', dayStart.toISOString());
        if ((alreadyIntroduced ?? 0) > 0) continue;

        const { data: summary } = await supabaseAdmin
          .from('ai_summary').select('habit_progress').eq('user_id', profile.id).maybeSingle();
        // FIX (AI-behaviour #14, identity split): `h.key ?? h.name` was UNDEFINED for chat-created
        // habits (the chat writer used the field `habit`), so the set became {undefined}, no key ever
        // matched, and the cron re-offered "Günlük öğün kaydı" every single morning. Normalise first.
        const habits = ((summary?.habit_progress as unknown[] | null) ?? [])
          .map(normalizeHabitEntry)
          .filter((h): h is NonNullable<typeof h> => h !== null);
        const activeHabitKeys = new Set(habits.filter(h => h.status === 'active' || h.status === 'mastered').map(h => h.key));

        // Find next habit in sequence that isn't active yet
        const nextHabit = HABIT_SEQUENCE.find(h => !activeHabitKeys.has(h.key));
        if (!nextHabit) continue;

        // If no habits yet: introduce the first one after 3+ active days
        if (habits.length === 0) {
          const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];
          const { count: recentLogs } = await supabaseAdmin
            .from('meal_logs').select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id).eq('is_deleted', false)
            .gte('logged_for_date', threeDaysAgo);
          if ((recentLogs ?? 0) < 3) continue;

          await insertCoachingMessage({
            user_id: profile.id,
            trigger_type: 'habit_introduce',
            priority: 'medium',
            // FIX (emülatör bulgusu): aksansız şablon dashboard'da olduğu gibi görünüyordu
            // ("Ilk aliskanlik zamani… Baslayalim mi?") — düzgün Türkçe.
            content: `İlk alışkanlık zamanı: "${nextHabit.label}". ${nextHabit.anchor ? nextHabit.anchor + '. ' : ''}Başlayalım mı? Onaylarsan 2 hafta boyunca bu tek şey odağımız olur.`,
          });
          totalSent++;
          continue;
        }

        // Auto-stack: if the most recent active habit has ≥80% compliance over last 14 days
        const latestActive = habits.filter(h => h.status === 'active')
          .sort((a, b) => (b.completion_log?.length ?? 0) - (a.completion_log?.length ?? 0))[0];
        if (!latestActive) continue;

        const log = latestActive.completion_log ?? [];
        const fourteenAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
        const recent = log.filter(d => d >= fourteenAgo);
        const compliance = (recent.length / 14) * 100;

        if (compliance < 80) continue;

        await insertCoachingMessage({
          user_id: profile.id,
          trigger_type: 'habit_stack',
          priority: 'medium',
          // FIX (final sweep): aksansız → proper Turkish, meaning unchanged.
          content: `"${latestActive.name ?? latestActive.key}" alışkanlığını %${Math.round(compliance)} uyumla 2 haftadır tutturuyorsun. Sıra "${nextHabit.label}" alışkanlığına geldi. ${nextHabit.anchor ? nextHabit.anchor + '. ' : ''}Eklemek ister misin?`,
        });
        totalSent++;
      } catch { /* non-critical */ }
    }

    // --- MVD next-day auto-reset (Spec 6.4) — morning check ---
    // Find any user whose yesterday daily_plan had status='mvd_suspended'. Today's plan
    // is fresh (normal), so send an acknowledgement + link to new plan.
    for (const profile of profiles as { id: string; home_timezone?: string; active_timezone?: string }[]) {
      const localH = getUserLocalHour(profile);
      if (localH < 7 || localH > 10) continue;

      try {
        // #arch (audit day-boundary): daily_plans.date is keyed on the user's EFFECTIVE day, and
        // this reset gates on the user's local morning — so "yesterday" must be the user's local
        // yesterday, not raw UTC yesterday (wrong calendar day for non-UTC+3 users).
        const mvdTz = (profile.active_timezone ?? profile.home_timezone) as string | null;
        const mvdDbh = (profile as { day_boundary_hour?: number | null }).day_boundary_hour ?? null;
        const yesterdayStr = shiftDateString(getEffectiveDateForUser(mvdTz, mvdDbh, now), -1);
        const { data: yMvd } = await supabaseAdmin
          .from('daily_plans')
          .select('id')
          .eq('user_id', profile.id)
          .eq('date', yesterdayStr)
          .eq('status', 'mvd_suspended')
          .maybeSingle();
        if (!yMvd) continue;

        // Dedupe: only once per MVD day
        const dayAgo = new Date(Date.now() - 86400000).toISOString();
        const { count: alreadySent } = await supabaseAdmin
          .from('coaching_messages')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .eq('trigger_type','mvd_reset')
          .gte('created_at', dayAgo);
        if ((alreadySent ?? 0) > 0) continue;

        await insertCoachingMessage({
          user_id: profile.id,
          trigger_type: 'mvd_reset',
          priority: 'low',
          // FIX (final sweep): aksansız → proper Turkish, meaning unchanged.
          content: `Dün MVD modunu kullandın. Bugün normal plana dönüyoruz — yumuşak başlayalım, istersen kayıtları ben yaparım.`,
        });
        totalSent++;
      } catch { /* non-critical */ }
    }

    // --- Weight reminder (Spec 10.1) — 7/14 day inactivity check, morning ---
    for (const profile of profiles as { id: string; home_timezone?: string; active_timezone?: string }[]) {
      const localH = getUserLocalHour(profile);
      if (localH < 8 || localH > 10) continue;

      try {
        const { data: lastWeight } = await supabaseAdmin
          .from('daily_metrics')
          .select('date')
          .eq('user_id', profile.id)
          .not('weight_kg', 'is', null)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!lastWeight) continue;
        const daysSince = Math.floor((Date.now() - new Date(lastWeight.date).getTime()) / 86400000);
        if (daysSince < 7) continue;

        // Avoid re-nudging within 2 days
        const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
        const { count: alreadySent } = await supabaseAdmin
          .from('coaching_messages')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .eq('trigger_type','weight_reminder')
          .gte('created_at', twoDaysAgo);
        if ((alreadySent ?? 0) > 0) continue;

        const msg = daysSince >= 14
          ? `${daysSince} gündür tartıya çıkmadın — tempo için bir kez olsun girsek mi?`
          : `${daysSince} gündür tartı kaydı yok. İki dakikada tartılıp giriş yapar mısın?`;

        await insertCoachingMessage({
          user_id: profile.id,
          trigger_type: 'weight_reminder',
          priority: daysSince >= 14 ? 'medium' : 'low',
          content: msg,
        });
        totalSent++;
      } catch { /* non-critical */ }
    }

    // --- Deload recommendation (Spec 7.5) — Monday morning ---
    // If 5+ weeks of continuous high-intensity training with no deload week,
    // send a proactive recommendation. User replies "evet" -> ai-plan picks up deload context.
    if (dayOfWeek === 1) {
      for (const profile of profiles as { id: string; home_timezone?: string; active_timezone?: string }[]) {
        const localH = getUserLocalHour(profile);
        if (localH < 7 || localH > 10) continue;

        try {
          // Count heavy workouts in last 35 days (5 weeks)
          const fiveWeeksAgo = new Date(Date.now() - 35 * 86400000).toISOString().split('T')[0];
          const { count: heavyCount } = await supabaseAdmin
            .from('workout_logs')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id)
            .eq('intensity', 'high')
            .gte('logged_for_date', fiveWeeksAgo);

          // Heuristic: >=12 high-intensity sessions in 5 weeks = heavy cycle
          if ((heavyCount ?? 0) < 12) continue;

          // Avoid double-sending: check if we already suggested deload this week
          const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
          const { count: alreadySent } = await supabaseAdmin
            .from('coaching_messages')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id)
            .eq('trigger_type','deload_suggestion')
            .gte('created_at', weekAgo);
          if ((alreadySent ?? 0) > 0) continue;

          await insertCoachingMessage({
            user_id: profile.id,
            trigger_type: 'deload_suggestion',
            priority: 'medium',
            // FIX (final sweep): aksansız → proper Turkish, meaning unchanged.
            content: `5+ haftadır yoğun çalışıyorsun (${heavyCount} ağır seans). Bu hafta deload: aynı hareketler %60-70 ağırlık, düşük set. Onaylarsan planı buna göre ayarlayalım.`,
          });
          totalSent++;
        } catch { /* non-critical */ }
      }
    }

    // --- Progressive Overload proactive check (Spec 7.5) — Monday morning ---
    // If user hit target reps in last 2 consecutive compound-lift sessions,
    // suggest +2.5kg for the next session.
    const COMPOUND_LIFTS = ['squat', 'bench_press', 'deadlift', 'overhead_press'];
    const TARGET_REPS = 8;
    if (dayOfWeek === 1) {
      for (const profile of profiles as { id: string; home_timezone?: string; active_timezone?: string; push_token: string | null; notification_prefs: Record<string, unknown> | null }[]) {
        const localH = getUserLocalHour(profile);
        if (localH < 7 || localH > 10) continue;

        // Avoid double-sending: the cron fires hourly across the 7-10 window, so without
        // a guard the SAME progressive_overload nudge is inserted up to 4x/Monday
        // (#R1-M7). Mirror the deload_suggestion guard — once per week per user.
        const poWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const { count: poAlready } = await supabaseAdmin
          .from('coaching_messages')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .eq('trigger_type', 'progressive_overload')
          .gte('created_at', poWeekAgo);
        if ((poAlready ?? 0) > 0) continue;

        for (const lift of COMPOUND_LIFTS) {
          try {
            // Scope to THIS user's sets via the workout_logs parent (strength_sets has no user_id).
            const { data: liftSets } = await supabaseAdmin
              .from('strength_sets')
              .select('reps, weight_kg, created_at, workout_log_id, exercise_name, workout_logs!inner(user_id)')
              .eq('exercise_name', lift)
              .eq('workout_logs.user_id', profile.id)
              .order('created_at', { ascending: false })
              .limit(6);
            if (!liftSets || liftSets.length < 2) continue;

            // Sessions are grouped by workout_log_id; take distinct latest 2
            const sessions: Record<string, { reps: number; weight: number }> = {};
            for (const s of liftSets as { reps: number; weight_kg: number; workout_log_id: string }[]) {
              if (!sessions[s.workout_log_id]) sessions[s.workout_log_id] = { reps: s.reps, weight: s.weight_kg };
              else if (s.weight_kg > sessions[s.workout_log_id].weight) sessions[s.workout_log_id] = { reps: s.reps, weight: s.weight_kg };
            }
            const sessionList = Object.values(sessions).slice(0, 2);
            if (sessionList.length < 2) continue;

            const bothSuccess = sessionList.every(s => s.reps >= TARGET_REPS);
            const sameWeight = sessionList[0].weight === sessionList[1].weight;
            if (bothSuccess && sameWeight) {
              const nextWeight = sessionList[0].weight + 2.5;
              await insertCoachingMessage({
                user_id: profile.id,
                trigger_type: 'progressive_overload',
                priority: 'medium',
                // FIX (final sweep): aksansız → proper Turkish, meaning unchanged.
                content: `${lift}: 2 seanstır ${TARGET_REPS}+ rep tutturuyorsun. Bir sonraki seans ${sessionList[0].weight}kg -> ${nextWeight}kg deneyelim.`,
              });
              totalSent++;
              break; // only one lift per user per Monday
            }
          } catch { /* non-critical */ }
        }
      }
    }

    for (const profile of fleet as { id: string; night_eating_habit: string | null; coach_tone: string; if_active: boolean; periodic_state: string | null; periodic_state_start: string | null; periodic_state_end: string | null; push_token: string | null; notification_prefs: Record<string, unknown> | null; weekly_calorie_budget: number | null; wake_time: string | null; sleep_time: string | null; home_timezone: string | null; active_timezone: string | null }[]) {
      // Per-user local time check — skip if outside their active hours
      const userLocalHour = getUserLocalHour(profile);
      if (!isAppropriateTime({ wake_time: profile.wake_time ?? undefined, sleep_time: profile.sleep_time ?? undefined }, userLocalHour)) continue;

      // Use user's local hour for all time-based logic below
      const hour = userLocalHour;
      const isWakeUp = isWakeUpHour({ wake_time: profile.wake_time ?? undefined }, hour);

      // Max messages per day check — fetch the rows (not just a count) so the
      // LLM context and the post-LLM dupe guard can see what was already sent.
      // #arch (audit day-boundary): count "sent today" against the user's LOCAL day start (the
      // loop already gates on userLocalHour), not raw UTC midnight — else the cap resets mid-day
      // for wide-offset users and the dailyLimit is effectively doubled.
      const nudgeTz = (profile.active_timezone ?? profile.home_timezone) as string | null;
      const { data: sentTodayRows } = await supabaseAdmin
        .from('coaching_messages')
        .select('content, trigger_type')
        .eq('user_id', profile.id)
        .gte('created_at', localDayStartIso(nudgeTz, now));
      const sentToday = (sentTodayRows ?? []) as { content: string; trigger_type: string | null }[];
      const dailyLimit = (profile.notification_prefs?.dailyLimit as number | undefined) ?? 5;
      if (sentToday.length >= dailyLimit) continue;
      const sentTodayContext = sentToday.length > 0
        ? `\nBUGUN ZATEN GONDERILEN MESAJLAR:\n${sentToday.map(m => `- [${m.trigger_type ?? '?'}] ${m.content.slice(0, 90)}`).join('\n')}\nKURAL: Yukaridakilerle ayni veya benzer konuda bugun IKINCI mesaj gonderme — o durumda send:false dondur.`
        : '';

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
      // F2/A12: the nudge context must not act on patterns the user already resolved.
      const patterns = activePatterns<{ type: string; description: string; status?: unknown }>(
        summaryRes.data?.behavioral_patterns as { type: string; description: string; status?: unknown }[] | null);

      // night_eating_habit is free text (e.g. "gece atistirma" / "yok" / "gece yemem").
      // Only flag risk when it describes ACTUAL night eating — exclude negative answers
      // so a "yok"/"yemem" reply doesn't falsely light up the 'Gece riski' nudge context.
      const neh = (profile.night_eating_habit ?? '').toLocaleLowerCase('tr');
      const nightRisk = !!neh
        && !/(yok|yemem|etmem|hayır|hayir|asla|nadiren)/.test(neh)
        && hour >= 21 && hour <= 23;

      // T3.13: Plateau detection for proactive messaging
      let plateauInfo = '';
      if (hour >= 8 && hour <= 10) { // Check once in the morning
        const threeWeeksAgo = new Date(Date.now() - 21 * 86400000).toISOString().split('T')[0];
        const { data: weights } = await supabaseAdmin
          .from('daily_metrics').select('weight_kg, date')
          .eq('user_id', profile.id).gte('date', threeWeeksAgo)
          .not('weight_kg', 'is', null).order('date');
        // #journey: trend-based (first-third vs last-third mean), matching plateau.service.ts.
        // The old max-deviation<=0.3kg gate missed real plateaus and needed >=5 weigh-ins.
        const pr = (weights ?? []) as { weight_kg: number; date: string }[];
        if (pr.length >= 2) {
          const ws = pr.map((w) => w.weight_kg);
          const avg = ws.reduce((s, w) => s + w, 0) / ws.length;
          const k = Math.max(1, Math.floor(ws.length / 3));
          const firstMean = ws.slice(0, k).reduce((s, w) => s + w, 0) / k;
          const lastMean = ws.slice(-k).reduce((s, w) => s + w, 0) / k;
          const netLoss = firstMean - lastMean;
          const spanDays = Math.round((Date.parse(pr[pr.length - 1].date) - Date.parse(pr[0].date)) / 86400000);
          // FIX (audit #8 — wrong-direction): |netLoss| so a user who is GAINING (netLoss negative)
          // isn't mislabeled "plateau/durgun" — that's the off-track tempo signal's job, not plateau.
          if (spanDays >= 12 && Math.abs(netLoss) < 0.3) {
            const weeks = Math.max(1, Math.round(spanDays / 7));
            plateauInfo = ws.length >= 5
              ? `TETIK: PLATEAU - ${weeks} haftadir ${avg.toFixed(1)}kg civarinda durgun (net degisim ${netLoss.toFixed(1)}kg)`
              : `TETIK: PLATEAU (dusuk veri) - ${weeks} haftada kilo ${avg.toFixed(1)}kg civarinda sabit; daha sik tartilmaya tesvik et`;
          }
        }
      }

      // T3.17: Goal tracking + Maintenance band check
      let maintenanceInfo = '';
      let goalTempoInfo = '';
      const { data: activeGoal } = await supabaseAdmin
        .from('goals').select('target_weight_kg, start_weight_kg, goal_type, weekly_rate, target_weeks, created_at, phase_order')
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
            // Check for multi-phase: auto-advance to the phase IMMEDIATELY AFTER the current one.
            // FIX (audit DB-TRG-02): the old `.gt('phase_order', 1)` picked the lowest inactive
            // phase>1, so a user on phase 3 could be moved BACKWARD to phase 2. Anchor on the
            // current active phase_order so we only ever advance forward.
            const { data: nextPhase } = await supabaseAdmin
              .from('goals').select('id, goal_type, phase_label, weekly_rate')
              .eq('user_id', profile.id).eq('is_active', false)
              .gt('phase_order', (activeGoal.phase_order as number | null) ?? 1)
              .order('phase_order').limit(1).maybeSingle();
            if (nextPhase) {
              // FIX (audit AI-INT-02/HIGH): atomic deactivate-current + activate-next in ONE
              // transaction (RPC swap_active_goal). The old two-statement path could leave the
              // user with ZERO active goals if the second update failed.
              const { data: swapped, error: swapErr } = await supabaseAdmin.rpc('swap_active_goal', { p_user: profile.id, p_next_id: nextPhase.id });
              if (swapErr || swapped !== true) {
                console.error('[phase-advance] atomic swap failed', swapErr?.message);
              } else {
                maintenanceInfo += ` | FAZ GECISI: Sonraki faz aktif edildi: ${nextPhase.phase_label ?? nextPhase.goal_type}`;
              }

              // Gradual 7-day calorie transition (ONLY when the atomic swap actually advanced
              // the phase — otherwise we'd shift calories for a phase change that didn't happen).
              if (swapped === true) try {
                const { data: profileCalories } = await supabaseAdmin
                  .from('profiles')
                  .select('calorie_range_rest_min, calorie_range_rest_max, calorie_range_training_min, calorie_range_training_max, tdee_calculated, gender')
                  .eq('id', profile.id)
                  .maybeSingle();
                if (profileCalories && profileCalories.tdee_calculated) {
                  const tdee = profileCalories.tdee_calculated as number;
                  const nextGoal = nextPhase as { goal_type: string; weekly_rate?: number };
                  const nextRate = (nextGoal.weekly_rate as number | null) ?? 0.5;
                  const dailyDelta = Math.round((nextRate * 7700) / 7);
                  let nextCalOffset = nextGoal.goal_type === 'lose_weight' ? -dailyDelta
                    : nextGoal.goal_type === 'gain_weight' || nextGoal.goal_type === 'gain_muscle' ? dailyDelta
                    : 0;
                  // #arch step 14 (SafetyState): never step an amber/red ED user into a deficit phase.
                  if (nextCalOffset < 0 && !(await deficitAllowed(profile.id)).allowed) { nextCalOffset = 0; }
                  // Current ranges
                  const oldRestMin = profileCalories.calorie_range_rest_min as number;
                  const oldRestMax = profileCalories.calorie_range_rest_max as number;
                  const oldTrainMin = profileCalories.calorie_range_training_min as number;
                  const oldTrainMax = profileCalories.calorie_range_training_max as number;
                  // Target ranges for new phase (based on TDEE +/- delta).
                  // F3/C3: ENDPOINTS floor-clamped at the DECISION — the day-by-day interpolator in
                  // ai-plan is a mechanical executor and inherits safety from here (an unclamped
                  // `tdee - delta - 100` endpoint would march a small user under the clinical floor
                  // one seventh at a time).
                  const gFloor = getCalorieFloor((profileCalories.gender as string | null) ?? null);
                  const newRestMin = Math.max(gFloor, tdee + nextCalOffset - 100);
                  const newRestMax = Math.max(newRestMin + 50, tdee + nextCalOffset + 100);
                  const newTrainMin = Math.max(gFloor, tdee + nextCalOffset + 100);
                  const newTrainMax = Math.max(newTrainMin + 50, tdee + nextCalOffset + 300);
                  // Record transition window (markers) + day-1 step through the ONE writer: gated
                  // (a deficit-phase step re-checks SafetyState), ledgered, projected forward.
                  await applyTargetAdjust({
                    userId: profile.id, today,
                    gender: (profileCalories.gender as string | null) ?? null,
                    band: {
                      restMin: Math.round(oldRestMin + (newRestMin - oldRestMin) / 7),
                      restMax: Math.round(oldRestMax + (newRestMax - oldRestMax) / 7),
                      trainingMin: Math.round(oldTrainMin + (newTrainMin - oldTrainMin) / 7),
                      trainingMax: Math.round(oldTrainMax + (newTrainMax - oldTrainMax) / 7),
                    },
                    source: 'proactive_recalc',
                    reason: `Faz geçişi (${nextGoal.goal_type}): 7 günlük kademeli geçiş, hedef ${newRestMin}-${newRestMax} kcal`,
                    profileExtras: {
                      phase_transition_start_date: today,
                      phase_transition_from_rest_min: oldRestMin,
                      phase_transition_from_rest_max: oldRestMax,
                      phase_transition_to_rest_min: newRestMin,
                      phase_transition_to_rest_max: newRestMax,
                    },
                  });
                }
              } catch { /* transition calc non-critical */ }
            } else {
              // #journey: goal reached and NO next phase → AUTO-ENTER maintenance instead of
              // only hinting the LLM. Without this a goal-reaching user stayed on the cutting
              // deficit forever unless they chatted the exact maintenance phrase. Idempotent:
              // skips if already in maintenance. The existing reverse-diet ramp block below
              // then ramps calories toward TDEE weekly.
              try {
                const { data: mProf } = await supabaseAdmin.from('profiles').select('maintenance_mode, periodic_state, tdee_calculated, calorie_range_rest_max').eq('id', profile.id).maybeSingle();
                if (mProf?.maintenance_mode !== true && mProf?.periodic_state !== 'maintenance') {
                  // #journey CRITICAL: raise the band to MAINTENANCE (≈TDEE) at the transition —
                  // the previous code only flipped flags and relied on a reverse-diet ramp that was
                  // unreachable (buried behind adjustAdaptiveDifficulty early-returns), so the band
                  // stayed on the cut and the goal-reacher kept under-eating. Set it here directly.
                  const tdee = (mProf?.tdee_calculated as number | null) ?? (((mProf?.calorie_range_rest_max as number | null) ?? 1800) + 500);
                  const mb = computeMaintenanceBand(tdee); // #arch step 10: single maintenance-band owner (was a copy of ai-chat maintenance_start)
                  // F3/C3 (target-engine): raise to maintenance through the ONE writer — atomic
                  // flags+band, ledgered, and projected onto TODAY AND EVERY LATER plan day (the
                  // old `.eq('date', today)` was the cron-path copy of EYLEM-02: the raise
                  // evaporated tomorrow while the week kept the cut).
                  await applyTargetAdjust({
                    userId: profile.id, today,
                    band: { restMin: mb.restMin, restMax: mb.restMax, trainingMin: mb.trainingMin, trainingMax: mb.trainingMax, weeklyBudget: mb.weeklyBudget },
                    source: 'maintenance_start',
                    reason: `Hedefe ulaşıldı — bakım modu otomatik başlatıldı (~TDEE ${tdee})`,
                    profileExtras: {
                      maintenance_mode: true, maintenance_start_date: today,
                      periodic_state: 'maintenance', periodic_state_start: today,
                    },
                  });
                  // #journey HIGH: convert the active goal to 'maintain' so the NEXT ai-plan /
                  // chat plan stops instructing a deficit toward an already-reached target.
                  await supabaseAdmin.from('goals').update({ goal_type: 'maintain' })
                    .eq('user_id', profile.id).eq('is_active', true);
                  // #journey HIGH: the goal_reached achievement was written ONLY client-side, so
                  // server-detected goal-reachers never got the maintenance retention layer
                  // (milestones, reverse-diet timing). Write it here idempotently.
                  const { data: existingGR } = await supabaseAdmin.from('achievements')
                    .select('id').eq('user_id', profile.id).eq('achievement_type', 'goal_reached').maybeSingle();
                  if (!existingGR) {
                    await supabaseAdmin.from('achievements').insert({
                      user_id: profile.id, achievement_type: 'goal_reached',
                      title: 'HEDEFE ULAŞTIN!', description: 'Tebrikler, hedef kilona ulaştın! Artık bakım dönemi.',
                    });
                  }
                  maintenanceInfo += ` | BAKIM MODU OTOMATIK AKTIF (kalori bakima cikarildi ${mb.dailyTargetMin}-${mb.dailyTargetMax}, hedef=maintain, goal_reached yazildi)`;
                  // FIX (adversarial HIGH — silent irreversible mutation): this block rewrites
                  // maintenance_mode, ALL FOUR calorie_range_* columns, the weekly budget, today's
                  // daily_plans targets and goal_type. The user's ONLY notice was the LLM message
                  // inserted later — which the nudge gate can suppress (prefs/cap), leaving a ~500
                  // kcal target change completely silent. Write an unconditional RECEIPT (exempt from
                  // the gate by RECEIPT_TRIGGERS) so the change can never happen without a notice.
                  await insertCoachingMessage({
                    user_id: profile.id,
                    trigger_type: 'maintenance_auto_started',
                    priority: 'high',
                    content: `Hedef kilona ulaştın — bugünden itibaren bakım moduna geçtim. Günlük kalori aralığın ${mb.dailyTargetMin}-${mb.dailyTargetMax} kcal olarak güncellendi. Devam etmek istemezsen söyle, geri alalım.`,
                  });
                }
              } catch (e) { console.error('[auto-maintenance] failed', (e as Error).message); }
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
                  await insertCoachingMessage({
                    user_id: profile.id,
                    // FIX (final sweep): aksansız → proper Turkish, meaning unchanged.
                    content: 'MİNİ CUT ÖNERİSİ: Hedef kilonun 1.5kg üstündesin. 2-4 haftalık mini cut dönemi önerilir.',
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
            // FIX (audit #8 HIGH — backwards tempo): SIGNED progress in the goal's intended direction.
            // Math.abs made a lose-weight user who GAINED 3kg read as "HIZLI KAYIP" (fast loss). Now a
            // negative signedChange = moving the WRONG way → a gentle off-track nudge, not "too fast".
            const dir = activeGoal.goal_type === 'lose_weight' ? 1
              : (activeGoal.goal_type === 'gain_weight' || activeGoal.goal_type === 'gain_muscle') ? -1 : 0;
            const signedChange = dir === 1 ? goalStartWeight - (latestWeight.weight_kg as number)
              : dir === -1 ? (latestWeight.weight_kg as number) - goalStartWeight : 0;
            if (dir !== 0 && expectedChange > 0) {
              if (signedChange < -0.3) {
                goalTempoInfo = `TETIK: TERS YONDE - hedef ${dir === 1 ? 'kilo verme' : 'kilo alma'} ama ${Math.abs(signedChange).toFixed(1)}kg ters yonde gitti; yargilamadan, nazikce toparlanmaya yonlendir`;
              } else {
                const tempoRatio = signedChange / expectedChange;
                if (tempoRatio < 0.5) {
                  goalTempoInfo = `TETIK: YAVAS TEMPO - hedef haftada ${activeGoal.weekly_rate}kg ama gercek tempo yavas (oran: ${tempoRatio.toFixed(2)})`;
                } else if (tempoRatio > 1.5) {
                  goalTempoInfo = `TETIK: HIZLI ${dir === 1 ? 'KAYIP' : 'ALIM'} - haftada ${(signedChange / weeksElapsed).toFixed(2)}kg, guvenli olmayabilir`;
                }
              }
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
              // FIX (final sweep): aksansız + typo ("Cogul insan") → proper Turkish, meaning unchanged.
              let reinforcementMsg: string;
              if (weeksSinceGoalReached >= 24) {
                reinforcementMsg = '6 aydır hedef kilonda tutunuyorsun! Bu inanılmaz bir başarı. Çoğu insan bunu başaramaz.';
              } else if (weeksSinceGoalReached >= 12) {
                reinforcementMsg = '3 aydır bakım modunda başarılısın. Alışkanlıklarının gücünün kanıtı bu.';
              } else {
                reinforcementMsg = '1 aydır hedef kilonun bandında kalıyorsun — bakım dönemin oturdu demektir.';
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
                await insertCoachingMessage({
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
      if (prof.menstrual_tracking && prof.menstrual_last_period_start && prof.menstrual_cycle_length
          && new Date(prof.menstrual_last_period_start as string).getTime() <= Date.now()) {
        // Guard future/invalid date -> no negative day-of-cycle / bogus transition (#R2-M1).
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
          .select('logged_at')   // meal_logs has logged_at (timestamptz), NOT created_at
          .eq('user_id', profile.id)
          .eq('meal_type', 'snack')
          .eq('is_deleted', false)
          .gte('logged_for_date', fourteenDaysAgo);
        if (snackLogs && snackLogs.length > 0) {
          const tz = (profile.active_timezone ?? profile.home_timezone) as string | undefined;
          const hourCounts: Record<number, number> = {};
          for (const s of snackLogs as { logged_at: string }[]) {
            // logged_at is UTC; getHours() in Deno returns the UTC hour. Convert to
            // the user's local hour so the detected snack window is correct.
            let h: number;
            try {
              h = new Date(new Date(s.logged_at).toLocaleString('en-US', { timeZone: tz ?? 'Europe/Istanbul' })).getHours();
            } catch {
              h = new Date(s.logged_at).getHours();
            }
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

      const context = `Saat: ${hour}:00 (kullanicinin yerel saati) | Koc tonu: ${profile.coach_tone ?? 'balanced'}
${isWakeUp ? 'TETIK: SABAH UYANMA SAATI - Gunaydin mesaji gonder. Bugunun plani, dunku ozet, motivasyon. Kisa ve enerjik ol.' : ''}
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
${await (async () => {
  // Weekend Risk (Spec 5.35) - Friday evening check
  const triggers: string[] = [];
  if (now.getDay() === 5 && hour >= 17 && hour <= 19) {
    // F2/A12: a resolved weekend pattern must stop firing the Friday-evening trigger.
    const bp = activePatterns<{ type: string; description: string; status?: unknown }>(
      summaryRes.data?.behavioral_patterns as { type: string; description: string; status?: unknown }[] | null);
    const weekendPattern = bp.find(p => p.type === 'weekend_deviation' || p.description?.toLowerCase().includes('hafta sonu'));
    if (weekendPattern) {
      triggers.push('TETIK: HAFTA SONU RISKI - gecmiste hafta sonlari sapma egilimi');
    }
  }
  // Habit check (Spec 5.35)
  // FIX (AI-behaviour #14): this gate read `weekly_compliance`, a field NOTHING in the repo ever
  // wrote — so it could never fire and every user stayed pinned to habit #1 forever. Derive the stats
  // from completion_log (shared/habits.ts) so the ladder can finally advance, and normalise identity
  // because three writer generations used key / name / habit interchangeably.
  const rawHabits = (summaryRes.data as Record<string, unknown>)?.habit_progress as unknown[] | null;
  if (rawHabits && rawHabits.length > 0) {
    const todayIso = new Date().toISOString().slice(0, 10);
    const normalized = rawHabits.map(normalizeHabitEntry).filter((h): h is NonNullable<typeof h> => h !== null);
    const activeHabit = normalized.find(h => h.status === 'active');
    if (activeHabit) {
      const st = deriveHabitStats(activeHabit.completion_log, todayIso);
      if (readyForNextHabit(st)) {
        triggers.push(`TETIK: ALISKANLIK ILERLEME - "${activeHabit.name}" ${st.streak} gundur suruyor (%${st.weekly_compliance}), siradaki aliskanligi BUNUN USTUNE ekleyerek oner`);
      } else if (st.broken) {
        triggers.push(`TETIK: ALISKANLIK SERISI KIRILDI - "${activeHabit.name}" son ${st.lastDone ?? '?'} tarihinde yapildi. SUCLAMA YOK; bugun TEK bir kez yapmaya davet et.`);
      }
    }
  }
  // #arch (audit day-boundary): daily_metrics/daily_reports.date are keyed on the user's EFFECTIVE
  // day and these triggers frame on the user's local morning — resolve today/yesterday per user
  // instead of raw UTC, else offset users read the wrong calendar day.
  const recTz = (profile as { active_timezone?: string | null; home_timezone?: string | null }).active_timezone
    ?? (profile as { home_timezone?: string | null }).home_timezone ?? null;
  const recDbh = (profile as { day_boundary_hour?: number | null }).day_boundary_hour ?? null;
  const effToday = getEffectiveDateForUser(recTz, recDbh, now);
  const effYesterday = shiftDateString(effToday, -1);

  // Recovery trigger: high soreness + low sleep
  const { data: todayMetrics } = await supabaseAdmin
    .from('daily_metrics').select('muscle_soreness, sleep_hours')
    .eq('user_id', profile.id).eq('date', effToday).maybeSingle();
  if (todayMetrics?.muscle_soreness === 'severe' && ((todayMetrics?.sleep_hours as number) ?? 8) < 6) {
    triggers.push('TETIK: DINLENME GEREKLI - Kas agrisi yuksek ve uyku yetersiz, bugun hafif aktivite veya dinlenme oner');
  }

  // Binge recovery: yesterday compliance very low
  const { data: yesterdayReport } = await supabaseAdmin
    .from('daily_reports').select('compliance_score')
    .eq('user_id', profile.id).eq('date', effYesterday).maybeSingle();
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
        // FIX (audit AI-PRO-03): emit the trigger text ONLY — do NOT clear state here.
        // This partial clear nulled the three columns but skipped the seasonal_notes
        // snapshot and the paused-challenge resume that the morning block (lines
        // ~455-517) performs. Whichever path fired first won; when this windowed loop
        // won, the period summary + challenge resume were lost permanently. The single
        // full morning block now owns the complete clear (snapshot + null + resume).
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
${motivationDropInfo}
${await (async () => {
  // Service-level predictive risk (sleep debt, injury risk, compliance fatigue)
  try {
    const risk = await getPredictiveRiskContext(profile.id);
    if (risk.prompt && risk.overallRisk !== 'low') {
      return `PREDIKTIF RISK (${risk.overallRisk.toUpperCase()}): ${risk.factors.join(', ')}`;
    }
  } catch { /* non-critical */ }
  return '';
})()}
${await (async () => {
  // Service-level adaptive difficulty context
  try {
    const adapt = await getAdaptiveDifficultyContext(profile.id);
    if (adapt) return adapt;
  } catch { /* non-critical */ }
  return '';
})()}
${sentTodayContext}`;

      interface NudgeResult { send: boolean; message?: string; trigger?: string; priority?: string; }

      let nudgeRc: UsageReceipt | null = null;
      const result = await chatCompletion<NudgeResult>(
        [{ role: 'system', content: NUDGE_PROMPT }, { role: 'user', content: context }],
        { temperature: TEMPERATURE.coaching, maxTokens: 200, jsonMode: true, onReceipt: (r) => { nudgeRc = r; } }
      );
      // #arch step 5 (audit ledger-gap): the per-user proactive LLM call was completely untracked.
      writeTurnLog(profile.id, 'ai-proactive', 'nudge', nudgeRc).then(() => {}, () => {});

      if (result.send && result.message) {
        const { clean } = sanitizeText(result.message);

        // Hard dupe guard: the LLM's trigger label is free text ("3+ gün sessiz"
        // vs "30+ GÜN SESSİZ"), so normalize before comparing; also catch
        // near-identical message bodies. Without this the return-flow trigger
        // re-fired on every hourly run (live: 4x "Seni özledik" in 90 min).
        const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/[^a-zçğıöşü]/g, '');
        const newTrigger = norm(result.trigger ?? 'proactive');
        const newContent = norm(clean).slice(0, 40);
        const isDupe = sentToday.some(m =>
          (newTrigger.length > 3 && norm(m.trigger_type ?? '') === newTrigger)
          || (newContent.length > 10 && norm(m.content).slice(0, 40) === newContent)
        );
        if (isDupe) continue;

        // Insert with push_sent=false; flip to true only after Expo accepts the
        // push (the old optimistic !!push_token wrote true even when the push
        // was suppressed by quiet hours/prefs or failed).
        // FIX (audit DB-CON-01/HIGH): the LLM-derived priority is free text, but
        // coaching_messages.priority has a CHECK in ('low','medium','high'). An off-enum value
        // (e.g. "urgent") made the INSERT fail — and the error was never read, so commitments were
        // still marked followed_up, totalSent incremented, and a PHANTOM push was sent for a
        // message that was never stored. Clamp to the allowed set and skip side-effects on failure.
        const priority = (['low', 'medium', 'high'] as const).includes(result.priority as never)
          ? (result.priority as string) : 'medium';
        const inserted = await insertCoachingMessage({
          user_id: profile.id, content: clean,
          trigger_type: result.trigger ?? 'proactive',
          priority, read: false,
          push_sent: false,
        });
        if (!inserted.ok || !inserted.id) {
          // Suppressed by prefs/cap, or the insert failed — either way skip the push and the
          // commitment follow-up so we never push a message that was not stored.
          console.warn('[proactive] coaching_message not stored (prefs/cap or error) — skipping push & follow-up');
          continue;
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
          const pushed = await sendPushNotification(
            profile.id,
            'Kochko',
            clean,
            { type: result.trigger ?? 'proactive' }
          );
          if (pushed && inserted?.id) {
            await supabaseAdmin.from('coaching_messages')
              .update({ push_sent: true }).eq('id', inserted.id);
          }
        } catch { /* push non-critical */ }
      }
    }

    // T1.38: Auto-trigger daily report for users at day boundary (Spec 8.1).
    // Fleet-wide cron window — use the server UTC hour (per-user `hour` isn't in scope here).
    if ((utcHour >= 4 && utcHour <= 6) || forceDaily) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      for (const profile of profiles as { id: string; home_timezone: string | null; active_timezone: string | null; day_boundary_hour: number | null }[]) {
        // FIX (audit AI-PRO-05): aggregate the report over the USER's effective
        // yesterday, not the raw UTC yesterday. meal_logs.logged_for_date is
        // written on the user's effective day (tz + day_boundary_hour), and
        // generateDailyReport sums meals with eq('logged_for_date', reportDate).
        // For non-UTC+3 / custom-boundary users, 'UTC yesterday' is not their
        // yesterday, so the auto-report aggregated the wrong calendar day.
        const tz = profile.active_timezone ?? profile.home_timezone;
        const effectiveToday = getEffectiveDateForUser(tz, profile.day_boundary_hour, now);
        const reportDate = shiftDateString(effectiveToday, -1);

        // Check if the user's effective-yesterday report already exists
        const { data: existingReport } = await supabaseAdmin
          .from('daily_reports').select('id')
          .eq('user_id', profile.id).eq('date', reportDate).maybeSingle();

        // F2/A6 — NO DATA IS NOT A BAD DAY. The night cron generated a report for every user for
        // every day, including days they never opened the app: 398 of the last 60 days' 424 rows
        // (94%) are zero-compliance rows for days with no meal and no workout. Those zeros are then
        // averaged into weekly adherence and into the capacity-mismatch detector, so a user coming
        // back from holiday is greeted with "%9 uyum" and an apology that the plan is too big for
        // them. It was never too big; they were away.
        //
        // The gate lives HERE and not inside ai-report on purpose: the daily_reports row is this
        // cron's ONLY idempotency marker (`if (!existingReport)`), and the cron runs hourly with a
        // 3-hour window. Refusing to write the row inside ai-report would leave no marker and turn
        // one wasted LLM call per empty day into three.
        let hasDataForReport = true;
        if (!existingReport) {
          const [{ count: mealCount }, { count: workoutCount }, { count: metricCount }] = await Promise.all([
            supabaseAdmin.from('meal_logs').select('id', { count: 'exact', head: true })
              .eq('user_id', profile.id).eq('logged_for_date', reportDate).neq('is_deleted', true),
            supabaseAdmin.from('workout_logs').select('id', { count: 'exact', head: true })
              .eq('user_id', profile.id).eq('logged_for_date', reportDate),
            supabaseAdmin.from('daily_metrics').select('id', { count: 'exact', head: true })
              .eq('user_id', profile.id).eq('date', reportDate),
          ]);
          hasDataForReport = (mealCount ?? 0) > 0 || (workoutCount ?? 0) > 0 || (metricCount ?? 0) > 0;
          if (!hasDataForReport) {
            console.log('[daily_report] skipped — no data for the day', { date: reportDate });
          }
        }

        if (!existingReport && hasDataForReport) {
          // Trigger report generation by calling ai-report function internally
          try {
            const reportUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-report`;
            await fetch(reportUrl, {
              method: 'POST',
              // FIX (audit cron-secret): forward x-cron-secret on the internal
              // ai-report call so the chained report invoke isn't 401'd if a
              // cron-secret guard is configured. CRON_SECRET unset → header
              // value is undefined and the call stays fail-open as before.
              headers: cronHeaders({ 'x-user-id': profile.id }),
              body: JSON.stringify({ report_type: 'daily', date: reportDate }),
            });
          } catch { /* non-critical */ }
        }
      }

      // Spec 13.5: Nightly challenge evaluator — without this, challenges.progress
      // never advanced and status could never reach 'completed' (frozen feature).
      try {
        await evaluateChallenges(yesterdayStr);
      } catch (e) {
        console.error('[ai-proactive] challenge evaluation failed:', (e as Error).message);
      }
    }

    // T1.38: Auto-trigger weekly report on Monday mornings (fleet-wide cron — server UTC hour).
    // FIX (audit cron weekly-report): the old 6-8 UTC window never overlapped any
    // ai-proactive cron (014 fires only at 05:00/10:00/17:00 UTC), so weekly reports
    // were NEVER auto-generated. Align to the daily block (4-6 UTC) so the existing
    // Monday 05:00 cron triggers both; existingWeekly guard keeps it idempotent.
    if (dayOfWeek === 1 && utcHour >= 4 && utcHour <= 6) {
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
              // FIX (audit cron-secret): forward x-cron-secret (see daily branch).
              headers: cronHeaders({ 'x-user-id': profile.id }),
              body: JSON.stringify({ report_type: 'weekly' }),
            });
          } catch { /* non-critical */ }
        }
      }
    }

    return respond({
      processed: profiles.length,
      sent: nudgeStats.inserted,          // actually stored
      suppressed: nudgeStats.suppressed,  // blocked by prefs/cap
      attempted: totalSent,               // trigger sites that fired
    });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});

/**
 * Spec 13.5: Nightly challenge evaluator. For every ACTIVE challenge, score
 * yesterday against target.metric, append {date, value, met} to progress and
 * mark status='completed' (+ achievement + coaching message) when the met-day
 * count reaches duration_days. Idempotent: a day already in progress is skipped.
 */
async function evaluateChallenges(dateStr: string) {
  const { data: challenges } = await supabaseAdmin
    .from('challenges')
    .select('id, user_id, title, target, progress, status, started_at')
    .eq('status', 'active');
  if (!challenges?.length) return;

  const SUGAR_RE = /şeker|seker|tatlı|tatli|çikolata|cikolata|kek\b|kurabiye|baklava|dondurma|gazoz|kola|şekerleme|gofret|waffle|bonbon|jelibon/i;

  for (const ch of challenges as { id: string; user_id: string; title: string; target: Record<string, unknown>; progress: { date: string; value: number; met: boolean }[]; started_at: string }[]) {
    try {
      const target = ch.target ?? {};
      const metric = (target.metric as string) ?? 'manual';
      if (metric === 'manual') continue; // user-defined, not auto-scorable
      const goal = Number(target.goal) || 1;
      const durationDays = Number(target.duration_days) || 7;
      const progress = Array.isArray(ch.progress) ? ch.progress : [];

      // Skip if this day is already scored, or the challenge started after it.
      if (progress.some(p => p.date === dateStr)) continue;
      if (ch.started_at && ch.started_at.split('T')[0] > dateStr) continue;

      let value = 0;
      let met = false;

      if (metric === 'steps') {
        const { data: m } = await supabaseAdmin.from('daily_metrics')
          .select('steps').eq('user_id', ch.user_id).eq('date', dateStr).maybeSingle();
        value = (m?.steps as number | null) ?? 0;
        met = value >= goal;
      } else if (metric === 'water_met') {
        const [{ data: m }, { data: plan }] = await Promise.all([
          supabaseAdmin.from('daily_metrics').select('water_liters').eq('user_id', ch.user_id).eq('date', dateStr).maybeSingle(),
          supabaseAdmin.from('daily_plans').select('water_target_liters').eq('user_id', ch.user_id).eq('date', dateStr).limit(1).maybeSingle(),
        ]);
        value = (m?.water_liters as number | null) ?? 0;
        met = value >= ((plan?.water_target_liters as number | null) ?? 2.5);
      } else if (metric === 'sleep') {
        const { data: m } = await supabaseAdmin.from('daily_metrics')
          .select('sleep_hours').eq('user_id', ch.user_id).eq('date', dateStr).maybeSingle();
        value = (m?.sleep_hours as number | null) ?? 0;
        met = value >= goal;
      } else if (metric === 'workout') {
        const { count } = await supabaseAdmin.from('workout_logs')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', ch.user_id).eq('logged_for_date', dateStr);
        value = count ?? 0;
        met = value >= 1;
      } else if (metric === 'protein_met') {
        // Prefer the daily report's deterministic verdict (generated minutes
        // earlier in this same cron window); fall back to summing items.
        const { data: report } = await supabaseAdmin.from('daily_reports')
          .select('protein_target_met, protein_actual').eq('user_id', ch.user_id).eq('date', dateStr).maybeSingle();
        if (report) {
          value = (report.protein_actual as number | null) ?? 0;
          met = report.protein_target_met === true;
        }
      } else if (metric === 'no_sugar') {
        const { data: logs } = await supabaseAdmin.from('meal_logs')
          .select('id').eq('user_id', ch.user_id).eq('logged_for_date', dateStr).eq('is_deleted', false);
        const ids = (logs ?? []).map((l: { id: string }) => l.id);
        if (ids.length === 0) {
          met = false; // nothing logged → can't verify a sugar-free day
        } else {
          const { data: items } = await supabaseAdmin.from('meal_log_items')
            .select('food_name').in('meal_log_id', ids);
          const sugary = (items ?? []).filter((i: { food_name: string }) => SUGAR_RE.test(i.food_name ?? ''));
          value = sugary.length;
          met = sugary.length === 0;
        }
      } else {
        continue; // unknown metric — leave untouched rather than guess
      }

      const newProgress = [...progress, { date: dateStr, value, met }];
      const metDays = newProgress.filter(p => p.met).length;
      const completed = metDays >= durationDays;

      await supabaseAdmin.from('challenges').update({
        progress: newProgress,
        ...(completed ? { status: 'completed', completed_at: new Date().toISOString() } : {}),
      }).eq('id', ch.id);

      if (completed) {
        await supabaseAdmin.from('achievements').insert({
          user_id: ch.user_id,
          achievement_type: 'challenge',
          title: `Challenge tamamlandı: ${ch.title}`,
          description: `${durationDays} günlük hedefe ulaştın!`,
        });
        await insertCoachingMessage({
          user_id: ch.user_id,
          trigger_type: 'challenge_completed',
          priority: 'high',
          content: `"${ch.title}" challenge'ını tamamladın — ${durationDays} günün ${metDays}'inde hedefi tutturdun. Tebrikler!`,
          read: false,
          push_sent: false,
        });
      }
    } catch (e) {
      console.error(`[ai-proactive] challenge ${ch.id} eval failed:`, (e as Error).message);
    }
  }
}

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

  // 2+ weeks at 85%+ → tighten (Spec 5.34)
  if (reports.length >= 14 && avgAll >= 85) {
    adjustment = 'increase';
  }
  // 1+ week under 70% → revert/widen (Spec 5.34 "Tutturamiyorsan 1 hafta sonra eski seviyeye doner")
  else if (recentScores.length >= 7 && avgRecent < 70) {
    adjustment = 'decrease';
  }

  if (!adjustment) return;

  // #arch step 14 (SafetyState): 'increase' TIGHTENS the band (caps the intake ceiling lower) — skip
  // it for an amber/red ED user. 'decrease' (widen/relax) is always fine and is left to run.
  if (adjustment === 'increase' && !(await deficitAllowed(userId)).allowed) return;

  const factor = adjustment === 'increase' ? 0.05 : -0.05;
  const proteinDelta = adjustment === 'increase' ? 5 : -5;

  const tMin = profile.calorie_range_training_min as number;
  const tMax = profile.calorie_range_training_max as number;
  const rMin = profile.calorie_range_rest_min as number;
  const rMax = profile.calorie_range_rest_max as number;
  const proteinPerKg = (profile.protein_per_kg as number) ?? 1.8;
  const weightKg = (profile.weight_kg as number) ?? 70;
  const minCal = getCalorieFloor(profile.gender as string | null); // owner floor (male 1500)

  // Tighten = narrow range (increase min, decrease max); Widen = opposite
  const newTMin = Math.max(minCal, Math.round(tMin + tMin * factor));
  const newTMax = Math.round(tMax - tMax * factor);
  const newRMin = Math.max(minCal, Math.round(rMin + rMin * factor));
  const newRMax = Math.round(rMax - rMax * factor);
  const newProteinPerKg = Math.max(1.2, Math.round((proteinPerKg + proteinDelta / weightKg) * 100) / 100);

  // Safety: min must be less than max
  if (newTMin >= newTMax || newRMin >= newRMax) return;

  // protein target is derived downstream from protein_per_kg * weight_kg
  // (protein_target_g is not a profiles column — it lives on daily_plans).
  // F3/C3 (target-engine): the one writer — 'increase' (tighten) re-checks SafetyState inside,
  // the band is ledgered, and the change reaches TODAY'S AND FUTURE plan rows instead of waiting
  // for the next projection to happen to pick it up.
  const adjRes = await applyTargetAdjust({
    userId, today: now.toISOString().split('T')[0],
    gender: (profile.gender as string | null) ?? null,
    band: { restMin: newRMin, restMax: newRMax, trainingMin: newTMin, trainingMax: newTMax },
    source: 'proactive_recalc',
    reason: adjustment === 'increase'
      ? `Uyum yüksek (2 hafta ≥%85) — zorluk artırıldı, bant daraltıldı (${newRMin}-${newRMax})`
      : `Uyum düştü (1 hafta <%70) — bant esnetildi (${newRMin}-${newRMax})`,
    profileExtras: { protein_per_kg: newProteinPerKg },
  });
  if (!adjRes.ok || !adjRes.allowed) {
    if (!adjRes.ok) console.error('adjustAdaptiveDifficulty profile update failed:', adjRes.error);
    return; // don't tell the user their targets changed if the write failed (or was refused)
  }

  // Send trigger as coaching message
  const triggerMsg = adjustment === 'increase'
    ? 'TETIK: ZORLUK AYARLANDI - arttirildi'
    : 'TETIK: ZORLUK AYARLANDI - azaltildi';

  await insertCoachingMessage({
    user_id: userId,
    content: adjustment === 'increase'
      ? 'Çıtayı yükseltiyorum: son 2 haftada uyumun %85 üzeri. Kalori aralığını biraz daraltıp protein hedefini artırıyorum.'
      : 'Eski seviyeye dönüyoruz, rahat ol. Bu hafta hedefler biraz esnek olacak — tekrar ritim yakala.',
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
          // F3/C3 (target-engine): the weekly +125 ramp is a RAISE (never gated) but was the last
          // silent band mover — now each step is ledgered and lands on the plan week immediately.
          await applyTargetAdjust({
            userId, today: now.toISOString().split('T')[0],
            band: { restMin: newMin, restMax: newMax },
            source: 'proactive_recalc',
            reason: `Reverse diet: hafta ${weeksSinceGoal + 1}/4 — bant +125 kcal (${newMin}-${newMax})`,
          });
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

/** User's current local hour from their timezone; falls back to Turkey UTC+3. */
function userLocalHour(activeTz: string | null, homeTz: string | null): number {
  const tz = activeTz ?? homeTz;
  if (tz) {
    try {
      return new Date(new Date().toLocaleString('en-US', { timeZone: tz })).getHours();
    } catch { /* invalid tz, fall through */ }
  }
  return (new Date().getUTCHours() + 3) % 24;
}

// (Removed duplicate 2-arg isQuietHour — the timezone-aware 3-arg version above is the single
//  source of truth. The old 2-arg version used server UTC time and, being declared later,
//  silently shadowed the 3-arg one so the `hour` argument at the call sites was ignored.)

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
    .select('push_token, notification_prefs, home_timezone, active_timezone')
    .eq('id', userId)
    .maybeSingle();

  if (!profile?.push_token) return false;

  const prefs = (profile.notification_prefs as Record<string, unknown>) ?? {};

  // Check if notifications are enabled
  if (prefs.enabled === false) return false;

  // Spec 10.2: respect the per-type toggles the user set in
  // Ayarlar > Bildirimler — data.type carries the trigger key (e.g.
  // 'reengagement'). Previously only the master switch was honored, so a
  // disabled type still pushed.
  const notifType = (data?.type as string | undefined) ?? null;
  const types = (prefs.types as Record<string, unknown> | undefined) ?? undefined;
  if (notifType && types && types[notifType] === false) return false;

  // Daily push cap: dailyLimit counts pushes actually delivered today (rows
  // with push_sent=true), so loops that bypass the main nudge gate can't spam.
  const dailyLimit = (prefs.dailyLimit as number | undefined) ?? 5;
  // #arch (audit day-boundary): window the cap on the user's LOCAL day start, not raw UTC midnight
  // — otherwise wide-offset users' cap resets mid-day and they get ~2x the pushes.
  const pushTz = (profile.active_timezone ?? profile.home_timezone) as string | null;
  const { count: pushedToday } = await supabaseAdmin
    .from('coaching_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('push_sent', true)
    .gte('created_at', localDayStartIso(pushTz, new Date()));
  if ((pushedToday ?? 0) >= dailyLimit) return false;

  // Check quiet hours in the user's local timezone (not server UTC)
  const quietStart = (prefs.quietStart as string) ?? '23:00';
  const quietEnd = (prefs.quietEnd as string) ?? '07:00';
  const localHour = userLocalHour(profile.active_timezone as string | null, profile.home_timezone as string | null);
  if (isQuietHour(quietStart, quietEnd, localHour)) return false;

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

    // FIX (audit HIGH — dead tokens counted as delivered forever): Expo returns HTTP 200 with a
    // PER-TICKET status, so `response.ok` reported success even when the ticket said
    // DeviceNotRegistered (app uninstalled / token rotated). Those rows were then marked
    // push_sent=true, which both corrupted the daily-cap accounting and kept us pushing at a dead
    // device indefinitely. Parse the ticket: only 'ok' counts, and purge a permanently-dead token.
    if (!response.ok) return false;
    let ticket: { status?: string; details?: { error?: string } } | null = null;
    try {
      const body = await response.json();
      ticket = Array.isArray(body?.data) ? body.data[0] : (body?.data ?? null);
    } catch { return false; } // unreadable body → don't claim delivery
    if (ticket?.status === 'ok') return true;
    const err = ticket?.details?.error;
    // FIX (adversarial): InvalidCredentials is a PROJECT-level Expo error (our FCM/APNs key is wrong
    // or expired) returned identically for EVERY recipient — purging on it would null push_token for
    // every user the cron touched. It is an ops alert, not a per-user fact. Only DeviceNotRegistered
    // means this device is gone. The compare-and-set on push_token also prevents nulling a token that
    // was refreshed by the app between our send and this write.
    if (err === 'DeviceNotRegistered') {
      await supabaseAdmin.from('profiles').update({ push_token: null })
        .eq('id', userId).eq('push_token', profile.push_token)
        .then(() => console.warn('[push] purged dead token', { userId }), () => {});
    } else if (err === 'InvalidCredentials') {
      console.error('[push] EXPO CREDENTIALS INVALID — project-level, tokens NOT purged. Rotate FCM/APNs key.', { status: ticket?.status });
    } else {
      console.warn('[push] ticket not ok', { userId, status: ticket?.status, err });
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * THE single gate for every in-app nudge write (audit #7 HIGH).
 *
 * ~20 specialised trigger paths used to `insert()` into coaching_messages DIRECTLY, so they
 * bypassed BOTH the user's notification preferences (a user who switched notifications OFF still
 * accumulated in-app nudges — there was no in-app opt-out anywhere) AND any daily cap (the
 * advertised "max 2-3 nudge/gün" contract was fiction; each path only de-duped against itself,
 * so deload + overload + habit + weight + weekend + snack could all land on the same day).
 *
 * Every write now goes through here: master switch → per-type toggle → local-day in-app cap.
 * `priority: 'high'` bypasses the CAP (not the switches) so a genuinely important coaching message
 * is never silently dropped behind six low-value nudges.
 *
 * Returns the inserted row id so callers can flip push_sent after a delivered push.
 */
/**
 * trigger_type → the notification-preference key the USER actually sees in Ayarlar > Bildirimler.
 *
 * FIX (adversarial): the per-type opt-out was DEAD for 18 of 19 call sites because it compared the
 * raw internal `trigger_type` against `prefs.types`, which is a different, client-fixed vocabulary
 * (DEFAULT_PREFS in src/services/notifications.service.ts:51-63). Only 'weight_reminder' happened to
 * collide. sendPushNotification proves the intended contract is a TRANSLATION, not the raw enum.
 * Unmapped triggers are intentionally left UN-gated (fail open) so a newly-added trigger is never
 * silently muted by a missing entry.
 */
const TRIGGER_TO_PREF: Record<string, string> = {
  snack_hour_nudge: 'night_risk',
  night_eating_risk: 'night_risk',
  motivation_dip: 'reengagement',
  alcohol_next_day: 'daily_report',
  weekly_budget_70: 'weekly_report',
  weekend_drift: 'weekly_report',
  reengagement: 'reengagement',
  reengagement_soft: 'reengagement',
  reengagement_medium: 'reengagement',
  reengagement_hard: 'reengagement',
  periodic_end: 'morning_plan',
  periodic_transition_3d: 'morning_plan',
  habit_introduce: 'morning_plan',
  habit_stack: 'morning_plan',
  mvd_reset: 'morning_plan',
  weight_reminder: 'weight_reminder',
  deload_suggestion: 'workout_reminder',
  progressive_overload: 'workout_reminder',
  mini_cut_suggestion: 'morning_plan',
  reinforcement_milestone: 'achievement',
  challenge_completed: 'challenge',
  commitment_followup: 'commitment_followup',
};

/** Coaching nudges the daily cap governs. System RECEIPTS (a target changed, a recalc happened) are
 *  NOT nudges — they must neither consume the coaching budget nor be blocked by it. */
const RECEIPT_TRIGGERS = new Set([
  'caffeine_water_bump', 'tdee_recalculated', 'activity_level_recalibrated',
  'maintenance_auto_started', 'plan_projected',
]);

/** Honest per-request nudge tallies (reset at the top of the handler). */
const nudgeStats = { inserted: 0, suppressed: 0 };

/**
 * F2/A2 — per-invocation safety snapshot cache. The nudge cron walks the whole fleet in one
 * invocation, so loading a user's allergens/injuries once and reusing it across that user's
 * trigger sites keeps the gate to two indexed reads per user instead of two per message.
 */
const safetyCache = new Map<string, UserSafetySnapshot>();
async function safetyFor(userId: string): Promise<UserSafetySnapshot> {
  const hit = safetyCache.get(userId);
  if (hit) return hit;
  const snap = await loadUserSafety(userId);
  safetyCache.set(userId, snap);
  return snap;
}

async function insertCoachingMessage(payload: Record<string, unknown>): Promise<{ ok: boolean; id: string | null }> {
  const userId = payload.user_id as string | undefined;
  if (!userId) return { ok: false, id: null };
  const type = (payload.trigger_type as string | undefined) ?? null;

  // F2/A2 — THE SAFETY GATE, at the one funnel every coaching message passes through.
  // Until now ai-proactive imported exactly one thing from guardrails (sanitizeText), so a nudge
  // could recommend a food this user is severely allergic to and it went straight to the lock
  // screen: no conversation, no chance to object. A notification cannot be argued with, so a
  // violation HOLDS the message entirely rather than appending a warning to it.
  try {
    const text = `${payload.title ?? ''} ${payload.content ?? ''}`.trim();
    if (text) {
      const verdict = gateUserText(text, await safetyFor(userId), 'push');
      if (!verdict.ok) {
        console.warn('[nudge_gate] held — constraint violation in outgoing message', {
          trigger: type, flags: verdict.flags, matched: verdict.matched.slice(0, 3),
        });
        nudgeStats.suppressed++;
        return { ok: false, id: null };
      }
    }
  } catch (e) {
    // A gate that throws must not silently pass unchecked text to a phone.
    console.error('[nudge_gate] scan failed — holding the message:', (e as Error).message);
    nudgeStats.suppressed++;
    return { ok: false, id: null };
  }
  // System receipts are exempt from BOTH the switches and the cap: telling the user their calorie
  // target changed is not a nudge, and silently withholding it is worse than an extra card.
  const isReceipt = type ? RECEIPT_TRIGGERS.has(type) : false;
  try {
    if (!isReceipt) {
      const { data: prof } = await supabaseAdmin
        .from('profiles').select('notification_prefs, home_timezone, active_timezone').eq('id', userId).maybeSingle();
      const prefs = (prof?.notification_prefs as Record<string, unknown>) ?? {};
      // In-app cards have their own switch; `enabled` governs PUSH (sendPushNotification already
      // checks it). Only an explicit inAppEnabled:false silences the in-app coaching surface.
      if (prefs.inAppEnabled === false) { nudgeStats.suppressed++; return { ok: false, id: null }; }
      const types = prefs.types as Record<string, unknown> | undefined;
      const prefKey = type ? (TRIGGER_TO_PREF[type] ?? null) : null; // unmapped → un-gated (fail open)
      if (prefKey && types && types[prefKey] === false) { nudgeStats.suppressed++; return { ok: false, id: null }; }
      if (payload.priority !== 'high') {
        const tz = (prof?.active_timezone ?? prof?.home_timezone) as string | null;
        const cap = Number(prefs.inAppDailyLimit ?? prefs.dailyLimit ?? 5);
        // Scope the cap to NUDGES — receipts must not consume the coaching budget.
        const { data: todayRows } = await supabaseAdmin
          .from('coaching_messages').select('trigger_type')
          .eq('user_id', userId).gte('created_at', localDayStartIso(tz, new Date())).limit(50);
        const nudgeCount = (todayRows ?? []).filter(
          (r: { trigger_type: string | null }) => !(r.trigger_type && RECEIPT_TRIGGERS.has(r.trigger_type))).length;
        if (Number.isFinite(cap) && cap > 0 && nudgeCount >= cap) { nudgeStats.suppressed++; return { ok: false, id: null }; }
      }
    }
  } catch (e) {
    // Prefs unreadable (transient) → fail OPEN and log. These are in-app cards, not phone buzzes;
    // silently dropping ALL coaching on a transient read error is the worse failure.
    console.warn('[nudge] prefs/cap check failed, inserting anyway:', (e as Error).message);
  }
  const { data, error } = await supabaseAdmin.from('coaching_messages').insert(payload).select('id').maybeSingle();
  if (error) { console.error('[nudge] insert failed', type, error.message); return { ok: false, id: null }; }
  nudgeStats.inserted++;
  return { ok: true, id: (data?.id as string | undefined) ?? null };
}

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

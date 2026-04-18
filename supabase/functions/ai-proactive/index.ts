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
import { getPredictiveRiskContext, getAdaptiveDifficultyContext } from '../shared/service-contexts.ts';

const NUDGE_PROMPT = `Sen Kochko kocusun. Kullanicinin durumunu degerlendir.
SADECE gercekten gerekli oldugunda mesaj uret. Spam YAPMA.
Samimi, kisa (1-2 cumle), operasyonel ol. Emoji yok.
Gerekli degilse: {"send": false}
Gerekli ise: {"send": true, "message": "mesaj", "trigger": "neden", "priority": "low|medium|high"}`;

serve(async (req: Request) => {
  try {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, gender, night_eating_risk, coach_tone, if_active, if_eating_start, if_eating_end, periodic_state, periodic_state_start, periodic_state_end, push_token, notification_prefs, weekly_calorie_budget, wake_time, sleep_time, work_start, home_timezone, active_timezone')
      .eq('onboarding_completed', true);

    if (!profiles?.length) return respond({ processed: 0, sent: 0 });

    const now = new Date();
    const utcHour = now.getUTCHours();
    const today = now.toISOString().split('T')[0];
    const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday
    let totalSent = 0;

    /**
     * Get user's current local hour based on their timezone.
     * Falls back to UTC+3 (Turkey) if no timezone set.
     */
    function getUserLocalHour(profile: { home_timezone?: string; active_timezone?: string }): number {
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
          .eq('trigger', 'snack_hour_nudge')
          .gte('created_at', dayStart.toISOString());
        if ((alreadySent ?? 0) > 0) continue;

        await supabaseAdmin.from('coaching_messages').insert({
          user_id: profile.id,
          trigger: 'snack_hour_nudge',
          priority: 'low',
          message: `Saat ${match}:00 civarinda atistirma yapma egilimin var. Bir bardak su ic, 5 dakika bekle — istersen o zaman yine degerlendir.`,
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
          .eq('trigger', 'motivation_dip')
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

        await supabaseAdmin.from('coaching_messages').insert({
          user_id: profile.id,
          trigger: 'motivation_dip',
          priority: 'low',
          message: `Son haftada biraz yavasladin — olur boyle donemler, hic sorun degil. Bugun sadece tek sey: bir sey ye ve kaydet. O kadar. Yarin devam ederiz.`,
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
            .eq('trigger', 'alcohol_next_day')
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

          await supabaseAdmin.from('coaching_messages').insert({
            user_id: profile.id,
            trigger: 'alcohol_next_day',
            priority: 'low',
            message: `Gecmiste cuma icki → cumartesi ogun atlama kalibini gorduk. Bugun kahvaltiyi atlamamaya calisalim — protein agirlikli hafif birsey yeter. Su 2 bardak.`,
          });
          totalSent++;

          // Persist pattern to ai_summary so future prompts remember
          await supabaseAdmin.rpc('ai_summary_merge', {
            p_user_id: profile.id,
            p_patch: { alcohol_pattern: `Cuma ickili → cumartesi ogle ogun atlama egilimi (${Math.round((satDipAfterAlcoholCount / friAlcoholCount) * 100)}% ornekte gozlendi).` },
          }).catch(() => {});
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
            .eq('trigger', 'weekly_budget_70')
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
          await supabaseAdmin.from('coaching_messages').insert({
            user_id: profile.id,
            trigger: 'weekly_budget_70',
            priority: 'medium',
            message: `Haftalik butcenin %${Math.round(pct * 100)}'i tukendi (${consumed}/${weeklyBudget} kcal). Kalan 4 gune ${perDay} kcal/gun duserse dengede kalirsin.`,
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
            .eq('trigger', 'weekend_drift')
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
            if (dow === 0 || dow === 5 || dow === 6) weekendScores.push(r.compliance_score);
            else weekdayScores.push(r.compliance_score);
          }
          if (weekendScores.length < 4 || weekdayScores.length < 8) continue;

          const avgWeekday = weekdayScores.reduce((s, v) => s + v, 0) / weekdayScores.length;
          const avgWeekend = weekendScores.reduce((s, v) => s + v, 0) / weekendScores.length;
          const gap = avgWeekday - avgWeekend;
          if (gap < 15) continue;

          await supabaseAdmin.from('coaching_messages').insert({
            user_id: profile.id,
            trigger: 'weekend_drift',
            priority: 'medium',
            message: `Son 4 hafta sonu ortalama %${Math.round(avgWeekend)} uyum, hafta ici %${Math.round(avgWeekday)}. Bu hafta sonu icin kucuk bir plan yapalim mi? Cuma aksami hafif yersen cumartesi ogle daha rahat olur.`,
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
          .eq('trigger', `reengagement_${tier}`)
          .gte('created_at', sixtyAgo);
        if ((alreadySent ?? 0) > 0) continue;

        let message = '';
        if (tier === 'short') {
          message = '3 gundur yoklar — her sey yolunda mi? Kucuk bir kayit bile ivmeyi tutmaya yeter.';
        } else if (tier === 'medium') {
          // Reference past wins if any
          const { data: achievements } = await supabaseAdmin
            .from('achievements').select('type').eq('user_id', profile.id).limit(3);
          const winRef = (achievements?.length ?? 0) > 0 ? ` ${achievements?.length} basari kazanmisin, bunu kaybetme.` : '';
          message = `Bir haftadir konusmadik.${winRef} Tek bir ogun kaydiyla geri donebiliriz, baski yok.`;
        } else {
          message = 'Bir ay oldu. Bugun sadece bir su veya bir kayit. O kadar. Nereden devam edelim?';
        }

        await supabaseAdmin.from('coaching_messages').insert({
          user_id: profile.id,
          trigger: `reengagement_${tier}`,
          priority: tier === 'long' ? 'medium' : 'low',
          message,
        });
        totalSent++;
      } catch { /* non-critical */ }
    }

    // --- Periodic state end transition (Spec 9) — morning check ---
    // If user's periodic_state_end is 3 days away, send a gentle transition heads-up.
    // If state has already ended, auto-clear and resume.
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
              }).catch(() => {});
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
          }).eq('user_id', profile.id).eq('status', 'paused').catch(() => {});

          await supabaseAdmin.from('coaching_messages').insert({
            user_id: profile.id,
            trigger: 'periodic_end',
            priority: 'medium',
            message: `${profile.periodic_state} donemin bitti. Normal plana donuyoruz — duraklatilmis challenge'lar yeniden aktif.`,
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
            .eq('trigger', 'periodic_transition_3d')
            .gte('created_at', new Date(Date.now() - 4 * 86400000).toISOString());
          if ((alreadySent ?? 0) > 0) continue;

          const stateLabel = profile.periodic_state === 'ramadan' ? 'Ramazan'
            : profile.periodic_state === 'illness' ? 'Hastalik donemi'
            : profile.periodic_state === 'pregnancy' ? 'Hamilelik'
            : profile.periodic_state === 'travel' ? 'Seyahat'
            : profile.periodic_state === 'holiday' ? 'Tatil'
            : profile.periodic_state;

          const advice = profile.periodic_state === 'ramadan'
            ? 'Sonraki 3 gunde normal ogun saatlerine gec, IF yi kademeli yeniden etkinlestirelim.'
            : profile.periodic_state === 'illness'
            ? 'Sonraki 3 gunde hafif antrenmanla geri baslayip, kalori hedefine yavas yaklasalim.'
            : 'Sonraki 3 gunde normal rutine kademeli donus planliyalim.';

          await supabaseAdmin.from('coaching_messages').insert({
            user_id: profile.id,
            trigger: 'periodic_transition_3d',
            priority: 'medium',
            message: `${stateLabel} 3 gun sonra bitiyor. ${advice}`,
          });
          totalSent++;
        }
      } catch { /* non-critical */ }
    }

    // --- Habit introduction + auto-stacking (Spec 5.35) — morning once per day ---
    // Sequence of habits in order of difficulty. We introduce the first one once
    // the user has been active for ≥3 days (enough to start tracking). Subsequent
    // habits are stacked when prior habit hits ≥80% compliance for 2 weeks.
    const HABIT_SEQUENCE = [
      { key: 'daily_meal_log', label: 'Gunluk ogun kaydi', anchor: null },
      { key: 'water_tracking', label: 'Su takibi', anchor: 'Her ogun kaydından sonra su ekle' },
      { key: 'weight_tracking', label: 'Tarti kaydi (haftada 3x)', anchor: 'Sabah kalktığında tartıl' },
      { key: 'protein_target', label: 'Protein hedefi', anchor: 'Her ogunde proteini kontrol et' },
      { key: 'sleep_tracking', label: 'Uyku kaydi', anchor: 'Sabah kalktığında uyku gir' },
      { key: 'workout_routine', label: 'Antrenman rutini (haftada 3x)', anchor: 'Antrenman gunu sabah plan kontrol' },
    ];
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
          .in('trigger', ['habit_introduce', 'habit_stack'])
          .gte('created_at', dayStart.toISOString());
        if ((alreadyIntroduced ?? 0) > 0) continue;

        const { data: summary } = await supabaseAdmin
          .from('ai_summary').select('habit_progress').eq('user_id', profile.id).maybeSingle();
        type HabitEntry = { key?: string; name?: string; status: string; streak: number; completion_log?: string[] };
        const habits = ((summary?.habit_progress as HabitEntry[] | null) ?? []);
        const activeHabitKeys = new Set(habits.filter(h => h.status === 'active' || h.status === 'mastered').map(h => h.key ?? h.name));

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

          await supabaseAdmin.from('coaching_messages').insert({
            user_id: profile.id,
            trigger: 'habit_introduce',
            priority: 'medium',
            message: `Ilk aliskanlik zamani: "${nextHabit.label}". ${nextHabit.anchor ? nextHabit.anchor + '. ' : ''}Baslayalim mi? Onaylarsan 2 hafta boyunca bu tek sey odagimiz olur.`,
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

        await supabaseAdmin.from('coaching_messages').insert({
          user_id: profile.id,
          trigger: 'habit_stack',
          priority: 'medium',
          message: `"${latestActive.name ?? latestActive.key}" aliskanligini %${Math.round(compliance)} uyumla 2 haftadir tutturuyorsun — harika! Sira "${nextHabit.label}" aliskanligina geldi. ${nextHabit.anchor ? nextHabit.anchor + '. ' : ''}Eklemek ister misin?`,
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
        const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
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
          .eq('trigger', 'mvd_reset')
          .gte('created_at', dayAgo);
        if ((alreadySent ?? 0) > 0) continue;

        await supabaseAdmin.from('coaching_messages').insert({
          user_id: profile.id,
          trigger: 'mvd_reset',
          priority: 'low',
          message: `Dun MVD modunu kullandin. Bugun normal plana donuyoruz — yumusak baslayalim, istersen kayitlari ben yaparim.`,
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
          .eq('trigger', 'weight_reminder')
          .gte('created_at', twoDaysAgo);
        if ((alreadySent ?? 0) > 0) continue;

        const msg = daysSince >= 14
          ? `${daysSince} gundur tartıya cikmadin — tempo icin bir kez olsun girsek mi?`
          : `${daysSince} gundur tarti yok. Iki dakikada tartılıp giriş yapar misin?`;

        await supabaseAdmin.from('coaching_messages').insert({
          user_id: profile.id,
          trigger: 'weight_reminder',
          priority: daysSince >= 14 ? 'medium' : 'low',
          message: msg,
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
            .eq('trigger', 'deload_suggestion')
            .gte('created_at', weekAgo);
          if ((alreadySent ?? 0) > 0) continue;

          await supabaseAdmin.from('coaching_messages').insert({
            user_id: profile.id,
            trigger: 'deload_suggestion',
            priority: 'medium',
            message: `5+ haftadir yogun calisiyorsun (${heavyCount} agir seans). Bu hafta deload: ayni hareketler %60-70 agirlik, dusuk set. Onaylarsan plani buna gore ayarlayalim.`,
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

        for (const lift of COMPOUND_LIFTS) {
          try {
            const { data: recentSets } = await supabaseAdmin
              .from('strength_sets')
              .select('reps, weight_kg, created_at, workout_log_id')
              .order('created_at', { ascending: false })
              .limit(6);
            if (!recentSets || recentSets.length < 2) continue;

            // Filter rows by exercise name via join (exercise_name is in strength_sets directly)
            const { data: liftSets } = await supabaseAdmin
              .from('strength_sets')
              .select('reps, weight_kg, created_at, workout_log_id, exercise_name')
              .eq('exercise_name', lift)
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
              await supabaseAdmin.from('coaching_messages').insert({
                user_id: profile.id,
                trigger: 'progressive_overload',
                priority: 'medium',
                message: `${lift}: 2 seanstir ${TARGET_REPS}+ rep tutturuyorsun. Bir sonraki seans ${sessionList[0].weight}kg -> ${nextWeight}kg deneyelim.`,
              });
              totalSent++;
              break; // only one lift per user per Monday
            }
          } catch { /* non-critical */ }
        }
      }
    }

    for (const profile of profiles as { id: string; night_eating_risk: boolean; coach_tone: string; if_active: boolean; periodic_state: string | null; periodic_state_start: string | null; periodic_state_end: string | null; push_token: string | null; notification_prefs: Record<string, unknown> | null; weekly_calorie_budget: number | null; wake_time: string | null; sleep_time: string | null; home_timezone: string | null; active_timezone: string | null }[]) {
      // Per-user local time check — skip if outside their active hours
      const userLocalHour = getUserLocalHour(profile);
      if (!isAppropriateTime({ wake_time: profile.wake_time ?? undefined, sleep_time: profile.sleep_time ?? undefined }, userLocalHour)) continue;

      // Use user's local hour for all time-based logic below
      const hour = userLocalHour;
      const isWakeUp = isWakeUpHour({ wake_time: profile.wake_time ?? undefined }, hour);

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
                  // Record transition window so ai-plan can interpolate day-by-day over 7 days
                  await supabaseAdmin.from('profiles').update({
                    phase_transition_start_date: today,
                    phase_transition_from_rest_min: oldRestMin,
                    phase_transition_from_rest_max: oldRestMax,
                    phase_transition_to_rest_min: newRestMin,
                    phase_transition_to_rest_max: newRestMax,
                    // Day-1 step so today's plan already reflects 1/7 nudge
                    calorie_range_rest_min: Math.round(oldRestMin + (newRestMin - oldRestMin) / 7),
                    calorie_range_rest_max: Math.round(oldRestMax + (newRestMax - oldRestMax) / 7),
                    calorie_range_training_min: Math.round(oldTrainMin + (newTrainMin - oldTrainMin) / 7),
                    calorie_range_training_max: Math.round(oldTrainMax + (newTrainMax - oldTrainMax) / 7),
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

  // 2+ weeks at 85%+ → tighten (Spec 5.34)
  if (reports.length >= 14 && avgAll >= 85) {
    adjustment = 'increase';
  }
  // 1+ week under 70% → revert/widen (Spec 5.34 "Tutturamiyorsan 1 hafta sonra eski seviyeye doner")
  else if (recentScores.length >= 7 && avgRecent < 70) {
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

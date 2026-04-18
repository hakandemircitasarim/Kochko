/**
 * Service Contexts for AI Chat System Prompt
 * Edge-function-compatible equivalents of frontend services.
 * Each function queries supabaseAdmin and returns a prompt string (or empty string if n/a).
 */
import { supabaseAdmin } from './supabase-admin.ts';

// ─────────────────────────────────────────────
// 1. HABITS CONTEXT (habits.service.ts)
// ─────────────────────────────────────────────

/**
 * Build habits context from ai_summary.habit_progress.
 * Also returns active habits list for post-response habit detection.
 */
export async function getHabitsContext(userId: string): Promise<{
  prompt: string;
  activeHabits: { name: string; status: string; streak: number; weekly_compliance?: number }[];
}> {
  try {
    const { data } = await supabaseAdmin
      .from('ai_summary').select('habit_progress').eq('user_id', userId).maybeSingle();
    if (!data?.habit_progress) return { prompt: '', activeHabits: [] };

    const habits = data.habit_progress as { name?: string; habit?: string; status: string; streak: number; weekly_compliance?: number; completion_log?: string[] }[];
    const active = habits.filter(h => h.status === 'active');
    const mastered = habits.filter(h => h.status === 'mastered');

    if (active.length === 0 && mastered.length === 0) return { prompt: '', activeHabits: [] };

    const parts: string[] = ['## ALISKANLIK DURUMU'];
    if (active.length > 0) {
      parts.push(`Aktif: ${active.map(h => `"${h.name ?? h.habit}" (${h.streak} gun seri, %${h.weekly_compliance ?? 0} uyum)`).join(', ')}`);
    }
    if (mastered.length > 0) {
      parts.push(`Oturtulmus: ${mastered.map(h => h.name ?? h.habit).join(', ')}`);
    }
    const almostMastered = active.find(h => h.streak >= 12 && h.streak < 14);
    if (almostMastered) {
      parts.push(`"${almostMastered.name ?? almostMastered.habit}" 2 gun sonra oturtulmus sayilacak!`);
    }

    return {
      prompt: parts.join('\n'),
      activeHabits: active.map(h => ({ name: h.name ?? h.habit ?? '', status: h.status, streak: h.streak, weekly_compliance: h.weekly_compliance })),
    };
  } catch {
    return { prompt: '', activeHabits: [] };
  }
}

/**
 * Detect habit completion from a user message (post-response check).
 */
export function checkHabitFromChat(
  message: string,
  activeHabits: { name: string }[]
): { habitName: string; increment: boolean } | null {
  const lower = message.toLocaleLowerCase('tr');

  for (const habit of activeHabits) {
    const habitLower = habit.name.toLocaleLowerCase('tr');
    if (habitLower.includes('ogun') && /yedim|ictim|kahvalt|ogun|kaydet/i.test(lower)) {
      return { habitName: habit.name, increment: true };
    }
    if (habitLower.includes('su') && /su.*(ictim|içtim)|bardak.*su|litre/i.test(lower)) {
      return { habitName: habit.name, increment: true };
    }
    if (habitLower.includes('tarti') && /kilo|tartil|tart[ıi]/i.test(lower)) {
      return { habitName: habit.name, increment: true };
    }
    if (habitLower.includes('protein') && /protein|tavuk|yumurta|yogurt/i.test(lower)) {
      return { habitName: habit.name, increment: true };
    }
    if (habitLower.includes('uyku') && /uyku|uyudum|yattim/i.test(lower)) {
      return { habitName: habit.name, increment: true };
    }
    if (habitLower.includes('antrenman') && /antrenman|egzersiz|spor|kosu/i.test(lower)) {
      return { habitName: habit.name, increment: true };
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// 2. PROGRESSIVE DISCLOSURE (progressive-disclosure.service.ts)
// ─────────────────────────────────────────────

const FEATURE_SCHEDULE: { key: string; minDays: number; introHint: string }[] = [
  { key: 'photo_logging', minDays: 1, introHint: 'Yemek fotografi ile kayit yapabilir' },
  { key: 'eating_out_mode', minDays: 3, introHint: 'Disarida yemek modu — en az hasarli secenekler' },
  { key: 'simulation_mode', minDays: 3, introHint: '"Sunu yesem ne olur?" simülasyonu' },
  { key: 'portion_calibration', minDays: 7, introHint: 'Porsiyon duzeltmeleri ile kisisel tahmin' },
  { key: 'favorite_templates', minDays: 7, introHint: 'Sik yenilen ogunler icin favori sablonlar' },
  { key: 'weekly_budget', minDays: 10, introHint: 'Gunluk degil haftalik kalori butcesi perspektifi' },
  { key: 'strength_tracking', minDays: 14, introHint: 'Agirlik antrenmaninda set-rep-kilo takibi' },
  { key: 'challenge_module', minDays: 21, introHint: 'Kisisel challenge modulu' },
];

export async function getProgressiveDisclosureContext(userId: string): Promise<string> {
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('created_at').eq('id', userId).maybeSingle();
    if (!profile?.created_at) return '';

    const daysSinceSignup = Math.floor((Date.now() - new Date(profile.created_at).getTime()) / 86400000);

    const { data: summary } = await supabaseAdmin
      .from('ai_summary').select('features_introduced').eq('user_id', userId).maybeSingle();
    const introduced = new Set((summary?.features_introduced as string[]) ?? []);

    const toIntroduce = FEATURE_SCHEDULE
      .filter(f => daysSinceSignup >= f.minDays && !introduced.has(f.key))
      .slice(0, 3); // max 3 at a time

    if (toIntroduce.length === 0) return '';

    return `## TANITILMAMIS OZELLIKLER\nDogal sohbette firsati olursa bahset:\n${toIntroduce.map(f => `- ${f.introHint}`).join('\n')}`;
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// 3. RECOVERY CONTEXT (recovery.service.ts)
// ─────────────────────────────────────────────

export async function getRecoveryContext(userId: string): Promise<string> {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get today's calorie total
    const { data: todayLogs } = await supabaseAdmin
      .from('meal_logs').select('id')
      .eq('user_id', userId).eq('logged_for_date', today).eq('is_deleted', false);

    let todayCalories = 0;
    if (todayLogs && todayLogs.length > 0) {
      const logIds = todayLogs.map((l: { id: string }) => l.id);
      const { data: items } = await supabaseAdmin
        .from('meal_log_items').select('calories').in('meal_log_id', logIds);
      todayCalories = (items ?? []).reduce((s, i) => s + ((i.calories as number) ?? 0), 0);
    }

    // Get target from profile
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('calorie_range_rest_min, calorie_range_rest_max').eq('id', userId).maybeSingle();
    const dailyTarget = Math.round(((profile?.calorie_range_rest_min as number ?? 1800) + (profile?.calorie_range_rest_max as number ?? 2200)) / 2);
    const excess = Math.max(0, todayCalories - dailyTarget);

    // Weekly budget remaining
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const { data: weekLogs } = await supabaseAdmin
      .from('meal_logs').select('id').eq('user_id', userId).gte('logged_for_date', weekStartStr).eq('is_deleted', false);
    let weeklyConsumed = 0;
    if (weekLogs && weekLogs.length > 0) {
      const weekLogIds = weekLogs.map((l: { id: string }) => l.id);
      const { data: weekItems } = await supabaseAdmin
        .from('meal_log_items').select('calories').in('meal_log_id', weekLogIds);
      weeklyConsumed = (weekItems ?? []).reduce((s, i) => s + ((i.calories as number) ?? 0), 0);
    }
    const weeklyBudget = dailyTarget * 7;
    const weeklyRemaining = Math.max(0, weeklyBudget - weeklyConsumed);
    const daysLeftInWeek = 7 - new Date().getDay();

    let severity: 'mild' | 'moderate' | 'significant' = 'mild';
    if (excess > 800) severity = 'significant';
    else if (excess > 400) severity = 'moderate';

    // Recovery history (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const { count: recoveryCount } = await supabaseAdmin
      .from('chat_messages').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('task_mode', 'recovery').gte('created_at', thirtyDaysAgo);

    return `## KURTARMA MODU AKTIF
Bugunun fazlasi: ${excess} kcal | Toplam bugun: ${todayCalories} kcal | Hedef: ${dailyTarget} kcal
Haftalik kalan: ${weeklyRemaining} kcal | Haftada ${daysLeftInWeek} gun kaldi
Ciddiyet: ${severity} | Hafta kurtarilabilir: ${weeklyRemaining > 0 || excess < 500 ? 'EVET' : 'HAYIR'}
Son 30 gunde recovery: ${recoveryCount ?? 0} kez

KURALLAR:
1. YARGILAMA. Empati kur, normalize et.
2. Haftalik perspektif ver — bir gun her seyi bozmaz.
3. Gunun kalan kismina mini kurtarma plani sun.
4. Yarin dengeleme stratejisi: gunluk hedeften ${daysLeftInWeek > 0 ? Math.round(excess / daysLeftInWeek) : 0} kcal daha az.
5. ASLA "neden boyle yaptin" deme. ASLA kati diyet onerme.`;
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// 4. RETURN FLOW CONTEXT (return-flow.service.ts)
// ─────────────────────────────────────────────

export async function getReturnFlowContext(userId: string): Promise<string> {
  try {
    const { data: lastMsgs } = await supabaseAdmin
      .from('chat_messages').select('created_at')
      .eq('user_id', userId).eq('role', 'user')
      .order('created_at', { ascending: false }).limit(1);

    const prevMsg = lastMsgs && lastMsgs.length > 0 ? lastMsgs[0] : null;
    if (!prevMsg) return '';

    const daysSince = Math.floor((Date.now() - new Date(prevMsg.created_at).getTime()) / 86400000);
    if (daysSince < 3) return '';

    // Fetch past achievements for reference
    const { data: reports } = await supabaseAdmin
      .from('daily_reports').select('compliance_score')
      .eq('user_id', userId).order('date', { ascending: false }).limit(30);
    const goodDays = (reports ?? []).filter((r: { compliance_score: number }) => r.compliance_score >= 70).length;
    const totalDays = (reports ?? []).length;

    // Fetch last known weight
    const { data: lastWeight } = await supabaseAdmin
      .from('daily_metrics').select('weight_kg')
      .eq('user_id', userId).not('weight_kg', 'is', null)
      .order('date', { ascending: false }).limit(1).maybeSingle();

    let level: string;
    let planLightening: number;
    let needsReOnboarding = false;

    if (daysSince >= 180) {
      level = 'very_long_break';
      planLightening = 30;
      needsReOnboarding = true;
    } else if (daysSince >= 30) {
      level = 'long_break';
      planLightening = 30;
    } else if (daysSince >= 7) {
      level = 'medium_break';
      planLightening = 20;
    } else {
      level = 'short_break';
      planLightening = 0;
    }

    const parts: string[] = [
      `## GERI DONUS MODU`,
      `Son aktivite: ${daysSince} gun once | Seviye: ${level}`,
    ];

    if (lastWeight?.weight_kg) {
      parts.push(`Son bilinen kilo: ${lastWeight.weight_kg} kg`);
    }
    if (goodDays > 0 && totalDays > 0) {
      parts.push(`Gecmis basari: ${goodDays}/${totalDays} gun hedeflerini tutturmustu`);
    }
    if (planLightening > 0) {
      parts.push(`Plan hafifletme: %${planLightening} — ilk 3 gun hedefler dusuruldu`);
    }

    parts.push(`\nKURALLAR:`);
    parts.push(`1. YARGILAMA. "Neredesin?" deme.`);
    parts.push(`2. Sicak ve samimi "hosgeldin" tonu kullan.`);
    parts.push(`3. Gecmis basarilarina referans ver.`);
    parts.push(`4. Ilk 3 gun plan hafifletildi — bunu belirt.`);
    if (needsReOnboarding) {
      parts.push(`5. MINI RE-ONBOARDING gerekli: mevcut kilo, hedef, yasam tarzi guncellemesi sor.`);
    }

    return parts.join('\n');
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// 5. EATING OUT CONTEXT (eating-out.service.ts)
// ─────────────────────────────────────────────

export async function getEatingOutContext(userId: string): Promise<string> {
  try {
    // Get known venues
    const { data: venues } = await supabaseAdmin
      .from('user_venues')
      .select('venue_name, venue_type, learned_items, visit_count')
      .eq('user_id', userId)
      .order('visit_count', { ascending: false })
      .limit(5);

    // Get today's consumption so far
    const today = new Date().toISOString().split('T')[0];
    const { data: todayLogs } = await supabaseAdmin
      .from('meal_logs').select('id')
      .eq('user_id', userId).eq('logged_for_date', today).eq('is_deleted', false);
    let todayCalories = 0;
    if (todayLogs && todayLogs.length > 0) {
      const logIds = todayLogs.map((l: { id: string }) => l.id);
      const { data: items } = await supabaseAdmin
        .from('meal_log_items').select('calories').in('meal_log_id', logIds);
      todayCalories = (items ?? []).reduce((s, i) => s + ((i.calories as number) ?? 0), 0);
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles').select('calorie_range_rest_min, calorie_range_rest_max').eq('id', userId).maybeSingle();
    const dailyTarget = Math.round(((profile?.calorie_range_rest_min as number ?? 1800) + (profile?.calorie_range_rest_max as number ?? 2200)) / 2);
    const remaining = Math.max(0, dailyTarget - todayCalories);

    const parts: string[] = ['## DISARIDA YEMEK MODU AKTIF'];
    parts.push(`Bugun yenilen: ${todayCalories} kcal | Kalan butce: ${remaining} kcal`);

    if (venues && venues.length > 0) {
      parts.push(`\nBILINEN MEKANLAR (${venues.length}):`);
      for (const v of venues.slice(0, 3)) {
        const items = ((v.learned_items as { name: string; calories: number }[]) ?? []).slice(0, 3);
        const itemStr = items.map(i => `${i.name} (~${i.calories}kcal)`).join(', ');
        parts.push(`- ${v.venue_name} (${v.visit_count}x): ${itemStr || 'henuz ogrenilmis yemek yok'}`);
      }
    }

    parts.push(`\nGUN AYARLAMASI: Aksam disarida yemek icin ${Math.round(remaining * 0.6)} kcal ayir. Gun icinde hafif ye.`);
    parts.push(`\nKURALLAR:
1. En az hasarli secenekleri oner
2. Sosyal baski koclugu yap (yargilamadan)
3. Haftalik butce perspektifi ver
4. Porsiyon kontrolu ipuclari ver
5. Mekan biliyorsan gecmis verileri kullan`);

    return parts.join('\n');
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// 6. MVD CONTEXT (mvd.service.ts)
// ─────────────────────────────────────────────

const MVD_GOALS = [
  { id: 'water', title: 'Su ic', desc: 'En az 1 bardak su ic' },
  { id: 'eat', title: 'Bir seyler ye', desc: 'Ne olursa olsun bir ogun ye ve kaydet' },
  { id: 'walk', title: '10 dakika yuru', desc: 'Kisa bir yuruyus yap' },
];

export async function getMVDContext(userId: string): Promise<string> {
  try {
    // Check MVD eligibility signals
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const { data: metrics } = await supabaseAdmin
      .from('daily_metrics').select('mood_score, sleep_hours')
      .eq('user_id', userId).gte('date', sevenDaysAgo)
      .order('date', { ascending: false }).limit(3);

    let eligibilityReason = '';
    if (metrics && metrics.length > 0) {
      const lowMood = (metrics as { mood_score: number | null }[]).filter(m => m.mood_score !== null && m.mood_score <= 2);
      if (lowMood.length >= 2) eligibilityReason = 'Son gunlerde ruh hali dusuk.';
      const poorSleep = (metrics as { sleep_hours: number | null }[]).filter(m => m.sleep_hours !== null && m.sleep_hours < 5);
      if (poorSleep.length >= 3) eligibilityReason = 'Uyku borcu birikti, hafif bir gun iyi olabilir.';
    }

    // Check if MVD already active today
    const today = new Date().toISOString().split('T')[0];
    const { data: plan } = await supabaseAdmin
      .from('daily_plans').select('status')
      .eq('user_id', userId).eq('date', today).maybeSingle();
    const isActive = plan?.status === 'mvd_suspended';

    const parts: string[] = ['## MINIMUM VIABLE DAY MODU'];
    if (isActive) {
      parts.push('MVD bugun AKTIF. Normal plan askida.');
    }
    parts.push(`Basit hedefler: ${MVD_GOALS.map(g => g.title).join(', ')}`);
    if (eligibilityReason) parts.push(`MVD uygunlugu: ${eligibilityReason}`);
    parts.push(`\nKURALLAR:
1. EN YUMUSAK ton. Baskici OLMA.
2. Sadece 3 basit hedef ver. "Bu bile fazla" derse 2'ye veya 1'e indir.
3. Normal plani askiya al, gun icinde basari duygusu olustur.
4. "Bugun zor bir gun, sorun degil" mesaji ver.`);

    return parts.join('\n');
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// 7. PREDICTIVE RISK (predictive.service.ts)
// ─────────────────────────────────────────────

export async function getPredictiveRiskContext(userId: string): Promise<{
  prompt: string;
  overallRisk: 'low' | 'medium' | 'high';
  factors: string[];
}> {
  try {
    const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
    const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    const [reportsRes, metricsRes, mealsThisWeek, mealsPrevWeek, workoutsRes] = await Promise.all([
      supabaseAdmin.from('daily_reports').select('date, compliance_score, calorie_actual, deviation_reason')
        .eq('user_id', userId).gte('date', fourWeeksAgo).order('date'),
      supabaseAdmin.from('daily_metrics').select('date, sleep_hours')
        .eq('user_id', userId).gte('date', twoWeeksAgo).not('sleep_hours', 'is', null),
      supabaseAdmin.from('meal_logs').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('logged_for_date', oneWeekAgo).eq('is_deleted', false),
      supabaseAdmin.from('meal_logs').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('logged_for_date', twoWeeksAgo).lt('logged_for_date', oneWeekAgo).eq('is_deleted', false),
      supabaseAdmin.from('workout_logs').select('duration_min, logged_for_date')
        .eq('user_id', userId).gte('logged_for_date', new Date(Date.now() - 35 * 86400000).toISOString().split('T')[0]),
    ]);

    const reports = (reportsRes.data ?? []) as { date: string; compliance_score: number; calorie_actual: number; deviation_reason: string | null }[];
    const factors: string[] = [];
    const alerts: string[] = [];

    // Weekend risk
    if (reports.length >= 14) {
      const weekdayScores = reports.filter(r => { const d = new Date(r.date).getDay(); return d !== 0 && d !== 6; }).map(r => r.compliance_score);
      const weekendScores = reports.filter(r => { const d = new Date(r.date).getDay(); return d === 0 || d === 6; }).map(r => r.compliance_score);
      if (weekendScores.length >= 4 && weekdayScores.length >= 8) {
        const avgWd = weekdayScores.reduce((s, v) => s + v, 0) / weekdayScores.length;
        const avgWe = weekendScores.reduce((s, v) => s + v, 0) / weekendScores.length;
        if (avgWd - avgWe >= 15) {
          factors.push('weekend_risk');
          alerts.push(`Hafta sonu uyum ${Math.round(avgWd - avgWe)} puan dusuk.`);
        }
      }
    }

    // Motivation drop (logging frequency)
    const thisCount = mealsThisWeek.count ?? 0;
    const prevCount = mealsPrevWeek.count ?? 0;
    if (prevCount > 5 && thisCount < prevCount * 0.6) {
      factors.push('motivation_drop');
      alerts.push(`Kayit sikligi %${Math.round(((prevCount - thisCount) / prevCount) * 100)} azaldi.`);
    }

    // Calorie creep
    if (reports.length >= 14) {
      const half = Math.floor(reports.length / 2);
      const firstHalf = reports.slice(0, half).filter(r => r.calorie_actual > 0);
      const secondHalf = reports.slice(half).filter(r => r.calorie_actual > 0);
      if (firstHalf.length >= 5 && secondHalf.length >= 5) {
        const avg1 = firstHalf.reduce((s, r) => s + r.calorie_actual, 0) / firstHalf.length;
        const avg2 = secondHalf.reduce((s, r) => s + r.calorie_actual, 0) / secondHalf.length;
        if (avg2 > avg1 * 1.05) {
          factors.push('calorie_creep');
          alerts.push(`Kalori kademeli artiyor (${Math.round(avg1)} → ${Math.round(avg2)} kcal/gun).`);
        }
      }
    }

    // Sleep debt
    const metrics = (metricsRes.data ?? []) as { sleep_hours: number }[];
    if (metrics.length >= 7) {
      let debt = 0;
      for (const m of metrics) { const d = 7.5 - m.sleep_hours; if (d > 0) debt += d; }
      if (debt > 10) {
        factors.push('sleep_debt');
        const avg = (metrics.reduce((s, m) => s + m.sleep_hours, 0) / metrics.length).toFixed(1);
        alerts.push(`Uyku borcu: ${debt.toFixed(1)}sa (ort. ${avg}sa/gece).`);
      }
    }

    // Compliance fatigue (3+ weeks declining)
    if (reports.length >= 21) {
      const weeks: number[][] = [];
      for (let i = 0; i < reports.length; i += 7) {
        const slice = reports.slice(i, Math.min(i + 7, reports.length));
        if (slice.length >= 3) weeks.push(slice.map(r => r.compliance_score));
      }
      if (weeks.length >= 3) {
        const avgs = weeks.map(w => w.reduce((s, v) => s + v, 0) / w.length);
        let declines = 0;
        for (let i = 1; i < avgs.length; i++) {
          if (avgs[i - 1] - avgs[i] >= 5) declines++; else declines = 0;
        }
        if (declines >= 2) {
          factors.push('compliance_fatigue');
          alerts.push(`Uyum puani ${declines + 1} haftadir dusuyor.`);
        }
      }
    }

    // Injury risk (workout volume spike)
    const workouts = (workoutsRes.data ?? []) as { duration_min: number; logged_for_date: string }[];
    if (workouts.length >= 8) {
      const thisWeekW = workouts.filter(w => w.logged_for_date >= oneWeekAgo);
      const prevWeeksW = workouts.filter(w => w.logged_for_date < oneWeekAgo);
      const thisVol = thisWeekW.reduce((s, w) => s + w.duration_min, 0);
      const prevAvg = prevWeeksW.length > 0 ? prevWeeksW.reduce((s, w) => s + w.duration_min, 0) / 4 : 0;
      if (prevAvg > 0 && thisVol > prevAvg * 1.3) {
        factors.push('injury_risk');
        alerts.push(`Antrenman hacmi %${Math.round(((thisVol - prevAvg) / prevAvg) * 100)} artti.`);
      }
    }

    // Alcohol risk
    const alcoholDeviations = reports.filter(r => {
      const d = new Date(r.date).getDay();
      return (d === 5 || d === 6) && r.deviation_reason?.includes('alkol');
    }).length;
    if (alcoholDeviations >= 2) {
      factors.push('alcohol_risk');
      alerts.push(`Son 4 haftada ${alcoholDeviations} hafta sonu alkol sapmasi.`);
    }

    const overallRisk: 'low' | 'medium' | 'high' =
      factors.length >= 3 ? 'high' : factors.length >= 1 ? 'medium' : 'low';

    if (factors.length === 0) return { prompt: '', overallRisk: 'low', factors: [] };

    const prompt = `## PREDIKTIF RISK ANALIZI (${overallRisk.toUpperCase()})
${alerts.map(a => `- ${a}`).join('\n')}
Proaktif olarak uyar ve oneri sun. Yargilamadan, destekleyici tonla.`;

    return { prompt, overallRisk, factors };
  } catch {
    return { prompt: '', overallRisk: 'low', factors: [] };
  }
}

// ─────────────────────────────────────────────
// 8. CAFFEINE-SLEEP CORRELATION (caffeine.service.ts)
// ─────────────────────────────────────────────

export async function getCaffeineSleepContext(userId: string): Promise<string> {
  try {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

    const [mealsRes, metricsRes] = await Promise.all([
      supabaseAdmin.from('meal_logs').select('raw_input, created_at, logged_for_date')
        .eq('user_id', userId).gte('logged_for_date', twoWeeksAgo).eq('is_deleted', false),
      supabaseAdmin.from('daily_metrics').select('date, sleep_hours')
        .eq('user_id', userId).gte('date', twoWeeksAgo).not('sleep_hours', 'is', null),
    ]);

    const meals = (mealsRes.data ?? []) as { raw_input: string; created_at: string; logged_for_date: string }[];
    const metrics = (metricsRes.data ?? []) as { date: string; sleep_hours: number }[];

    if (meals.length < 10 || metrics.length < 7) return '';

    const CAFFEINE_KEYWORDS = ['kahve', 'espresso', 'latte', 'cappuccino', 'americano', 'cay', 'enerji', 'red bull', 'monster', 'cola', 'kola'];

    // Find days with late caffeine (after 15:00)
    const lateCaffeineDates = new Set<string>();
    for (const meal of meals) {
      const hour = new Date(meal.created_at).getHours();
      if (hour >= 15) {
        const lower = (meal.raw_input ?? '').toLocaleLowerCase('tr');
        if (CAFFEINE_KEYWORDS.some(kw => lower.includes(kw))) {
          lateCaffeineDates.add(meal.logged_for_date);
        }
      }
    }

    if (lateCaffeineDates.size < 3) return '';

    const lateSleep: number[] = [];
    const noLateSleep: number[] = [];
    for (const m of metrics) {
      if (lateCaffeineDates.has(m.date)) lateSleep.push(m.sleep_hours);
      else noLateSleep.push(m.sleep_hours);
    }

    if (lateSleep.length < 3 || noLateSleep.length < 3) return '';

    const avgLate = lateSleep.reduce((s, v) => s + v, 0) / lateSleep.length;
    const avgNoLate = noLateSleep.reduce((s, v) => s + v, 0) / noLateSleep.length;
    const diff = avgNoLate - avgLate;

    if (diff < 0.5) return '';

    return `## KAFEIN-UYKU KORELASYONU
15:00 sonrasi kafein alinan gunlerde ort. ${avgLate.toFixed(1)}sa uyku, alinmayan gunlerde ${avgNoLate.toFixed(1)}sa. Fark: ${diff.toFixed(1)}sa.
Ogleden sonra kafein uyku kalitesini olumsuz etkiliyor. 14:00'ten sonra kafein sinirlamasini oner.`;
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// 9. ADAPTIVE DIFFICULTY (adaptive-difficulty.service.ts)
// ─────────────────────────────────────────────

export async function getAdaptiveDifficultyContext(userId: string): Promise<string> {
  try {
    const threeWeeksAgo = new Date(Date.now() - 21 * 86400000).toISOString().split('T')[0];
    const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

    const { data: reports } = await supabaseAdmin
      .from('daily_reports').select('date, compliance_score')
      .eq('user_id', userId).gte('date', threeWeeksAgo).order('date');

    if (!reports || reports.length < 10) return '';

    const week1 = (reports as { date: string; compliance_score: number }[]).filter(r => r.date >= twoWeeksAgo && r.date < oneWeekAgo);
    const week2 = (reports as { date: string; compliance_score: number }[]).filter(r => r.date >= oneWeekAgo);

    if (week1.length < 4 || week2.length < 4) return '';

    const avg1 = week1.reduce((s, r) => s + r.compliance_score, 0) / week1.length;
    const avg2 = week2.reduce((s, r) => s + r.compliance_score, 0) / week2.length;

    if (avg1 >= 85 && avg2 >= 85) {
      return `## ADAPTIF ZORLUK
Son 2 hafta uyum: %${Math.round(avg1)} ve %${Math.round(avg2)} — mükemmel!
Citayi yukseltme zamani: kalori araligini %5 daralt, protein hedefini +5g artir.
Kullaniciya "Cok iyi gidiyorsun, hedefleri biraz zorlaştırıyorum" de.`;
    }

    if (avg2 < 60 && avg1 >= 75) {
      return `## ADAPTIF ZORLUK
Bu hafta uyum %${Math.round(avg2)}'e dustu (onceki hafta %${Math.round(avg1)}).
Hedefleri eski seviyeye geri al. "Rahat ol, biraz esnetiyorum" de.`;
    }

    return '';
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// 10. CONFLICT RESOLVER (conflict-resolver.service.ts)
// ─────────────────────────────────────────────

export async function getConflictContext(
  userId: string,
  loggedFoodText?: string
): Promise<string> {
  try {
    const alerts: string[] = [];

    // Get allergens from food_preferences
    if (loggedFoodText) {
      const { data: allergens } = await supabaseAdmin
        .from('food_preferences').select('food_name, allergen_severity')
        .eq('user_id', userId).eq('is_allergen', true);

      if (allergens && allergens.length > 0) {
        const lower = loggedFoodText.toLocaleLowerCase('tr');
        const ALLERGEN_FOODS: Record<string, string[]> = {
          gluten: ['makarna', 'ekmek', 'borek', 'pasta', 'pizza', 'bulgur', 'un', 'simit', 'pogaca'],
          laktoz: ['sut', 'süt', 'peynir', 'yogurt', 'yoğurt', 'dondurma', 'krema'],
          fistik: ['fistik', 'fıstık'],
          yumurta: ['yumurta', 'omlet', 'menemen'],
          balik: ['balik', 'balık', 'somon', 'levrek', 'hamsi'],
        };

        for (const allergen of allergens) {
          const aName = (allergen.food_name as string).toLocaleLowerCase('tr');
          const foods = ALLERGEN_FOODS[aName] ?? [aName];
          for (const food of foods) {
            if (lower.includes(food)) {
              alerts.push(`ALERJEN CELISKISI: "${allergen.food_name}" alerjenin var ama "${food}" iceren yemek girdin. Intoleransin degisti mi sor.`);
            }
          }
        }
      }
    }

    // Goal-behavior mismatch check (2+ weeks data)
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
    const [goalRes, reportsRes, profileRes] = await Promise.all([
      supabaseAdmin.from('goals').select('goal_type').eq('user_id', userId).eq('is_active', true).maybeSingle(),
      supabaseAdmin.from('daily_reports').select('calorie_actual')
        .eq('user_id', userId).gte('date', twoWeeksAgo),
      supabaseAdmin.from('profiles').select('tdee_calculated').eq('id', userId).maybeSingle(),
    ]);

    if (goalRes.data?.goal_type && reportsRes.data && reportsRes.data.length >= 10 && profileRes.data?.tdee_calculated) {
      const goalType = goalRes.data.goal_type as string;
      const reports = reportsRes.data as { calorie_actual: number }[];
      const validReports = reports.filter(r => r.calorie_actual > 0);
      if (validReports.length >= 10) {
        const avgCal = validReports.reduce((s, r) => s + r.calorie_actual, 0) / validReports.length;
        const tdee = profileRes.data.tdee_calculated as number;

        if (goalType === 'lose_weight' && avgCal > tdee * 0.95) {
          alerts.push(`HEDEF-DAVRANIS CELISKISI: Kilo vermek istiyor ama ort. ${Math.round(avgCal)} kcal/gun (TDEE: ${tdee}). Hedef veya plan ayarlanmali mi sor.`);
        } else if (goalType === 'gain_weight' && avgCal < tdee * 1.05) {
          alerts.push(`HEDEF-DAVRANIS CELISKISI: Kilo almak istiyor ama kalori alimi yetersiz (ort. ${Math.round(avgCal)} kcal, TDEE: ${tdee}).`);
        }
      }
    }

    if (alerts.length === 0) return '';

    return `## CELISKILER\n${alerts.join('\n')}`;
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// 11. TRAVEL / TIMEZONE (travel.service.ts)
// ─────────────────────────────────────────────

export async function getTravelContext(userId: string, clientTimezone?: string): Promise<string> {
  try {
    if (!clientTimezone) return '';

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('home_timezone, active_timezone, timezone_changed_at')
      .eq('id', userId).maybeSingle();

    const homeTimezone = (profile?.home_timezone as string) ?? 'Europe/Istanbul';
    const lastActive = (profile?.active_timezone as string) ?? homeTimezone;

    // If client reports a different zone than we have on file, update + mark changed
    if (clientTimezone !== lastActive) {
      await supabaseAdmin.from('profiles').update({
        active_timezone: clientTimezone,
        timezone_changed_at: new Date().toISOString(),
      }).eq('id', userId).catch(() => {});
    }

    if (clientTimezone === homeTimezone) return '';

    // Offset from home
    let offset = 0;
    try {
      const now = new Date();
      const homeStr = now.toLocaleString('en-US', { timeZone: homeTimezone });
      const currentStr = now.toLocaleString('en-US', { timeZone: clientTimezone });
      offset = Math.round((new Date(currentStr).getTime() - new Date(homeStr).getTime()) / 3600000);
    } catch { /* fallback */ }

    if (offset === 0) return '';

    // Grace window: 48h from the timestamp we recorded the change
    const changedAt = (profile?.timezone_changed_at as string | null) ?? null;
    const hoursSinceChange = changedAt
      ? (Date.now() - new Date(changedAt).getTime()) / 3600000
      : 0;
    const jetLagGrace = Math.abs(offset) >= 2 && hoursSinceChange <= 48;

    const parts: string[] = [
      `## SEYAHAT MODU`,
      `Ev: ${homeTimezone} | Simdi: ${clientTimezone} (${offset > 0 ? '+' : ''}${offset} saat)`,
    ];

    if (jetLagGrace) {
      const remaining = Math.max(0, Math.round(48 - hoursSinceChange));
      parts.push(`JET LAG GRACE: Aktif (~${remaining} saat kaldi). Ogun/uyku zamanina ZORLAMA, ±1 saat tolerans.`);
    } else if (Math.abs(offset) >= 2) {
      parts.push(`Jet lag penceresi kapandi — yerel saate tam uyum.`);
    }
    parts.push(`Ogun saatlerini yerel saate gore ayarla.`);
    parts.push(`Bulundugu bolgenin mutfak kulturune uygun oneriler yap.`);

    return parts.join('\n');
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// AGGREGATOR: Get all service contexts at once
// ─────────────────────────────────────────────

export interface ServiceContexts {
  habits: { prompt: string; activeHabits: { name: string }[] };
  progressiveDisclosure: string;
  recovery: string;
  returnFlow: string;
  eatingOut: string;
  mvd: string;
  predictiveRisk: { prompt: string; overallRisk: string; factors: string[] };
  caffeineSleep: string;
  adaptiveDifficulty: string;
  conflicts: string;
  travel: string;
}

/**
 * Fetch all service contexts in parallel for a given user and task mode.
 * Only fetches mode-specific contexts when that mode is active.
 */
export async function getAllServiceContexts(
  userId: string,
  taskMode: string,
  options?: { message?: string; clientTimezone?: string }
): Promise<ServiceContexts> {
  // Always fetch these (lightweight)
  const [habits, progressiveDisclosure, caffeineSleep, adaptiveDifficulty, predictiveRisk, travel, conflicts] = await Promise.all([
    getHabitsContext(userId),
    getProgressiveDisclosureContext(userId),
    getCaffeineSleepContext(userId),
    getAdaptiveDifficultyContext(userId),
    getPredictiveRiskContext(userId),
    getTravelContext(userId, options?.clientTimezone),
    getConflictContext(userId, options?.message),
  ]);

  // Mode-specific contexts (only fetch when relevant)
  let recovery = '';
  let returnFlow = '';
  let eatingOut = '';
  let mvd = '';

  if (taskMode === 'recovery') {
    recovery = await getRecoveryContext(userId);
  }
  // Return flow is detected earlier in index.ts — but we provide richer context
  if (taskMode === 'coaching' || taskMode === 'onboarding') {
    returnFlow = await getReturnFlowContext(userId);
  }
  if (taskMode === 'eating_out') {
    eatingOut = await getEatingOutContext(userId);
  }
  if (taskMode === 'mvd') {
    mvd = await getMVDContext(userId);
  }

  return {
    habits: { prompt: habits.prompt, activeHabits: habits.activeHabits },
    progressiveDisclosure,
    recovery,
    returnFlow,
    eatingOut,
    mvd,
    predictiveRisk: { prompt: predictiveRisk.prompt, overallRisk: predictiveRisk.overallRisk, factors: predictiveRisk.factors },
    caffeineSleep,
    adaptiveDifficulty,
    conflicts,
    travel,
  };
}

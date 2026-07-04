/**
 * Achievement & Streak Service
 * Spec Section 13: Başarı ve motivasyon sistemi
 */
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';

export interface Achievement {
  id: string;
  achievement_type: string;
  title: string;
  description: string | null;
  achieved_at: string;
}

export async function getAchievements(): Promise<Achievement[]> {
  const { data } = await supabase
    .from('achievements')
    .select('*')
    .order('achieved_at', { ascending: false });
  return (data ?? []) as Achievement[];
}

/**
 * Calculate current streak (consecutive days with at least 1 meal log).
 *
 * "Today" is the day-boundary-aware EFFECTIVE date (same definition the server
 * uses when writing logged_for_date) — the old UTC date broke the chain every
 * late evening/early morning depending on the user's timezone. A streak that
 * ends YESTERDAY still counts (today simply hasn't been logged yet).
 */
export async function calculateStreak(userId: string, dayBoundaryHour: number = 4): Promise<number> {
  // #journey: query by DATE WINDOW, not a row LIMIT. .limit(90) counted 90 meal_log
  // ROWS, so a user logging 3-5 meals/day filled the cap at ~18-30 distinct days and the
  // streak silently froze after ~3-4 weeks (streak_100 unreachable). A 200-day window
  // scales with calendar days regardless of meals-per-day.
  const streakCutoff = new Date();
  streakCutoff.setDate(streakCutoff.getDate() - 200);
  const { data } = await supabase
    .from('meal_logs')
    .select('logged_for_date')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .gte('logged_for_date', streakCutoff.toISOString().split('T')[0])
    .order('logged_for_date', { ascending: false });

  if (!data || data.length === 0) return 0;

  const dates = [...new Set((data as { logged_for_date: string }[]).map(d => d.logged_for_date))].sort().reverse();
  const today = getEffectiveDate(new Date(), dayBoundaryHour);

  // Anchor on today if logged, else yesterday (an unbroken run through
  // yesterday shouldn't display as 0 before the user's first log of the day).
  const shift = (dateStr: string, days: number): string => {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
  };
  const anchor = dates[0] === today ? today : shift(today, -1);

  let streak = 0;
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] === shift(anchor, -i)) streak++;
    else break;
  }

  return streak;
}

/**
 * Check and create milestone achievements.
 * Called after weight log or streak update.
 */
export async function checkMilestones(
  userId: string,
  currentWeight: number | null,
  startWeight: number | null,
  targetWeight: number | null,
  streak: number,
  goalType?: string | null,
): Promise<Achievement | null> {
  // Check existing achievements to avoid duplicates
  const { data: existing } = await supabase
    .from('achievements')
    .select('achievement_type')
    .eq('user_id', userId);
  const types = new Set((existing ?? []).map((a: { achievement_type: string }) => a.achievement_type));

  // Collect EVERY unmet milestone whose threshold is currently crossed, evaluated
  // independently (no ascending-order short-circuit), ordered highest-tier first so
  // the returned achievement is the most significant one for the toast.
  const earned: { type: string; title: string; desc: string }[] = [];

  // Weight milestones (highest threshold first). Direction-aware: a gain goal
  // (gain_weight/gain_muscle) progresses UPWARD, so loss-only math never fired its
  // milestones (#R4-7). `progress` = kg moved toward the goal in the right direction.
  if (currentWeight && startWeight) {
    const isGain = goalType === 'gain_weight' || goalType === 'gain_muscle';
    const progress = isGain ? currentWeight - startWeight : startWeight - currentWeight;
    const totalNeeded = targetWeight != null ? Math.abs(startWeight - targetWeight) : null;
    const reachedTarget = targetWeight != null && (isGain ? currentWeight >= targetWeight : currentWeight <= targetWeight);
    const unit = isGain ? 'aldın' : 'verdin';
    if (reachedTarget && !types.has('goal_reached'))
      earned.push({ type: 'goal_reached', title: 'HEDEFE ULAŞTIN!', desc: 'Tebrikler, hedef kilona ulaştın!' });
    if (totalNeeded != null && totalNeeded > 0 && progress >= totalNeeded / 2 && !types.has('half_goal'))
      earned.push({ type: 'half_goal', title: 'Yarı Yolda!', desc: 'Hedefin yarısına ulaştın.' });
    if (progress >= 5 && !types.has('five_kg'))
      earned.push({ type: 'five_kg', title: '5 Kilo!', desc: `5 kg ${unit}, harika iş!` });
    if (progress >= 1 && !types.has('first_kg'))
      earned.push({ type: 'first_kg', title: 'İlk Kilo!', desc: `1 kg ${unit}.` });
  }

  // Streak milestones (highest threshold first)
  if (streak >= 100 && !types.has('streak_100'))
    earned.push({ type: 'streak_100', title: '100 GÜN!', desc: 'İnanılmaz. 100 gün arka arkaya.' });
  if (streak >= 30 && !types.has('streak_30'))
    earned.push({ type: 'streak_30', title: '30 Gün!', desc: '1 ay kesintisiz, muhteşem disiplin.' });
  if (streak >= 7 && !types.has('streak_7'))
    earned.push({ type: 'streak_7', title: '7 Gün Seri!', desc: '1 hafta kesintisiz kayıt.' });

  // Maintenance milestones (Spec 13.2) — highest threshold first
  if (targetWeight && currentWeight && currentWeight <= targetWeight) {
    // Check maintenance duration
    const { data: goalReachedAch } = await supabase
      .from('achievements').select('achieved_at')
      .eq('user_id', userId).eq('achievement_type', 'goal_reached').maybeSingle();
    if (goalReachedAch) {
      const daysSinceGoal = Math.floor((Date.now() - new Date(goalReachedAch.achieved_at).getTime()) / 86400000);
      if (daysSinceGoal >= 180 && !types.has('maintenance_6m'))
        earned.push({ type: 'maintenance_6m', title: '6 Ay Bakımda!', desc: 'Yarım yıl hedef kilonda. Alışkanlığın oturmuş.' });
      if (daysSinceGoal >= 90 && !types.has('maintenance_3m'))
        earned.push({ type: 'maintenance_3m', title: '3 Ay Bakımda!', desc: 'Hedef kilonda 3 aydır devam ediyorsun, muhteşem.' });
      if (daysSinceGoal >= 30 && !types.has('maintenance_1m'))
        earned.push({ type: 'maintenance_1m', title: '1 Ay Bakımda!', desc: 'Hedef kilonda 1 aydır tutunuyorsun.' });
    }
  }

  if (earned.length === 0) return null;

  const { data, error } = await supabase.from('achievements').insert(
    earned.map(a => ({
      user_id: userId,
      achievement_type: a.type,
      title: a.title,
      description: a.desc,
    }))
  ).select();
  if (error) {
    console.warn('checkMilestones insert failed', error);
    return null;
  }

  const rows = (data ?? []) as Achievement[];
  // Return the highest-tier earned achievement (earned[] is ordered top-down) for the toast.
  return rows.find(r => r.achievement_type === earned[0].type) ?? rows[0] ?? null;
}

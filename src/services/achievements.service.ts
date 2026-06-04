/**
 * Achievement & Streak Service
 * Spec Section 13: Başarı ve motivasyon sistemi
 */
import { supabase } from '@/lib/supabase';

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
 */
export async function calculateStreak(userId: string): Promise<number> {
  const { data } = await supabase
    .from('meal_logs')
    .select('logged_for_date')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .order('logged_for_date', { ascending: false })
    .limit(90);

  if (!data || data.length === 0) return 0;

  const dates = [...new Set((data as { logged_for_date: string }[]).map(d => d.logged_for_date))].sort().reverse();
  let streak = 0;
  const today = new Date().toISOString().split('T')[0];

  for (let i = 0; i < dates.length; i++) {
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    const expectedStr = expected.toISOString().split('T')[0];

    if (dates[i] === expectedStr) {
      streak++;
    } else {
      break;
    }
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
  streak: number
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

  // Weight milestones (highest threshold first)
  if (currentWeight && startWeight) {
    const lost = startWeight - currentWeight;
    if (targetWeight && currentWeight <= targetWeight && !types.has('goal_reached'))
      earned.push({ type: 'goal_reached', title: 'HEDEFE ULAŞTIN!', desc: 'Tebrikler, hedef kilona ulaştın!' });
    if (targetWeight && lost >= (startWeight - targetWeight) / 2 && !types.has('half_goal'))
      earned.push({ type: 'half_goal', title: 'Yarı Yolda!', desc: 'Hedefin yarısına ulaştın.' });
    if (lost >= 5 && !types.has('five_kg'))
      earned.push({ type: 'five_kg', title: '5 Kilo!', desc: '5 kg verdin, harika iş!' });
    if (lost >= 1 && !types.has('first_kg'))
      earned.push({ type: 'first_kg', title: 'İlk Kilo!', desc: '1 kg verdin.' });
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

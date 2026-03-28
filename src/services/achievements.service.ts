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

  let newAchievement: { type: string; title: string; desc: string } | null = null;

  // Weight milestones
  if (currentWeight && startWeight) {
    const lost = startWeight - currentWeight;
    if (lost >= 1 && !types.has('first_kg')) newAchievement = { type: 'first_kg', title: 'Ilk Kilo!', desc: '1 kg verdin.' };
    else if (lost >= 5 && !types.has('five_kg')) newAchievement = { type: 'five_kg', title: '5 Kilo!', desc: '5 kg verdin, harika is!' };
    else if (targetWeight && lost >= (startWeight - targetWeight) / 2 && !types.has('half_goal'))
      newAchievement = { type: 'half_goal', title: 'Yari Yolda!', desc: 'Hedefe yarisina ulastin.' };
    else if (targetWeight && currentWeight <= targetWeight && !types.has('goal_reached'))
      newAchievement = { type: 'goal_reached', title: 'HEDEFE ULASTIN!', desc: 'Tebrikler, hedef kilona ulastin!' };
  }

  // Streak milestones
  if (!newAchievement) {
    if (streak >= 7 && !types.has('streak_7')) newAchievement = { type: 'streak_7', title: '7 Gun Seri!', desc: '1 hafta kesintisiz kayit.' };
    else if (streak >= 30 && !types.has('streak_30')) newAchievement = { type: 'streak_30', title: '30 Gun!', desc: '1 ay kesintisiz, muhtesem disiplin.' };
    else if (streak >= 100 && !types.has('streak_100')) newAchievement = { type: 'streak_100', title: '100 GUN!', desc: 'Inanilmaz. 100 gun arka arkaya.' };
  }

  if (newAchievement) {
    const { data } = await supabase.from('achievements').insert({
      user_id: userId,
      achievement_type: newAchievement.type,
      title: newAchievement.title,
      description: newAchievement.desc,
    }).select().single();
    return data as Achievement | null;
  }

  return null;
}

/**
 * Minimum Viable Day Service
 * Spec 6.4: "Bugün hiç istemiyorum" dediğinde
 *
 * Normal planı askıya alır, sadece 3 basit hedef verir.
 * En yumuşak tonu devreye alır. Baskıcı OLMAZ.
 */
import { supabase } from '@/lib/supabase';

export interface MVDGoal {
  id: string;
  title: string;
  description: string;
  icon: string;
  completed: boolean;
}

export interface MVDPlan {
  goals: MVDGoal[];
  message: string;
  level: 1 | 2 | 3; // 3 goals, 2 goals, 1 goal
  suspendedPlanDate: string | null;
}

// ─── Goal Templates ───

const GOAL_TEMPLATES: { id: string; title: string; description: string; icon: string; priority: number }[] = [
  { id: 'water', title: 'Su ic', description: 'En az 1 bardak su ic', icon: 'water', priority: 1 },
  { id: 'eat', title: 'Bir seyler ye', description: 'Ne olursa olsun bir ogun ye ve kaydet', icon: 'food', priority: 2 },
  { id: 'walk', title: '10 dakika yuru', description: 'Kisa bir yuruyus yap, tempo onemli degil', icon: 'walk', priority: 3 },
  { id: 'sleep', title: 'Erken yat', description: 'Bugun erken yatmaya calis', icon: 'sleep', priority: 4 },
  { id: 'log', title: '1 kayit gir', description: 'Herhangi bir sey kaydet (su, yemek, ruh hali)', icon: 'log', priority: 5 },
  { id: 'breathe', title: '5 dakika nefes al', description: 'Derin nefes al, sakinles', icon: 'breathe', priority: 6 },
];

// ─── Core Functions ───

/**
 * Generate MVD goals based on user profile and simplification level.
 * Level 3 = 3 goals (default), Level 2 = 2 goals, Level 1 = 1 goal
 */
export function generateMVDGoals(level: 1 | 2 | 3 = 3): MVDPlan {
  const goalCount = level;
  const selectedGoals = GOAL_TEMPLATES
    .slice(0, goalCount)
    .map(g => ({
      id: g.id,
      title: g.title,
      description: g.description,
      icon: g.icon,
      completed: false,
    }));

  const messages: Record<number, string> = {
    3: 'Bugun zor bir gun. Sorun degil. Sadece su 3 basit hedef yeterli:',
    2: 'Anladim, daha da basit yapalim. Sadece 2 sey:',
    1: 'Tamam, tek bir sey yeterli bugun:',
  };

  return {
    goals: selectedGoals,
    message: messages[goalCount],
    level,
    suspendedPlanDate: new Date().toISOString().split('T')[0],
  };
}

/**
 * Simplify MVD further when user says "bu bile fazla".
 */
export function simplifyMVD(currentPlan: MVDPlan): MVDPlan {
  const newLevel = Math.max(1, currentPlan.level - 1) as 1 | 2 | 3;
  return generateMVDGoals(newLevel);
}

/**
 * Check if MVD is active for today.
 */
export async function isMVDActive(userId: string): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('daily_plans')
    .select('status')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  return data?.status === 'mvd_suspended';
}

/**
 * Suspend today's normal plan and activate MVD.
 */
export async function activateMVD(userId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  // Mark existing plan as suspended
  await supabase
    .from('daily_plans')
    .update({ status: 'mvd_suspended' })
    .eq('user_id', userId)
    .eq('date', today);

  // Store MVD activation for proactive follow-up
  await supabase.from('user_commitments').insert({
    user_id: userId,
    commitment: 'MVD gunu — yarin normal plana don',
    follow_up_at: new Date(Date.now() + 86400000).toISOString(), // tomorrow
    status: 'pending',
  });
}

/**
 * Deactivate MVD and return to normal plan.
 */
export async function deactivateMVD(userId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  await supabase
    .from('daily_plans')
    .update({ status: 'active' })
    .eq('user_id', userId)
    .eq('date', today);
}

/**
 * Mark an MVD goal as completed.
 */
export function completeGoal(plan: MVDPlan, goalId: string): MVDPlan {
  return {
    ...plan,
    goals: plan.goals.map(g => g.id === goalId ? { ...g, completed: true } : g),
  };
}

/**
 * Check MVD eligibility — detect low motivation signals.
 */
export async function checkMVDEligibility(userId: string): Promise<{
  eligible: boolean;
  reason: string | null;
}> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const { data: metrics } = await supabase
    .from('daily_metrics')
    .select('mood_score, sleep_hours')
    .eq('user_id', userId)
    .gte('date', sevenDaysAgo)
    .order('date', { ascending: false })
    .limit(3);

  if (!metrics || metrics.length === 0) return { eligible: false, reason: null };

  // Low mood for 2+ consecutive days
  const lowMood = (metrics as { mood_score: number | null }[]).filter(m => m.mood_score !== null && m.mood_score <= 2);
  if (lowMood.length >= 2) {
    return { eligible: true, reason: 'Son gunlerde ruh halin dusuk gorunuyor.' };
  }

  // Poor sleep for 3+ days
  const poorSleep = (metrics as { sleep_hours: number | null }[]).filter(m => m.sleep_hours !== null && m.sleep_hours < 5);
  if (poorSleep.length >= 3) {
    return { eligible: true, reason: 'Uyku borcun birikti, hafif bir gun iyi olabilir.' };
  }

  return { eligible: false, reason: null };
}

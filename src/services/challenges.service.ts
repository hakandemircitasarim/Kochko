/**
 * Challenge Module Service — Spec 13.5
 * System and custom challenges with progress tracking.
 * Max 2 active at once. Auto-pause on periodic state.
 * Completed challenges → achievements.
 */
import { supabase } from '@/lib/supabase';

export interface ChallengeProgress {
  date: string;
  value: number;
  met: boolean;
}

export interface Challenge {
  id: string;
  title: string;
  description: string | null;
  challenge_type: 'system' | 'custom';
  target: { metric: string; goal: number; period: string; duration_days: number };
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  progress: ChallengeProgress[];
  started_at: string;
  paused_at: string | null;
}

// System-defined challenges (Spec 13.5)
export const SYSTEM_CHALLENGES = [
  {
    title: '7 Gun Seker Yok',
    description: 'Eklenmis seker iceren yiyeceklerden 7 gun uzak dur. Meyve serbest.',
    target: { metric: 'no_sugar', goal: 1, period: 'daily', duration_days: 7 },
  },
  {
    title: '30 Gun 10.000 Adim',
    description: 'Her gun en az 10.000 adim at. Yagmurda da, karda da.',
    target: { metric: 'steps', goal: 10000, period: 'daily', duration_days: 30 },
  },
  {
    title: '14 Gun Protein Hedefi',
    description: '14 gun boyunca gunluk protein hedefini tuttur. Kas koruma icin kritik.',
    target: { metric: 'protein_met', goal: 1, period: 'daily', duration_days: 14 },
  },
  {
    title: '14 Gun Su Hedefi',
    description: '14 gun boyunca su hedefini tamamla. Metabolizma ve tokluk icin onemli.',
    target: { metric: 'water_met', goal: 1, period: 'daily', duration_days: 14 },
  },
  {
    title: '7 Gun Her Gun Antrenman',
    description: '7 gun ust uste her gun en az 1 antrenman yap. Yogunluk onemli degil, tutarlilik onemli.',
    target: { metric: 'workout', goal: 1, period: 'daily', duration_days: 7 },
  },
  {
    title: '21 Gun Kayit Disiplini',
    description: '21 gun boyunca her gun en az 1 ogun kaydi gir. Farkindaligin temeli.',
    target: { metric: 'meal_logged', goal: 1, period: 'daily', duration_days: 21 },
  },
];

export async function getActiveChallenges(): Promise<Challenge[]> {
  const { data } = await supabase
    .from('challenges')
    .select('*')
    .in('status', ['active', 'paused'])
    .order('started_at');
  return (data ?? []) as Challenge[];
}

export async function getCompletedChallenges(limit = 10): Promise<Challenge[]> {
  const { data } = await supabase
    .from('challenges')
    .select('*')
    .in('status', ['completed', 'abandoned'])
    .order('started_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as Challenge[];
}

export async function startChallenge(
  title: string,
  description: string | null,
  target: Challenge['target'],
  type: 'system' | 'custom' = 'system',
): Promise<void> {
  // Max 2 active at once (Spec 13.5)
  const { count } = await supabase
    .from('challenges')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');

  if ((count ?? 0) >= 2) {
    throw new Error('En fazla 2 aktif challenge olabilir. Birini bitir veya birak.');
  }

  await supabase.from('challenges').insert({
    title, description, challenge_type: type, target,
    status: 'active', progress: [],
    started_at: new Date().toISOString(),
  });
}

export async function pauseChallenge(id: string): Promise<void> {
  await supabase.from('challenges').update({
    status: 'paused',
    paused_at: new Date().toISOString(),
  }).eq('id', id);
}

export async function resumeChallenge(id: string): Promise<void> {
  await supabase.from('challenges').update({
    status: 'active',
    paused_at: null,
  }).eq('id', id);
}

export async function abandonChallenge(id: string): Promise<void> {
  await supabase.from('challenges').update({ status: 'abandoned' }).eq('id', id);
}

/**
 * Record daily progress for a challenge.
 * Called by AI proactive function or dashboard daily check.
 */
export async function recordChallengeProgress(
  challengeId: string,
  date: string,
  value: number,
  met: boolean,
): Promise<{ completed: boolean }> {
  const { data } = await supabase.from('challenges').select('progress, target').eq('id', challengeId).single();
  if (!data) return { completed: false };

  const progress = [...((data.progress as ChallengeProgress[]) ?? []), { date, value, met }];
  const target = data.target as Challenge['target'];
  const metDays = progress.filter(p => p.met).length;
  const isComplete = metDays >= target.duration_days;

  await supabase.from('challenges').update({
    progress,
    status: isComplete ? 'completed' : 'active',
  }).eq('id', challengeId);

  return { completed: isComplete };
}

/**
 * Calculate current streak within a challenge.
 */
export function getChallengeStreak(progress: ChallengeProgress[]): number {
  let streak = 0;
  for (let i = progress.length - 1; i >= 0; i--) {
    if (progress[i].met) streak++;
    else break;
  }
  return streak;
}

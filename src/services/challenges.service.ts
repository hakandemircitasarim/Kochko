/**
 * Challenge Module Service
 * Spec 13.5: Challenge modülü
 */
import { supabase } from '@/lib/supabase';

export interface Challenge {
  id: string;
  title: string;
  description: string | null;
  challenge_type: 'system' | 'custom';
  target: { metric: string; goal: number; period: string; duration_days: number };
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  progress: { date: string; value: number; met: boolean }[];
  started_at: string;
}

// System-defined challenges (Spec 13.5)
export const SYSTEM_CHALLENGES = [
  { title: '7 Gun Seker Yok', target: { metric: 'no_sugar', goal: 1, period: 'daily', duration_days: 7 } },
  { title: '30 Gun 10.000 Adim', target: { metric: 'steps', goal: 10000, period: 'daily', duration_days: 30 } },
  { title: '14 Gun Protein Hedefi', target: { metric: 'protein_met', goal: 1, period: 'daily', duration_days: 14 } },
  { title: '14 Gun Su Hedefi', target: { metric: 'water_met', goal: 1, period: 'daily', duration_days: 14 } },
  { title: '7 Gun Her Gun Antrenman', target: { metric: 'workout', goal: 1, period: 'daily', duration_days: 7 } },
];

export async function getActiveChallenges(): Promise<Challenge[]> {
  const { data } = await supabase
    .from('challenges')
    .select('*')
    .in('status', ['active', 'paused'])
    .order('started_at');
  return (data ?? []) as Challenge[];
}

export async function startChallenge(
  title: string,
  description: string | null,
  target: Challenge['target'],
  type: 'system' | 'custom' = 'system'
): Promise<void> {
  // Max 2 active at once (Spec 13.5)
  const { count } = await supabase
    .from('challenges').select('id', { count: 'exact', head: true }).eq('status', 'active');
  if ((count ?? 0) >= 2) {
    throw new Error('En fazla 2 aktif challenge olabilir.');
  }

  await supabase.from('challenges').insert({
    title, description, challenge_type: type, target, status: 'active', progress: [],
  });
}

export async function pauseChallenge(id: string): Promise<void> {
  await supabase.from('challenges').update({ status: 'paused', paused_at: new Date().toISOString() }).eq('id', id);
}

export async function resumeChallenge(id: string): Promise<void> {
  await supabase.from('challenges').update({ status: 'active', paused_at: null }).eq('id', id);
}

export async function abandonChallenge(id: string): Promise<void> {
  await supabase.from('challenges').update({ status: 'abandoned' }).eq('id', id);
}

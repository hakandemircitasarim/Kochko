/**
 * Multi-Phase Goal Service
 * Spec 6.7: Çok fazlı hedef planlaması (cut/bulk döngüsü)
 */
import { supabase } from '@/lib/supabase';

export interface GoalPhase {
  id: string;
  goal_type: string;
  target_weight_kg: number | null;
  target_weeks: number | null;
  phase_order: number;
  phase_label: string | null;
  is_active: boolean;
  created_at: string;
}

/**
 * Get all phases for user's goal plan.
 */
export async function getGoalPhases(userId: string): Promise<GoalPhase[]> {
  const { data } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', userId)
    .order('phase_order');
  return (data ?? []) as GoalPhase[];
}

/**
 * Add a new phase to the multi-phase plan.
 */
export async function addPhase(
  userId: string,
  goalType: string,
  targetWeight: number | null,
  targetWeeks: number,
  phaseLabel: string
): Promise<void> {
  // Get current max phase order
  const { data: existing } = await supabase
    .from('goals')
    .select('phase_order')
    .eq('user_id', userId)
    .order('phase_order', { ascending: false })
    .limit(1)
    .single();

  const nextOrder = ((existing?.phase_order as number) ?? 0) + 1;

  await supabase.from('goals').insert({
    user_id: userId,
    goal_type: goalType,
    target_weight_kg: targetWeight,
    target_weeks: targetWeeks,
    phase_order: nextOrder,
    phase_label: phaseLabel,
    is_active: nextOrder === 1, // only first phase is active initially
    priority: 'sustainable',
    restriction_mode: 'sustainable',
    weekly_rate: targetWeight ? 0.5 : null,
  });
}

/**
 * Activate next phase when current one is complete.
 * Spec 6.7: Otomatik faz geçişi
 */
export async function advanceToNextPhase(userId: string): Promise<GoalPhase | null> {
  // Deactivate current
  const { data: current } = await supabase
    .from('goals')
    .select('phase_order')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  if (!current) return null;

  const currentOrder = current.phase_order as number;
  await supabase.from('goals').update({ is_active: false }).eq('user_id', userId).eq('phase_order', currentOrder);

  // Activate next
  const { data: next } = await supabase
    .from('goals')
    .update({ is_active: true })
    .eq('user_id', userId)
    .eq('phase_order', currentOrder + 1)
    .select()
    .single();

  return next as GoalPhase | null;
}

/**
 * Delete a phase.
 */
export async function deletePhase(phaseId: string): Promise<void> {
  await supabase.from('goals').delete().eq('id', phaseId);
}

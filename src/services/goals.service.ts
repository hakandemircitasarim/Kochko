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
  try {
    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', userId)
      .order('phase_order');
    if (error) { console.error('getGoalPhases error:', error.message); return []; }
    return (data ?? []) as GoalPhase[];
  } catch (err) {
    console.error('getGoalPhases unexpected error:', err);
    return [];
  }
}

/**
 * Add a new phase to the multi-phase plan.
 */
export async function addPhase(
  userId: string,
  goalType: string,
  targetWeight: number | null,
  targetWeeks: number,
  phaseLabel: string,
  // When set, forces the new row's is_active. The single-goal "replace" path
  // (settings/goals.tsx) passes true — it deactivates the old goal then expects
  // THIS one active. Left undefined for the multi-phase append path, where only
  // phase 1 starts active (later phases activate via auto-transition).
  active?: boolean,
): Promise<void> {
  // Get current max phase order
  const { data: existing } = await supabase
    .from('goals')
    .select('phase_order')
    .eq('user_id', userId)
    .order('phase_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = ((existing?.phase_order as number) ?? 0) + 1;

  // Snapshot current weight as the phase start weight — the dashboard's goal
  // progress math (lib/goal-progress.ts via dashboard.store) needs a FIXED
  // baseline; without it progress reads 0% / "Durmus" forever.
  const { data: profile } = await supabase
    .from('profiles')
    .select('weight_kg')
    .eq('id', userId)
    .maybeSingle();
  const startWeight = (profile?.weight_kg as number | null) ?? null;

  // Derive weekly_rate from the real target/timeline instead of a hardcoded 0.5.
  const weeklyRate = targetWeight && startWeight && targetWeeks > 0
    ? Math.round((Math.abs(startWeight - targetWeight) / targetWeeks) * 100) / 100
    : targetWeight ? 0.5 : null;

  // FIX (ux-pass5): supabase-js REDDETMEZ, {error} ile resolve eder — insert sonucu atılıyordu,
  // RLS/constraint/ağ hatası sessizce void dönüp çağıranlara "başarı" okutuyordu. deletePhase
  // deseniyle throw: her iki çağıran da (settings/goals.tsx handleSave, multi-phase-goals.tsx
  // handleAdd) zaten try/catch ile sarıyor.
  const { error } = await supabase.from('goals').insert({
    user_id: userId,
    goal_type: goalType,
    target_weight_kg: targetWeight,
    target_weeks: targetWeeks,
    phase_order: nextOrder,
    phase_label: phaseLabel,
    is_active: active ?? (nextOrder === 1), // explicit flag wins; else only first phase active
    priority: 'sustainable',
    restriction_mode: 'sustainable',
    start_weight_kg: startWeight,
    weekly_rate: weeklyRate,
  });
  if (error) {
    console.error('addPhase error:', error.message);
    throw new Error(error.message);
  }
}

/**
 * Activate next phase when current one is complete.
 * Spec 6.7: Otomatik faz geçişi
 */
export async function advanceToNextPhase(userId: string): Promise<GoalPhase | null> {
  try {
    // Current active phase
    const { data: current, error: currentError } = await supabase
      .from('goals')
      .select('phase_order')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (currentError || !current) { console.error('advanceToNextPhase: no active phase', currentError?.message); return null; }

    const currentOrder = current.phase_order as number;

    // FIX (audit DB-TRG-01/HIGH): find the next phase BEFORE deactivating anything. The old
    // code deactivated unconditionally then tried to activate phase+1 — so on the FINAL phase
    // (no next) the user was left with ZERO active goals, and the two separate writes were
    // non-atomic (a failed activate also left zero active). Now: bail if no next phase, else
    // deactivate-current + activate-next in ONE transaction via the swap_active_goal RPC.
    const { data: next } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', userId)
      .gt('phase_order', currentOrder)
      .order('phase_order', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!next) return null; // already on the final phase — keep it active

    const { error: swapError } = await supabase.rpc('swap_active_goal', { p_user: userId, p_next_id: next.id });
    if (swapError) { console.error('advanceToNextPhase swap failed:', swapError.message); return null; }

    return { ...(next as GoalPhase), is_active: true };
  } catch (err) {
    console.error('advanceToNextPhase unexpected error:', err);
    return null;
  }
}

/**
 * Delete a phase.
 * FIX (audit UX-FBK-04): hatayı yutmak yerine fırlat — çağıran (multi-phase-goals.tsx)
 * try/catch ile yakalayıp kullanıcıya başarı/başarısızlık geri bildirimi verebilsin.
 * Önceden hata yalnızca console.error'lanıp void dönüyordu; RLS/FK reddi sessizce
 * kayboluyor, satır load() sonrası geri gelince kullanıcı hiçbir açıklama görmüyordu.
 */
export async function deletePhase(phaseId: string): Promise<void> {
  const { error } = await supabase.from('goals').delete().eq('id', phaseId);
  if (error) {
    console.error('deletePhase error:', error.message);
    throw new Error(error.message);
  }
}

// ─── Phase Transitions (Phase 6) ───

/**
 * Calculate gradual transition between phases.
 * 7-day calorie/macro shift from current to next phase.
 */
export function calculatePhaseTransition(
  currentCalorie: { min: number; max: number },
  nextCalorie: { min: number; max: number },
  transitionDay: number, // 1-7
  totalDays: number = 7
): { min: number; max: number; progress: number } {
  const progress = Math.min(1, transitionDay / totalDays);

  return {
    min: Math.round(currentCalorie.min + (nextCalorie.min - currentCalorie.min) * progress),
    max: Math.round(currentCalorie.max + (nextCalorie.max - currentCalorie.max) * progress),
    progress,
  };
}

/**
 * Get timeline data for PhaseTimeline component.
 */
export async function getTimelineData(userId: string): Promise<{
  phases: { id: string; label: string; goalType: string; targetWeeks: number; isActive: boolean; isCompleted: boolean }[];
  currentWeek: number;
}> {
  const phases = await getGoalPhases(userId);

  const activePhase = phases.find(p => p.is_active);
  let currentWeek = 0;

  if (activePhase) {
    const created = new Date(activePhase.created_at);
    currentWeek = Math.max(1, Math.round((Date.now() - created.getTime()) / (7 * 86400000)));
  }

  return {
    phases: phases.map(p => ({
      id: p.id,
      label: p.phase_label ?? p.goal_type,
      goalType: p.goal_type,
      targetWeeks: p.target_weeks ?? 12,
      isActive: p.is_active,
      isCompleted: !p.is_active && phases.indexOf(p) < phases.indexOf(activePhase!),
    })),
    currentWeek,
  };
}

// ─── Goal Compatibility Matrix (Spec 6.2) ───

const COMPATIBILITY_MATRIX: Record<string, Record<string, 'compatible' | 'conflict' | 'warning'>> = {
  lose_weight: { lose_weight: 'compatible', gain_weight: 'conflict', gain_muscle: 'warning', health: 'compatible', maintain: 'conflict', conditioning: 'compatible' },
  gain_weight: { lose_weight: 'conflict', gain_weight: 'compatible', gain_muscle: 'compatible', health: 'compatible', maintain: 'conflict', conditioning: 'compatible' },
  gain_muscle: { lose_weight: 'warning', gain_weight: 'compatible', gain_muscle: 'compatible', health: 'compatible', maintain: 'compatible', conditioning: 'compatible' },
  health:      { lose_weight: 'compatible', gain_weight: 'compatible', gain_muscle: 'compatible', health: 'compatible', maintain: 'compatible', conditioning: 'compatible' },
  maintain:    { lose_weight: 'conflict', gain_weight: 'conflict', gain_muscle: 'compatible', health: 'compatible', maintain: 'compatible', conditioning: 'compatible' },
  conditioning:{ lose_weight: 'compatible', gain_weight: 'compatible', gain_muscle: 'compatible', health: 'compatible', maintain: 'compatible', conditioning: 'compatible' },
};

const CONFLICT_MESSAGES: Record<string, string> = {
  'lose_weight+gain_weight': 'Kilo vermek ve kilo almak aynı anda mümkün değil.',
  'lose_weight+maintain': 'Kilo vermek ve kilo korumak çelişiyor. Birini seç.',
  'gain_weight+maintain': 'Kilo almak ve kilo korumak çelişiyor.',
  'lose_weight+gain_muscle': 'Kilo verirken kas kazanmak zor ama mümkün (body recomp). Yeni başlayanlar için uygun, ileri seviyede çok zor.',
};

// ─── AI Goal Suggestions (Phase 4) ───

export interface GoalSuggestion {
  goalType: string;
  reasoning: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Get AI goal suggestions based on current progress and observations.
 */
export async function getAIGoalSuggestions(
  userId: string,
  currentWeight: number | null,
  targetWeight: number | null
): Promise<GoalSuggestion[]> {
  const suggestions: GoalSuggestion[] = [];

  // Check water intake
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const { data: metrics } = await supabase
    .from('daily_metrics')
    .select('water_liters, sleep_hours')
    .eq('user_id', userId)
    .gte('date', sevenDaysAgo);

  if (metrics && metrics.length > 0) {
    const avgWater = (metrics as { water_liters: number }[]).reduce((s, m) => s + (m.water_liters ?? 0), 0) / metrics.length;
    if (avgWater < 1.5) {
      suggestions.push({
        goalType: 'health',
        reasoning: 'Su tüketimin düşük (ort. ' + avgWater.toFixed(1).replace('.', ',') + ' L). Önce su alışkanlığını oturtalım.',
        priority: 'high',
      });
    }

    const sleepData = (metrics as { sleep_hours: number | null }[]).filter(m => m.sleep_hours !== null);
    const avgSleep = sleepData.length > 0 ? sleepData.reduce((s, m) => s + (m.sleep_hours ?? 0), 0) / sleepData.length : 0;
    if (avgSleep > 0 && avgSleep < 6) {
      suggestions.push({
        goalType: 'health',
        reasoning: 'Uyku ortalaman ' + avgSleep.toFixed(1).replace('.', ',') + ' saat. Uyku düzeni hedefi ekleyelim.',
        priority: 'high',
      });
    }
  }

  // Check if at target weight → suggest maintenance
  if (currentWeight && targetWeight && Math.abs(currentWeight - targetWeight) <= 1) {
    suggestions.push({
      goalType: 'maintain',
      reasoning: 'Hedefe çok yakınsın! Bakım moduna geçmeyi düşünebilirsin.',
      priority: 'high',
    });
  }

  return suggestions;
}

/**
 * Check if a goal rate is too aggressive.
 */
export function checkAggressiveGoal(
  weeklyRateKg: number,
  currentWeight: number | null,
  gender: string | null
): { isAggressive: boolean; warning: string | null; suggestedRate: number } {
  const maxSafe = 1.0; // kg/week

  if (weeklyRateKg > maxSafe) {
    return {
      isAggressive: true,
      warning: `Haftada ${String(weeklyRateKg).replace('.', ',')} kg kayıp çok hızlı. Sağlıklı ve sürdürülebilir kayıp haftada 0,5-1 kg arası. Haftada 0,5-0,75 kg öneririm.`,
      suggestedRate: 0.75,
    };
  }

  if (weeklyRateKg > 0.75 && currentWeight && currentWeight < 70) {
    return {
      isAggressive: true,
      warning: `Mevcut kilonda (${String(currentWeight).replace('.', ',')} kg) haftada ${String(weeklyRateKg).replace('.', ',')} kg kayıp yüksek olabilir. Haftada 0,5 kg öneririm.`,
      suggestedRate: 0.5,
    };
  }

  return { isAggressive: false, warning: null, suggestedRate: weeklyRateKg };
}

/**
 * Integrate goal with plateau detection.
 * When plateau is detected, suggest goal adjustment.
 */
export function integrateWithPlateau(
  weeksSinceChange: number,
  currentRate: number
): { shouldAdjust: boolean; suggestion: string } {
  if (weeksSinceChange >= 4) {
    return {
      shouldAdjust: true,
      suggestion: `${weeksSinceChange} haftadır kilo değişmiyor. Hedef hızını geçici olarak yavaşlatmayı veya 2 haftalık bakım molası vermeyi düşünebilirsin.`,
    };
  }
  return { shouldAdjust: false, suggestion: '' };
}

export function checkGoalCompatibility(
  newGoalType: string,
  existingGoalType: string,
): { compatible: boolean; level: 'compatible' | 'conflict' | 'warning'; message_tr: string } {
  const compatibility = COMPATIBILITY_MATRIX[newGoalType]?.[existingGoalType] ?? 'compatible';
  const key1 = `${newGoalType}+${existingGoalType}`;
  const key2 = `${existingGoalType}+${newGoalType}`;
  const message = CONFLICT_MESSAGES[key1] ?? CONFLICT_MESSAGES[key2] ?? '';

  return {
    compatible: compatibility !== 'conflict',
    level: compatibility,
    message_tr: compatibility === 'conflict' ? message || 'Bu hedefler birbiriyle çelişiyor.'
      : compatibility === 'warning' ? message || 'Bu hedefler birlikte zor ama mümkün.'
      : '',
  };
}

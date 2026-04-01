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
  'lose_weight+gain_weight': 'Kilo vermek ve kilo almak ayni anda mumkun degil.',
  'lose_weight+maintain': 'Kilo vermek ve kilo korumak celisiyor. Birini sec.',
  'gain_weight+maintain': 'Kilo almak ve kilo korumak celisiyor.',
  'lose_weight+gain_muscle': 'Kilo verirken kas kazanmak zor ama mumkun (body recomp). Yeni baslayanlar icin uygun, ileri seviyede cok zor.',
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
        reasoning: 'Su tuketiminiz dusuk (ort. ' + avgWater.toFixed(1) + 'L). Once su aliskanligi oturalim.',
        priority: 'high',
      });
    }

    const sleepData = (metrics as { sleep_hours: number | null }[]).filter(m => m.sleep_hours !== null);
    const avgSleep = sleepData.length > 0 ? sleepData.reduce((s, m) => s + (m.sleep_hours ?? 0), 0) / sleepData.length : 0;
    if (avgSleep > 0 && avgSleep < 6) {
      suggestions.push({
        goalType: 'health',
        reasoning: 'Uyku ortalamaniz ' + avgSleep.toFixed(1) + ' saat. Uyku duzeni hedefi eklenmeli.',
        priority: 'high',
      });
    }
  }

  // Check if at target weight → suggest maintenance
  if (currentWeight && targetWeight && Math.abs(currentWeight - targetWeight) <= 1) {
    suggestions.push({
      goalType: 'maintain',
      reasoning: 'Hedefe cok yakinsiniz! Bakim moduna gecis onerilir.',
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
      warning: `Haftada ${weeklyRateKg}kg kayip cok hizli. Saglikli ve surudrulebilir kayip haftada 0.5-1kg arasi. Haftada 0.5-0.75kg oneririz.`,
      suggestedRate: 0.75,
    };
  }

  if (weeklyRateKg > 0.75 && currentWeight && currentWeight < 70) {
    return {
      isAggressive: true,
      warning: `Mevcut kilonuzda (${currentWeight}kg) haftada ${weeklyRateKg}kg kayip yuksek olabilir. Haftada 0.5kg oneririz.`,
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
      suggestion: `${weeksSinceChange} haftadir kilo degismiyor. Hedef hizini gecici olarak yaveslatmayi veya 2 haftalik bakim molasi vermeyi dusunebilirsin.`,
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
    message_tr: compatibility === 'conflict' ? message || 'Bu hedefler birbiriyle celisiyor.'
      : compatibility === 'warning' ? message || 'Bu hedefler birlikte zor ama mumkun.'
      : '',
  };
}

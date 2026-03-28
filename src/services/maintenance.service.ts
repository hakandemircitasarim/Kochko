/**
 * Maintenance Mode Service
 * Spec 6.6: Hedefe ulaşma & bakım modu
 *
 * When user reaches goal weight:
 * 1. Reverse diet (gradual calorie increase, 100-150 kcal/week)
 * 2. Maintenance band (±1.5kg tolerance)
 * 3. Mini cut if band exceeded
 */
import { supabase } from '@/lib/supabase';

export interface MaintenanceStatus {
  isInMaintenance: boolean;
  maintenanceCalories: number | null;
  toleranceBand: { min: number; max: number } | null;
  currentWeight: number | null;
  goalWeight: number | null;
  bandStatus: 'in_band' | 'approaching_limit' | 'exceeded' | null;
  weeksSinceGoalReached: number;
  message: string;
}

/**
 * Check if user is in or should enter maintenance mode.
 */
export async function getMaintenanceStatus(userId: string): Promise<MaintenanceStatus> {
  const [profileRes, goalRes, metricsRes] = await Promise.all([
    supabase.from('profiles').select('weight_kg, tdee_calculated').eq('id', userId).single(),
    supabase.from('goals').select('target_weight_kg, goal_type').eq('user_id', userId).eq('is_active', true).single(),
    supabase.from('daily_metrics').select('weight_kg, date').eq('user_id', userId).not('weight_kg', 'is', null).order('date', { ascending: false }).limit(1).single(),
  ]);

  const profile = profileRes.data;
  const goal = goalRes.data;
  const latest = metricsRes.data;

  if (!profile || !goal || !latest) {
    return { isInMaintenance: false, maintenanceCalories: null, toleranceBand: null, currentWeight: null, goalWeight: null, bandStatus: null, weeksSinceGoalReached: 0, message: '' };
  }

  const currentWeight = latest.weight_kg as number;
  const goalWeight = goal.target_weight_kg as number;
  const tdee = profile.tdee_calculated as number | null;

  // Check if goal reached
  const goalType = goal.goal_type as string;
  const goalReached = goalType === 'lose_weight'
    ? currentWeight <= goalWeight
    : goalType === 'gain_weight' || goalType === 'gain_muscle'
      ? currentWeight >= goalWeight
      : goalType === 'maintain';

  if (!goalReached) {
    return { isInMaintenance: false, maintenanceCalories: tdee, toleranceBand: null, currentWeight, goalWeight, bandStatus: null, weeksSinceGoalReached: 0, message: '' };
  }

  // In maintenance mode
  const toleranceBand = { min: goalWeight - 1.5, max: goalWeight + 1.5 };
  let bandStatus: 'in_band' | 'approaching_limit' | 'exceeded';

  if (currentWeight < toleranceBand.min || currentWeight > toleranceBand.max) {
    bandStatus = 'exceeded';
  } else if (Math.abs(currentWeight - goalWeight) > 1.0) {
    bandStatus = 'approaching_limit';
  } else {
    bandStatus = 'in_band';
  }

  const message = bandStatus === 'exceeded'
    ? `Bakim bandinin disina ciktin (${toleranceBand.min}-${toleranceBand.max}kg). Mini cut planlayalim mi?`
    : bandStatus === 'approaching_limit'
      ? `Bakim bandinin sinirina yaklasiyorsun. Dikkatli ol.`
      : `Bakim bandinda gidiyorsun, guzel.`;

  return {
    isInMaintenance: true,
    maintenanceCalories: tdee,
    toleranceBand,
    currentWeight,
    goalWeight,
    bandStatus,
    weeksSinceGoalReached: 0, // TODO: calculate from achievement date
    message,
  };
}

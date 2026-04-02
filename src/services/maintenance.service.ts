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

const REVERSE_DIET_WEEKLY_INCREASE = 125; // kcal/week (midpoint of 100-150 range)
const TOLERANCE_BAND_KG = 1.5;
const APPROACHING_LIMIT_KG = 1.0;
const MINI_CUT_TRIGGER_WEEKS = 2;

export interface MaintenanceStatus {
  isInMaintenance: boolean;
  maintenanceCalories: number | null;
  toleranceBand: { min: number; max: number } | null;
  currentWeight: number | null;
  goalWeight: number | null;
  bandStatus: 'in_band' | 'approaching_limit' | 'exceeded' | null;
  weeksSinceGoalReached: number;
  reverseDiet: ReverseDietStatus | null;
  message: string;
}

export interface ReverseDietStatus {
  targetCalories: number;
  currentWeek: number;
  weeklyIncrease: number;
  isComplete: boolean;
  startCalories: number;
}

export interface MiniCutDecision {
  trigger: boolean;
  reason_tr: string;
}

/**
 * Calculate reverse diet progression.
 * Gradually increase calories from deficit to TDEE over several weeks.
 */
export function calculateReverseDiet(
  deficitCalories: number,
  tdee: number,
  weeksSinceGoalReached: number,
): ReverseDietStatus {
  const startCalories = deficitCalories;
  const totalIncrease = tdee - startCalories;
  const weeksNeeded = Math.ceil(totalIncrease / REVERSE_DIET_WEEKLY_INCREASE);
  const currentWeek = Math.min(weeksSinceGoalReached, weeksNeeded);
  const targetCalories = Math.min(
    startCalories + (currentWeek * REVERSE_DIET_WEEKLY_INCREASE),
    tdee,
  );
  const isComplete = targetCalories >= tdee;

  return {
    targetCalories: Math.round(targetCalories),
    currentWeek,
    weeklyIncrease: REVERSE_DIET_WEEKLY_INCREASE,
    isComplete,
    startCalories,
  };
}

/**
 * Determine if a mini-cut should be triggered.
 * Triggers when band is exceeded for 2+ consecutive weeks.
 */
export function shouldTriggerMiniCut(
  bandStatus: 'in_band' | 'approaching_limit' | 'exceeded',
  weeksExceeded: number,
): MiniCutDecision {
  if (bandStatus !== 'exceeded') {
    return { trigger: false, reason_tr: '' };
  }

  if (weeksExceeded >= MINI_CUT_TRIGGER_WEEKS) {
    return {
      trigger: true,
      reason_tr: `Bakim bandinin disinda ${weeksExceeded} haftadir. 2-3 haftalik mini cut onerilir.`,
    };
  }

  return {
    trigger: false,
    reason_tr: `Bakim bandinin disinda ${weeksExceeded} hafta. ${MINI_CUT_TRIGGER_WEEKS - weeksExceeded} hafta daha surerse mini cut onerilecek.`,
  };
}

/**
 * Check if user is in or should enter maintenance mode.
 */
export async function getMaintenanceStatus(userId: string): Promise<MaintenanceStatus> {
  const [profileRes, goalRes, metricsRes, achievementRes] = await Promise.all([
    supabase.from('profiles').select('weight_kg, tdee_calculated, calorie_range_rest_min').eq('id', userId).single(),
    supabase.from('goals').select('target_weight_kg, goal_type').eq('user_id', userId).eq('is_active', true).single(),
    supabase.from('daily_metrics').select('weight_kg, date').eq('user_id', userId).not('weight_kg', 'is', null).order('date', { ascending: false }).limit(1).single(),
    // Find when goal was first reached (via achievement)
    supabase.from('achievements').select('achieved_at').eq('user_id', userId).eq('achievement_type', 'goal_reached').order('achieved_at', { ascending: false }).limit(1).single(),
  ]);

  const profile = profileRes.data;
  const goal = goalRes.data;
  const latest = metricsRes.data;

  if (!profile || !goal || !latest) {
    return { isInMaintenance: false, maintenanceCalories: null, toleranceBand: null, currentWeight: null, goalWeight: null, bandStatus: null, weeksSinceGoalReached: 0, reverseDiet: null, message: '' };
  }

  const currentWeight = latest.weight_kg as number;
  const goalWeight = goal.target_weight_kg as number;
  const tdee = profile.tdee_calculated as number | null;

  // Check if goal reached
  const goalType = goal.goal_type as string;
  const goalReached = goalType === 'lose_weight'
    ? currentWeight <= goalWeight + 0.5
    : goalType === 'gain_weight' || goalType === 'gain_muscle'
      ? currentWeight >= goalWeight - 0.5
      : goalType === 'maintain';

  if (!goalReached) {
    return { isInMaintenance: false, maintenanceCalories: tdee, toleranceBand: null, currentWeight, goalWeight, bandStatus: null, weeksSinceGoalReached: 0, reverseDiet: null, message: '' };
  }

  // Calculate weeks since goal reached
  let weeksSinceGoalReached = 0;
  if (achievementRes.data?.achieved_at) {
    const achievedAt = new Date(achievementRes.data.achieved_at as string);
    weeksSinceGoalReached = Math.max(0, Math.round((Date.now() - achievedAt.getTime()) / (7 * 24 * 60 * 60 * 1000)));
  }

  // Tolerance band
  const toleranceBand = { min: goalWeight - TOLERANCE_BAND_KG, max: goalWeight + TOLERANCE_BAND_KG };
  let bandStatus: 'in_band' | 'approaching_limit' | 'exceeded';

  if (currentWeight < toleranceBand.min || currentWeight > toleranceBand.max) {
    bandStatus = 'exceeded';
  } else if (Math.abs(currentWeight - goalWeight) > APPROACHING_LIMIT_KG) {
    bandStatus = 'approaching_limit';
  } else {
    bandStatus = 'in_band';
  }

  // Reverse diet calculation
  let reverseDiet: ReverseDietStatus | null = null;
  if (tdee && profile.calorie_range_rest_min) {
    const deficitCalories = profile.calorie_range_rest_min as number;
    reverseDiet = calculateReverseDiet(deficitCalories, tdee, weeksSinceGoalReached);
  }

  // Maintenance calories: during reverse diet, use progressive calories
  const maintenanceCalories = reverseDiet && !reverseDiet.isComplete
    ? reverseDiet.targetCalories
    : tdee;

  // Message
  let message: string;
  if (reverseDiet && !reverseDiet.isComplete) {
    message = `Reverse diet ${reverseDiet.currentWeek}. hafta: ${reverseDiet.targetCalories} kcal (TDEE'ye haftalik +${REVERSE_DIET_WEEKLY_INCREASE} kcal artis)`;
  } else if (bandStatus === 'exceeded') {
    message = `Bakim bandinin disina ciktin (${toleranceBand.min}-${toleranceBand.max}kg). Mini cut planlayalim mi?`;
  } else if (bandStatus === 'approaching_limit') {
    message = `Bakim bandinin sinirina yaklasiyorsun. Dikkatli ol.`;
  } else {
    message = `Bakim bandinda gidiyorsun, guzel.`;
  }

  return {
    isInMaintenance: true,
    maintenanceCalories,
    toleranceBand,
    currentWeight,
    goalWeight,
    bandStatus,
    weeksSinceGoalReached,
    reverseDiet,
    message,
  };
}

// ─── Behavior Reinforcement (Phase 7) ───

/**
 * Generate positive reinforcement message for maintenance users.
 */
export function generateReinforcementMessage(
  weeksSinceGoalReached: number,
  bandStatus: string
): string | null {
  if (bandStatus !== 'in_band') return null;

  if (weeksSinceGoalReached >= 24) {
    return `6 aydir hedef kilonda tutunuyorsun! Bu inanilmaz bir basari. Cogul insan bunu basaramaz.`;
  }
  if (weeksSinceGoalReached >= 12) {
    return `3 aydir bakim modunda basarilisin. Aliskanliklarinin gucunun kaniti bu.`;
  }
  if (weeksSinceGoalReached >= 4) {
    return `1 aydir hedef kilonda kalmaya devam ediyorsun. Harika gidiyorsun!`;
  }

  return null;
}

/**
 * Get retention strategy — keep user engaged in maintenance mode.
 */
export function getRetentionStrategy(
  bandStatus: string,
  weeksSinceGoalReached: number
): { strategy: string; message: string } {
  if (bandStatus === 'approaching_limit') {
    return {
      strategy: 'proactive_warning',
      message: "Hedef kilonun sinirina yaklasiyorsun. Mini-cut'a gerek kalmadan onlem alalim — bu hafta su ve protein hedeflerine odaklan.",
    };
  }

  if (bandStatus === 'exceeded') {
    return {
      strategy: 'mini_cut_suggestion',
      message: 'Tolerans bandini astin. Tam diyete donus degil, 2-4 haftalik hafif kalori acigi ile dengeye donebilirsin.',
    };
  }

  // In band — micro-goals to stay engaged
  const microGoals = [
    'Bu hafta her gun su hedefini tut.',
    'Bu hafta 3 gun protein hedefini tuttur.',
    'Bu hafta yeni bir saglikli tarif dene.',
    'Bu hafta uyku duzulune odaklan — her gece ayni saatte yat.',
  ];

  return {
    strategy: 'micro_goals',
    message: microGoals[weeksSinceGoalReached % microGoals.length],
  };
}

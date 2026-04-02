/**
 * Adaptive Difficulty Service
 * Spec 5.34: Kademeli zorluk artışı
 *
 * When user achieves 85%+ compliance for 2+ consecutive weeks,
 * gradually increase targets. If they fail for 1 week, revert.
 */
import { supabase } from '@/lib/supabase';

export interface DifficultyAdjustment {
  shouldAdjust: boolean;
  direction: 'increase' | 'decrease' | 'none';
  changes: {
    calorie_range_reduction?: number;  // tighten range by X kcal (now %5 based)
    protein_increase?: number;         // +Xg
    workout_intensity_bump?: number;   // intensity_level increment (+1 or -1)
    water_increase?: number;           // +X liters
  };
  message: string;
}

/**
 * Check if difficulty should be adjusted.
 * Spec: 2+ hafta %85+ uyum → %5 dar kalori aralığı, +5g protein, +1 kademe antrenman
 */
export async function checkAdaptiveDifficulty(userId: string): Promise<DifficultyAdjustment> {
  // Get last 3 weeks of daily reports
  const threeWeeksAgo = new Date(Date.now() - 21 * 86400000).toISOString().split('T')[0];
  const { data: reports } = await supabase
    .from('daily_reports')
    .select('date, compliance_score')
    .eq('user_id', userId)
    .gte('date', threeWeeksAgo)
    .order('date');

  if (!reports || reports.length < 10) {
    return { shouldAdjust: false, direction: 'none', changes: {}, message: '' };
  }

  // Split into weeks
  const now = new Date();
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

  const week1 = (reports as { date: string; compliance_score: number }[]).filter(r => r.date >= twoWeeksAgo && r.date < oneWeekAgo);
  const week2 = (reports as { date: string; compliance_score: number }[]).filter(r => r.date >= oneWeekAgo);

  if (week1.length < 4 || week2.length < 4) {
    return { shouldAdjust: false, direction: 'none', changes: {}, message: '' };
  }

  const avg1 = week1.reduce((s, r) => s + r.compliance_score, 0) / week1.length;
  const avg2 = week2.reduce((s, r) => s + r.compliance_score, 0) / week2.length;

  // Fetch profile for percentage-based calorie calculation
  const { data: profile } = await supabase
    .from('profiles')
    .select('calorie_range_training_min, calorie_range_training_max, calorie_range_rest_min, calorie_range_rest_max')
    .eq('id', userId)
    .single();

  // A11: Calculate 5% of (max - min) range instead of fixed 50 kcal
  let calorieReduction = 50; // fallback
  if (profile) {
    const rangeMax = profile.calorie_range_rest_max ?? profile.calorie_range_training_max ?? 2500;
    const rangeMin = profile.calorie_range_rest_min ?? profile.calorie_range_training_min ?? 1800;
    calorieReduction = Math.round((rangeMax - rangeMin) * 0.05);
    // Ensure at least a meaningful adjustment
    if (calorieReduction < 10) calorieReduction = 10;
  }

  // Both weeks 85%+ → increase difficulty
  if (avg1 >= 85 && avg2 >= 85) {
    return {
      shouldAdjust: true,
      direction: 'increase',
      changes: {
        calorie_range_reduction: calorieReduction, // A11: %5 of (max-min) range
        protein_increase: 5,                        // +5g
        workout_intensity_bump: 1,                  // A11: intensity_level + 1
        water_increase: 0.2,                        // +0.2L
      },
      message: `Son 2 hafta cok iyi gitti! Citayi biraz yukseltiyorum - kalori araligini %5 daraltiyorum (${calorieReduction} kcal), protein hedefini +5g artiriyorum, antrenman yogunlugunu 1 kademe artiriyorum.`,
    };
  }

  // Current week < 60% after previous increase → revert
  if (avg2 < 60 && avg1 >= 75) {
    return {
      shouldAdjust: true,
      direction: 'decrease',
      changes: {
        calorie_range_reduction: -calorieReduction,
        protein_increase: -5,
        workout_intensity_bump: -1,                 // intensity_level - 1
        water_increase: -0.2,
      },
      message: 'Bu hafta zorlandin, hedefleri eski seviyeye geri aliyorum. Rahat ol.',
    };
  }

  return { shouldAdjust: false, direction: 'none', changes: {}, message: '' };
}

/**
 * A11: Calculate new targets based on current profile and adjustment direction.
 * - Kalori: (max-min) * 0.05 daraltma (percentage-based, not fixed 50kcal)
 * - Protein: +5g
 * - Antrenman: intensity_level + 1 (if field exists)
 */
export function calculateNewTargets(
  currentProfile: {
    calorie_range_rest_min: number | null;
    calorie_range_rest_max: number | null;
    calorie_range_training_min: number | null;
    calorie_range_training_max: number | null;
    protein_target_g: number | null;
    water_target_liters: number | null;
    intensity_level?: number | null;
  },
  direction: 'increase' | 'decrease',
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  const restMax = currentProfile.calorie_range_rest_max ?? 2500;
  const restMin = currentProfile.calorie_range_rest_min ?? 1800;
  const trainingMax = currentProfile.calorie_range_training_max ?? 2800;
  const trainingMin = currentProfile.calorie_range_training_min ?? 2000;

  // Calorie: 5% of (max - min) range
  const restReduction = Math.round((restMax - restMin) * 0.05);
  const trainingReduction = Math.round((trainingMax - trainingMin) * 0.05);

  if (direction === 'increase') {
    updates.calorie_range_rest_min = restMin + Math.max(restReduction, 10);
    updates.calorie_range_training_min = trainingMin + Math.max(trainingReduction, 10);
  } else {
    updates.calorie_range_rest_min = Math.max(1200, restMin - Math.max(restReduction, 10));
    updates.calorie_range_training_min = Math.max(1200, trainingMin - Math.max(trainingReduction, 10));
  }

  // Protein: +5g / -5g
  const proteinDelta = direction === 'increase' ? 5 : -5;
  updates.protein_target_g = Math.max(50, (currentProfile.protein_target_g ?? 100) + proteinDelta);

  // Water
  const waterDelta = direction === 'increase' ? 0.2 : -0.2;
  updates.water_target_liters = Math.round(
    Math.max(1.5, ((currentProfile.water_target_liters ?? 2.5) + waterDelta)) * 10
  ) / 10;

  // Intensity level: +1 / -1 (if field exists in profile)
  if (currentProfile.intensity_level !== undefined && currentProfile.intensity_level !== null) {
    const intensityDelta = direction === 'increase' ? 1 : -1;
    updates.intensity_level = Math.max(1, Math.min(10, currentProfile.intensity_level + intensityDelta));
  }

  return updates;
}

/**
 * T2.41: Apply difficulty adjustment to user profile.
 * A11: Now uses calculateNewTargets for percentage-based calorie adjustment
 * and intensity_level support.
 */
export async function applyDifficultyAdjustment(userId: string, adjustment: DifficultyAdjustment): Promise<void> {
  if (!adjustment.shouldAdjust) return;

  const { data: profile } = await supabase
    .from('profiles')
    .select('calorie_range_training_min, calorie_range_training_max, calorie_range_rest_min, calorie_range_rest_max, protein_target_g, water_target_liters, intensity_level')
    .eq('id', userId)
    .single();

  if (!profile) return;

  const updates = calculateNewTargets(
    {
      calorie_range_rest_min: profile.calorie_range_rest_min as number | null,
      calorie_range_rest_max: profile.calorie_range_rest_max as number | null,
      calorie_range_training_min: profile.calorie_range_training_min as number | null,
      calorie_range_training_max: profile.calorie_range_training_max as number | null,
      protein_target_g: profile.protein_target_g as number | null,
      water_target_liters: profile.water_target_liters as number | null,
      intensity_level: (profile as Record<string, unknown>).intensity_level as number | null | undefined,
    },
    adjustment.direction === 'none' ? 'increase' : adjustment.direction,
  );

  updates.updated_at = new Date().toISOString();
  await supabase.from('profiles').update(updates).eq('id', userId);
}

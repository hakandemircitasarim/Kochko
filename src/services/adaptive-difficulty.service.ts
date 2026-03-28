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
    calorie_range_reduction?: number;  // tighten range by X kcal
    protein_increase?: number;         // +Xg
    workout_intensity_bump?: boolean;
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

  // Both weeks 85%+ → increase difficulty
  if (avg1 >= 85 && avg2 >= 85) {
    return {
      shouldAdjust: true,
      direction: 'increase',
      changes: {
        calorie_range_reduction: 50, // tighten by 50 kcal
        protein_increase: 5,          // +5g
        workout_intensity_bump: true,
        water_increase: 0.2,          // +0.2L
      },
      message: 'Son 2 hafta cok iyi gitti! Citayi biraz yukseltiyorum - kalori araligini daraltiyorum, protein hedefini +5g artiriyorum.',
    };
  }

  // Current week < 60% after previous increase → revert
  if (avg2 < 60 && avg1 >= 75) {
    return {
      shouldAdjust: true,
      direction: 'decrease',
      changes: {
        calorie_range_reduction: -50,
        protein_increase: -5,
        workout_intensity_bump: false,
        water_increase: -0.2,
      },
      message: 'Bu hafta zorlandin, hedefleri eski seviyeye geri aliyorum. Rahat ol.',
    };
  }

  return { shouldAdjust: false, direction: 'none', changes: {}, message: '' };
}

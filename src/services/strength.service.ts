/**
 * Strength Training Progression Service
 * Spec 7.5: Güç antrenmanı progresyon sistemi
 * Set-rep-weight tracking, 1RM estimation, deload management.
 */
import { supabase } from '@/lib/supabase';

export interface StrengthSet {
  id: string;
  exercise_name: string;
  set_number: number;
  reps: number;
  weight_kg: number;
  is_pr: boolean;
}

export interface ExerciseHistory {
  exercise: string;
  estimated1RM: number;
  lastWeight: number;
  lastReps: number;
  history: { date: string; weight_kg: number; reps: number; sets: number }[];
  weeksSinceDeload: number;
}

/**
 * Estimate 1RM using Epley formula.
 * 1RM = weight × (1 + reps/30)
 */
export function estimate1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

/**
 * Get exercise history for a specific movement.
 */
export async function getExerciseHistory(
  userId: string,
  exerciseName: string,
  weeks: number = 8
): Promise<ExerciseHistory | null> {
  const fromDate = new Date(Date.now() - weeks * 7 * 86400000).toISOString().split('T')[0];

  const { data: workouts } = await supabase
    .from('workout_logs')
    .select('id, logged_for_date')
    .eq('user_id', userId)
    .gte('logged_for_date', fromDate)
    .order('logged_for_date');

  if (!workouts?.length) return null;

  const workoutIds = workouts.map((w: { id: string }) => w.id);
  const { data: sets } = await supabase
    .from('strength_sets')
    .select('workout_log_id, set_number, reps, weight_kg')
    .in('workout_log_id', workoutIds)
    .eq('exercise_name', exerciseName)
    .order('set_number');

  if (!sets?.length) return null;

  // Group by workout date
  const byDate: Record<string, { weight_kg: number; reps: number; sets: number }> = {};
  for (const s of sets as { workout_log_id: string; reps: number; weight_kg: number }[]) {
    const workout = workouts.find((w: { id: string }) => w.id === s.workout_log_id) as { logged_for_date: string } | undefined;
    if (!workout) continue;
    const date = workout.logged_for_date;
    if (!byDate[date]) byDate[date] = { weight_kg: s.weight_kg, reps: s.reps, sets: 0 };
    byDate[date].sets++;
    if (s.weight_kg > byDate[date].weight_kg) {
      byDate[date].weight_kg = s.weight_kg;
      byDate[date].reps = s.reps;
    }
  }

  const history = Object.entries(byDate).map(([date, data]) => ({ date, ...data }));
  const latest = history[history.length - 1];
  const estimated = estimate1RM(latest.weight_kg, latest.reps);

  return {
    exercise: exerciseName,
    estimated1RM: estimated,
    lastWeight: latest.weight_kg,
    lastReps: latest.reps,
    history,
    weeksSinceDeload: history.length, // simplified
  };
}

/**
 * Suggest next workout targets based on progressive overload.
 * Spec 7.5: 2 consecutive successes → increase weight.
 */
export function suggestProgression(
  lastWeight: number,
  lastReps: number,
  targetReps: number,
  consecutiveSuccesses: number
): { weight: number; reps: number; note: string } {
  if (consecutiveSuccesses >= 2 && lastReps >= targetReps) {
    // Increase weight by 2.5kg (standard progression)
    return {
      weight: lastWeight + 2.5,
      reps: targetReps,
      note: `2 ardisik basari! Agirligi ${lastWeight}kg -> ${lastWeight + 2.5}kg cikiyoruz.`,
    };
  }

  if (lastReps < targetReps) {
    // Couldn't hit target reps, stay same weight
    return {
      weight: lastWeight,
      reps: targetReps,
      note: `Hedef ${targetReps} rep'e ulasamadin, ayni agirlikta devam.`,
    };
  }

  return {
    weight: lastWeight,
    reps: targetReps,
    note: 'Devam et, bir sonrakinde agirligi artirabilirsin.',
  };
}

/**
 * Check if deload is needed (Spec 7.5: 4-6 hafta sonra otomatik deload önerisi).
 */
export function shouldDeload(weeksSinceDeload: number): { needed: boolean; message: string } {
  if (weeksSinceDeload >= 6) {
    return { needed: true, message: '6+ haftadir agir calisiyorsun. Deload haftasi zamanı - ayni hareketler, %60-70 agirlik, dusuk set.' };
  }
  if (weeksSinceDeload >= 4) {
    return { needed: false, message: '4 hafta oldu, 1-2 hafta sonra deload dusunebiliriz.' };
  }
  return { needed: false, message: '' };
}

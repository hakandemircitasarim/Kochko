/**
 * Step Counter Service
 * Spec 3.1, 14.2: Telefon yerleşik sensöründen adım verisi
 *
 * Uses expo-sensors Pedometer API.
 * Wearable connected → wearable data overrides phone data.
 */
import { supabase } from '@/lib/supabase';

/**
 * Get today's step count from daily_metrics.
 */
export async function getTodaySteps(userId: string): Promise<{ steps: number; source: string }> {
  const date = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('daily_metrics')
    .select('steps, steps_source')
    .eq('user_id', userId)
    .eq('date', date)
    .single();

  return {
    steps: (data?.steps as number) ?? 0,
    source: (data?.steps_source as string) ?? 'phone',
  };
}

/**
 * Update step count for today.
 * Source priority: wearable > phone > manual
 */
export async function updateSteps(
  userId: string,
  steps: number,
  source: 'phone' | 'wearable' | 'manual' = 'phone',
): Promise<void> {
  const date = new Date().toISOString().split('T')[0];

  // Don't override wearable data with phone data
  const { data: existing } = await supabase
    .from('daily_metrics')
    .select('steps_source')
    .eq('user_id', userId)
    .eq('date', date)
    .single();

  if (existing?.steps_source === 'wearable' && source === 'phone') return;

  await supabase.from('daily_metrics').upsert(
    { user_id: userId, date, steps, steps_source: source, synced: true },
    { onConflict: 'user_id,date' },
  );
}

/**
 * Calculate step goal based on profile activity level.
 */
export function getStepGoal(activityLevel: string): number {
  switch (activityLevel) {
    case 'sedentary': return 6000;
    case 'light': return 8000;
    case 'moderate': return 10000;
    case 'active': return 12000;
    case 'very_active': return 15000;
    default: return 10000;
  }
}

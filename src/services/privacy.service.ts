/**
 * Privacy & Data Management Service
 * Spec 18: Veri saklama, gizlilik ve güvenlik
 *
 * Handles:
 * - Account deletion (30-day grace period)
 * - Data export (JSON/CSV/PDF)
 * - Katman 2 (AI summary) viewing and editing
 * - Photo cleanup (24h after parse)
 * - Old record summarization (2+ years → aggregate only)
 */
import { supabase } from '@/lib/supabase';

/**
 * Request account deletion with 30-day grace period (Spec 1.4, 18.1).
 * User can log back in within 30 days to cancel.
 */
export async function requestAccountDeletion(userId: string): Promise<{ scheduledDate: string }> {
  const scheduledDate = new Date();
  scheduledDate.setDate(scheduledDate.getDate() + 30);

  // Mark profile for deletion (don't actually delete yet)
  await supabase.from('profiles').update({
    deletion_requested_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as never).eq('id', userId);

  return { scheduledDate: scheduledDate.toISOString().split('T')[0] };
}

/**
 * Cancel account deletion (user logged back in within 30 days).
 */
export async function cancelAccountDeletion(userId: string): Promise<void> {
  await supabase.from('profiles').update({
    deletion_requested_at: null,
    updated_at: new Date().toISOString(),
  } as never).eq('id', userId);
}

/**
 * Get Katman 2 (AI summary) for user review (Spec 2.3).
 * KVKK Article 16: User has right to view and correct.
 */
export async function getAISummaryForReview(userId: string): Promise<{
  general: string;
  patterns: { type: string; description: string }[];
  portionCalibration: Record<string, unknown>;
  strengthRecords: Record<string, unknown>;
  coachingNotes: string;
  nutritionLiteracy: string;
} | null> {
  const { data } = await supabase
    .from('ai_summary')
    .select('general_summary, behavioral_patterns, portion_calibration, strength_records, coaching_notes, nutrition_literacy')
    .eq('user_id', userId)
    .single();

  if (!data) return null;

  return {
    general: (data.general_summary as string) ?? '',
    patterns: (data.behavioral_patterns as { type: string; description: string }[]) ?? [],
    portionCalibration: (data.portion_calibration as Record<string, unknown>) ?? {},
    strengthRecords: (data.strength_records as Record<string, unknown>) ?? {},
    coachingNotes: (data.coaching_notes as string) ?? '',
    nutritionLiteracy: (data.nutrition_literacy as string) ?? 'medium',
  };
}

/**
 * Delete specific AI summary note (Spec 2.3, KVKK Article 17).
 * User says "benim hakkımda X bilgisini sil".
 */
export async function deleteAISummaryNote(
  userId: string,
  field: string,
  noteToDelete: string
): Promise<void> {
  const { data } = await supabase
    .from('ai_summary')
    .select(field)
    .eq('user_id', userId)
    .single();

  if (!data) return;

  const currentValue = (data as unknown as Record<string, unknown>)[field];

  if (typeof currentValue === 'string') {
    // Remove the note from text
    const updated = (currentValue as string).replace(noteToDelete, '').replace(/\n\n+/g, '\n\n').trim();
    await supabase.from('ai_summary').update({ [field]: updated } as never).eq('user_id', userId);
  } else if (Array.isArray(currentValue)) {
    // Remove from array (patterns, habits, etc.)
    const updated = (currentValue as { description: string }[]).filter(
      item => !item.description?.includes(noteToDelete)
    );
    await supabase.from('ai_summary').update({ [field]: updated } as never).eq('user_id', userId);
  }
}

/**
 * Clear entire Katman 2 (AI summary) - nuclear option.
 * User explicitly requests full memory reset.
 */
export async function resetAISummary(userId: string): Promise<void> {
  await supabase.from('ai_summary').update({
    general_summary: '',
    behavioral_patterns: [],
    coaching_notes: '',
    portion_calibration: {},
    strength_records: {},
    user_persona: null,
    nutrition_literacy: 'medium',
    learned_tone_preference: null,
    micro_nutrient_risks: [],
    alcohol_pattern: null,
    caffeine_sleep_notes: null,
    social_eating_notes: null,
    habit_progress: [],
    features_introduced: [],
    recovery_pattern: null,
    menstrual_notes: null,
    weekly_budget_pattern: null,
    supplement_notes: null,
    updated_at: new Date().toISOString(),
  } as never).eq('user_id', userId);
}

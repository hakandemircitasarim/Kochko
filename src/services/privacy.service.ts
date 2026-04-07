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
  patterns: { type: string; description: string; trigger?: string; intervention?: string; confidence?: number }[];
  portionCalibration: Record<string, unknown>;
  strengthRecords: Record<string, unknown>;
  coachingNotes: string;
  nutritionLiteracy: string;
  userPersona: string | null;
  learnedTonePreference: string | null;
  alcoholPattern: unknown;
  caffeineSleepNotes: string | null;
  socialEatingNotes: string | null;
  recoveryPattern: string | null;
  weeklyBudgetPattern: string | null;
  menstrualNotes: string | null;
  microNutrientRisks: { nutrient: string; risk_level: string }[];
  habitProgress: { habit: string; status: string; streak?: number }[];
  learnedMealTimes: Record<string, string> | null;
  seasonalNotes: string | null;
  supplementNotes: string | null;
  featuresIntroduced: string[];
} | null> {
  const { data } = await supabase
    .from('ai_summary')
    .select(`
      general_summary, behavioral_patterns, portion_calibration, strength_records,
      coaching_notes, nutrition_literacy, user_persona, learned_tone_preference,
      alcohol_pattern, caffeine_sleep_notes, social_eating_notes, recovery_pattern,
      weekly_budget_pattern, menstrual_notes, micro_nutrient_risks, habit_progress,
      learned_meal_times, seasonal_notes, supplement_notes, features_introduced
    `)
    .eq('user_id', userId)
    .single();

  if (!data) return null;

  return {
    general: (data.general_summary as string) ?? '',
    patterns: (data.behavioral_patterns as { type: string; description: string; trigger?: string; intervention?: string; confidence?: number }[]) ?? [],
    portionCalibration: (data.portion_calibration as Record<string, unknown>) ?? {},
    strengthRecords: (data.strength_records as Record<string, unknown>) ?? {},
    coachingNotes: (data.coaching_notes as string) ?? '',
    nutritionLiteracy: (data.nutrition_literacy as string) ?? 'medium',
    userPersona: (data.user_persona as string) ?? null,
    learnedTonePreference: (data.learned_tone_preference as string) ?? null,
    alcoholPattern: data.alcohol_pattern ?? null,
    caffeineSleepNotes: (data.caffeine_sleep_notes as string) ?? null,
    socialEatingNotes: (data.social_eating_notes as string) ?? null,
    recoveryPattern: (data.recovery_pattern as string) ?? null,
    weeklyBudgetPattern: (data.weekly_budget_pattern as string) ?? null,
    menstrualNotes: (data.menstrual_notes as string) ?? null,
    microNutrientRisks: (data.micro_nutrient_risks as { nutrient: string; risk_level: string }[]) ?? [],
    habitProgress: (data.habit_progress as { habit: string; status: string; streak?: number }[]) ?? [],
    learnedMealTimes: (data.learned_meal_times as Record<string, string>) ?? null,
    seasonalNotes: (data.seasonal_notes as string) ?? null,
    supplementNotes: (data.supplement_notes as string) ?? null,
    featuresIntroduced: (data.features_introduced as string[]) ?? [],
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

// ─── Photo Cleanup (Phase 7) ───

/**
 * Schedule photo cleanup — delete food photos 24h after parse.
 * Creates a scheduled cleanup entry.
 */
export async function schedulePhotoCleanup(
  userId: string,
  photoUrl: string
): Promise<void> {
  const deleteAt = new Date(Date.now() + 24 * 3600000).toISOString();
  await supabase.from('scheduled_cleanups').upsert({
    user_id: userId,
    resource_type: 'meal_photo',
    resource_id: photoUrl,
    scheduled_at: deleteAt,
    status: 'pending',
  });
}

// ─── KVKK Audit Log (Phase 7) ───

/**
 * Log a KVKK/GDPR audit event.
 */
export async function logAuditEvent(
  userId: string,
  eventType: string,
  description: string
): Promise<void> {
  await supabase.from('audit_logs').insert({
    user_id: userId,
    event_type: eventType,
    description,
  });
}

// ─── Data Minimization (Phase 7) ───

/**
 * Apply data minimization for records older than 2 years.
 * Detailed meal items are aggregated into daily summaries.
 */
export async function applyDataMinimization(userId: string): Promise<{ count: number }> {
  const twoYearsAgo = new Date(Date.now() - 730 * 86400000).toISOString().split('T')[0];

  const { data: oldLogs } = await supabase
    .from('meal_logs')
    .select('id')
    .eq('user_id', userId)
    .lt('logged_for_date', twoYearsAgo);

  // Server-side aggregation would be handled by a scheduled function.
  // Client-side just reports the count.
  return { count: (oldLogs ?? []).length };
}

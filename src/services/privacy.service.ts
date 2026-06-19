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

  // Mark profile for deletion (don't actually delete yet). deleted_at is set
  // too so this path behaves identically to the settings-screen path — the
  // re-login reactivation watches these flags, and leaving deleted_at null
  // here used to let the day-30 cron hard-delete a RETURNED user.
  const { error } = await supabase.from('profiles').update({
    deletion_requested_at: new Date().toISOString(),
    deleted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as never).eq('id', userId);
  if (error) throw new Error(error.message);

  // KVKK audit trail — record the deletion request (#R5-3). Best-effort: the audit
  // row lives in audit_logs (cascade-deleted with the account after the grace
  // period), so it is a within-grace-window proof, not a post-deletion record.
  await logAuditEvent(userId, 'account_delete_request', 'Kullanici hesap silme talebinde bulundu', {
    scheduled_deletion_date: scheduledDate.toISOString().split('T')[0],
  }).catch(() => {});

  return { scheduledDate: scheduledDate.toISOString().split('T')[0] };
}

/**
 * Cancel account deletion (user logged back in within 30 days).
 */
export async function cancelAccountDeletion(userId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({
    deletion_requested_at: null,
    updated_at: new Date().toISOString(),
  } as never).eq('id', userId);
  if (error) throw new Error(error.message);

  await logAuditEvent(userId, 'account_delete_cancel', 'Kullanici hesap silme talebini iptal etti').catch(() => {});
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
    .maybeSingle();

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
    .maybeSingle();

  if (!data) return;

  const currentValue = (data as unknown as Record<string, unknown>)[field];

  if (typeof currentValue === 'string') {
    // Remove the note from text
    const updated = (currentValue as string).replace(noteToDelete, '').replace(/\n\n+/g, '\n\n').trim();
    const { data: upd, error } = await supabase.from('ai_summary').update({ [field]: updated } as never).eq('user_id', userId).select('user_id');
    if (error) throw new Error(error.message);
    if (!upd || upd.length === 0) throw new Error('Not silinemedi (kayıt güncellenmedi).');
  } else if (Array.isArray(currentValue)) {
    // Remove from array (patterns, habits, etc.)
    const updated = (currentValue as { description: string }[]).filter(
      item => !item.description?.includes(noteToDelete)
    );
    const { data: upd, error } = await supabase.from('ai_summary').update({ [field]: updated } as never).eq('user_id', userId).select('user_id');
    if (error) throw new Error(error.message);
    if (!upd || upd.length === 0) throw new Error('Not silinemedi (kayıt güncellenmedi).');
  }
}

/**
 * Clear entire Katman 2 (AI summary) - nuclear option.
 * User explicitly requests full memory reset.
 */
export async function resetAISummary(userId: string): Promise<void> {
  const { data, error } = await supabase.from('ai_summary').update({
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
    // Previously-missed learned fields — a "full" KVKK reset must clear these too (#R5-6).
    learned_meal_times: {},
    snacking_hours: [],
    seasonal_notes: null,
    tdee_notes: null,
    updated_at: new Date().toISOString(),
  } as never).eq('user_id', userId).select('user_id');
  if (error) throw new Error(error.message);
  // A PostgREST UPDATE affecting 0 rows is EITHER an RLS regression OR the user
  // simply has no ai_summary row yet (nothing to reset). Distinguish: only fail if
  // a row actually exists but wasn't updated — a missing row means already-clear,
  // so we must NOT throw a false "reset failed" (#R5-10).
  if (!data || data.length === 0) {
    const { count } = await supabase.from('ai_summary')
      .select('user_id', { count: 'exact', head: true }).eq('user_id', userId);
    if ((count ?? 0) > 0) throw new Error('Hafıza sıfırlanamadı (kayıt güncellenmedi).');
  }
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
  const { error } = await supabase.from('scheduled_cleanups').upsert({
    user_id: userId,
    resource_type: 'meal_photo',
    resource_id: photoUrl,
    scheduled_at: deleteAt,
    status: 'pending',
  });
  if (error) throw new Error(error.message);
}

// ─── KVKK Audit Log (Phase 7) ───

/**
 * Log a KVKK/GDPR audit event.
 */
export async function logAuditEvent(
  userId: string,
  eventType: string,
  description: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('audit_logs').insert({
    user_id: userId,
    event_type: eventType,
    description,
    ...(metadata ? { metadata } : {}),
  });
  if (error) console.error('[audit] log insert failed', eventType, error);
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

/**
 * KVKK Audit Log Service
 * Spec 13: Gizlilik ve veri güvenliği — denetim loglama
 *
 * Veri erişim, export, silme olaylarını loglar.
 * KVKK/GDPR uyumluluk için gerekli.
 */
import { supabase } from '@/lib/supabase';

// ─── Types ───

export type AuditEventType =
  | 'data_export'
  | 'data_view'
  | 'data_delete'
  | 'ai_summary_view'
  | 'ai_summary_edit'
  | 'ai_summary_delete'
  | 'account_delete_request'
  | 'account_delete_cancel'
  | 'photo_upload'
  | 'photo_delete'
  | 'profile_update';

export interface AuditEvent {
  id?: string;
  event_type: AuditEventType;
  description: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

// ─── Core Functions ───

/**
 * Log an audit event.
 */
export async function logAuditEvent(
  userId: string,
  eventType: AuditEventType,
  description: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await supabase.from('audit_logs').insert({
    user_id: userId,
    event_type: eventType,
    description,
    metadata: metadata ?? null,
    ip_address: null, // Not available on client
  });
}

/**
 * Get audit history for a user.
 */
export async function getAuditHistory(
  userId: string,
  limit = 50
): Promise<AuditEvent[]> {
  const { data } = await supabase
    .from('audit_logs')
    .select('id, event_type, description, metadata, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as AuditEvent[];
}

// ─── Photo Cleanup ───

/**
 * Schedule photo cleanup — mark photo for deletion 24h after parse.
 */
export async function schedulePhotoCleanup(
  userId: string,
  photoId: string
): Promise<void> {
  const deleteAt = new Date(Date.now() + 24 * 3600000).toISOString();

  await supabase.from('scheduled_cleanups').insert({
    user_id: userId,
    resource_type: 'meal_photo',
    resource_id: photoId,
    scheduled_at: deleteAt,
    status: 'pending',
  });

  await logAuditEvent(userId, 'photo_upload', `Yemek fotosu yuklendi, 24 saat sonra silinecek`, { photoId });
}

// ─── Data Minimization ───

/**
 * Apply data minimization for old records (2+ years).
 * Aggregates detailed meal logs into daily summaries.
 */
export async function applyDataMinimization(userId: string): Promise<{
  aggregated: number;
  message: string;
}> {
  const twoYearsAgo = new Date(Date.now() - 730 * 86400000).toISOString().split('T')[0];

  // Count old detailed records
  const { count } = await supabase
    .from('meal_log_items')
    .select('id', { count: 'exact', head: true })
    .in('meal_log_id',
      (await supabase.from('meal_logs').select('id').eq('user_id', userId).lt('logged_for_date', twoYearsAgo))
        .data?.map((m: { id: string }) => m.id) ?? []
    );

  const oldCount = count ?? 0;

  if (oldCount === 0) {
    return { aggregated: 0, message: 'Minimizasyon gerekmiyor.' };
  }

  // Note: Actual aggregation would be done server-side via a scheduled function.
  // This client-side service just identifies and logs the need.
  await logAuditEvent(userId, 'data_view', `Veri minimizasyonu kontrolu: ${oldCount} eski kayit bulundu`);

  return {
    aggregated: oldCount,
    message: `${oldCount} adet 2+ yillik kayit aggrege edilecek.`,
  };
}

// ─── KVKK Compliance Helpers ───

/**
 * Log data export for KVKK compliance.
 */
export async function logDataExport(
  userId: string,
  format: 'json' | 'csv' | 'pdf',
  dataTypes: string[]
): Promise<void> {
  await logAuditEvent(userId, 'data_export', `Veri export: ${format.toUpperCase()} formati`, {
    format,
    dataTypes,
    exportedAt: new Date().toISOString(),
  });
}

/**
 * Log AI summary access for KVKK compliance.
 */
export async function logAISummaryAccess(
  userId: string,
  action: 'view' | 'edit' | 'delete'
): Promise<void> {
  const eventMap: Record<string, AuditEventType> = {
    view: 'ai_summary_view',
    edit: 'ai_summary_edit',
    delete: 'ai_summary_delete',
  };

  await logAuditEvent(userId, eventMap[action], `AI ozeti ${action === 'view' ? 'goruntulendi' : action === 'edit' ? 'duzenlendi' : 'silindi'}`);
}

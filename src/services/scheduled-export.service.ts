/**
 * Scheduled Export Service
 * Spec 18.2: Zamanlanmış otomatik veri export
 *
 * Users can schedule weekly or monthly automatic data backups.
 */
import { supabase } from '@/lib/supabase';

export type ExportFrequency = 'weekly' | 'monthly' | 'off';

export interface ScheduledExportSettings {
  frequency: ExportFrequency;
  format: 'json' | 'csv';
  includeAISummary: boolean;
  lastExportedAt: string | null;
  nextExportAt: string | null;
}

const DEFAULT_SETTINGS: ScheduledExportSettings = {
  frequency: 'off',
  format: 'json',
  includeAISummary: true,
  lastExportedAt: null,
  nextExportAt: null,
};

/**
 * Get scheduled export settings.
 */
export async function getScheduledExportSettings(): Promise<ScheduledExportSettings> {
  const { data } = await supabase.from('profiles').select('scheduled_export_settings').single();
  if (data?.scheduled_export_settings && typeof data.scheduled_export_settings === 'object') {
    return { ...DEFAULT_SETTINGS, ...(data.scheduled_export_settings as Partial<ScheduledExportSettings>) };
  }
  return DEFAULT_SETTINGS;
}

/**
 * Update scheduled export settings.
 */
export async function updateScheduledExportSettings(
  settings: Partial<ScheduledExportSettings>,
): Promise<void> {
  const current = await getScheduledExportSettings();
  const merged = { ...current, ...settings };

  // Calculate next export date
  if (merged.frequency !== 'off') {
    const now = new Date();
    if (merged.frequency === 'weekly') {
      now.setDate(now.getDate() + 7);
    } else {
      now.setMonth(now.getMonth() + 1);
    }
    merged.nextExportAt = now.toISOString();
  } else {
    merged.nextExportAt = null;
  }

  await supabase.from('profiles').update({ scheduled_export_settings: merged as never }).single();
}

/**
 * Check if export is due.
 */
export function isExportDue(settings: ScheduledExportSettings): boolean {
  if (settings.frequency === 'off' || !settings.nextExportAt) return false;
  return new Date() >= new Date(settings.nextExportAt);
}

/**
 * Mark export as completed and schedule next one.
 */
export async function markExportCompleted(): Promise<void> {
  const settings = await getScheduledExportSettings();
  settings.lastExportedAt = new Date().toISOString();

  const next = new Date();
  if (settings.frequency === 'weekly') {
    next.setDate(next.getDate() + 7);
  } else if (settings.frequency === 'monthly') {
    next.setMonth(next.getMonth() + 1);
  }
  settings.nextExportAt = settings.frequency !== 'off' ? next.toISOString() : null;

  await supabase.from('profiles').update({ scheduled_export_settings: settings as never }).single();
}

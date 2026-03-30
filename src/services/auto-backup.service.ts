/**
 * Auto Backup Service
 * Spec 18.2: Zamanlanmış otomatik veri yedeği.
 *
 * Periodic export of user data (weekly/monthly).
 * Supports email delivery or local file save.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { exportJSON } from './export.service';

const LAST_BACKUP_KEY = '@kochko_last_backup';

export type BackupFrequency = 'weekly' | 'monthly' | 'never';

interface BackupConfig {
  frequency: BackupFrequency;
  includeLayer2: boolean;
  lastBackupAt: string | null;
}

/**
 * Get current backup configuration.
 */
export async function getBackupConfig(): Promise<BackupConfig> {
  const raw = await AsyncStorage.getItem(LAST_BACKUP_KEY);
  if (raw) return JSON.parse(raw);
  return { frequency: 'never', includeLayer2: true, lastBackupAt: null };
}

/**
 * Update backup configuration.
 */
export async function updateBackupConfig(config: Partial<BackupConfig>): Promise<void> {
  const current = await getBackupConfig();
  const updated = { ...current, ...config };
  await AsyncStorage.setItem(LAST_BACKUP_KEY, JSON.stringify(updated));
}

/**
 * Check if backup is due and trigger if needed.
 * Call this on app startup.
 */
export async function checkAndRunBackup(): Promise<boolean> {
  const config = await getBackupConfig();
  if (config.frequency === 'never') return false;
  if (!config.lastBackupAt) {
    // First backup
    await runBackup();
    return true;
  }

  const lastBackup = new Date(config.lastBackupAt);
  const now = new Date();
  const daysSince = Math.floor((now.getTime() - lastBackup.getTime()) / 86400000);

  const threshold = config.frequency === 'weekly' ? 7 : 30;
  if (daysSince >= threshold) {
    await runBackup();
    return true;
  }

  return false;
}

/**
 * Run the actual backup (export data via share sheet).
 */
async function runBackup(): Promise<void> {
  try {
    await exportJSON();
    await updateBackupConfig({ lastBackupAt: new Date().toISOString() });
  } catch {
    // Non-critical - backup failure shouldn't break the app
  }
}

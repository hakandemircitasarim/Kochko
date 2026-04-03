/**
 * Real-time Sync Service
 * Spec 14: Çoklu cihaz desteği — gerçek zamanlı senkronizasyon
 *
 * Supabase Realtime kanalları ile meal_logs, daily_metrics, chat_messages senkronize eder.
 * Çakışma çözümü: son zaman damgası kazanır.
 */
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ───

export type SyncStatus = 'connected' | 'disconnected' | 'syncing' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: string | null;
  pendingChanges: number;
  deviceCount: number;
}

type ChangeCallback = (table: string, payload: Record<string, unknown>) => void;

const SYNC_KEY = '@kochko_last_sync';
const TABLES_TO_SYNC = ['meal_logs', 'daily_metrics', 'chat_messages', 'daily_plans'];

// ─── Subscription Management ───

let activeChannels: ReturnType<typeof supabase.channel>[] = [];
let onChangeCallback: ChangeCallback | null = null;

/**
 * Subscribe to real-time changes for a user's data.
 */
export function subscribeToChanges(userId: string, onChange: ChangeCallback): void {
  unsubscribeAll(); // Clean up previous subscriptions
  onChangeCallback = onChange;

  for (const table of TABLES_TO_SYNC) {
    const channel = supabase
      .channel(`${table}_${userId}`)
      .on(
        'postgres_changes' as 'system',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `user_id=eq.${userId}`,
        } as Record<string, unknown>,
        (payload: Record<string, unknown>) => {
          onChangeCallback?.(table, payload);
          updateLastSync();
        }
      )
      .subscribe();

    activeChannels.push(channel);
  }

  updateSyncStatus('connected');
}

/**
 * Unsubscribe from all real-time channels.
 */
export function unsubscribeAll(): void {
  for (const channel of activeChannels) {
    supabase.removeChannel(channel);
  }
  activeChannels = [];
  onChangeCallback = null;
  updateSyncStatus('disconnected');
}

// ─── Sync State ───

let currentSyncState: SyncState = {
  status: 'disconnected',
  lastSyncAt: null,
  pendingChanges: 0,
  deviceCount: 1,
};

function updateSyncStatus(status: SyncStatus): void {
  currentSyncState = { ...currentSyncState, status };
}

async function updateLastSync(): Promise<void> {
  const now = new Date().toISOString();
  currentSyncState = { ...currentSyncState, lastSyncAt: now };
  await AsyncStorage.setItem(SYNC_KEY, now);
}

/**
 * Get current sync state.
 */
export function getSyncState(): SyncState {
  return { ...currentSyncState };
}

/**
 * Get last sync timestamp.
 */
export async function getLastSyncTime(): Promise<string | null> {
  return AsyncStorage.getItem(SYNC_KEY);
}

// ─── Conflict Resolution ───

/**
 * Resolve sync conflict between local and remote data.
 * Strategy: last-write-wins for profiles, append for logs.
 */
export function resolveConflict(
  table: string,
  localData: Record<string, unknown>,
  remoteData: Record<string, unknown>
): Record<string, unknown> {
  const localTime = new Date(localData.updated_at as string ?? localData.logged_at as string ?? 0).getTime();
  const remoteTime = new Date(remoteData.updated_at as string ?? remoteData.logged_at as string ?? 0).getTime();

  // For log tables, both are kept (append strategy)
  if (['meal_logs', 'workout_logs', 'supplement_logs'].includes(table)) {
    return remoteData; // Accept remote, local is already persisted
  }

  // For metric/profile tables, latest wins
  return remoteTime >= localTime ? remoteData : localData;
}

// ─── Session Management ───

/**
 * Get active sessions for the current user.
 */
export async function getActiveSessions(): Promise<{
  sessionId: string;
  deviceInfo: string;
  lastActiveAt: string;
}[]> {
  const { data } = await supabase
    .from('user_sessions')
    .select('id, device_info, last_active_at')
    .order('last_active_at', { ascending: false })
    .limit(10);

  return (data ?? []).map(s => ({
    sessionId: s.id as string,
    deviceInfo: s.device_info as string ?? 'Bilinmeyen cihaz',
    lastActiveAt: s.last_active_at as string,
  }));
}

/**
 * Terminate a specific session by deleting its record.
 */
export async function terminateSession(sessionId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('user_sessions')
    .delete()
    .eq('id', sessionId);
  return { error: error?.message ?? null };
}

/**
 * Force sync — pull latest data from server.
 */
export async function forceSync(userId: string): Promise<{ synced: boolean; error: string | null }> {
  try {
    updateSyncStatus('syncing');

    // Pull latest data for key tables
    const [mealsRes, metricsRes, plansRes] = await Promise.all([
      supabase.from('meal_logs').select('*').eq('user_id', userId).order('logged_at', { ascending: false }).limit(50),
      supabase.from('daily_metrics').select('*').eq('user_id', userId).order('date', { ascending: false }).limit(14),
      supabase.from('daily_plans').select('*').eq('user_id', userId).order('date', { ascending: false }).limit(7),
    ]);

    if (mealsRes.error || metricsRes.error || plansRes.error) {
      updateSyncStatus('error');
      return { synced: false, error: 'Senkronizasyon basarisiz' };
    }

    await updateLastSync();
    updateSyncStatus('connected');
    return { synced: true, error: null };
  } catch {
    updateSyncStatus('error');
    return { synced: false, error: 'Baglanti hatasi' };
  }
}

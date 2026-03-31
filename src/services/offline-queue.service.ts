/**
 * Offline Queue Service
 * Spec 11: Offline çalışma ve senkronizasyon.
 *
 * Stores actions in AsyncStorage when offline.
 * Syncs when connection returns.
 * Conflict resolution: append for logs, last-write-wins for profile.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import NetInfo from '@react-native-community/netinfo';
import { resolveConflict, type SyncDataType } from './conflict-resolver.service';

const QUEUE_KEY = '@kochko_offline_queue';
const LAST_SYNC_KEY = '@kochko_last_sync';

export interface QueuedAction {
  id: string;
  type: 'meal_log' | 'workout_log' | 'water_log' | 'weight_log' | 'sleep_log' | 'mood_log' | 'supplement_log' | 'profile_update';
  table: string;
  data: Record<string, unknown>;
  timestamp: string;
  userId: string;
}

/**
 * Check if device is online.
 */
export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true;
}

/**
 * Add an action to the offline queue.
 */
export async function enqueue(action: Omit<QueuedAction, 'id' | 'timestamp'>): Promise<void> {
  const queue = await getQueue();
  queue.push({
    ...action,
    id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
  });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Get current offline queue.
 */
export async function getQueue(): Promise<QueuedAction[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

/**
 * Sync all queued actions to Supabase.
 * Spec 11.3: Append strategy for logs, last-write-wins for profile.
 */
export async function syncQueue(): Promise<{ synced: number; failed: number }> {
  const online = await isOnline();
  if (!online) return { synced: 0, failed: 0 };

  const queue = await getQueue();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  const remaining: QueuedAction[] = [];

  for (const action of queue) {
    try {
      const dataType = mapActionTypeToSyncType(action.type);

      if (dataType === 'profile') {
        // Fetch server version to resolve conflict
        const { data: serverData } = await supabase.from(action.table)
          .select('*').eq('id', action.userId).single();

        if (serverData) {
          const result = resolveConflict(action.data as Record<string, unknown>, serverData, 'profile');
          if (result.winner === 'server') {
            // Server wins, discard local change
            synced++;
            continue;
          }
        }
        await supabase.from(action.table)
          .update({ ...action.data, synced: true })
          .eq('id', action.userId);
      } else if (dataType === 'daily_metrics') {
        // Merge strategy for daily metrics
        const recordDate = (action.data as Record<string, unknown>).date as string;
        const { data: serverData } = await supabase.from(action.table)
          .select('*').eq('user_id', action.userId).eq('date', recordDate).single();

        if (serverData) {
          const result = resolveConflict(action.data as Record<string, unknown>, serverData, 'daily_metrics');
          await supabase.from(action.table)
            .upsert({ ...(result.data as Record<string, unknown>), synced: true }, { onConflict: 'user_id,date' });
        } else {
          await supabase.from(action.table)
            .upsert({ ...action.data, synced: true }, { onConflict: 'user_id,date' });
        }
      } else {
        // Append for log data (meal_log, workout_log, supplement_log, etc.)
        await supabase.from(action.table)
          .upsert({ ...action.data, synced: true });
      }
      synced++;
    } catch {
      failed++;
      remaining.push(action);
    }
  }

  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
  return { synced, failed };
}

/**
 * Map queue action type to sync data type for conflict resolution.
 */
function mapActionTypeToSyncType(actionType: QueuedAction['type']): SyncDataType | null {
  switch (actionType) {
    case 'meal_log': return 'meal_log';
    case 'workout_log': return 'workout_log';
    case 'supplement_log': return 'supplement_log';
    case 'profile_update': return 'profile';
    default: return null;
  }
}

/**
 * Clear the offline queue (after successful full sync or user reset).
 */
export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

/**
 * Get queue count for UI indicator.
 */
export async function getQueueCount(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}

/**
 * Get detailed queue status for sync UI.
 */
export async function getQueueStatus(): Promise<{
  pending: number;
  failed: number;
  lastSyncAt: string | null;
}> {
  const queue = await getQueue();
  const lastSyncAt = await AsyncStorage.getItem(LAST_SYNC_KEY);
  // Count items that have been attempted before (they remain in queue = failed on last attempt)
  // For now, all items in queue are pending; failed count comes from last sync result
  return {
    pending: queue.length,
    failed: 0,
    lastSyncAt,
  };
}

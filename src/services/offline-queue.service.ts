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

const QUEUE_KEY = '@kochko_offline_queue';

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
      if (action.type === 'profile_update') {
        // Last-write-wins for profile
        await supabase.from(action.table)
          .update({ ...action.data, synced: true })
          .eq('id', action.userId);
      } else {
        // Append for log data (insert, let DB handle conflicts)
        await supabase.from(action.table)
          .upsert({ ...action.data, synced: true }, {
            onConflict: action.table === 'daily_metrics' ? 'user_id,date' : undefined,
          });
      }
      synced++;
    } catch {
      failed++;
      remaining.push(action);
    }
  }

  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { synced, failed };
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

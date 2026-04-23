/**
 * Offline Queue Service
 * Spec 11: Offline çalışma ve senkronizasyon.
 *
 * Stores actions encrypted at rest via expo-secure-store (iOS Keychain /
 * Android Keystore-backed EncryptedSharedPreferences). Each queue item lives
 * under its own SecureStore key to stay under the per-item size limit; a
 * small index key holds the list of outstanding ids.
 *
 * Syncs when connection returns. Conflict resolution: append for logs,
 * last-write-wins for profile.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import NetInfo from '@react-native-community/netinfo';
import { resolveConflict, type SyncDataType } from './conflict-resolver.service';

const QUEUE_INDEX_KEY = 'kochko_offline_queue_index';
const QUEUE_ITEM_PREFIX = 'kochko_offline_queue_item_';
const LEGACY_QUEUE_KEY = '@kochko_offline_queue';
const LAST_SYNC_KEY = '@kochko_last_sync';

export interface QueuedAction {
  id: string;
  type: 'meal_log' | 'workout_log' | 'water_log' | 'weight_log' | 'sleep_log' | 'mood_log' | 'supplement_log' | 'profile_update';
  table: string;
  data: Record<string, unknown>;
  timestamp: string;
  userId: string;
}

function itemKey(id: string): string {
  return QUEUE_ITEM_PREFIX + id.replace(/[^A-Za-z0-9._-]/g, '');
}

async function readIndex(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(QUEUE_INDEX_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

async function writeIndex(ids: string[]): Promise<void> {
  await SecureStore.setItemAsync(QUEUE_INDEX_KEY, JSON.stringify(ids));
}

/**
 * One-time migration: if a legacy plaintext queue exists in AsyncStorage,
 * move its items into SecureStore and wipe the old key. Idempotent — safe to
 * call on every getQueue() invocation.
 */
async function migrateLegacyQueue(): Promise<void> {
  const legacy = await AsyncStorage.getItem(LEGACY_QUEUE_KEY);
  if (!legacy) return;
  try {
    const items = JSON.parse(legacy) as QueuedAction[];
    const existingIds = await readIndex();
    const idSet = new Set(existingIds);
    for (const item of items) {
      if (!idSet.has(item.id)) {
        await SecureStore.setItemAsync(itemKey(item.id), JSON.stringify(item));
        idSet.add(item.id);
      }
    }
    await writeIndex(Array.from(idSet));
  } catch {
    // malformed legacy data — drop it rather than keep replaying migration
  }
  await AsyncStorage.removeItem(LEGACY_QUEUE_KEY);
}

export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true;
}

export async function enqueue(action: Omit<QueuedAction, 'id' | 'timestamp'>): Promise<void> {
  await migrateLegacyQueue();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const item: QueuedAction = {
    ...action,
    id,
    timestamp: new Date().toISOString(),
  };
  await SecureStore.setItemAsync(itemKey(id), JSON.stringify(item));
  const ids = await readIndex();
  ids.push(id);
  await writeIndex(ids);
}

export async function getQueue(): Promise<QueuedAction[]> {
  await migrateLegacyQueue();
  const ids = await readIndex();
  const items: QueuedAction[] = [];
  for (const id of ids) {
    const raw = await SecureStore.getItemAsync(itemKey(id));
    if (raw) {
      try { items.push(JSON.parse(raw) as QueuedAction); } catch { /* drop corrupt */ }
    }
  }
  return items;
}

async function removeItems(ids: string[]): Promise<void> {
  await Promise.all(ids.map(id => SecureStore.deleteItemAsync(itemKey(id))));
  const index = await readIndex();
  const remaining = index.filter(id => !ids.includes(id));
  await writeIndex(remaining);
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
  const syncedIds: string[] = [];

  for (const action of queue) {
    try {
      const dataType = mapActionTypeToSyncType(action.type);

      if (dataType === 'profile') {
        const { data: serverData } = await supabase.from(action.table)
          .select('*').eq('id', action.userId).single();

        if (serverData) {
          const result = resolveConflict(action.data as Record<string, unknown>, serverData, 'profile');
          if (result.winner === 'server') {
            syncedIds.push(action.id);
            synced++;
            continue;
          }
        }
        await supabase.from(action.table)
          .update({ ...action.data, synced: true })
          .eq('id', action.userId);
      } else if (dataType === 'daily_metrics') {
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
        await supabase.from(action.table)
          .upsert({ ...action.data, synced: true });
      }
      syncedIds.push(action.id);
      synced++;
    } catch {
      failed++;
    }
  }

  if (syncedIds.length > 0) await removeItems(syncedIds);
  await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
  return { synced, failed };
}

function mapActionTypeToSyncType(actionType: QueuedAction['type']): SyncDataType | null {
  switch (actionType) {
    case 'meal_log': return 'meal_log';
    case 'workout_log': return 'workout_log';
    case 'supplement_log': return 'supplement_log';
    case 'profile_update': return 'profile';
    default: return null;
  }
}

export async function clearQueue(): Promise<void> {
  const ids = await readIndex();
  await Promise.all(ids.map(id => SecureStore.deleteItemAsync(itemKey(id))));
  await SecureStore.deleteItemAsync(QUEUE_INDEX_KEY);
  await AsyncStorage.removeItem(LEGACY_QUEUE_KEY);
}

export async function getQueueCount(): Promise<number> {
  await migrateLegacyQueue();
  const ids = await readIndex();
  return ids.length;
}

export function setupAutoSync(): () => void {
  const unsubscribe = NetInfo.addEventListener(state => {
    if (state.isConnected) {
      syncQueue().catch(() => {});
    }
  });
  return unsubscribe;
}

export async function getQueueStatus(): Promise<{
  pending: number;
  failed: number;
  lastSyncAt: string | null;
}> {
  const pending = await getQueueCount();
  const lastSyncAt = await AsyncStorage.getItem(LAST_SYNC_KEY);
  return { pending, failed: 0, lastSyncAt };
}

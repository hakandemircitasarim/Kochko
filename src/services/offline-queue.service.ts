/**
 * Offline Queue Service — Spec 11
 * Queues logs when offline, flushes when connectivity returns.
 * Uses AsyncStorage as local queue.
 *
 * Conflict resolution (Spec 11.3):
 * - Meal/workout/metric logs: append (no data loss)
 * - Profile changes: last-write-wins
 * - Plans: server version wins
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

const QUEUE_KEY = '@kochko_offline_queue';

interface QueuedAction {
  id: string;
  table: string;
  operation: 'insert' | 'upsert' | 'update';
  data: Record<string, unknown>;
  conflictKey?: string;
  createdAt: string;
}

/**
 * Add an action to the offline queue.
 */
export async function enqueue(
  table: string,
  operation: 'insert' | 'upsert' | 'update',
  data: Record<string, unknown>,
  conflictKey?: string,
): Promise<void> {
  const queue = await getQueue();
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    table,
    operation,
    data,
    conflictKey,
    createdAt: new Date().toISOString(),
  });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Flush all queued actions to Supabase.
 * Call this when connectivity is restored.
 */
export async function flushQueue(): Promise<{ flushed: number; failed: number }> {
  const queue = await getQueue();
  if (queue.length === 0) return { flushed: 0, failed: 0 };

  let flushed = 0;
  let failed = 0;
  const remaining: QueuedAction[] = [];

  for (const action of queue) {
    try {
      if (action.operation === 'insert') {
        const { error } = await supabase.from(action.table).insert(action.data);
        if (error) throw error;
      } else if (action.operation === 'upsert') {
        const { error } = await supabase
          .from(action.table)
          .upsert(action.data, action.conflictKey ? { onConflict: action.conflictKey } : undefined);
        if (error) throw error;
      } else if (action.operation === 'update') {
        // data must include id for update
        const { id, ...rest } = action.data;
        const { error } = await supabase.from(action.table).update(rest).eq('id', id);
        if (error) throw error;
      }
      flushed++;
    } catch {
      failed++;
      remaining.push(action); // Keep failed items for retry
    }
  }

  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { flushed, failed };
}

/**
 * Get current queue size.
 */
export async function getQueueSize(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}

/**
 * Clear the entire queue (use with caution).
 */
export async function clearQueue(): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([]));
}

async function getQueue(): Promise<QueuedAction[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as QueuedAction[]; }
  catch { return []; }
}

import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  task_mode?: string;
  created_at: string;
}

export interface ChatResponse {
  message: string;
  actions: { type: string; feedback: string | null }[];
  task_mode: string;
}

const CACHE_KEY = '@kochko_chat_cache';
const OFFLINE_QUEUE_KEY = '@kochko_chat_offline_queue';
const MAX_MESSAGE_LENGTH = 2000;
const MAX_RETRIES = 3;

// ─── Validation ───

export function validateMessage(text: string): { valid: boolean; error: string | null } {
  if (!text || !text.trim()) return { valid: false, error: 'Mesaj bos olamaz.' };
  if (text.length > MAX_MESSAGE_LENGTH) return { valid: false, error: `Mesaj cok uzun (max ${MAX_MESSAGE_LENGTH} karakter).` };
  return { valid: true, error: null };
}

// ─── Core Send Functions ───

export async function sendMessage(text: string): Promise<{ data: ChatResponse | null; error: string | null }> {
  const validation = validateMessage(text);
  if (!validation.valid) return { data: null, error: validation.error };

  const { data, error } = await supabase.functions.invoke('ai-chat', { body: { message: text } });
  if (error) return { data: null, error: error.message };
  return { data: data as ChatResponse, error: null };
}

export async function sendMessageWithRetry(
  text: string,
  maxRetries = MAX_RETRIES,
): Promise<{ data: ChatResponse | null; error: string | null }> {
  const validation = validateMessage(text);
  if (!validation.valid) return { data: null, error: validation.error };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { data, error } = await supabase.functions.invoke('ai-chat', { body: { message: text } });
    if (!error && data) return { data: data as ChatResponse, error: null };

    // Last attempt — return error
    if (attempt === maxRetries) return { data: null, error: error?.message ?? 'Baglanti hatasi. Lutfen tekrar dene.' };

    // Exponential backoff: 1s, 2s, 4s
    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
  }

  return { data: null, error: 'Baglanti hatasi.' };
}

export async function sendMessageWithPhoto(text: string, imageUri: string): Promise<{ data: ChatResponse | null; error: string | null }> {
  try {
    const base64 = await FileSystem.readAsStringAsync(imageUri, { encoding: 'base64' as const });
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { message: text, image_base64: base64 },
    });
    if (error) return { data: null, error: error.message };
    return { data: data as ChatResponse, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

// ─── History with Cache ───

export async function loadChatHistory(limit = 50): Promise<ChatMessage[]> {
  try {
    const { data } = await supabase
      .from('chat_messages')
      .select('id, role, content, task_mode, created_at')
      .order('created_at', { ascending: true })
      .limit(limit);
    const messages = (data as ChatMessage[]) ?? [];

    // Cache locally for offline access
    if (messages.length > 0) {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(messages.slice(-20)));
    }

    return messages;
  } catch {
    // Fallback to cache if network fails
    return getCachedHistory();
  }
}

export async function getCachedHistory(): Promise<ChatMessage[]> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) as ChatMessage[] : [];
  } catch {
    return [];
  }
}

// ─── Offline Queue ───

interface QueuedMessage {
  text: string;
  queuedAt: string;
  targetDate?: string;
}

export async function queueMessageOffline(text: string, targetDate?: string): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    const queue: QueuedMessage[] = existing ? JSON.parse(existing) : [];
    queue.push({ text, queuedAt: new Date().toISOString(), targetDate });
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch { /* best effort */ }
}

export async function processOfflineQueue(): Promise<number> {
  try {
    const existing = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!existing) return 0;

    const queue: QueuedMessage[] = JSON.parse(existing);
    let sent = 0;

    for (const msg of queue) {
      const { error } = msg.targetDate
        ? await sendMessageForDate(msg.text, msg.targetDate)
        : await sendMessage(msg.text);
      if (!error) sent++;
    }

    // Clear processed messages
    if (sent > 0) {
      const remaining = queue.slice(sent);
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    }

    return sent;
  } catch {
    return 0;
  }
}

export async function getOfflineQueueSize(): Promise<number> {
  try {
    const existing = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    return existing ? (JSON.parse(existing) as QueuedMessage[]).length : 0;
  } catch {
    return 0;
  }
}

// ─── Batch/Retroactive Entry ───

export async function sendMessageForDate(text: string, targetDate: string): Promise<{ data: ChatResponse | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: { message: `[${targetDate} icin kayit] ${text}`, target_date: targetDate },
  });
  if (error) return { data: null, error: error.message };
  return { data: data as ChatResponse, error: null };
}

// ─── AI Summary / Insights ───

export async function loadInsights(): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from('ai_summary').select('*').single();
  return data;
}

import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  task_mode?: string;
  created_at: string;
  actions_executed?: { type: string }[] | null;
}

export interface TaskCompletion {
  completed: string;
  summary: string;
  next_suggestions: string[];
}

export interface ChatResponse {
  message: string;
  actions: { type: string; feedback: string | null }[];
  task_mode: string;
  task_completion?: TaskCompletion | null;
  plan_snapshot?: Record<string, unknown> | null;
  plan_reasoning?: string | null;
  plan_persist_error?: string | null;
  plan_approved?: { id: string } | null;
  navigate_to?: string | null;
}

// Plan chat invocation — used by plan/diet.tsx and plan/workout.tsx screens.
export async function invokePlanChat(params: {
  sessionId: string;
  message: string;
  planType: 'diet' | 'workout';
  userApproved?: boolean;
  draftId?: string;
}): Promise<{ data: ChatResponse | null; error: string | null }> {
  const body: Record<string, unknown> = {
    message: params.message,
    session_id: params.sessionId,
    task_mode_hint: params.planType === 'diet' ? 'plan_diet' : 'plan_workout',
    plan_type: params.planType,
  };
  if (params.userApproved) body.user_approved = true;
  if (params.draftId) body.draft_id = params.draftId;
  try {
    const { data, error } = await supabase.functions.invoke('ai-chat', { body });
    if (error) return { data: null, error: error.message };
    return { data: data as ChatResponse, error: null };
  } catch (e) {
    return { data: null, error: (e as Error).message };
  }
}

const CACHE_KEY = '@kochko_chat_cache';
const OFFLINE_QUEUE_KEY = '@kochko_chat_offline_queue';
const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_MAX_RETRIES = 2; // 2 retries = 3 total attempts (1s, 3s backoff)

// Errors that should NOT be retried (user error, policy, etc.)
function isNonRetryable(errMsg: string): boolean {
  const m = errMsg.toLowerCase();
  return m.includes('401') || m.includes('403') || m.includes('unauthor')
    || m.includes('invalid') || m.includes('validation')
    || m.includes('rate limit') || m.includes('payload');
}

// ─── Validation ───

export function validateMessage(text: string): { valid: boolean; error: string | null } {
  if (!text || !text.trim()) return { valid: false, error: 'Mesaj bos olamaz.' };
  if (text.length > MAX_MESSAGE_LENGTH) return { valid: false, error: `Mesaj cok uzun (max ${MAX_MESSAGE_LENGTH} karakter).` };
  return { valid: true, error: null };
}

// ─── Helpers ───

async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function invokeChat(
  body: Record<string, unknown>,
  maxRetries: number = DEFAULT_MAX_RETRIES,
): Promise<{ data: ChatResponse | null; error: string | null }> {
  let lastError = 'Baglanti hatasi. Lutfen tekrar dene.';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Supabase client automatically attaches auth headers — don't override
    const { data, error } = await supabase.functions.invoke('ai-chat', { body });
    if (!error) return { data: data as ChatResponse, error: null };

    lastError = error.message;

    // Non-retryable errors: fail fast
    if (isNonRetryable(lastError)) return { data: null, error: lastError };

    // Last attempt — don't wait
    if (attempt === maxRetries) break;

    // Exponential backoff: attempt 0→1s, attempt 1→3s
    const delayMs = attempt === 0 ? 1000 : 3000;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  return { data: null, error: lastError };
}

// ─── Core Send Functions ───

export async function sendMessage(text: string): Promise<{ data: ChatResponse | null; error: string | null }> {
  const validation = validateMessage(text);
  if (!validation.valid) return { data: null, error: validation.error };

  return invokeChat({ message: text });
}

/**
 * Deprecated: retry logic moved into invokeChat. Kept for call-site compatibility.
 */
export async function sendMessageWithRetry(
  text: string,
): Promise<{ data: ChatResponse | null; error: string | null }> {
  return sendMessage(text);
}

export async function sendMessageWithPhoto(text: string, imageUri: string): Promise<{ data: ChatResponse | null; error: string | null }> {
  try {
    const base64 = await FileSystem.readAsStringAsync(imageUri, { encoding: 'base64' as const });
    return invokeChat({ message: text, image_base64: base64 });
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

// ─── History with Cache ───

export async function loadChatHistory(limit = 50): Promise<ChatMessage[]> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return getCachedHistory();

    const { data } = await supabase
      .from('chat_messages')
      .select('id, role, content, task_mode, created_at, actions_executed')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: true })
      .limit(limit);
    const messages = (data as ChatMessage[]) ?? [];

    // Cache locally for offline access
    if (messages.length > 0) {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(messages.slice(-20)));
    }

    return messages;
  } catch (err) {
    console.warn('loadChatHistory: falling back to cache', err);
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
  } catch (err) { console.warn('queueMessageOffline failed:', err); }
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
  } catch (err) {
    console.warn('processOfflineQueue failed:', err);
    return 0;
  }
}

export async function getOfflineQueueSize(): Promise<number> {
  try {
    const existing = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    return existing ? (JSON.parse(existing) as QueuedMessage[]).length : 0;
  } catch (err) {
    console.warn('getOfflineQueueSize failed:', err);
    return 0;
  }
}

// ─── Batch/Retroactive Entry ───

export async function sendMessageForDate(text: string, targetDate: string): Promise<{ data: ChatResponse | null; error: string | null }> {
  return invokeChat({ message: `[${targetDate} icin kayit] ${text}`, target_date: targetDate });
}

// ─── Session Management ───

const SESSIONS_CACHE_KEY = '@kochko_sessions_cache';

export interface ChatSessionSummary {
  id: string;
  title: string | null;
  topic_tags: string[];
  started_at: string;
  updated_at: string | null;
  ended_at: string | null;
  message_count: number;
  is_active: boolean;
  last_message?: string;
}

export async function loadSessions(limit = 20): Promise<ChatSessionSummary[]> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return getCachedSessions();

    const { data } = await supabase
      .from('chat_sessions')
      .select('id, title, topic_tags, started_at, updated_at, ended_at, message_count, is_active')
      .eq('user_id', session.user.id)
      .order('started_at', { ascending: false })
      .limit(limit);

    const sessions = (data ?? []) as ChatSessionSummary[];

    // Fetch last message for each session
    for (const s of sessions) {
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('content')
        .eq('session_id', s.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (msgs?.[0]) {
        s.last_message = (msgs[0].content as string).substring(0, 80);
      }
    }

    await AsyncStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify(sessions));
    return sessions;
  } catch {
    return getCachedSessions();
  }
}

async function getCachedSessions(): Promise<ChatSessionSummary[]> {
  try {
    const cached = await AsyncStorage.getItem(SESSIONS_CACHE_KEY);
    return cached ? JSON.parse(cached) as ChatSessionSummary[] : [];
  } catch {
    return [];
  }
}

export async function createSession(options?: { title?: string; topicTags?: string[] }): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return null;
    const userId = session.user.id;

    // Close any currently active session
    await supabase
      .from('chat_sessions')
      .update({ is_active: false, ended_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('is_active', true);

    // Create new session
    const { data, error } = await supabase
      .from('chat_sessions')
      .insert({
        user_id: userId,
        title: options?.title ?? null,
        topic_tags: options?.topicTags ?? [],
        is_active: true,
      })
      .select('id')
      .single();

    if (error || !data) return null;
    return data.id;
  } catch {
    return null;
  }
}

export async function loadSessionMessages(sessionId: string, limit = 50): Promise<ChatMessage[]> {
  try {
    const { data } = await supabase
      .from('chat_messages')
      .select('id, role, content, task_mode, created_at, actions_executed')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(limit);
    return (data as ChatMessage[]) ?? [];
  } catch {
    return [];
  }
}

export async function sendMessageToSession(
  sessionId: string,
  text: string,
  taskModeHint?: string,
  targetDate?: string,
): Promise<{ data: ChatResponse | null; error: string | null }> {
  const validation = validateMessage(text);
  if (!validation.valid) return { data: null, error: validation.error };
  const body: Record<string, unknown> = { message: text, session_id: sessionId };
  if (targetDate) body.target_date = targetDate;
  if (taskModeHint) body.task_mode_hint = taskModeHint;
  return invokeChat(body);
}

export async function sendPhotoToSession(
  sessionId: string,
  text: string,
  imageUri: string,
): Promise<{ data: ChatResponse | null; error: string | null }> {
  try {
    const base64 = await FileSystem.readAsStringAsync(imageUri, { encoding: 'base64' as const });
    return invokeChat({ message: text, session_id: sessionId, image_base64: base64 });
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

export async function closeSession(sessionId: string): Promise<void> {
  await supabase
    .from('chat_sessions')
    .update({ is_active: false, ended_at: new Date().toISOString() })
    .eq('id', sessionId);
}

export async function reopenSession(sessionId: string): Promise<void> {
  // Close any other active session first
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.id) {
    await supabase
      .from('chat_sessions')
      .update({ is_active: false, ended_at: new Date().toISOString() })
      .eq('user_id', session.user.id)
      .eq('is_active', true);
  }

  await supabase
    .from('chat_sessions')
    .update({ is_active: true, ended_at: null })
    .eq('id', sessionId);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await supabase.from('chat_messages').delete().eq('session_id', sessionId);
  await supabase.from('chat_sessions').delete().eq('id', sessionId);
}

// ─── AI Summary / Insights ───

export async function loadInsights(): Promise<Record<string, unknown> | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return null;
    const { data } = await supabase.from('ai_summary').select('*').eq('user_id', session.user.id).maybeSingle();
    return data;
  } catch { return null; }
}

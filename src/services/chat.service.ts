import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';

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
  actions: { type: string; feedback: string | null; confidence?: 'high' | 'medium' | 'low' }[];
  task_mode: string;
  task_completion?: TaskCompletion | null;
  plan_snapshot?: Record<string, unknown> | null;
  plan_reasoning?: string | null;
  plan_persist_error?: string | null;
  plan_approved?: { id: string } | null;
  navigate_to?: string | null;
  rate_limited?: boolean;
  remaining?: number;
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
  try { body.client_timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* tz unavailable */ }
  if (params.userApproved) body.user_approved = true;
  if (params.draftId) body.draft_id = params.draftId;
  try {
    const { data, error } = await supabase.functions.invoke('ai-chat', { body });
    if (error) return { data: null, error: await mapInvokeError(error) };
    return { data: data as ChatResponse, error: null };
  } catch (e) {
    return { data: null, error: FRIENDLY_AI_ERROR };
  }
}

const CACHE_KEY = '@kochko_chat_cache';
const OFFLINE_QUEUE_KEY = '@kochko_chat_offline_queue';
const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_MAX_RETRIES = 2; // 2 retries = 3 total attempts (1s, 3s backoff)
// Hard timeout per attempt. The edge function rarely takes >20s; if we're
// still waiting at 60s something is wrong (edge cold start that bounced, lost
// socket, etc.) — fail so the UI can surface an error instead of hanging.
const REQUEST_TIMEOUT_MS = 60_000;

// Errors that should NOT be retried (user error, policy, etc.)
function isNonRetryable(errMsg: string): boolean {
  const m = errMsg.toLowerCase();
  return m.includes('401') || m.includes('403') || m.includes('unauthor')
    || m.includes('invalid') || m.includes('validation')
    || m.includes('rate limit') || m.includes('payload');
}

function isAuthError(errMsg: string): boolean {
  const m = errMsg.toLowerCase();
  return m.includes('401') || m.includes('unauthor') || m.includes('jwt')
    || m.includes('invalid_grant') || m.includes('session_not_found');
}

let signingOut = false;
async function handleAuthFailure(): Promise<void> {
  // One-shot guard — if many queued requests fail with 401 at once we don't
  // want N signOut calls fighting each other.
  if (signingOut) return;
  signingOut = true;
  try {
    // Give Supabase a chance to refresh silently before we nuke the session.
    const { error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr) {
      await useAuthStore.getState().signOut();
    }
  } catch {
    try { await useAuthStore.getState().signOut(); } catch { /* already gone */ }
  } finally {
    // Reset after a tick so a legitimately-new session can trigger this path
    // again later (e.g. user signs in, token expires hours later).
    setTimeout(() => { signingOut = false; }, 2000);
  }
}

// ─── Error mapping ───
// supabase-js wraps any non-2xx edge response in a FunctionsHttpError whose
// .message is ALWAYS the fixed English string 'Edge Function returned a non-2xx
// status code'; the real HTTP status + body live in error.context (a Response).
// We must never surface that raw string to a Turkish user — map every failure to
// a friendly message, and read the real status for retry decisions.
const FRIENDLY_AI_ERROR = 'Kochko şu an yanıt veremiyor. Birazdan tekrar dene.';

function extractStatus(error: unknown): number | null {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof ctx === 'object' && 'status' in (ctx as object)) {
    const s = (ctx as { status?: unknown }).status;
    return typeof s === 'number' ? s : null;
  }
  return null;
}

async function extractServerError(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as { clone?: unknown }).clone === 'function') {
    try {
      const body = await (ctx as Response).clone().json();
      if (body && typeof body === 'object' && 'error' in body) return String((body as { error: unknown }).error);
    } catch { /* body not JSON or already consumed */ }
  }
  return null;
}

// Map any edge/LLM failure to a friendly Turkish message. Never leaks the raw
// supabase-js 'non-2xx status code' string.
async function mapInvokeError(error: { message: string }): Promise<string> {
  const msg = error.message ?? '';
  if (isAuthError(msg)) return 'Oturum süresi doldu. Lütfen tekrar giriş yap.';
  const status = extractStatus(error);
  if (status === 401 || status === 403) return 'Oturum süresi doldu. Lütfen tekrar giriş yap.';
  if (status === 429) return 'Çok hızlı gidiyorsun, birazdan tekrar dene.';
  const serverMsg = await extractServerError(error);
  // Server-authored 4xx validation messages are Turkish and user-safe — surface
  // them. But never echo an internal provider error (OpenAI/quota/key) to the user.
  if (status !== null && status >= 400 && status < 500 && serverMsg && !/openai|api key|quota|insufficient/i.test(serverMsg)) {
    return serverMsg;
  }
  // 5xx / AI down / unknown → friendly fallback.
  return FRIENDLY_AI_ERROR;
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
  // Attach the device IANA timezone so the server can activate travel/jet-lag mode and
  // resolve the user's local hour (getTravelContext + active_timezone update). (P2)
  if (body.client_timezone === undefined) {
    try { body.client_timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* tz unavailable */ }
  }
  let lastFriendly = 'Bağlantı hatası. Lütfen tekrar dene.';
  let serverRetries = 0; // 5xx/AI-down attempts already spent (cap at 1 extra)

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Promise.race gives us a hard upper bound on wait time. Supabase client
    // doesn't expose AbortSignal on functions.invoke, so the underlying
    // request may continue, but the UI unblocks — and a second attempt won't
    // be queued past the retry loop below.
    let timedOut = false;
    const result = await Promise.race([
      supabase.functions.invoke('ai-chat', { body }),
      new Promise<{ data: unknown; error: { message: string } }>((resolve) =>
        setTimeout(() => {
          timedOut = true;
          resolve({ data: null, error: { message: 'REQUEST_TIMEOUT: istek zaman asimina ugradi' } });
        }, REQUEST_TIMEOUT_MS),
      ),
    ]);
    const { data, error } = result as { data: unknown; error: { message: string } | null };
    if (!error) return { data: data as ChatResponse, error: null };

    // Timeout: retry unless we're on the last attempt. The retry loop will hit
    // the same timeout again if the server really is down.
    if (timedOut && attempt < maxRetries) {
      continue;
    }

    const status = extractStatus(error);
    if (isAuthError(error.message) || status === 401 || status === 403) {
      // Fire-and-forget — handleAuthFailure tries a silent refresh and falls
      // back to signOut. UI gets a friendly message either way.
      void handleAuthFailure();
      return { data: null, error: 'Oturum süresi doldu. Lütfen tekrar giriş yap.' };
    }

    // Always resolve to a friendly Turkish message — never the raw English
    // 'Edge Function returned a non-2xx status code'.
    lastFriendly = await mapInvokeError(error);

    // Client 4xx (validation/rate-limit/payload) won't change on retry — fail fast.
    const isClient4xx = status !== null && status >= 400 && status < 500;
    if (isClient4xx || isNonRetryable(error.message)) {
      return { data: null, error: lastFriendly };
    }

    // 5xx / unknown server error (e.g. OpenAI quota outage) won't self-heal in
    // seconds. Allow ONE quick retry to absorb a cold-start bounce, then stop —
    // retrying 3× just burns ~4s and up to 6 server-side OpenAI calls (#11).
    serverRetries++;
    if (serverRetries > 1 || attempt === maxRetries) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return { data: null, error: lastFriendly };
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

// ~3.5 MB of base64 (~2.6 MB raw) — well under the Supabase edge function 5 MB
// body cap, leaving headroom for the message text and auth headers.
const MAX_IMAGE_BASE64_BYTES = 3_500_000;

async function readImageAsBase64(imageUri: string): Promise<{ base64: string | null; error: string | null }> {
  try {
    const base64 = await FileSystem.readAsStringAsync(imageUri, { encoding: 'base64' as const });
    if (base64.length > MAX_IMAGE_BASE64_BYTES) {
      return { base64: null, error: 'Foto cok buyuk. Daha dusuk cozunurluklu bir foto sec veya tekrar cek.' };
    }
    return { base64, error: null };
  } catch (err) {
    return { base64: null, error: (err as Error).message };
  }
}

export async function sendMessageWithPhoto(text: string, imageUri: string): Promise<{ data: ChatResponse | null; error: string | null }> {
  const { base64, error } = await readImageAsBase64(imageUri);
  if (!base64) return { data: null, error };
  return invokeChat({ message: text, image_base64: base64 });
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

    if (error) {
      // If another device won the "close+insert" race we'll get a unique
      // violation from migration 035's partial index. Close whoever they
      // are and retry once so the user ends up with a fresh session.
      const code = (error as { code?: string }).code;
      const isUniqueViolation = code === '23505' || /duplicate key|uniq_chat_sessions_one_active_per_user/i.test(error.message ?? '');
      if (isUniqueViolation) {
        await supabase
          .from('chat_sessions')
          .update({ is_active: false, ended_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('is_active', true);
        const { data: retryData } = await supabase
          .from('chat_sessions')
          .insert({
            user_id: userId,
            title: options?.title ?? null,
            topic_tags: options?.topicTags ?? [],
            is_active: true,
          })
          .select('id')
          .single();
        return retryData?.id ?? null;
      }
      return null;
    }
    return data?.id ?? null;
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
  const { base64, error } = await readImageAsBase64(imageUri);
  if (!base64) return { data: null, error };
  return invokeChat({ message: text, session_id: sessionId, image_base64: base64 });
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

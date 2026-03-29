/**
 * Chat Service — Spec 5, 16.4
 * Sends messages to AI, handles photo, loads history.
 * Rate limiting: free users 5 coaching msgs/day (parse excluded).
 */
import { readAsStringAsync } from 'expo-file-system';
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

const FREE_DAILY_LIMIT = 5;

/**
 * Check if free user has messages remaining today.
 * Spec 16.1: Kayıt parse mesajları sayaçtan düşmez.
 */
export async function checkMessageQuota(isPremium: boolean): Promise<{ allowed: boolean; remaining: number }> {
  if (isPremium) return { allowed: true, remaining: 999 };

  const today = new Date().toISOString().split('T')[0];
  const { count } = await supabase
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'user')
    .gte('created_at', `${today}T00:00:00`)
    .not('task_mode', 'eq', 'register'); // register = kayıt parse, sayılmaz

  const used = count ?? 0;
  const remaining = Math.max(0, FREE_DAILY_LIMIT - used);
  return { allowed: remaining > 0, remaining };
}

export async function sendMessage(text: string): Promise<{ data: ChatResponse | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('ai-chat', { body: { message: text } });
  if (error) return { data: null, error: error.message };
  return { data: data as ChatResponse, error: null };
}

export async function sendMessageWithPhoto(text: string, imageUri: string): Promise<{ data: ChatResponse | null; error: string | null }> {
  try {
    const base64 = await readAsStringAsync(imageUri, { encoding: 'base64' });
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { message: text, image_base64: base64 },
    });
    if (error) return { data: null, error: error.message };
    return { data: data as ChatResponse, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

export async function loadChatHistory(limit = 50): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('chat_messages')
    .select('id, role, content, task_mode, created_at')
    .order('created_at', { ascending: true })
    .limit(limit);
  return (data as ChatMessage[]) ?? [];
}

export async function loadInsights(): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from('ai_summary').select('*').single();
  return data;
}

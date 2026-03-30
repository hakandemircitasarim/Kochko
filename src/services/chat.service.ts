import * as FileSystem from 'expo-file-system';
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

export async function sendMessage(text: string): Promise<{ data: ChatResponse | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('ai-chat', { body: { message: text } });
  if (error) return { data: null, error: error.message };
  return { data: data as ChatResponse, error: null };
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

export async function loadChatHistory(limit = 50): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('chat_messages')
    .select('id, role, content, task_mode, created_at')
    .order('created_at', { ascending: true })
    .limit(limit);
  return (data as ChatMessage[]) ?? [];
}

/**
 * T1.17: Send message with a specific date for batch/retroactive entry.
 * Spec 3.1: Geçmişe dönük kayıt (batch entry)
 */
export async function sendMessageForDate(text: string, targetDate: string): Promise<{ data: ChatResponse | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: { message: `[${targetDate} icin kayit] ${text}`, target_date: targetDate },
  });
  if (error) return { data: null, error: error.message };
  return { data: data as ChatResponse, error: null };
}

export async function loadInsights(): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from('ai_summary').select('*').single();
  return data;
}

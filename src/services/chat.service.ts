import * as FileSystem from 'expo-file-system';
import { supabase } from '@/lib/supabase';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ChatResponse {
  message: string;
  actions: { type: string; [key: string]: unknown }[];
}

/**
 * Sends a text message to the AI coach.
 */
export async function sendMessage(
  text: string
): Promise<{ data: ChatResponse | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: { message: text },
  });

  if (error) return { data: null, error: error.message };
  return { data: data as ChatResponse, error: null };
}

/**
 * Sends a message with a photo to the AI coach.
 * The photo is converted to base64 and sent to the Edge Function,
 * which uses GPT-4o's vision capability to analyze the image.
 */
export async function sendMessageWithPhoto(
  text: string,
  imageUri: string
): Promise<{ data: ChatResponse | null; error: string | null }> {
  try {
    // Read image as base64
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: 'base64' as const,
    });

    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: {
        message: text,
        image_base64: base64,
      },
    });

    if (error) return { data: null, error: error.message };
    return { data: data as ChatResponse, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

/**
 * Loads recent chat history.
 */
export async function loadChatHistory(
  limit = 50
): Promise<{ data: ChatMessage[]; error: string | null }> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) return { data: [], error: error.message };
  return { data: (data as ChatMessage[]) ?? [], error: null };
}

/**
 * Loads user insights for profile display.
 */
export async function loadInsights(): Promise<{
  data: { category: string; insight: string; updated_at: string }[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('user_insights')
    .select('category, insight, updated_at')
    .eq('active', true)
    .order('updated_at', { ascending: false });

  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

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
 * Sends a message to the AI coach and returns the response.
 * The Edge Function handles:
 * - Context building (profile + insights + history + today's data)
 * - Response generation
 * - Action detection and execution (meal/workout/weight/water logging)
 * - Insight extraction (background, non-blocking)
 */
export async function sendMessage(
  text: string
): Promise<{ data: ChatResponse | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: { message: text },
  });

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as ChatResponse, error: null };
}

/**
 * Loads recent chat history from the database.
 */
export async function loadChatHistory(
  limit = 50
): Promise<{ data: ChatMessage[]; error: string | null }> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: (data as ChatMessage[]) ?? [], error: null };
}

/**
 * Loads user insights for display in profile.
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

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: data ?? [], error: null };
}

/**
 * Coaching Messages Service
 * Fetches proactive coaching messages (nudges) from ai-proactive edge function.
 * Shows unread messages on dashboard and chat tab.
 */
import { supabase } from '@/lib/supabase';

export interface CoachingMessage {
  id: string;
  user_id: string;
  message: string;
  trigger_type: string;
  priority: 'low' | 'medium' | 'high';
  is_read: boolean;
  created_at: string;
}

/**
 * Get unread coaching messages for the current user.
 * Returns newest first, limit 5.
 */
export async function getUnreadCoachingMessages(userId: string): Promise<CoachingMessage[]> {
  const { data, error } = await supabase
    .from('coaching_messages')
    .select('id, user_id, message, trigger_type, priority, is_read, created_at')
    .eq('user_id', userId)
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('[CoachingMessages] Fetch failed:', error.message);
    return [];
  }
  return (data ?? []) as CoachingMessage[];
}

/**
 * Mark a coaching message as read.
 */
export async function markMessageRead(messageId: string): Promise<void> {
  await supabase
    .from('coaching_messages')
    .update({ is_read: true })
    .eq('id', messageId);
}

/**
 * Mark all coaching messages as read for a user.
 */
export async function markAllRead(userId: string): Promise<void> {
  await supabase
    .from('coaching_messages')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);
}

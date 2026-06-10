/**
 * Coaching Messages Service
 * Fetches proactive coaching messages (nudges) from ai-proactive edge function.
 * Shows unread messages on dashboard and chat tab.
 *
 * Columns match the coaching_messages table (migration 003): content, trigger_type, read.
 */
import { supabase } from '@/lib/supabase';

export interface CoachingMessage {
  id: string;
  user_id: string;
  content: string;
  trigger_type: string;
  priority: 'low' | 'medium' | 'high';
  read: boolean;
  created_at: string;
}

/**
 * Get unread coaching messages for the current user.
 * Returns newest first, limit 5.
 */
export async function getUnreadCoachingMessages(userId: string): Promise<CoachingMessage[]> {
  const { data, error } = await supabase
    .from('coaching_messages')
    .select('id, user_id, content, trigger_type, priority, read, created_at')
    .eq('user_id', userId)
    .eq('read', false)
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
  const { error } = await supabase
    .from('coaching_messages')
    .update({ read: true })
    .eq('id', messageId);
  if (error) console.error('[CoachingMessages] markMessageRead failed:', error.message);
}

/**
 * Mark all coaching messages as read for a user.
 */
export async function markAllRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('coaching_messages')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) console.error('[CoachingMessages] markAllRead failed:', error.message);
}

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
/**
 * ux-defect pass 2026-07-29: nudges have a SHELF LIFE. A "uzun süredir yemek yememişsin"
 * generated at 22:07 was still headlining the dashboard at 09:20 the next morning — the only
 * staleness rule was meal-relative (dropped it after a NEW meal), so an overnight gap kept it
 * alive forever. Anything older than 12h is noise by definition of a nudge: fetch newer only,
 * and mark the expired ones read server-side so they stop accumulating as "unread".
 */
const NUDGE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * RECEIPTS never expire unseen. These trigger types are the unconditional notice of a change
 * the server already made (mirrors ai-proactive RECEIPT_TRIGGERS — e.g. "bakım moduna geçtim,
 * kalorin güncellendi"). Silently marking one read would break the "a big change can never
 * happen without the user seeing a notice" guarantee for someone who opens the app days later.
 */
const RECEIPT_TRIGGERS = new Set([
  'caffeine_water_bump', 'tdee_recalculated', 'activity_level_recalibrated',
  'maintenance_auto_started', 'plan_projected',
]);

/**
 * Accept/decline OFFERS (Evet/Sonra buttons in CoachingNudge) — not time-of-day noise like a
 * meal-gap ping, so they get a longer 48h shelf: "Sıra su takibi alışkanlığına geldi" is as
 * valid tomorrow morning as it was last night. ONE owner — CoachingNudge imports this.
 */
export const OFFER_TRIGGERS = new Set([
  'deload_suggestion', 'habit_introduce', 'habit_stack', 'progressive_overload',
  'mini_cut_suggestion', 'maintain',
]);
const OFFER_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export async function getUnreadCoachingMessages(userId: string): Promise<CoachingMessage[]> {
  const cutoff = new Date(Date.now() - NUDGE_MAX_AGE_MS).toISOString();
  const { data, error } = await supabase
    .from('coaching_messages')
    .select('id, user_id, content, trigger_type, priority, read, created_at')
    .eq('user_id', userId)
    .eq('read', false)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('[CoachingMessages] Fetch failed:', error.message);
    return [];
  }
  const rows = (data ?? []) as CoachingMessage[];
  const offerCutoff = new Date(Date.now() - OFFER_MAX_AGE_MS).toISOString();
  const shelfOf = (m: CoachingMessage) => OFFER_TRIGGERS.has(m.trigger_type ?? '') ? offerCutoff : cutoff;
  const fresh = rows.filter(m => m.created_at >= shelfOf(m) || RECEIPT_TRIGGERS.has(m.trigger_type ?? ''));
  const expired = rows.filter(m => m.created_at < shelfOf(m) && !RECEIPT_TRIGGERS.has(m.trigger_type ?? ''));

  // Retire expired unread nudges (fire-and-forget) — otherwise they pile up unread forever
  // and every future badge/count reads them as pending.
  if (expired.length > 0) {
    void supabase
      .from('coaching_messages')
      .update({ read: true })
      .in('id', expired.map(m => m.id))
      .then(({ error: expireErr }) => {
        if (expireErr) console.warn('[CoachingMessages] expire failed:', expireErr.message);
      });
  }

  return fresh.slice(0, 5);
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

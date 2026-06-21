/**
 * Message Counter Service
 * Spec 16: Premium/Ücretsiz plan — günlük AI mesaj sayacı
 *
 * Ücretsiz plan: 5 mesaj/gün (kayıt parse'ları sayılmaz)
 * Premium: sınırsız
 */
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const COUNTER_KEY = '@kochko_daily_msg_count';
// Mirrors supabase/functions/shared/rate-limit.ts FREE_DAILY_LIMIT (server-authoritative).
// Onboarding-only users get unlimited; this client cap surfaces remaining for the rest.
const FREE_DAILY_LIMIT = 50;

interface DailyCount {
  date: string;
  count: number;
}

/**
 * Get today's message count.
 */
export async function getDailyMessageCount(): Promise<DailyCount> {
  const today = new Date().toISOString().split('T')[0];
  try {
    const stored = await AsyncStorage.getItem(COUNTER_KEY);
    if (stored) {
      const data = JSON.parse(stored) as DailyCount;
      if (data.date === today) return data;
    }
  } catch { /* ignore */ }

  return { date: today, count: 0 };
}

/**
 * Increment message count for today.
 * Returns whether the message is allowed.
 */
export async function incrementAndCheck(isPremium: boolean): Promise<{
  allowed: boolean;
  remaining: number;
  message: string | null;
}> {
  if (isPremium) {
    return { allowed: true, remaining: Infinity, message: null };
  }

  const today = new Date().toISOString().split('T')[0];
  const current = await getDailyMessageCount();

  // Reset if new day
  const count = current.date === today ? current.count : 0;
  const newCount = count + 1;

  await AsyncStorage.setItem(COUNTER_KEY, JSON.stringify({ date: today, count: newCount }));

  const remaining = Math.max(0, FREE_DAILY_LIMIT - newCount);

  if (newCount > FREE_DAILY_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      message: `Günlük ${FREE_DAILY_LIMIT} mesaj hakkını kullandın. Premium'a geçersen sınırsız mesaj hakkı kazanırsın.`,
    };
  }

  if (remaining <= 5) {
    return {
      allowed: true,
      remaining,
      message: `${remaining} mesaj hakkın kaldı.`,
    };
  }

  return { allowed: true, remaining, message: null };
}

/**
 * Refund one message for today (clamped at 0). Call this when a send that was
 * optimistically counted ultimately FAILED (LLM/edge error) and no chat_messages
 * row was persisted server-side — otherwise a free user would burn their daily
 * allowance on messages the AI never answered, and could even lock themselves
 * out client-side while the authoritative server still allows them.
 */
export async function refundDailyMessage(isPremium: boolean): Promise<void> {
  if (isPremium) return;
  const today = new Date().toISOString().split('T')[0];
  const current = await getDailyMessageCount();
  if (current.date !== today) return; // day rolled over; nothing to refund
  const newCount = Math.max(0, current.count - 1);
  await AsyncStorage.setItem(COUNTER_KEY, JSON.stringify({ date: today, count: newCount }));
}

/**
 * FIX (audit UX-CHT-05/UX-PRM-02/UX-PRM-05): reconcile the local counter with the
 * SERVER's authoritative `remaining` value (returned by every successful ai-chat send).
 *
 * The server is the single source of truth for the daily conversation gate — it counts
 * ALL role='user' chat_messages since local-day start (including photo + chip + action
 * sends) and EXEMPTS record-parse messages (meal/water/sleep/weight logs). The old local
 * counter diverged on every one of those paths. We now persist `count = LIMIT - remaining`
 * so getRemainingMessages() and the badge mirror the server.
 *
 * Returns the clamped remaining count for the caller to display. `serverRemaining < 0`
 * (the server's -1 "unlimited/exempt" sentinel) is treated as "no client cap" → returns
 * the full limit and does NOT decrement the local counter.
 */
export async function syncRemainingFromServer(isPremium: boolean, serverRemaining: number | undefined): Promise<number> {
  if (isPremium) return Infinity;
  if (serverRemaining == null || serverRemaining < 0) {
    // Unlimited / exempt (record-parse, onboarding) — leave the local counter untouched
    // and report the current remaining so a record-parse send never burns the visible quota.
    return getRemainingMessages(isPremium);
  }
  const remaining = Math.max(0, Math.min(FREE_DAILY_LIMIT, serverRemaining));
  const today = new Date().toISOString().split('T')[0];
  const count = FREE_DAILY_LIMIT - remaining;
  await AsyncStorage.setItem(COUNTER_KEY, JSON.stringify({ date: today, count }));
  return remaining;
}

/**
 * Get remaining messages for today.
 */
export async function getRemainingMessages(isPremium: boolean): Promise<number> {
  if (isPremium) return Infinity;
  const current = await getDailyMessageCount();
  return Math.max(0, FREE_DAILY_LIMIT - current.count);
}

/**
 * Reset daily counter (for testing or day change).
 */
export async function resetDailyCounter(): Promise<void> {
  await AsyncStorage.removeItem(COUNTER_KEY);
}

/**
 * Message Counter Service
 * Spec 16: Premium/Ücretsiz plan — günlük AI mesaj sayacı
 *
 * Ücretsiz plan: 20 mesaj/gün (kayıt parse'ları sayılmaz)
 * Premium: sınırsız
 */
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const COUNTER_KEY = '@kochko_daily_msg_count';
const FREE_DAILY_LIMIT = 5;

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
      message: `Gunluk ${FREE_DAILY_LIMIT} mesaj hakkini kullandin. Premium'a gecersen sinirsiz mesaj hakki kazanirsin.`,
    };
  }

  if (remaining <= 3) {
    return {
      allowed: true,
      remaining,
      message: `${remaining} mesaj hakkin kaldi.`,
    };
  }

  return { allowed: true, remaining, message: null };
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

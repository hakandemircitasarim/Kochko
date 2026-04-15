/**
 * Rate Limiting
 * Spec 16.4, 18.4: Kullanıcı bazlı API call sınırı.
 * Free: 5 coaching messages/day (record parse excluded)
 * Premium: 200 messages/day, 30/hour
 */
import { supabaseAdmin } from './supabase-admin.ts';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  message?: string;
}

const FREE_DAILY_LIMIT = 5;
const PREMIUM_DAILY_LIMIT = 200;
const PREMIUM_HOURLY_LIMIT = 30;

export async function checkRateLimit(
  userId: string,
  isRecordParse: boolean = false
): Promise<RateLimitResult> {
  // Record parse messages (meal/workout/water logging) don't count for free users
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('premium')
    .eq('id', userId)
    .maybeSingle();

  const isPremium = profile?.premium === true;

  if (isRecordParse && !isPremium) {
    // Free users: record parse doesn't count against limit
    return { allowed: true, remaining: -1 };
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  // Count today's messages
  const { count: dailyCount } = await supabaseAdmin
    .from('chat_messages')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'user')
    .gte('created_at', todayStart);

  const daily = dailyCount ?? 0;
  const dailyLimit = isPremium ? PREMIUM_DAILY_LIMIT : FREE_DAILY_LIMIT;

  if (daily >= dailyLimit) {
    const resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const hoursLeft = Math.ceil((resetTime.getTime() - now.getTime()) / (1000 * 60 * 60));
    return {
      allowed: false,
      remaining: 0,
      message: isPremium
        ? `Bugun cok calistin, gunluk ${PREMIUM_DAILY_LIMIT} mesaj limitine ulastin. Yaklasik ${hoursLeft} saat sonra yenilenecek. Biraz mola ver, yarın devam ederiz!`
        : `Sana daha fazla yardimci olmak isterdim ama gunluk ${FREE_DAILY_LIMIT} ucretsiz mesaj hakkini kullandin. Yaklasik ${hoursLeft} saat sonra yenilenecek. Daha fazla kocluk icin hesabini Premium'a yukseltebilirsin!`,
    };
  }

  // Premium hourly check
  if (isPremium) {
    const { count: hourlyCount } = await supabaseAdmin
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('role', 'user')
      .gte('created_at', hourAgo);

    if ((hourlyCount ?? 0) >= PREMIUM_HOURLY_LIMIT) {
      return {
        allowed: false,
        remaining: 0,
        message: `Saatlik ${PREMIUM_HOURLY_LIMIT} mesaj limitine ulastin. Birkaç dakika sonra tekrar dene, bir yere gitmiyorum!`,
      };
    }
  }

  return { allowed: true, remaining: dailyLimit - daily - 1 };
}

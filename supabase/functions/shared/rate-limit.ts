/**
 * Rate Limiting (MASTER_PLAN §4.7, Phase 6)
 *
 * Rules:
 *   - Onboarding (any of 13 tasks incomplete) → NO cap.
 *   - Record parse (meal/workout/water/sleep/weight log) → NO cap.
 *   - Post-onboarding free tier → 50 messages/day per user's local midnight.
 *   - Premium → 200/day, 30/hour.
 *
 * The "day" for cap counting resets at the user's local midnight, defined
 * via profiles.home_timezone + profiles.day_boundary_hour (default 4). UTC
 * is the fallback when timezone isn't set. This mirrors src/lib/day-boundary.ts
 * so the cap and meal logs share one day definition.
 */
import { supabaseAdmin } from './supabase-admin.ts';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  message?: string;
}

const FREE_DAILY_LIMIT = 50;
const PREMIUM_DAILY_LIMIT = 200;
const PREMIUM_HOURLY_LIMIT = 30;

/**
 * Return an ISO timestamp for "start of today in the user's local day",
 * honoring `home_timezone` (IANA name) and `day_boundary_hour` (int 0-23).
 * Falls back to UTC midnight if data is missing.
 */
function localDayStartIso(
  tz: string | null | undefined,
  dayBoundaryHour: number | null | undefined,
): string {
  const boundary = typeof dayBoundaryHour === 'number' ? dayBoundaryHour : 0;
  const now = new Date();
  try {
    if (tz) {
      // Compute "today" in the user's timezone by formatting, then reparse as UTC.
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      const parts = fmt.formatToParts(now).reduce((acc, p) => {
        if (p.type !== 'literal') acc[p.type] = p.value;
        return acc;
      }, {} as Record<string, string>);
      const localHour = parseInt(parts.hour ?? '0', 10);
      const useYesterday = localHour < boundary;
      // The tz's UTC offset at `now`: the local wall-clock interpreted as UTC, minus the
      // true UTC instant. (Bug fix: the old code parsed the local date as UTC and applied
      // the boundary hour WITHOUT this offset, so the day-start was wrong by the full UTC
      // offset — e.g. 3h off for Istanbul/UTC+3 — shifting the daily-cap window for everyone.)
      const localAsUtcMs = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`).getTime();
      const offsetMs = localAsUtcMs - now.getTime();
      // The boundary-hour wall-clock on the active "user day" (yesterday if before boundary)...
      const baseDate = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
      if (useYesterday) baseDate.setUTCDate(baseDate.getUTCDate() - 1);
      baseDate.setUTCHours(boundary, 0, 0, 0);
      // ...converted from local wall-clock to the true UTC instant by removing the offset.
      return new Date(baseDate.getTime() - offsetMs).toISOString();
    }
  } catch {
    // fall through to UTC
  }
  // UTC fallback
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), boundary));
  if (now.getUTCHours() < boundary) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString();
}

export async function checkRateLimit(
  userId: string,
  isRecordParse: boolean = false,
): Promise<RateLimitResult> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('premium, home_timezone, day_boundary_hour, onboarding_completed')
    .eq('id', userId)
    .maybeSingle();

  const isPremium = profile?.premium === true;

  // Record parse never counts against limits.
  if (isRecordParse) return { allowed: true, remaining: -1 };

  // Onboarding bypass — free users get unlimited messages ONLY while still in the
  // initial onboarding flow (onboarding_completed != true). Keying this on the 13
  // OPTIONAL task-cards (the old isInOnboarding) let a fully-onboarded free user
  // (the normal state: core done, optional cards skipped) bypass the daily cap
  // forever — an AI-cost / monetization hole.
  if (!isPremium && profile?.onboarding_completed !== true) {
    return { allowed: true, remaining: -1 };
  }

  const now = new Date();
  const dayStart = localDayStartIso(
    profile?.home_timezone as string | null,
    profile?.day_boundary_hour as number | null,
  );
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  const { count: dailyCount } = await supabaseAdmin
    .from('chat_messages')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'user')
    .gte('created_at', dayStart);

  const daily = dailyCount ?? 0;
  const dailyLimit = isPremium ? PREMIUM_DAILY_LIMIT : FREE_DAILY_LIMIT;

  if (daily >= dailyLimit) {
    // Approximate hours until next local midnight.
    const hoursLeft = Math.max(1, Math.ceil(
      (new Date(new Date(dayStart).getTime() + 24 * 3600 * 1000).getTime() - now.getTime())
      / (1000 * 60 * 60),
    ));
    return {
      allowed: false,
      remaining: 0,
      message: isPremium
        ? `Bugün çok çalıştık, günlük ${PREMIUM_DAILY_LIMIT} mesaj limitine ulaştık. Yaklaşık ${hoursLeft} saat sonra yenilenecek.`
        : `Bugünlük ${FREE_DAILY_LIMIT} ücretsiz mesaj hakkını kullandın. Yaklaşık ${hoursLeft} saat sonra yenilenecek. Sınırsız sohbet için premium paketi deneyebilirsin.`,
    };
  }

  // Premium hourly check.
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
        message: `Saatlik ${PREMIUM_HOURLY_LIMIT} mesaj limitine ulaştık. Birkaç dakika sonra tekrar dene.`,
      };
    }
  }

  return { allowed: true, remaining: Math.max(0, dailyLimit - daily - 1) };
}

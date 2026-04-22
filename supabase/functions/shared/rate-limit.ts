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
      const isoDay = `${parts.year}-${parts.month}-${parts.day}`;
      // We want the start of the active "user day" — if local time is before
      // boundary, we're still in yesterday's day from the user's perspective.
      const baseDate = new Date(`${isoDay}T00:00:00Z`);
      if (useYesterday) baseDate.setUTCDate(baseDate.getUTCDate() - 1);
      baseDate.setUTCHours(boundary, 0, 0, 0);
      return baseDate.toISOString();
    }
  } catch {
    // fall through to UTC
  }
  // UTC fallback
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), boundary));
  if (now.getUTCHours() < boundary) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString();
}

/**
 * Check if the user still has any uncompleted onboarding tasks. If yes,
 * they are in "onboarding mode" and bypass the cap entirely.
 */
async function isInOnboarding(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('ai_summary')
    .select('onboarding_tasks_completed')
    .eq('user_id', userId)
    .maybeSingle();
  const completed = (data?.onboarding_tasks_completed as string[] | null) ?? [];
  // 13 tasks total (see MASTER_PLAN Appendix A). Any missing → onboarding mode.
  const ALL_TASKS = [
    'introduce_yourself', 'set_goal', 'daily_routine', 'eating_habits', 'allergies',
    'kitchen_logistics', 'exercise_history', 'health_history', 'weight_history',
    'lab_values', 'sleep_patterns', 'stress_motivation', 'home_environment',
  ];
  return ALL_TASKS.some(k => !completed.includes(k));
}

export async function checkRateLimit(
  userId: string,
  isRecordParse: boolean = false,
): Promise<RateLimitResult> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('premium, home_timezone, day_boundary_hour')
    .eq('id', userId)
    .maybeSingle();

  const isPremium = profile?.premium === true;

  // Record parse never counts against limits.
  if (isRecordParse) return { allowed: true, remaining: -1 };

  // Onboarding bypass — free users completing onboarding get unlimited messages.
  if (!isPremium && await isInOnboarding(userId)) {
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
        ? `Bugun cok calistik, gunluk ${PREMIUM_DAILY_LIMIT} mesaj limitine ulastik. Yaklasik ${hoursLeft} saat sonra yenilenecek.`
        : `Bugunluk ${FREE_DAILY_LIMIT} ucretsiz mesaj hakkini kullandin. Yaklasik ${hoursLeft} saat sonra yenilenecek. Sinirsiz sohbet icin premium paketi deneyebilirsin.`,
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
        message: `Saatlik ${PREMIUM_HOURLY_LIMIT} mesaj limitine ulastik. Birkaç dakika sonra tekrar dene.`,
      };
    }
  }

  return { allowed: true, remaining: dailyLimit - daily - 1 };
}

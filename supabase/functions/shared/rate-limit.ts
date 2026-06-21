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
import { isActivePremium } from './premium.ts';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  message?: string;
}

const FREE_DAILY_LIMIT = 50;
const PREMIUM_DAILY_LIMIT = 200;
const PREMIUM_HOURLY_LIMIT = 30;
// Record-parse (logs) bypass the 50/day CONVERSATION cap, but free post-onboarding users
// get this HIGH bounded daily cap so a user can't phrase every message as a "log" to get
// truly unlimited paid LLM calls (audit AI/HIGH — "register" cost hole). Set well above any
// realistic logging day (meals+water+sleep+workout+weight ≈ <20).
const FREE_RECORD_PARSE_DAILY = 120;

/**
 * Return an ISO timestamp for "start of today in the user's local day",
 * honoring `home_timezone` (IANA name) and `day_boundary_hour` (int 0-23).
 * Falls back to UTC midnight if data is missing.
 */
function localDayStartIso(
  tz: string | null | undefined,
  dayBoundaryHour: number | null | undefined,
): string {
  // FIX (audit AI-MDL-07): default to 4 (not 0) when day_boundary_hour is explicitly
  // NULL, matching src/lib/day-boundary.ts and the DB column default + this file's header.
  // An explicit-NULL profile otherwise got a cap window resetting at 00:00 instead of 04:00.
  const boundary = typeof dayBoundaryHour === 'number' ? dayBoundaryHour : 4;
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
  // FIX (audit AI-MDL-05): when called from reserveRateLimitSlot the current user message has
  // ALREADY been inserted (and is therefore included in the counts below). Shift every cap
  // boundary up by 1 and skip the usual "-1 for this message" on `remaining` so the reservation
  // path matches the historical read-then-insert semantics exactly (e.g. free users still get a
  // full 50, not 49).
  alreadyCounted: boolean = false,
): Promise<RateLimitResult> {
  const selfOffset = alreadyCounted ? 1 : 0;
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('premium, premium_expires_at, home_timezone, day_boundary_hour, onboarding_completed')
    .eq('id', userId)
    .maybeSingle();

  // Honor premium_expires_at — an expired-premium user inside the cron grace window
  // (premium=true but past expiry) must get the FREE cap, not 200/day.
  const isPremium = isActivePremium(profile);

  // Onboarding bypass — free users get unlimited messages ONLY while still in the
  // initial onboarding flow (onboarding_completed != true). Keying this on the 13
  // OPTIONAL task-cards (the old isInOnboarding) let a fully-onboarded free user
  // (the normal state: core done, optional cards skipped) bypass the daily cap
  // forever — an AI-cost / monetization hole. (Covers record-parse during onboarding too.)
  if (!isPremium && profile?.onboarding_completed !== true) {
    return { allowed: true, remaining: -1 };
  }

  // Record parse (meal/workout/water/sleep/weight logs) is exempt from the 50/day
  // CONVERSATION cap so logging stays frictionless. Premium → fully unlimited.
  // FIX (audit AI/HIGH — "register" cost hole): a free user could phrase EVERY message as a
  // log (detectTaskMode='register') to bypass the cap entirely. Free post-onboarding now gets
  // a HIGH bounded daily cap on total messages so normal logging is never hit but abuse stops.
  if (isRecordParse) {
    if (isPremium) return { allowed: true, remaining: -1 };
    const rpDayStart = localDayStartIso(
      profile?.home_timezone as string | null,
      profile?.day_boundary_hour as number | null,
    );
    const { count: rpCount } = await supabaseAdmin
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('role', 'user')
      .gte('created_at', rpDayStart);
    if ((rpCount ?? 0) >= FREE_RECORD_PARSE_DAILY + selfOffset) {
      return {
        allowed: false,
        remaining: 0,
        message: 'Bugünlük kayıt limitine ulaştın. Biraz sonra yenilenecek. Sınırsız kayıt için premium paketi deneyebilirsin.',
      };
    }
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

  if (daily >= dailyLimit + selfOffset) {
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

    if ((hourlyCount ?? 0) >= PREMIUM_HOURLY_LIMIT + selfOffset) {
      return {
        allowed: false,
        remaining: 0,
        message: `Saatlik ${PREMIUM_HOURLY_LIMIT} mesaj limitine ulaştık. Birkaç dakika sonra tekrar dene.`,
      };
    }
  }

  // When alreadyCounted, `daily` includes this message → remaining is dailyLimit - daily.
  // Otherwise subtract 1 for the message about to be stored (legacy read-then-insert path).
  return { allowed: true, remaining: Math.max(0, dailyLimit - daily - (1 - selfOffset)) };
}

// FIX (audit AI-MDL-05): atomic-ish slot RESERVATION via insert-then-check.
//
// checkRateLimit (above) only READS the daily count; the user's chat_messages row is not
// inserted until storeMessages at the END of the ai-chat handler (after the LLM call). That
// read-then-act gap is seconds wide, so N parallel requests from one user all read the same
// count BEFORE any row exists and all pass the cap together — letting the free 50/day and the
// record-parse 120/day caps be exceeded under concurrency.
//
// This reserves the slot the only way possible WITHOUT a new DB object (no migration / no
// row-locked RPC allowed): INSERT the user row FIRST, then COUNT. Because the insert lands
// before the count, two concurrent requests each see the other's row, so the count reflects
// reality and at most the in-flight window can slip over — instead of every parallel request
// passing on a stale zero. On over-limit we delete the just-inserted reservation row so a
// blocked attempt doesn't permanently consume a slot, and return the row id to the caller so
// the final storeMessages reuses it (patches in the assistant reply) instead of inserting a
// SECOND user row.
//
// `sessionId` may be null (storeMessages resolves/creates the active session); the reservation
// row carries the session when known so it lands in the right conversation. Onboarding /
// premium-unlimited (remaining === -1) callers skip reservation entirely (handled by the
// caller checking allowed+remaining before calling this).
export interface RateLimitReservation extends RateLimitResult {
  reservedMessageId: string | null;
}

export async function reserveRateLimitSlot(
  userId: string,
  userMsg: string,
  taskMode: string | undefined,
  sessionId: string | null,
  isRecordParse: boolean = false,
): Promise<RateLimitReservation> {
  // Insert the reservation row FIRST so the count below includes it.
  const { data: reserved, error: insertErr } = await supabaseAdmin
    .from('chat_messages')
    .insert({ user_id: userId, session_id: sessionId, role: 'user', content: userMsg, task_mode: taskMode })
    .select('id')
    .maybeSingle();

  // If the reservation insert fails (e.g. transient), fall back to the read-only check so the
  // turn isn't lost — the caller's final storeMessages will insert the user row as before.
  if (insertErr || !reserved?.id) {
    if (insertErr) console.error('[rate-limit] reservation insert failed, falling back to read-only check:', insertErr.message);
    const fallback = await checkRateLimit(userId, isRecordParse);
    return { ...fallback, reservedMessageId: null };
  }

  const reservedMessageId = reserved.id as string;
  // Now run the normal cap check with alreadyCounted=true; the count it performs already
  // INCLUDES this reservation row, so the boundary + remaining math is shifted accordingly.
  const result = await checkRateLimit(userId, isRecordParse, true);

  if (!result.allowed) {
    // Over the cap — release the slot we just reserved so a blocked attempt doesn't burn quota.
    await supabaseAdmin.from('chat_messages').delete().eq('id', reservedMessageId);
    return { ...result, reservedMessageId: null };
  }

  return { ...result, reservedMessageId };
}

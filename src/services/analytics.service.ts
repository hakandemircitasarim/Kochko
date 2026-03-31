/**
 * Analytics Tracking Service
 * Spec 24: Başarı kriterleri ve metrik toplama.
 *
 * Provides event tracking with a local buffer for future backend sync,
 * plus retention/conversion/engagement metric calculations.
 */
import { supabase } from '@/lib/supabase';

// ────────────────────────────── Types ──────────────────────────────

export interface AnalyticsEvent {
  eventName: string;
  properties: Record<string, unknown>;
  timestamp: number;
  userId?: string;
}

export interface RetentionMetrics {
  daysActive: number;
  totalSessions: number;
  avgSessionDuration: number; // seconds
  streakMax: number;
}

export interface ConversionMetrics {
  trialStarted: boolean;
  trialConverted: boolean;
  premiumDays: number;
}

export interface EngagementMetrics {
  avgDailyMeals: number;
  avgDailyMessages: number;
  featureUsage: Record<string, number>;
}

// ────────────────────────────── Event Buffer ──────────────────────────────

/**
 * In-memory event buffer. Events are stored locally and can be
 * flushed to a backend analytics endpoint when ready.
 */
const eventBuffer: AnalyticsEvent[] = [];

const MAX_BUFFER_SIZE = 1000;

/**
 * Track an analytics event. Stored in local buffer for future sync.
 */
export function trackEvent(
  eventName: string,
  properties: Record<string, unknown> = {}
): void {
  const event: AnalyticsEvent = {
    eventName,
    properties,
    timestamp: Date.now(),
  };

  eventBuffer.push(event);

  // Evict oldest events if buffer is full
  if (eventBuffer.length > MAX_BUFFER_SIZE) {
    eventBuffer.splice(0, eventBuffer.length - MAX_BUFFER_SIZE);
  }
}

/**
 * Get the current event buffer contents (for debugging or sync).
 */
export function getEventBuffer(): readonly AnalyticsEvent[] {
  return eventBuffer;
}

/**
 * Flush the event buffer and return flushed events.
 * In production, this would POST to an analytics backend.
 */
export function flushEventBuffer(): AnalyticsEvent[] {
  const flushed = [...eventBuffer];
  eventBuffer.length = 0;
  return flushed;
}

// ────────────────────────────── Retention ──────────────────────────────

/**
 * Calculate retention metrics for a user.
 * Based on daily_metrics (one row per active day) and chat_messages (sessions).
 */
export async function getRetentionMetrics(userId: string): Promise<RetentionMetrics> {
  const [metricsRes, sessionsRes] = await Promise.all([
    // Count distinct active days
    supabase
      .from('daily_metrics')
      .select('log_date, streak_days')
      .eq('user_id', userId)
      .order('log_date', { ascending: false }),

    // Count chat sessions as proxy for app sessions
    supabase
      .from('chat_messages')
      .select('created_at')
      .eq('user_id', userId)
      .eq('role', 'user')
      .order('created_at', { ascending: true }),
  ]);

  const dailyRows = metricsRes.data ?? [];
  const daysActive = dailyRows.length;
  const streakMax = dailyRows.reduce((max, r) => Math.max(max, r.streak_days ?? 0), 0);

  // Estimate sessions: group messages by 30-minute gaps
  const messages = sessionsRes.data ?? [];
  let totalSessions = 0;
  let totalDuration = 0;
  let sessionStart = 0;
  let lastTs = 0;
  const SESSION_GAP = 30 * 60 * 1000; // 30 min

  for (const msg of messages) {
    const ts = new Date(msg.created_at).getTime();
    if (ts - lastTs > SESSION_GAP) {
      if (sessionStart > 0) {
        totalDuration += lastTs - sessionStart;
      }
      totalSessions++;
      sessionStart = ts;
    }
    lastTs = ts;
  }
  // Close last session
  if (sessionStart > 0) {
    totalDuration += lastTs - sessionStart;
  }

  const avgSessionDuration = totalSessions > 0 ? Math.round(totalDuration / 1000 / totalSessions) : 0;

  return { daysActive, totalSessions, avgSessionDuration, streakMax };
}

// ────────────────────────────── Conversion ──────────────────────────────

/**
 * Calculate conversion metrics for a user.
 * Based on profile premium flags and creation date.
 */
export async function getConversionMetrics(userId: string): Promise<ConversionMetrics> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('premium, premium_expires_at, created_at')
    .eq('id', userId)
    .single();

  if (!profile) {
    return { trialStarted: false, trialConverted: false, premiumDays: 0 };
  }

  const trialStarted = profile.premium_expires_at != null || profile.premium;
  const trialConverted = profile.premium === true;

  let premiumDays = 0;
  if (profile.premium && profile.premium_expires_at) {
    const now = Date.now();
    const start = new Date(profile.created_at).getTime();
    const expires = new Date(profile.premium_expires_at).getTime();
    // Approximate premium days as time from account creation to expiry (or now)
    const end = Math.min(now, expires);
    premiumDays = Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  }

  return { trialStarted, trialConverted, premiumDays };
}

// ────────────────────────────── Engagement ──────────────────────────────

/**
 * Calculate engagement metrics for a user over the last 30 days.
 */
export async function getEngagementMetrics(userId: string): Promise<EngagementMetrics> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const since = thirtyDaysAgo.toISOString().slice(0, 10);

  const [mealsRes, messagesRes, metricsRes] = await Promise.all([
    // Meals logged in last 30 days
    supabase
      .from('meal_log_items')
      .select('log_date')
      .eq('user_id', userId)
      .gte('log_date', since),

    // User messages in last 30 days
    supabase
      .from('chat_messages')
      .select('created_at')
      .eq('user_id', userId)
      .eq('role', 'user')
      .gte('created_at', thirtyDaysAgo.toISOString()),

    // Active days in last 30 days
    supabase
      .from('daily_metrics')
      .select('log_date')
      .eq('user_id', userId)
      .gte('log_date', since),
  ]);

  const meals = mealsRes.data ?? [];
  const messages = messagesRes.data ?? [];
  const activeDays = metricsRes.data?.length ?? 1;

  const avgDailyMeals = activeDays > 0 ? Math.round((meals.length / activeDays) * 10) / 10 : 0;
  const avgDailyMessages = activeDays > 0 ? Math.round((messages.length / activeDays) * 10) / 10 : 0;

  // Feature usage: count distinct dates per feature proxy
  const featureUsage: Record<string, number> = {
    meal_logging: meals.length,
    chat: messages.length,
    daily_tracking: activeDays,
  };

  return { avgDailyMeals, avgDailyMessages, featureUsage };
}

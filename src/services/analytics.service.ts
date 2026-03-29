/**
 * Analytics Service — Spec 24
 * Tracks key metrics for success criteria:
 * retention, churn, feature usage, AI response time, guardrail triggers.
 */
import { supabase } from '@/lib/supabase';

type EventCategory =
  | 'auth'        // login, register, logout, password_reset
  | 'log'         // meal_log, workout_log, weight_log, water, sleep, supplement
  | 'ai'          // chat_message, plan_generated, report_generated
  | 'feature'     // barcode_scan, photo_upload, voice_input, template_used, challenge_started
  | 'navigation'  // screen_view, tab_switch
  | 'premium'     // trial_start, subscribe, cancel, downgrade
  | 'guardrail'   // calorie_floor, allergen_block, medical_sanitize, suspicious_input
  | 'engagement'; // streak_milestone, achievement_unlocked, share

interface AnalyticsEvent {
  category: EventCategory;
  action: string;
  label?: string;
  value?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Track an analytics event.
 * Events are stored in Supabase for server-side analysis.
 * Fails silently — analytics should never block the user.
 */
export async function trackEvent(event: AnalyticsEvent): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('analytics_events').insert({
      user_id: user.id,
      category: event.category,
      action: event.action,
      label: event.label ?? null,
      value: event.value ?? null,
      metadata: event.metadata ?? null,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Silent fail — analytics must never break UX
  }
}

// Convenience helpers for common events

export const trackScreenView = (screen: string) =>
  trackEvent({ category: 'navigation', action: 'screen_view', label: screen });

export const trackMealLogged = (method: string) =>
  trackEvent({ category: 'log', action: 'meal_log', label: method });

export const trackAIMessage = (taskMode: string, responseMs: number) =>
  trackEvent({ category: 'ai', action: 'chat_message', label: taskMode, value: responseMs });

export const trackGuardrailTriggered = (guardrailType: string) =>
  trackEvent({ category: 'guardrail', action: guardrailType });

export const trackPremiumAction = (action: string) =>
  trackEvent({ category: 'premium', action });

export const trackFeatureUsed = (feature: string) =>
  trackEvent({ category: 'feature', action: feature });

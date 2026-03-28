/**
 * Notification Service
 * Spec 10.1-10.3: Bildirim sistemi
 *
 * Handles push notification registration and local notification scheduling.
 * Note: Full implementation requires expo-notifications setup with
 * Firebase (Android) and APNs (iOS) configuration.
 */
import { supabase } from '@/lib/supabase';

export interface NotificationPreferences {
  enabled: boolean;
  dailyLimit: number;
  quietStart: string; // e.g. "23:00"
  quietEnd: string;   // e.g. "07:00"
  types: {
    morning_plan: boolean;
    meal_reminder: boolean;
    workout_reminder: boolean;
    water_reminder: boolean;
    night_risk: boolean;
    daily_report: boolean;
    weekly_report: boolean;
    weight_reminder: boolean;
    commitment_followup: boolean;
    achievement: boolean;
    challenge: boolean;
    reengagement: boolean;
  };
}

const DEFAULT_PREFS: NotificationPreferences = {
  enabled: true,
  dailyLimit: 5,
  quietStart: '23:00',
  quietEnd: '07:00',
  types: {
    morning_plan: true,
    meal_reminder: true,
    workout_reminder: true,
    water_reminder: true,
    night_risk: true,
    daily_report: true,
    weekly_report: true,
    weight_reminder: true,
    commitment_followup: true,
    achievement: true,
    challenge: true,
    reengagement: true,
  },
};

// For now, store preferences in profile metadata
// In production, integrate with expo-notifications + FCM/APNs

export async function getNotificationPrefs(): Promise<NotificationPreferences> {
  // TODO: Read from profile or separate table
  return DEFAULT_PREFS;
}

export async function updateNotificationPrefs(prefs: Partial<NotificationPreferences>): Promise<void> {
  // TODO: Save to profile or separate table
  // TODO: Update push notification channels
}

/**
 * Re-engagement notification schedule (Spec 10.4)
 * - 3 days silent: "Bir suredir gorusmedik"
 * - 7 days: Personal message from Katman 2
 * - 14 days: Email
 * - 30 days: Final email
 * - 30+ days: No notification, wait for return
 */
export function getReengagementLevel(hoursSinceLastActivity: number): 'none' | '3day' | '7day' | '14day' | '30day' | 'stopped' {
  const days = hoursSinceLastActivity / 24;
  if (days < 3) return 'none';
  if (days < 7) return '3day';
  if (days < 14) return '7day';
  if (days < 30) return '14day';
  if (days < 31) return '30day';
  return 'stopped';
}

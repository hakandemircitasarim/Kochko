/**
 * Notification Service
 * Spec 10.1-10.3: Bildirim sistemi
 *
 * Handles push notification registration, local notification scheduling,
 * and preference management with expo-notifications.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
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

/**
 * Initialize notifications - call in app root layout.
 * Spec 10.3: Strategic permission request timing.
 */
export async function initializeNotifications(): Promise<string | null> {
  // Set notification handler for foreground
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  // Request permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  // Get push token
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: undefined, // Will use app.json projectId
    });
    return tokenData.data;
  } catch {
    return null;
  }
}

/**
 * Save push token to user profile for backend push notifications.
 */
export async function savePushToken(userId: string, token: string): Promise<void> {
  await supabase.from('profiles').update({
    push_token: token,
    push_token_platform: Platform.OS,
    updated_at: new Date().toISOString(),
  }).eq('id', userId);
}

/**
 * Get notification preferences from profile.
 */
export async function getNotificationPrefs(userId: string): Promise<NotificationPreferences> {
  const { data } = await supabase
    .from('profiles')
    .select('notification_prefs')
    .eq('id', userId)
    .single();

  if (data?.notification_prefs) {
    return { ...DEFAULT_PREFS, ...data.notification_prefs as Partial<NotificationPreferences> };
  }
  return DEFAULT_PREFS;
}

/**
 * Update notification preferences.
 */
export async function updateNotificationPrefs(
  userId: string,
  prefs: Partial<NotificationPreferences>
): Promise<void> {
  const current = await getNotificationPrefs(userId);
  const updated = { ...current, ...prefs };

  await supabase.from('profiles').update({
    notification_prefs: updated,
    updated_at: new Date().toISOString(),
  }).eq('id', userId);

  // Reschedule local notifications based on new prefs
  await scheduleLocalNotifications(updated);
}

/**
 * Schedule local notifications based on user preferences.
 * Spec 10.1: Meal reminders, water reminders, etc.
 */
export async function scheduleLocalNotifications(
  prefs: NotificationPreferences
): Promise<void> {
  // Cancel all existing scheduled notifications
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (!prefs.enabled) return;

  // Water reminder - every 2 hours during waking hours
  if (prefs.types.water_reminder) {
    for (let hour = 9; hour <= 20; hour += 2) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Su Hatirlatma',
          body: 'Su icmeyi unutma!',
          data: { type: 'water_reminder' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute: 0 },
      });
    }
  }

  // Weight reminder - weekly on Monday morning
  if (prefs.types.weight_reminder) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Tarti Hatirlatma',
        body: 'Bu hafta tartilmayi unutma.',
        data: { type: 'weight_reminder' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 2, hour: 8, minute: 0 },
    });
  }

  // Daily report reminder - every evening
  if (prefs.types.daily_report) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Gun Sonu',
        body: 'Gunun nasil gecti? Raporuna bak.',
        data: { type: 'daily_report' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 21, minute: 0 },
    });
  }

  // Weekly report - Sunday evening
  if (prefs.types.weekly_report) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Haftalik Rapor',
        body: 'Bu haftanin raporu hazir.',
        data: { type: 'weekly_report' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 1, hour: 19, minute: 0 },
    });
  }
}

/**
 * Re-engagement notification schedule (Spec 10.4)
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

/**
 * Check if a notification should be sent given quiet hours.
 */
export function isQuietHour(quietStart: string, quietEnd: string): boolean {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentMinutes = hour * 60 + minute;

  const [startH, startM] = quietStart.split(':').map(Number);
  const [endH, endM] = quietEnd.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes > endMinutes) {
    // Crosses midnight: e.g. 23:00 - 07:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

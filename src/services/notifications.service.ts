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
 * Setup notification handler only - no permission request.
 * Safe to call early in app lifecycle (e.g., root layout mount).
 */
export function setupNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

/**
 * Request notification permission only if status is 'undetermined'.
 * Spec 10.3: Strategic permission request timing - ask only at the right moment.
 * Returns push token if granted, null otherwise.
 */
export async function requestNotificationPermissionIfNeeded(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();

  // Only prompt if undetermined - don't re-prompt denied users
  if (existingStatus === 'granted') {
    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: undefined,
      });
      return tokenData.data;
    } catch {
      return null;
    }
  }

  if (existingStatus !== 'undetermined') {
    return null;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    return null;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: undefined,
    });
    return tokenData.data;
  } catch {
    return null;
  }
}

/**
 * Initialize notifications - call in app root layout.
 * Spec 10.3: Backward-compatible wrapper that sets up handler + requests permission.
 */
export async function initializeNotifications(): Promise<string | null> {
  setupNotificationHandler();
  return requestNotificationPermissionIfNeeded();
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
  prefs: NotificationPreferences,
  profile?: { if_active?: boolean; if_eating_start?: string; if_eating_end?: string }
): Promise<void> {
  // Cancel all existing scheduled notifications
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (!prefs.enabled) return;

  // Morning plan notification - 07:30
  if (prefs.types.morning_plan !== false) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Gunun Plani Hazir',
        body: 'Bugunun beslenme ve antrenman planina goz at.',
        data: { type: 'morning_plan' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 7, minute: 30 },
    });
  }

  // Meal reminders - breakfast, lunch, dinner
  if (prefs.types.meal_reminder) {
    // Helper: check if a given hour:minute falls within the IF eating window
    const isWithinIFWindow = (mealHour: number, mealMinute: number): boolean => {
      if (!profile?.if_active || !profile.if_eating_start || !profile.if_eating_end) return true;
      const [startH, startM] = profile.if_eating_start.split(':').map(Number);
      const [endH, endM] = profile.if_eating_end.split(':').map(Number);
      const mealMins = mealHour * 60 + mealMinute;
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;
      if (startMins <= endMins) {
        return mealMins >= startMins && mealMins <= endMins;
      }
      // Eating window crosses midnight
      return mealMins >= startMins || mealMins <= endMins;
    };

    // Kahvalti - 08:00
    if (isWithinIFWindow(8, 0)) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Kahvalti Zamani',
          body: 'Gune saglikli bir kahvalti ile basla.',
          data: { type: 'meal_reminder', meal: 'kahvalti' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 8, minute: 0 },
      });
    }

    // Ogle yemegi - 12:30
    if (isWithinIFWindow(12, 30)) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Ogle Yemegi',
          body: 'Ogle yemegi vakti geldi, dengeli bir ogun sec.',
          data: { type: 'meal_reminder', meal: 'ogle' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 12, minute: 30 },
      });
    }

    // Aksam yemegi - 19:00
    if (isWithinIFWindow(19, 0)) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Aksam Yemegi',
          body: 'Aksam yemegi icin hafif ve doyurucu bir sey hazirla.',
          data: { type: 'meal_reminder', meal: 'aksam' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 19, minute: 0 },
      });
    }
  }

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

  // Workout reminder - 17:00 on weekdays (Monday=2 through Friday=6 in expo-notifications weekday)
  if (prefs.types.workout_reminder !== false) {
    for (const weekday of [2, 3, 4, 5, 6]) { // Mon–Fri
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Antrenman Zamani',
          body: 'Bugunun antrenman planin hazir. Harekete gec!',
          data: { type: 'workout_reminder' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday, hour: 17, minute: 0 },
      });
    }
  }

  // Night risk / sleep reminder - 22:30
  if (prefs.types.night_risk) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Gece Hatirlatma',
        body: 'Uykudan once mutfaktan uzak dur. Yarin icin planin hazir.',
        data: { type: 'night_risk' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 22, minute: 30 },
    });
  }
}

/**
 * Schedule a trial expiry reminder notification.
 * Spec 16: If trial is active and 2 days remaining, notify user.
 */
export async function scheduleTrialReminder(trialDaysLeft: number): Promise<void> {
  if (trialDaysLeft !== 2) return;

  // Cancel any existing trial reminders first
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.content.data?.type === 'trial_reminder') {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  // Schedule immediate-ish notification (next day at 10:00)
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Deneme Sureniz Bitiyor',
      body: "Deneme sureniz 2 gun sonra bitiyor. Premium'a gecin!",
      data: { type: 'trial_reminder' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 10,
      minute: 0,
    },
  });
}

/**
 * Check trial status and schedule reminder if needed.
 * Call this on app open / profile load.
 */
export async function checkAndScheduleTrialReminder(
  isInTrial: boolean,
  trialDaysLeft: number
): Promise<void> {
  if (!isInTrial) return;
  if (trialDaysLeft <= 2 && trialDaysLeft > 0) {
    await scheduleTrialReminder(trialDaysLeft);
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

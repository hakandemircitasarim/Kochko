/**
 * Notification Service
 * Spec 10.1-10.3: Bildirim sistemi
 *
 * Handles notification preferences stored in profile metadata,
 * local notification scheduling via expo-notifications,
 * and re-engagement logic.
 */
import { supabase } from '@/lib/supabase';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

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
 * Read notification preferences from user profile metadata.
 */
export async function getNotificationPrefs(): Promise<NotificationPreferences> {
  const { data } = await supabase.from('profiles').select('notification_prefs').single();
  if (data?.notification_prefs && typeof data.notification_prefs === 'object') {
    return { ...DEFAULT_PREFS, ...(data.notification_prefs as Partial<NotificationPreferences>) };
  }
  return DEFAULT_PREFS;
}

/**
 * Save notification preferences to user profile.
 */
export async function updateNotificationPrefs(prefs: Partial<NotificationPreferences>): Promise<void> {
  const current = await getNotificationPrefs();
  const merged = { ...current, ...prefs };
  await supabase.from('profiles').update({ notification_prefs: merged as never }).single();
}

/**
 * Register for push notifications.
 * Spec 10.3: bildirim izni stratejik zamanda istenir.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Kochko',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const token = await Notifications.getExpoPushTokenAsync();
  return token.data;
}

/**
 * Schedule a local notification.
 */
export async function scheduleLocalNotification(
  title: string,
  body: string,
  triggerSeconds: number,
): Promise<string> {
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled) return '';

  return Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: { seconds: triggerSeconds, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL },
  });
}

/**
 * Cancel all scheduled notifications.
 */
export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Check if current time is in quiet hours.
 */
export function isInQuietHours(quietStart: string, quietEnd: string): boolean {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = quietStart.split(':').map(Number);
  const [endH, endM] = quietEnd.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes > endMinutes) {
    // Overnight quiet hours (e.g., 23:00 - 07:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
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
 * Get re-engagement message based on level.
 */
export function getReengagementMessage(level: string): string {
  switch (level) {
    case '3day': return 'Bir suredir gorusmedik, bugun nasilsin?';
    case '7day': return 'Seni ozledik! Kaldigin yerden devam edelim mi?';
    case '14day': return 'Hedefin seni bekliyor. Geri donmek icin harika bir gun!';
    case '30day': return 'Merhaba! Istedigin zaman buradayim, tekrar baslayalim mi?';
    default: return '';
  }
}

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
  quietStart: string;
  quietEnd: string;
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

export function setupNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export async function requestNotificationPermissionIfNeeded(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();

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

export async function initializeNotifications(): Promise<string | null> {
  setupNotificationHandler();
  return requestNotificationPermissionIfNeeded();
}

export async function savePushToken(userId: string, token: string): Promise<void> {
  await supabase.from('profiles').update({
    push_token: token,
    push_token_platform: Platform.OS,
    updated_at: new Date().toISOString(),
  }).eq('id', userId);
}

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

  const { data: profile } = await supabase
    .from('profiles')
    .select('if_active, if_eating_start, if_eating_end, workout_days')
    .eq('id', userId)
    .single();

  const ifProfile = profile ? {
    if_active: profile.if_active as boolean,
    if_eating_start: profile.if_eating_start as string | null,
    if_eating_end: profile.if_eating_end as string | null,
  } : null;

  const workoutDays = (profile as Record<string, unknown> | null)?.workout_days as number[] | null;

  await scheduleLocalNotifications(updated, ifProfile, workoutDays);
}

export async function scheduleLocalNotifications(
  prefs: NotificationPreferences,
  ifProfile?: { if_active: boolean; if_eating_start: string | null; if_eating_end: string | null } | null,
  workoutDays?: number[] | null,
): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (!prefs.enabled) return;

  if (prefs.types.morning_plan) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Gunun Plani Hazir',
        body: 'Bugunun beslenme ve antrenman planina goz at.',
        data: { type: 'morning_plan' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 7, minute: 30 },
    });
  }

  if (prefs.types.meal_reminder) {
    const useIF = ifProfile?.if_active && ifProfile.if_eating_start && ifProfile.if_eating_end;
    let mealTimes: { label: string; title: string; body: string; meal: string; hour: number; minute: number }[];

    if (useIF) {
      const [startH, startM] = ifProfile!.if_eating_start!.split(':').map(Number);
      const [endH, endM] = ifProfile!.if_eating_end!.split(':').map(Number);
      let windowMinutes = (endH * 60 + endM) - (startH * 60 + startM);
      if (windowMinutes <= 0) windowMinutes += 24 * 60;

      const halfWindow = Math.floor(windowMinutes / 2);
      const midH = Math.floor((startH * 60 + startM + halfWindow) / 60) % 24;
      const midM = (startH * 60 + startM + halfWindow) % 60;

      mealTimes = [
        { label: 'ilk_ogun', title: 'Ilk Ogun', body: 'IF pencereniz acildi, ilk ogununu kaydet.', meal: 'kahvalti', hour: startH, minute: startM },
        { label: 'ara_ogun', title: 'Ara Ogun', body: 'IF pencerenizde ikinci ogun zamani.', meal: 'ogle', hour: midH, minute: midM },
        { label: 'son_ogun', title: 'Son Ogun', body: 'IF penceresi kapanmadan son ogununu planla.', meal: 'aksam', hour: endH > 0 ? endH - 1 : 23, minute: endM },
      ];
    } else {
      mealTimes = [
        { label: 'kahvalti', title: 'Kahvalti Zamani', body: 'Gune saglikli bir kahvalti ile basla.', meal: 'kahvalti', hour: 8, minute: 0 },
        { label: 'ogle', title: 'Ogle Yemegi', body: 'Ogle yemegi vakti geldi, dengeli bir ogun sec.', meal: 'ogle', hour: 12, minute: 30 },
        { label: 'aksam', title: 'Aksam Yemegi', body: 'Aksam yemegi icin hafif ve doyurucu bir sey hazirla.', meal: 'aksam', hour: 19, minute: 0 },
      ];
    }

    for (const mt of mealTimes) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: mt.title,
          body: mt.body,
          data: { type: 'meal_reminder', meal: mt.meal },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: mt.hour, minute: mt.minute },
      });
    }
  }

  if (prefs.types.workout_reminder && workoutDays && workoutDays.length > 0) {
    for (const weekday of workoutDays) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Antrenman Zamani',
          body: 'Bugun antrenman gunun. Planini kontrol et ve hazirliklara basla!',
          data: { type: 'workout_reminder', weekday },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday, hour: 9, minute: 0 },
      });
    }
  }

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

export async function scheduleTrialReminder(trialDaysLeft: number): Promise<void> {
  if (trialDaysLeft !== 2) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.content.data?.type === 'trial_reminder') {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

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

export async function checkAndScheduleTrialReminder(
  isInTrial: boolean,
  trialDaysLeft: number
): Promise<void> {
  if (!isInTrial) return;
  if (trialDaysLeft <= 2 && trialDaysLeft > 0) {
    await scheduleTrialReminder(trialDaysLeft);
  }
}

export function getReengagementLevel(hoursSinceLastActivity: number): 'none' | '3day' | '7day' | '14day' | '30day' | 'stopped' {
  const days = hoursSinceLastActivity / 24;
  if (days < 3) return 'none';
  if (days < 7) return '3day';
  if (days < 14) return '7day';
  if (days < 30) return '14day';
  if (days < 31) return '30day';
  return 'stopped';
}

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
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

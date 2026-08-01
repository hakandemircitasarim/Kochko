/**
 * Notification Service
 * Spec 10.1-10.3: Bildirim sistemi
 *
 * Handles push notification registration, local notification scheduling,
 * and preference management with expo-notifications.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';

// #journey: expo-notifications needs the EAS projectId to mint a push token in a
// standalone build; passing projectId:undefined silently minted NOTHING, so 0 users
// had a push_token and the entire push/re-engagement layer was inert. Read it from the
// EAS-populated config. (Delivery still requires the app be built with a real EAS project.)
const EAS_PROJECT_ID =
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
  ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
import {
  calculateDynamicTiming, inferActiveHours, bundleNotifications,
  type NotificationCandidate,
} from '@/services/notification-intelligence.service';

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
      shouldShowAlert: true as const,
      shouldPlaySound: true as const,
      shouldSetBadge: true as const,
      shouldShowBanner: true as const,
      shouldShowList: true as const,
    }),
  });
}

export async function requestNotificationPermissionIfNeeded(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();

  if (existingStatus === 'granted') {
    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: EAS_PROJECT_ID,
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
      projectId: EAS_PROJECT_ID,
    });
    return tokenData.data;
  } catch {
    return null;
  }
}

/**
 * Current OS notification permission status. (audit UX-FBK-02) Lets the settings screen
 * tell the user when in-app toggles can't actually deliver because the OS permission is off.
 */
export async function getNotificationPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status as 'granted' | 'denied' | 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export async function setupAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Kochko',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  } catch { /* channel setup non-critical */ }
}

export async function initializeNotifications(): Promise<string | null> {
  setupNotificationHandler();
  await setupAndroidChannel();
  return requestNotificationPermissionIfNeeded();
}

/**
 * FIX (ux-ideas #16): app-launch setup WITHOUT a cold OS permission prompt. Sets up the
 * notification handler + Android channel and returns the push token ONLY if permission was
 * already granted — it never triggers the system dialog. The actual request is deferred to a
 * primed moment (post-onboarding, value explained first): a cold prompt craters accept rates,
 * and once denied the whole proactive-coaching / re-engagement layer is dead permanently.
 */
export async function setupNotificationsIfGranted(): Promise<string | null> {
  setupNotificationHandler();
  await setupAndroidChannel();
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return null;
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    return tokenData.data;
  } catch {
    return null;
  }
}

export async function savePushToken(userId: string, token: string): Promise<void> {
  await supabase.from('profiles').update({
    push_token: token,
    push_token_platform: Platform.OS,
    updated_at: new Date().toISOString(),
  }).eq('id', userId);
}

export async function getNotificationPrefs(userId: string): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from('profiles')
    .select('notification_prefs')
    .eq('id', userId)
    .single();

  if (error) {
    console.warn('getNotificationPrefs read failed, using defaults:', error.message);
  }

  if (data?.notification_prefs) {
    return { ...DEFAULT_PREFS, ...data.notification_prefs as Partial<NotificationPreferences> };
  }
  return DEFAULT_PREFS;
}

export async function updateNotificationPrefs(
  userId: string,
  prefs: Partial<NotificationPreferences>
): Promise<boolean> {
  const current = await getNotificationPrefs(userId);
  const updated = { ...current, ...prefs };

  const { error } = await supabase.from('profiles').update({
    notification_prefs: updated,
    updated_at: new Date().toISOString(),
  }).eq('id', userId);

  if (error) {
    console.error('updateNotificationPrefs error:', error.message);
    return false; // do not reschedule when the prefs were not persisted
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('if_active, if_eating_start, if_eating_end, sleep_time')
    .eq('id', userId)
    .single();

  const ifProfile = profile ? {
    if_active: profile.if_active as boolean,
    if_eating_start: profile.if_eating_start as string | null,
    if_eating_end: profile.if_eating_end as string | null,
  } : null;

  const workoutDays = await getWorkoutWeekdays(userId);
  const sleepTime = (profile as Record<string, unknown> | null)?.sleep_time as string | null;

  await scheduleLocalNotifications(updated, ifProfile, workoutDays, userId, sleepTime);
  return true;
}

/**
 * Antrenman günlerini kullanıcının PLANINDAN türet.
 *
 * "Antrenman hatırlatma" anahtarı ayarlarda açılabiliyor ve "Antrenman günlerinde
 * hatırlatır" diyordu, ama `workoutDays` sabit `null` bırakılmıştı (profiles'ta
 * workout_days kolonu yok diye) — koşul `workoutDays && length > 0` hiçbir zaman
 * geçmediği için bu bildirim BİR KEZ BİLE planlanmadı. Kolon yok ama veri var:
 * `daily_plans.plan_type` zaten 'training' | 'rest'.
 *
 * Önümüzdeki 14 günü okuyup antrenman günü olan HAFTA GÜNLERİNİ çıkarıyoruz
 * (14 gün = plan haftalık döngüde olsa bile her günü en az bir kez görürüz).
 * Expo'nun WEEKLY tetikleyicisi 1=Pazar..7=Cumartesi sayar; JS getDay() 0=Pazar
 * verir, o yüzden +1.
 *
 * Plan yoksa null döner → hatırlatma kurulmaz (uydurma gün üretmeyiz).
 */
async function getWorkoutWeekdays(userId: string): Promise<number[] | null> {
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const until = new Date(today.getTime() + 14 * 86400000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('daily_plans')
    .select('date, plan_type')
    .eq('user_id', userId)
    .eq('plan_type', 'training')
    .gte('date', from)
    .lte('date', until);

  if (error || !data || data.length === 0) return null;

  const weekdays = new Set<number>();
  for (const row of data as { date: string }[]) {
    // 'YYYY-MM-DD' — parçalayarak kur; new Date('2026-07-31') UTC yorumlanır ve
    // UTC+3'te gün kayabilir (gece yarısı sınırındaki plan yanlış güne düşerdi).
    const [y, m, d] = row.date.split('-').map(Number);
    if (!y || !m || !d) continue;
    weekdays.add(new Date(y, m - 1, d).getDay() + 1);
  }
  return weekdays.size > 0 ? [...weekdays].sort((a, b) => a - b) : null;
}

/**
 * Schedule local notifications on app startup from the user's saved prefs.
 * Previously reminders were only (re)scheduled when the user opened the notification
 * settings screen — so a user who never visited it received no local reminders at all.
 */
export async function scheduleNotificationsOnStartup(userId: string): Promise<void> {
  const prefs = await getNotificationPrefs(userId);
  if (!prefs.enabled) {
    await Notifications.cancelAllScheduledNotificationsAsync();
    return;
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('if_active, if_eating_start, if_eating_end, sleep_time')
    .eq('id', userId)
    .single();
  const ifProfile = profile ? {
    if_active: profile.if_active as boolean,
    if_eating_start: profile.if_eating_start as string | null,
    if_eating_end: profile.if_eating_end as string | null,
  } : null;
  const sleepTime = (profile as Record<string, unknown> | null)?.sleep_time as string | null;
  // Açılıştaki bu yol da `null` geçiyordu — yani ayarlar ekranına hiç girmeyen kullanıcıda
  // antrenman hatırlatması iki kere ölüydü. Aynı türetimi burada da kullan.
  const workoutDays = await getWorkoutWeekdays(userId);
  await scheduleLocalNotifications(prefs, ifProfile, workoutDays, userId, sleepTime);
}

export async function scheduleLocalNotifications(
  prefs: NotificationPreferences,
  ifProfile?: { if_active: boolean; if_eating_start: string | null; if_eating_end: string | null } | null,
  workoutDays?: number[] | null,
  userId?: string,
  sleepTime?: string | null,
): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (!prefs.enabled) return;

  // Infer user's active hours for dynamic timing (Spec 10)
  let activeHours: number[] = [8, 12, 19]; // defaults
  if (userId) {
    try {
      const { data: chatData } = await supabase
        .from('chat_messages')
        .select('created_at')
        .eq('user_id', userId)
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(100);
      if (chatData && chatData.length > 0) {
        activeHours = inferActiveHours(chatData.map(m => m.created_at));
      }
    } catch { /* use defaults */ }
  }

  // Helper: adjust scheduled hour/minute using dynamic timing
  const adjustTime = (hour: number, minute: number): { hour: number; minute: number } => {
    const baseDate = new Date();
    baseDate.setHours(hour, minute, 0, 0);
    const adjusted = calculateDynamicTiming(baseDate, activeHours);
    return { hour: adjusted.getHours(), minute: adjusted.getMinutes() };
  };

  // Quiet-window policy applied to EVERY candidate (previously only 3/9 types
  // were checked, and adjustTime could shift a reminder INTO the quiet window):
  //  - 'skip':  drop it (water in the middle of the night is useless)
  //  - 'after': push to quietEnd (morning-type reminders)
  //  - 'before': pull to 30 min before quietStart (evening reports)
  const [qeH, qeM] = prefs.quietEnd.split(':').map(Number);
  const [qsH, qsM] = prefs.quietStart.split(':').map(Number);
  const resolveQuiet = (
    hour: number, minute: number, policy: 'skip' | 'after' | 'before',
  ): { hour: number; minute: number } | null => {
    if (!isTimeInQuietWindow(hour, minute, prefs.quietStart, prefs.quietEnd)) return { hour, minute };
    if (policy === 'skip') return null;
    if (policy === 'after') return { hour: (qeH ?? 7) % 24, minute: qeM ?? 0 };
    let total = (qsH ?? 23) * 60 + (qsM ?? 0) - 30;
    if (total < 0) total += 24 * 60;
    return { hour: Math.floor(total / 60) % 24, minute: total % 60 };
  };

  // Collect all DAILY candidates first, then bundle same-30-min-window ones into
  // a single notification (Spec 10: "AI aynı anda birden fazla bildirim göndermez").
  type DailyCandidate = NotificationCandidate & { extraData?: Record<string, unknown> };
  const daily: DailyCandidate[] = [];
  const candidateAt = (hour: number, minute: number): Date => {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const pushDaily = (
    type: string, title: string, body: string,
    priority: NotificationCandidate['priority'],
    t: { hour: number; minute: number } | null,
    extraData?: Record<string, unknown>,
  ) => {
    if (!t) return;
    daily.push({ id: `${type}_${t.hour}_${t.minute}`, type, title, body, priority, scheduledAt: candidateAt(t.hour, t.minute), category: type, extraData });
  };

  if (prefs.types.morning_plan) {
    const t = adjustTime(7, 30);
    pushDaily('morning_plan', 'Günün Planı Hazır', 'Bugünün beslenme ve antrenman planına göz at.', 'medium',
      resolveQuiet(t.hour, t.minute, 'after'));
  }

  if (prefs.types.meal_reminder) {
    const useIF = ifProfile?.if_active && ifProfile.if_eating_start && ifProfile.if_eating_end;
    let mealTimes: { title: string; body: string; meal: string; hour: number; minute: number }[];

    if (useIF) {
      const [startH, startM] = ifProfile!.if_eating_start!.split(':').map(Number);
      const [endH, endM] = ifProfile!.if_eating_end!.split(':').map(Number);
      let windowMinutes = (endH * 60 + endM) - (startH * 60 + startM);
      if (windowMinutes <= 0) windowMinutes += 24 * 60;

      const halfWindow = Math.floor(windowMinutes / 2);
      const midH = Math.floor((startH * 60 + startM + halfWindow) / 60) % 24;
      const midM = (startH * 60 + startM + halfWindow) % 60;

      mealTimes = [
        { title: 'İlk Öğün', body: 'IF pencereni açtın, ilk öğününü kaydet.', meal: 'kahvalti', hour: startH, minute: startM },
        { title: 'Ara Öğün', body: 'IF pencerende ikinci öğün zamanı.', meal: 'ogle', hour: midH, minute: midM },
        { title: 'Son Öğün', body: 'IF penceresi kapanmadan son öğününü planla.', meal: 'aksam', hour: endH > 0 ? endH - 1 : 23, minute: endM },
      ];
    } else {
      mealTimes = [
        { title: 'Kahvaltı Zamanı', body: 'Güne sağlıklı bir kahvaltı ile başla.', meal: 'kahvalti', hour: 8, minute: 0 },
        { title: 'Öğle Yemeği', body: 'Öğle yemeği vakti geldi, dengeli bir öğün seç.', meal: 'ogle', hour: 12, minute: 30 },
        { title: 'Akşam Yemeği', body: 'Akşam yemeği için hafif ve doyurucu bir şey hazırla.', meal: 'aksam', hour: 19, minute: 0 },
      ];
    }

    for (const mt of mealTimes) {
      pushDaily('meal_reminder', mt.title, mt.body, 'medium',
        resolveQuiet(mt.hour, mt.minute, 'skip'), { meal: mt.meal });
    }
  }

  if (prefs.types.water_reminder) {
    for (let hour = 9; hour <= 20; hour += 2) {
      pushDaily('water_reminder', 'Su Hatırlatma', 'Su içmeyi unutma!', 'low',
        resolveQuiet(hour, 0, 'skip'));
    }
  }

  if (prefs.types.daily_report) {
    pushDaily('daily_report', 'Gün Sonu', 'Günün nasıl geçti? Raporuna bak.', 'medium',
      resolveQuiet(21, 0, 'before'));
  }

  if (prefs.types.night_risk) {
    pushDaily('night_risk', 'Gece Hatırlatma', 'Uykudan önce mutfaktan uzak dur. Yarın için planın hazır.', 'high',
      resolveQuiet(22, 30, 'skip'));
  }

  // Bedtime wind-down (Spec 14.2): sleep_time - 30 minutes → soft "screen off" reminder.
  if (sleepTime) {
    const [sh, sm] = sleepTime.split(':').map(Number);
    if (Number.isFinite(sh) && Number.isFinite(sm)) {
      let totalMin = sh * 60 + sm - 30;
      if (totalMin < 0) totalMin += 24 * 60;
      pushDaily('bedtime_wind_down', 'Uyku Yaklaşıyor',
        'Yatış saatine 30 dakika kaldı. Ekranı kapat, bir su iç, ertesi gün için güzel bir uyku al.', 'low',
        resolveQuiet(Math.floor(totalMin / 60) % 24, totalMin % 60, 'skip'));
    }
  }

  // Group daily candidates into 30-min windows; 2+ in a window collapse into ONE
  // bundled notification via notification-intelligence (previously each type was
  // scheduled independently, so e.g. dinner 19:00 + water 19:00 fired together).
  const sortedDaily = [...daily].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const windows: DailyCandidate[][] = [];
  for (const cand of sortedDaily) {
    const cur = windows[windows.length - 1];
    if (cur && cand.scheduledAt.getTime() - cur[0].scheduledAt.getTime() < 30 * 60 * 1000) cur.push(cand);
    else windows.push([cand]);
  }
  for (const group of windows) {
    const winner = group.length === 1 ? group[0] : (bundleNotifications(group) ?? group[0]);
    const data = group.length === 1
      ? { type: winner.type, ...(group[0].extraData ?? {}) }
      : { type: 'bundled', bundled: group.map(g => g.type) };
    await Notifications.scheduleNotificationAsync({
      content: { title: winner.title, body: winner.body, data },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: winner.scheduledAt.getHours(),
        minute: winner.scheduledAt.getMinutes(),
      },
    });
  }

  // Weekly reminders (different weekday semantics — not bundled with dailies,
  // but the quiet-window policy still applies).
  if (prefs.types.workout_reminder && workoutDays && workoutDays.length > 0) {
    const t = resolveQuiet(9, 0, 'after');
    if (t) {
      for (const weekday of workoutDays) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Antrenman Zamanı',
            body: 'Bugün antrenman günün. Planını kontrol et ve hazırlıklara başla!',
            data: { type: 'workout_reminder', weekday },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday, hour: t.hour, minute: t.minute },
        });
      }
    }
  }

  if (prefs.types.weight_reminder) {
    const t = resolveQuiet(8, 0, 'after');
    if (t) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Tartı Hatırlatma',
          body: 'Bu hafta tartılmayı unutma.',
          data: { type: 'weight_reminder' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 2, hour: t.hour, minute: t.minute },
      });
    }
  }

  if (prefs.types.weekly_report) {
    const t = resolveQuiet(19, 0, 'before');
    if (t) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Haftalık Rapor',
          body: 'Bu haftanın raporu hazır.',
          data: { type: 'weekly_report' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 1, hour: t.hour, minute: t.minute },
      });
    }
  }
}

export async function scheduleTrialReminder(trialDaysLeft: number): Promise<void> {
  // FIX (audit: dead trial reminder) was `!== 2` → silently no-op'd the 1-day-left
  // case that checkAndScheduleTrialReminder explicitly forwards. Allow 1–2 days left.
  if (trialDaysLeft < 1 || trialDaysLeft > 2) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.content.data?.type === 'trial_reminder') {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Deneme Süren Bitiyor',
      // FIX (audit: dead trial reminder) dynamic day count instead of hard-coded "2 gün".
      body: `Deneme süren ${trialDaysLeft} gün sonra bitiyor. Premium'a geç!`,
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
  return isTimeInQuietWindow(now.getHours(), now.getMinutes(), quietStart, quietEnd);
}

/** Is a specific scheduled time (hour:minute) inside the quiet window? (P1#9) */
function isTimeInQuietWindow(hour: number, minute: number, quietStart: string, quietEnd: string): boolean {
  const cur = hour * 60 + minute;
  const [startH, startM] = quietStart.split(':').map(Number);
  const [endH, endM] = quietEnd.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  if (startMinutes > endMinutes) {
    return cur >= startMinutes || cur < endMinutes;
  }
  return cur >= startMinutes && cur < endMinutes;
}

/**
 * FIX (ux-ideas #14): map a notification's data.type to an in-app route so tapping a
 * push lands the user on the relevant screen instead of a cold dashboard. Returns null
 * for types with no better destination than "just open the app". Consumed by the
 * response listener in app/_layout.tsx.
 */
export function routeForNotificationType(type: string | undefined): string | null {
  switch (type) {
    case 'weekly_report':
    case 'weekly':
      return '/reports/weekly';
    case 'daily':
      return '/reports/daily';
    case 'weight_reminder':
    case 'workout_reminder':
    case 'snack_hour_nudge':
    case 'meal_gap':
    case 'no_meals':
    case 'night_eating_risk':
      return '/log';
    case 'trial_reminder':
      return '/settings/premium';
    case 'challenge':
    case 'challenge_completed':
      return '/settings/challenges';
    case 'goal_reached':
    case 'reinforcement_milestone':
      return '/settings/achievements';
    // Conversational / coaching pushes → the coach thread.
    case 'reengagement':
    case 'motivation_dip':
    case 'weekend_drift':
    case 'bundled':
    case 'habit_introduce':
    case 'habit_stack':
    case 'deload_suggestion':
    case 'progressive_overload':
    case 'mini_cut_suggestion':
    case 'maintain':
    case 'mvd_reset':
    case 'periodic_end':
    case 'alcohol_next_day':
      return '/(tabs)/chat';
    default:
      return null;
  }
}

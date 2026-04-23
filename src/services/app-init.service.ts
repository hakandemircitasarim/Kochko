/**
 * App-init — side effects that run once a user is authenticated.
 * Extracted from app/_layout.tsx so the root layout stays focused on
 * routing + theming. Call the exported hooks from the root layout.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { initializeNotifications, savePushToken } from '@/services/notifications.service';
import { checkAndRunBackup } from '@/services/auto-backup.service';
import { registerSession, heartbeatSession, isSessionStillValid } from '@/services/realtime-sync.service';
import { getWidgetData, serializeForNativeWidget } from '@/services/widget.service';
import { detectTimezone } from '@/lib/timezone';

const WIDGET_STORAGE_KEY = '@kochko_widget_data';

async function initNotificationsAndSession(userId: string) {
  try {
    const token = await initializeNotifications();
    if (token) savePushToken(userId, token);
    const deviceInfo = `${Device.modelName ?? 'Unknown'} · ${Device.osName ?? ''} ${Device.osVersion ?? ''}`.trim();
    await registerSession(deviceInfo, token ?? null);
  } catch (err) {
    console.warn('Notification/session init failed:', err);
  }
}

function syncTimezone(userId: string) {
  const profile = useProfileStore.getState().profile;
  if (!profile) return;
  const detectedTz = detectTimezone();
  const updates: Record<string, string> = {};
  if (!profile.home_timezone || profile.home_timezone === 'Europe/Istanbul') {
    if (detectedTz !== 'Europe/Istanbul') updates.home_timezone = detectedTz;
  }
  if (profile.active_timezone !== detectedTz) {
    updates.active_timezone = detectedTz;
  }
  if (Object.keys(updates).length > 0) {
    useProfileStore.getState().update(userId, updates as never);
  }
}

/** Runs all authenticated-user startup tasks once per sign-in. */
export function useAuthenticatedAppInit() {
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!userId) return;
    initNotificationsAndSession(userId);
    checkAndRunBackup().catch((err) => console.warn('Auto backup check failed:', err));
    syncTimezone(userId);
  }, [userId]);
}

/** App foreground/background listener: widget sync + session liveness check. */
export function useAppStateSync() {
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (!userId) return;

      if (nextState === 'background' || nextState === 'inactive') {
        try {
          const widgetData = await getWidgetData(userId);
          await AsyncStorage.setItem(WIDGET_STORAGE_KEY, serializeForNativeWidget(widgetData));
        } catch (err) {
          console.warn('Widget sync failed:', err);
        }
      }

      if (nextState === 'active') {
        try {
          const valid = await isSessionStillValid();
          if (!valid) {
            await useAuthStore.getState().signOut();
          } else {
            await heartbeatSession();
          }
        } catch { /* non-critical */ }
      }
    });
    return () => subscription.remove();
  }, [userId]);
}

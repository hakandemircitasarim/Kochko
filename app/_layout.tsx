import { useEffect, useState, useMemo } from 'react';
import { useColorScheme, AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { initializeNotifications, savePushToken } from '@/services/notifications.service';
import { checkAndRunBackup } from '@/services/auto-backup.service';
import { registerSession, heartbeatSession, isSessionStillValid } from '@/services/realtime-sync.service';
import * as Device from 'expo-device';
import { getWidgetData, serializeForNativeWidget } from '@/services/widget.service';
import { detectTimezone } from '@/lib/timezone';
import { ThemeContext, DARK_COLORS, LIGHT_COLORS, type ThemeMode } from '@/lib/theme';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

const THEME_KEY = '@kochko_theme_mode';

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);
  const user = useAuthStore((s) => s.user);
  const systemScheme = useColorScheme();
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');

  useEffect(() => { initialize(); }, [initialize]);

  // Load saved theme preference
  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then(saved => {
      if (saved === 'dark' || saved === 'light' || saved === 'system') setThemeMode(saved);
    });
  }, []);

  // Save theme preference on change
  const handleSetMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    AsyncStorage.setItem(THEME_KEY, mode);
  };

  // Resolve effective theme
  const isDark = themeMode === 'system' ? systemScheme !== 'light' : themeMode === 'dark';
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;

  const themeValue = useMemo(() => ({
    mode: themeMode,
    colors,
    isDark,
    setMode: handleSetMode,
  }), [themeMode, isDark, colors]);

  // Initialize push notifications when user is authenticated (Spec 10.1)
  useEffect(() => {
    if (!user?.id) return;
    initializeNotifications().then(async token => {
      if (token) savePushToken(user.id, token);
      // Register this device/app instance as an active session (Spec 16.4)
      const deviceInfo = `${Device.modelName ?? 'Unknown'} · ${Device.osName ?? ''} ${Device.osVersion ?? ''}`.trim();
      await registerSession(deviceInfo, token ?? null);
    }).catch((err) => console.warn('Notification/session init failed:', err));
    // Auto backup check (Spec 18.2)
    checkAndRunBackup().catch((err) => console.warn('Auto backup check failed:', err));

    // Auto-detect timezone (Spec 2.5)
    const profile = useProfileStore.getState().profile;
    if (profile) {
      const detectedTz = detectTimezone();
      const updates: Record<string, string> = {};
      if (!profile.home_timezone || profile.home_timezone === 'Europe/Istanbul') {
        if (detectedTz !== 'Europe/Istanbul') updates.home_timezone = detectedTz;
      }
      if (profile.active_timezone !== detectedTz) {
        updates.active_timezone = detectedTz;
      }
      if (Object.keys(updates).length > 0) {
        useProfileStore.getState().update(user.id, updates as never);
      }
    }
  }, [user?.id]);

  // Widget data sync: update AsyncStorage when app goes to background (Spec 23)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if ((nextState === 'background' || nextState === 'inactive') && user?.id) {
        try {
          const widgetData = await getWidgetData(user.id);
          const serialized = serializeForNativeWidget(widgetData);
          await AsyncStorage.setItem('@kochko_widget_data', serialized);
        } catch (err) { console.warn('Widget sync failed:', err); }
      }
      // On foreground: heartbeat + check if our session was remotely terminated (Spec 16.4)
      if (nextState === 'active' && user?.id) {
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
  }, [user?.id]);

  return (
    <ErrorBoundary>
    <ThemeContext.Provider value={themeValue}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="log" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="chat" options={{ headerShown: false }} />
        {/* app/plan/* — header is managed per-page via inline <Stack.Screen> in
            diet.tsx/workout.tsx/history.tsx (each sets its own title). No
            grouped layout file, so no parent declaration needed here. */}
        <Stack.Screen name="recipe" options={{ headerShown: false }} />
        <Stack.Screen name="weekly-menu" options={{ headerShown: false }} />
        <Stack.Screen name="reports" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
      </Stack>
    </ThemeContext.Provider>
    </ErrorBoundary>
  );
}

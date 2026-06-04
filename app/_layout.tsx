import { useEffect, useState, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/stores/auth.store';
import { useAuthenticatedAppInit, useAppStateSync } from '@/services/app-init.service';
import { installGlobalErrorHandlers } from '@/services/error-handler.service';
import { safeGetString, safeSetString } from '@/lib/safe-storage';
import { ThemeContext, DARK_COLORS, LIGHT_COLORS, type ThemeMode } from '@/lib/theme';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { OfflineBanner } from '@/components/common/OfflineBanner';
import { initSentry } from '@/lib/sentry';

const THEME_KEY = '@kochko_theme_mode';

// Install at module load, before any render happens, so rejections fired
// during component mount are also captured.
installGlobalErrorHandlers();

// Initialize Sentry once at module load. No-op if DSN is unset.
void initSentry();

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);
  const systemScheme = useColorScheme();
  // App is designed as a flat dark theme (teal accent). Default to dark so a
  // light-mode device doesn't render authed screens light while the hardcoded
  // auth screens stay dark. Users can still override in settings (persisted).
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');

  useEffect(() => { initialize(); }, [initialize]);

  useEffect(() => {
    safeGetString(THEME_KEY).then(saved => {
      if (saved === 'dark' || saved === 'light' || saved === 'system') setThemeMode(saved);
    });
  }, []);

  const handleSetMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    safeSetString(THEME_KEY, mode);
  };

  const isDark = themeMode === 'system' ? systemScheme !== 'light' : themeMode === 'dark';
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;

  const themeValue = useMemo(() => ({
    mode: themeMode,
    colors,
    isDark,
    setMode: handleSetMode,
  }), [themeMode, isDark, colors]);

  useAuthenticatedAppInit();
  useAppStateSync();

  return (
    <ErrorBoundary>
    <ThemeContext.Provider value={themeValue}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <OfflineBanner />
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

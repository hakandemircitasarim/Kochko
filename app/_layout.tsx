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

const THEME_KEY = '@kochko_theme_mode';

// Install at module load, before any render happens, so rejections fired
// during component mount are also captured.
installGlobalErrorHandlers();

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);
  const systemScheme = useColorScheme();
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');

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

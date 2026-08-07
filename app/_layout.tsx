import { useEffect, useState, useMemo, useRef } from 'react';
import { useColorScheme, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Stack, router, useSegments } from 'expo-router';
import { routeForNotificationType } from '@/services/notifications.service';
import { SystemBars } from 'react-native-edge-to-edge';
import { useAuthStore } from '@/stores/auth.store';
import { useAuthenticatedAppInit, useAppStateSync } from '@/services/app-init.service';
import { installGlobalErrorHandlers } from '@/services/error-handler.service';
import { safeGetString, safeSetString } from '@/lib/safe-storage';
import { ThemeContext, DARK_COLORS, LIGHT_COLORS, type ThemeMode } from '@/lib/theme';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { OfflineBanner } from '@/components/common/OfflineBanner';
import { ToastHost } from '@/components/ui/Toast';
import { initSentry } from '@/lib/sentry';

const THEME_KEY = '@kochko_theme_mode';

// Install at module load, before any render happens, so rejections fired
// during component mount are also captured.
installGlobalErrorHandlers();

// Initialize Sentry once at module load. No-op if DSN is unset.
void initSentry();

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);
  const session = useAuthStore((s) => s.session);
  const authInitialized = useAuthStore((s) => s.initialized);
  const segments = useSegments();
  const systemScheme = useColorScheme();
  // Varsayilan ACIK (2026-08-07). Eski gerekce ("auth ekranlari sabit koyu") artik
  // gecersiz: 07-31'de 47 dosya useTheme()'e tasindi, statik COLORS import eden dosya
  // sayisi 0 — yani her ekran temayi dogru izliyor.
  // Karar kullanicinin sozune dayaniyor: "asiri ic karartici buluyorum, uygulama
  // gercekten boguyor". #0D0D12 neredeyse siyah bir zemin bir KOCLUK urunu icin agir.
  // Koyu tema kayboldu degil — Ayarlar > Tema'da duruyor ve secim kalici (a8bb18f).
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');

  useEffect(() => { initialize(); }, [initialize]);

  // FIX (ux-ideas #14): route a tapped notification to the relevant screen. Handles both
  // a tap while running and a cold start launched by the notification (useLastNotificationResponse
  // returns the launching response). Deduped by identifier so a re-render never re-routes;
  // gated on an active session so an unauthenticated user isn't pushed past the login guard.
  // expo-notifications has no `getLastNotificationResponse` on web, and the hook calls it during
  // render — so on web this THREW inside RootLayout and the whole app tree failed to mount (blank
  // screen, only an error-boundary warning in the console). Platform.OS is fixed for the lifetime
  // of the process, so this branch is stable across renders and does not violate the rules of
  // hooks. Guarding here (rather than not rendering the layout) keeps `expo start --web` usable
  // for UI work; on device the behaviour is unchanged.
  const lastNotifResponse = Platform.OS === 'web' ? null : Notifications.useLastNotificationResponse();
  const handledNotifKey = useRef<string | null>(null);
  useEffect(() => {
    if (!authInitialized || !lastNotifResponse) return;
    const req = lastNotifResponse.notification.request;
    // FIX (ux-review): dedup per DELIVERY, not per scheduled identifier — repeating local
    // reminders (weekly/daily triggers) reuse the same identifier across deliveries, so an
    // identifier-only guard would swallow every tap after the first while the process lives.
    // The delivery date differs per firing; a pure re-render keeps the same date+id.
    const key = `${req.identifier}:${lastNotifResponse.notification.date ?? ''}`;
    if (handledNotifKey.current === key) return;
    handledNotifKey.current = key;
    const data = req.content.data as { type?: string } | undefined;
    const route = routeForNotificationType(data?.type);
    if (route && useAuthStore.getState().session) {
      router.push(route as never);
    }
  }, [lastNotifResponse, authInitialized]);

  // FIX (ux-pass2, W#46): drain the offline chat queue on app START. The reconnect
  // listener only fires on a live offline→online transition — a message queued
  // offline, app closed, reopened online later would silently never send.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const { getOfflineQueueSize, processOfflineQueue } = await import('@/services/chat.service');
        if (cancelled) return;
        if ((await getOfflineQueueSize()) > 0) await processOfflineQueue();
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [session]);

  // Global protected-route guard: if the session is lost WHILE the user is inside
  // the app (cross-device logout, admin revoke, failed silent refresh — all call
  // signOut() without navigating), return them to login. app/index.tsx only guards
  // the cold-start path; this covers in-app session loss so the user isn't stranded
  // on an authed screen whose every query 401s (#R5-1).
  useEffect(() => {
    if (!authInitialized) return;
    // Public routes that an unauthenticated user must be able to reach: the auth
    // group AND the top-level password-recovery screen (kochko://reset-password,
    // which runs with a null session until the recovery token lands). Excluding it
    // prevents the guard from bouncing the user off the reset screen (#R7-1).
    const isPublic = segments[0] === '(auth)' || segments[0] === 'reset-password';
    if (!session && !isPublic) {
      router.replace('/(auth)/login');
    }
  }, [session, authInitialized, segments]);

  useEffect(() => {
    safeGetString(THEME_KEY).then(saved => {
      // Bu satir `if (saved === 'dark')` idi ve bu bir KILITTI: light/system, Ayarlar ve
      // Raporlar ekranlari statik koyu COLORS'tan tasinana kadar bilerek yok sayiliyordu
      // (#R3-6). Ama yazan taraf (handleSetMode) her modu kaydediyordu — yani kullanici
      // "Her Zaman Acik"i seciyor, tema aninda aciliyor, uygulama her yeniden baslayisinda
      // SESSIZCE koyuya donuyordu. Secim kayboluyor ve hicbir yer sebebini soylemiyor.
      //
      // Kilidin sarti 2026-07-31'de saglandi (47 dosya useTheme()'e tasindi). 08-06'da
      // olculdu: statik `COLORS` import eden dosya sayisi 0. Kilit artik yalnizca
      // kullanicinin secimini yiyordu.
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
      {/* Durum çubuğu ikon rengi.
          Burada `expo-status-bar`'ın <StatusBar> bileşeni vardı ve targetSdk 36'da (Android 15)
          HİÇBİR ETKİSİ YOKTU: edge-to-edge artık zorunlu ve RN'in StatusBarModule'ü stil
          değişimini sessizce yok sayıyor ("Ignored status bar change, current activity is
          edge-to-edge" — logcat'te görülebilir). Koyu tema tek seçenekken bu fark edilmiyordu;
          açık tema açılınca kusur görünür oldu: aydınlık zeminde saat/pil ikonları BEYAZ
          kalıyor ve okunmuyordu. Edge-to-edge'de doğru API WindowInsetsControllerCompat'tır,
          onu da `react-native-edge-to-edge`'in <SystemBars> bileşeni sarar. */}
      <SystemBars style={isDark ? 'light' : 'dark'} />
      <OfflineBanner />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="log" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="chat" options={{ headerShown: false }} />
        {/* app/plan/* — header is managed per-page via inline <Stack.Screen> in
            diet.tsx/workout.tsx/history.tsx (each sets its own title). No
            grouped layout file, so no parent declaration needed here. */}
        {/* (removed) 'recipe' / 'weekly-menu' had no app/recipe.* or app/weekly-menu.*
            route file — the real screens live at app/settings/{recipes,weekly-menu}.tsx
            and nothing navigates to the bare names. Orphan registrations deleted. */}
        <Stack.Screen name="reports" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
      </Stack>
      {/* FIX (ux-ideas #15): one shared, theme-aware toast host for the whole app — any screen
          or service can call showToast(...) for a consistent bottom-anchored confirmation. */}
      <ToastHost />
    </ThemeContext.Provider>
    </ErrorBoundary>
  );
}

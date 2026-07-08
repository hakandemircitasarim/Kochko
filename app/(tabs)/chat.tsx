/**
 * Kochko Chat Tab — #S1 (one-thread structural rebuild)
 *
 * The tab IS the conversation. This screen is a thin resolver: it gets-or-creates the user's
 * single canonical coach thread and lands them straight in it — no session list, no "Yeni sohbet"
 * button, no 24h auto-close. The old separate-sessions surface is exactly what made the coach
 * feel amnesiac and "kopuk" (each session an island, the active thread beheaded by every task
 * card / plan flow / daily auto-close), so the list UX is retired; past sessions remain browsable
 * as frozen history in settings/chat-history, and the KVKK export is untouched.
 *
 * Prefill contract preserved: dashboard nudges / quick-log deep links (`/(tabs)/chat?prefill=...`,
 * `openCamera`) forward into the thread, exactly as before.
 */
import { useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { getOrCreateActiveSession } from '@/services/chat.service';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';

export default function ChatTabResolver() {
  const { colors } = useTheme();
  const user = useAuthStore(s => s.user);
  const { prefill, openCamera, taskModeHint } = useLocalSearchParams<{ prefill?: string; openCamera?: string; taskModeHint?: string }>();
  const [failed, setFailed] = useState(false);
  // REF guards, never state in the callback deps: `resolving` as a dep minted a new callback
  // identity on every setState → useFocusEffect re-ran → on the FAILURE path this was a
  // deterministic infinite retry loop hammering the network while offline.
  const inFlightRef = useRef(false);
  const failedRef = useRef(false);

  const resolve = useCallback(async () => {
    if (!user?.id || inFlightRef.current) return;
    inFlightRef.current = true;
    failedRef.current = false;
    setFailed(false);
    try {
      const id = await getOrCreateActiveSession();
      if (id) {
        const params: Record<string, string> = { fromTab: '1' };
        if (prefill) params.prefill = String(prefill);
        if (openCamera) params.openCamera = String(openCamera);
        if (taskModeHint) params.taskModeHint = String(taskModeHint);
        router.replace({ pathname: `/chat/${id}`, params });
      } else {
        failedRef.current = true;
        setFailed(true);
      }
    } catch {
      failedRef.current = true;
      setFailed(true);
    } finally {
      inFlightRef.current = false;
    }
  }, [user?.id, prefill, openCamera, taskModeHint]);

  // Resolve on focus. NO auto-retry after a failure — only the explicit "Tekrar dene" button
  // re-attempts, so an offline user gets a stable error screen instead of a flicker loop.
  useFocusEffect(useCallback(() => { if (!failedRef.current) resolve(); }, [resolve]));

  if (failed) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl }}>
        <Ionicons name="cloud-offline-outline" size={44} color={colors.textMuted} />
        <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700', marginTop: SPACING.md, textAlign: 'center' }}>
          Koçuna bağlanılamadı
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xs, textAlign: 'center', lineHeight: 20 }}>
          İnternet bağlantını kontrol edip tekrar dene.
        </Text>
        <TouchableOpacity
          onPress={resolve}
          accessibilityRole="button"
          accessibilityLabel="Tekrar dene"
          style={{ marginTop: SPACING.lg, backgroundColor: colors.primary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm + 2 }}
        >
          <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '700' }}>Tekrar dene</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Resolving — skeleton, never a flash of empty UI.
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SkeletonScreen cards={3} />
    </View>
  );
}

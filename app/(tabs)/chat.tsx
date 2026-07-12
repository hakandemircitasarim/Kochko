/**
 * Kochko Chat Tab — #S1 (one-thread) + ux-pass2 (embedded thread)
 *
 * The tab IS the conversation — literally now. The previous shape (thin resolver that
 * router.replace()'d out to a root-level /chat/[id] stack) destroyed the tab navigator on
 * every entry: the tab bar vanished while chatting, hardware back dumped on Ana Sayfa,
 * and every coach<->app hop re-ran a network resolve + full thread reload. The thread now
 * renders INSIDE the tab; the canonical session id is cached (S1's one-active-per-user
 * index makes it stable), so re-entries are instant and the resolver network round-trip
 * happens once per install, not once per focus.
 *
 * Param contract preserved: dashboard nudges / quick-log deep links / task cards land on
 * `/(tabs)/chat?prefill=...&taskModeHint=...&taskNonce=...` and ChatThreadScreen reads
 * them from this route.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { getOrCreateActiveSession, getCachedActiveSessionId } from '@/services/chat.service';
import ChatThreadScreen from '@/screens/ChatThreadScreen';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';

// Module-level cache: survives tab remounts within the app session.
// User-keyed (review fix): an unkeyed id survived an account switch and mounted
// the previous user's thread for the next sign-in.
let resolvedSessionId: string | null = null;
let resolvedForUserId: string | null = null;

export default function ChatTab() {
  const { colors } = useTheme();
  const user = useAuthStore(s => s.user);
  const [sessionId, setSessionId] = useState<string | null>(
    user?.id && resolvedForUserId === user.id ? resolvedSessionId : null,
  );
  const [failed, setFailed] = useState(false);
  const inFlightRef = useRef(false);

  // Account switch while the tab stays mounted: drop the stale id immediately.
  useEffect(() => {
    if (user?.id && resolvedForUserId !== user.id) {
      resolvedSessionId = null;
      resolvedForUserId = null;
      setSessionId(null);
    }
  }, [user?.id]);

  const resolve = useCallback(async () => {
    if (!user?.id || inFlightRef.current) return;
    inFlightRef.current = true;
    setFailed(false);
    try {
      // Cold start: the persisted id renders the thread immediately; the network
      // resolve below still runs once to self-heal a stale cache.
      if (!resolvedSessionId || resolvedForUserId !== user.id) {
        const cached = await getCachedActiveSessionId(); // user-scoped key
        if (cached) {
          resolvedSessionId = cached;
          resolvedForUserId = user.id;
          setSessionId(cached);
        }
      }
      const id = await getOrCreateActiveSession();
      if (id) {
        resolvedSessionId = id;
        resolvedForUserId = user.id;
        setSessionId(prev => (prev === id ? prev : id));
      } else if (!resolvedSessionId) {
        setFailed(true);
      }
    } catch {
      if (!resolvedSessionId) setFailed(true);
    } finally {
      inFlightRef.current = false;
    }
  }, [user?.id]);

  useEffect(() => { resolve(); }, [resolve]);

  if (sessionId) {
    return <ChatThreadScreen sessionId={sessionId} />;
  }

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

  // First-ever resolve (no cache yet) — skeleton, never a flash of empty UI.
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SkeletonScreen cards={3} />
    </View>
  );
}

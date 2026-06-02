/**
 * Offline Banner — persistent thin strip shown at top of app when network is
 * unreachable. Informs user that writes are queued locally and will sync when
 * they reconnect. Auto-hides when connection is restored.
 *
 * Spec 11 — Offline çalışma.
 */
import { useEffect, useState } from 'react';
import { View, Text, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { syncQueue } from '@/services/offline-queue.service';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT } from '@/lib/constants';

export function OfflineBanner() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [isOnline, setIsOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const translateY = useState(new Animated.Value(-60))[0];

  useEffect(() => {
    // Initial state
    NetInfo.fetch().then(state => setIsOnline(state.isConnected === true));

    // Listener — fires on connectivity changes
    const unsub = NetInfo.addEventListener(state => {
      const online = state.isConnected === true;
      setIsOnline(prev => {
        // If we just came back online, trigger a sync
        if (!prev && online) {
          setSyncing(true);
          syncQueue()
            .catch(() => { /* per-item errors already logged */ })
            .finally(() => setSyncing(false));
        }
        return online;
      });
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: isOnline && !syncing ? -60 : 0,
      useNativeDriver: true,
      tension: 120,
      friction: 14,
    }).start();
  }, [isOnline, syncing, translateY]);

  // Don't render at all when fully online and not syncing
  if (isOnline && !syncing) return null;

  const bg = syncing ? colors.primary + 'E6' : '#D85A30E6';
  const label = syncing ? 'Bekleyen kayıtlar senkronize ediliyor...' : 'Çevrimdışısın — kayıtların yerel saklanıyor, bağlanınca eklenecek.';
  const icon = syncing ? 'sync' : 'cloud-offline-outline';

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        backgroundColor: bg,
        paddingTop: insets.top + SPACING.xs,
        paddingBottom: SPACING.sm,
        paddingHorizontal: SPACING.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.sm,
        zIndex: 1000,
        transform: [{ translateY }],
      }}
    >
      <Ionicons name={icon} size={14} color="#fff" />
      <Text style={{ color: '#fff', fontSize: FONT.xs, flex: 1 }} numberOfLines={2}>
        {label}
      </Text>
    </Animated.View>
  );
}

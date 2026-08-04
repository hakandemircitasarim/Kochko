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
import { syncQueue, getQueueCount } from '@/services/offline-queue.service';
// FIX (audit UX-OFF-07) chat offline kuyruğu da reconnect'te gerçekten işlenmeli;
// ve "senkronize ediliyor" göstergesi yalnız bekleyen kayıt varken çıkmalı.
import { processOfflineQueue, getOfflineQueueSize } from '@/services/chat.service';
import { useTheme } from '@/lib/theme';
import { SPACING } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { getContrastColor } from '@/lib/accessibility';

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
        // If we just came back online, drain whatever is genuinely queued.
        if (!prev && online) {
          // FIX (audit UX-OFF-07) Önce gerçekten bekleyen kayıt var mı diye bak —
          // hem yapısal kuyruk (su/öğün logları → enqueue) hem chat kuyruğu. Yoksa
          // "senkronize ediliyor" göstergesini hiç açma (boş kuyruğu maskeleme).
          // Varsa İKİ kuyruğu da işle (eskiden yalnız her zaman-boş yapısal kuyruk
          // çalışıyordu; chat kuyruğu ve dashboard logları hiç işlenmiyordu).
          Promise.all([getQueueCount(), getOfflineQueueSize()])
            .then(([structured, chat]) => {
              if (structured + chat === 0) return;
              setSyncing(true);
              return Promise.all([
                syncQueue().catch(() => { /* per-item errors already logged */ }),
                processOfflineQueue().catch(() => { /* logged in chat.service */ }),
              ]).finally(() => setSyncing(false));
            })
            .catch(() => { /* count read failed — skip the sync banner */ });
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

  const bgBase = syncing ? colors.primary : '#D85A30';
  const bg = bgBase + 'E6';
  // FIX (audit: kontrast) — beyaz metin bu marka aksanları üstünde AA'yı geçmiyor
  // (primary 3.39, #D85A30 ~3.87). getContrastColor ikisi için de 'black' döndürür;
  // koyu metin/ikon kullanarak okunabilirliği AA'ya çıkar.
  const fg = getContrastColor(bgBase) === 'black' ? '#0D0D12' : '#fff';
  // FIX (audit UX-OFF-07) "senkronize ediliyor" yalnız gerçekten bekleyen kayıt
  // varken görünür (üstteki getQueueCount + getOfflineQueueSize sıfır değilse).
  // Çevrimdışı kopya dürüst kalır: su kayıtları (enqueue) ve chat mesajları reconnect'te
  // kaldığı yerden devam eder; silme işlemleri bağlantı gerektirir (kuyruğa alınmaz).
  const label = syncing ? 'Bekleyen kayıtlar senkronize ediliyor...' : 'Çevrimdışısın — internet gelince kaldığın yerden devam edebilirsin.';
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
      <Ionicons name={icon} size={14} color={fg} />
      <Text style={{ ...TYPE.caption, color: fg, flex: 1 }} numberOfLines={2}>
        {label}
      </Text>
    </Animated.View>
  );
}

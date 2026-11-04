/**
 * Offline Banner — persistent thin strip shown at top of app when network is
 * unreachable. Informs user that writes are queued locally and will sync when
 * they reconnect. Auto-hides when connection is restored.
 *
 * Spec 11 — Offline çalışma.
 *
 * Sunum (2026-11-04, Duolingo dili): ince turuncu şerit yerine Toast'la aynı GÖVDELİ kart —
 * 2px gri çerçeve + vurgu renginde alt raf, solda tonlu dairede Koçko. Çevrimdışıyken
 * `cheerup` (teselli eden koç, kehribar raf), senkron sırasında `thinking` (çalışan koç,
 * marka rafı). Kart güvenli alanın altında yüzer; dokunmayı geçirir (pointerEvents none).
 * Giriş yayı reduce-motion'da atlanır.
 */
import { useEffect, useState } from 'react';
import { View, Text, Animated } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KochkoMascot } from '@/components/mascot/KochkoMascot';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { syncQueue, getQueueCount } from '@/services/offline-queue.service';
// FIX (audit UX-OFF-07) chat offline kuyruğu da reconnect'te gerçekten işlenmeli;
// ve "senkronize ediliyor" göstergesi yalnız bekleyen kayıt varken çıkmalı.
import { processOfflineQueue, getOfflineQueueSize } from '@/services/chat.service';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE, MOTION, alpha } from '@/lib/design';

/** Kartın gizliyken durduğu yer: güvenli alan + kart boyu kadar yukarıda. */
const HIDDEN_Y = -160;

export function OfflineBanner() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [isOnline, setIsOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const translateY = useState(new Animated.Value(HIDDEN_Y))[0];

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
    const to = isOnline && !syncing ? HIDDEN_Y : 0;
    if (reduceMotion) { translateY.setValue(to); return; }
    const a = Animated.spring(translateY, {
      toValue: to,
      useNativeDriver: true,
      tension: 120,
      friction: 14,
    });
    a.start();
    return () => a.stop();
  }, [isOnline, syncing, translateY, reduceMotion]);

  // Don't render at all when fully online and not syncing
  if (isOnline && !syncing) return null;

  // Vurgu yalnız RAFTA ve rozet tonunda (Toast kalıbı): kehribar çevrimdışı, menekşe senkron.
  // Metin kart yüzünde colors.text — eski turuncu dolguda AA için koyu metne mecburduk; kart
  // yüzü bu sorunu kökten kaldırır.
  const accent = syncing ? colors.primary : METRIC_COLORS.steps;
  // FIX (audit UX-OFF-07) "senkronize ediliyor" yalnız gerçekten bekleyen kayıt
  // varken görünür (üstteki getQueueCount + getOfflineQueueSize sıfır değilse).
  // Çevrimdışı kopya dürüst kalır: su kayıtları (enqueue) ve chat mesajları reconnect'te
  // kaldığı yerden devam eder; silme işlemleri bağlantı gerektirir (kuyruğa alınmaz).
  const title = syncing ? 'Kayıtların gönderiliyor' : 'Çevrimdışısın';
  const label = syncing
    ? 'Bekleyen kayıtlar senkronize ediliyor...'
    : 'İnternet gelince kaldığın yerden devam edebilirsin.';

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${title}. ${label}`}
      style={{
        position: 'absolute',
        top: insets.top + SPACING.xs, left: SPACING.md, right: SPACING.md,
        zIndex: 1000,
        transform: [{ translateY }],
      }}
    >
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
          backgroundColor: colors.cardElevated, borderRadius: RADIUS.lg,
          borderWidth: 2, borderColor: isDark ? colors.border : colors.progressTrack,
          borderBottomWidth: MOTION.shelf, borderBottomColor: accent,
          paddingVertical: SPACING.sm, paddingLeft: SPACING.sm, paddingRight: SPACING.md,
        }}
      >
        <View
          style={{
            width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
            backgroundColor: alpha(accent, isDark ? 0.22 : 0.16),
          }}
        >
          <KochkoMascot size={30} mood={syncing ? 'thinking' : 'cheerup'} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...TYPE.bodyStrong, color: colors.text }} numberOfLines={1}>{title}</Text>
          <Text style={{ ...TYPE.caption, color: colors.textSecondary }} numberOfLines={2}>{label}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

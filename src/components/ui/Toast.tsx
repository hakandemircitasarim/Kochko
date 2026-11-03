/**
 * Toast / Snackbar — shared, imperative, theme-aware confirmation primitive (ux-ideas #15).
 *
 * Every screen previously hand-rolled its own transient banner (dashboard refresh-failed,
 * water-undo, edit-profile "kaydedildi"…), each with a different position / color / duration.
 * This gives the whole app ONE consistent, bottom-anchored toast with success/error/info
 * variants, an optional action (e.g. "Geri al"), spring-in + auto-dismiss, and a light haptic.
 *
 * Usage (no provider/prop-drilling needed — call from anywhere, including services):
 *   import { showToast } from '@/components/ui/Toast';
 *   showToast('Kaydedildi', { variant: 'success' });
 *   showToast('Su eklendi', { actionLabel: 'Geri al', onAction: undoWater });
 *
 * Mounted once via <ToastHost/> in app/_layout.tsx (inside the theme provider).
 */
import { useEffect, useRef } from 'react';
import { Animated, View, Text, TouchableOpacity } from 'react-native';
import { create } from 'zustand';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE, MOTION, alpha } from '@/lib/design';
import { haptics } from '@/lib/haptics';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { KochkoMascot } from '@/components/mascot/KochkoMascot';

export type ToastVariant = 'success' | 'error' | 'info';

interface ToastData {
  id: number;
  message: string;
  variant: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
  duration: number;
}

interface ToastState {
  current: ToastData | null;
  show: (t: ToastData) => void;
  hide: () => void;
}

const useToastStore = create<ToastState>((set) => ({
  current: null,
  show: (t) => set({ current: t }),
  hide: () => set({ current: null }),
}));

let nextId = 1;

/**
 * Imperatively show a toast from anywhere (components OR services). The newest call
 * replaces any visible toast (single-slot, like a snackbar).
 */
export function showToast(
  message: string,
  opts?: { variant?: ToastVariant; actionLabel?: string; onAction?: () => void; duration?: number },
): void {
  useToastStore.getState().show({
    id: nextId++,
    message,
    variant: opts?.variant ?? 'success',
    actionLabel: opts?.actionLabel,
    onAction: opts?.onAction,
    // An actionable toast lingers longer so the user can reach "Geri al".
    duration: opts?.duration ?? (opts?.actionLabel ? 4500 : 2400),
  });
}

/** Mounted once at the app root (inside the theme provider). Renders the current toast. */
export function ToastHost() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const current = useToastStore((s) => s.current);
  const hide = useToastStore((s) => s.hide);
  const translateY = useRef(new Animated.Value(60)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const badge = useRef(new Animated.Value(1)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => hide());
  };

  useEffect(() => {
    if (!current) return;
    haptics.tap();
    if (reduceMotion) {
      // Kayma/yaylanma yok: yerinde belirir.
      translateY.setValue(0);
      badge.setValue(1);
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    } else {
      translateY.setValue(60);
      opacity.setValue(0);
      badge.setValue(0.4);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, friction: 8, tension: 80, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        // Rozet (maskot/ikon) kart oturduktan hemen sonra "pıt" diye girer.
        Animated.sequence([
          Animated.delay(90),
          Animated.spring(badge, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }),
        ]),
      ]).start();
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => dismiss(), current.duration);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!current) return null;

  const accent = current.variant === 'error' ? colors.error : current.variant === 'info' ? colors.primary : colors.success;
  const icon = current.variant === 'error' ? 'alert-circle' : current.variant === 'info' ? 'information-circle' : 'checkmark-circle';

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 90,
        alignItems: 'center', paddingHorizontal: SPACING.md, zIndex: 100,
        opacity, transform: [{ translateY }],
      }}
    >
      {/* Gövdeli kart (Duolingo dili, §0-A): sol renk şeridi yerine 2px çerçeve + vurgunun
          renginde alt raf. Başarıda rozet KOÇKO'nun kendisi — "kaydettim" diyen karakter; hata
          ve bilgide tonlu daire içinde ikon (maskot hatayı sevimlileştirmesin). */}
      <View
        // Screen-reader: announce the toast as a live status message.
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        accessibilityLabel={current.actionLabel ? `${current.message}. ${current.actionLabel}` : current.message}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, maxWidth: '100%',
          backgroundColor: colors.cardElevated, borderRadius: RADIUS.lg,
          borderWidth: 2, borderColor: isDark ? colors.border : colors.progressTrack,
          borderBottomWidth: MOTION.shelf, borderBottomColor: accent,
          paddingVertical: SPACING.sm, paddingLeft: SPACING.sm, paddingRight: SPACING.lg,
        }}
      >
        <Animated.View
          style={{
            width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
            backgroundColor: alpha(accent, isDark ? 0.2 : 0.14),
            transform: [{ scale: badge }],
          }}
        >
          {current.variant === 'success'
            ? <KochkoMascot size={28} />
            : <Ionicons name={icon} size={18} color={accent} />}
        </Animated.View>
        <Text style={{ ...TYPE.bodyStrong, color: colors.text, flexShrink: 1 }} numberOfLines={2}>{current.message}</Text>
        {current.actionLabel ? (
          <TouchableOpacity activeOpacity={MOTION.pressOpacity}
            onPress={() => { const a = current.onAction; dismiss(); a?.(); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={current.actionLabel}
          >
            <Text style={{ ...TYPE.bodyStrong, color: accent, fontWeight: '700' }}>{current.actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Animated.View>
  );
}

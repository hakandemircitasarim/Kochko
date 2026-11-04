/**
 * Animated 3-dot typing indicator for the chat screen.
 *
 * The stock "Kochko yazıyor... + spinner" reads as "loading", not "typing".
 * This three-dot bounce matches messaging app conventions and feels alive.
 * Each dot offsets the animation by 160ms so the pulse travels left-to-right.
 *
 * 2026-11-04: mesaj balonlarıyla aynı konuşmacı dili (CoachSpeech) — Koçko avatarı balonun
 * DIŞINDA solda, balon 2px gri çerçeveli + avatara bakan kuyruklu. Önceden maskot balonun
 * içindeydi; hemen üstündeki koç mesajlarının avatarıyla hizası tutmuyordu.
 */
import { useEffect, useRef } from 'react';
import { View, Animated, Easing, Text } from 'react-native';
import { useTheme } from '@/lib/theme';
import { SPACING } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { CoachAvatar, SpeechTail, bodyEdge, BUBBLE_RADIUS, BUBBLE_TAIL_RADIUS, BUBBLE_BORDER } from '@/components/chat/CoachSpeech';

const DOT_SIZE = 6;
const DOT_GAP = 4;
const CYCLE_MS = 900;

export function Dot({ delay, color, cycleMs = CYCLE_MS }: { delay: number; color: string; cycleMs?: number }) {
  const t = useRef(new Animated.Value(0)).current;
  // Reduce-motion: zıplayan döngü yok; noktalar sabit ve tam görünür (anlamı etiket taşıyor).
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) { t.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(t, {
          toValue: 1,
          duration: cycleMs / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(t, {
          toValue: 0,
          duration: cycleMs / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, delay, cycleMs, reduceMotion]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: reduceMotion ? [0, 0] : [0, -4] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  return (
    <Animated.View
      style={{
        width: DOT_SIZE,
        height: DOT_SIZE,
        borderRadius: DOT_SIZE / 2,
        backgroundColor: color,
        transform: [{ translateY }],
        opacity,
      }}
    />
  );
}

interface Props {
  label?: string;
}

export function TypingIndicator({ label = 'Kochko yazıyor' }: Props) {
  const { colors, isDark } = useTheme();
  const edge = bodyEdge(colors, isDark);
  return (
    // FIX (ux-polish): announce once on appear (polite live region) with a STABLE label so the
    // rotating stage text doesn't re-announce on every flip.
    <View
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel="Kochko yanıt hazırlıyor"
      style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, alignSelf: 'flex-start' }}
    >
      {/* Yazan kişi görünür olsun: mini Koçko avatarı (statik — bu boyda idle animasyon
          titrer; canlılığı zaten zıplayan noktalar taşıyor). */}
      <CoachAvatar />
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: BUBBLE_RADIUS,
          borderBottomLeftRadius: BUBBLE_TAIL_RADIUS,
          borderWidth: BUBBLE_BORDER,
          borderColor: edge,
          paddingHorizontal: SPACING.md,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SPACING.sm,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: DOT_GAP }}>
          <Dot delay={0} color={colors.primary} />
          <Dot delay={160} color={colors.primary} />
          <Dot delay={320} color={colors.primary} />
        </View>
        <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
          {label}
        </Text>
        <SpeechTail side="left" face={colors.card} edge={edge} />
      </View>
    </View>
  );
}

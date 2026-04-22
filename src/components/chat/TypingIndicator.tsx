/**
 * Animated 3-dot typing indicator for the chat screen.
 *
 * The stock "Kochko yazıyor... + spinner" reads as "loading", not "typing".
 * This three-dot bounce matches messaging app conventions and feels alive.
 * Each dot offsets the animation by 160ms so the pulse travels left-to-right.
 */
import { useEffect, useRef } from 'react';
import { View, Animated, Easing, Text } from 'react-native';
import { useTheme } from '@/lib/theme';
import { SPACING } from '@/lib/constants';

const DOT_SIZE = 6;
const DOT_GAP = 4;
const CYCLE_MS = 900;

function Dot({ delay, color }: { delay: number; color: string }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(t, {
          toValue: 1,
          duration: CYCLE_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(t, {
          toValue: 0,
          duration: CYCLE_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, delay]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
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
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${label}, bir mesaj hazırlıyor`}
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        borderBottomLeftRadius: 4,
        paddingHorizontal: SPACING.md,
        paddingVertical: 10,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.sm,
        borderWidth: 0.5,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: DOT_GAP }}>
        <Dot delay={0} color={colors.primary} />
        <Dot delay={160} color={colors.primary} />
        <Dot delay={320} color={colors.primary} />
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>
        {label}
      </Text>
    </View>
  );
}

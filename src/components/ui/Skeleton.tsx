/**
 * Skeleton — flat shimmer placeholder for loading states (replaces bare spinners).
 * Pulses opacity on a native-driven loop. Honors the flat dark design (no gradient).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, type ViewStyle, type DimensionValue } from 'react-native';
import { useTheme } from '@/lib/theme';
import { RADIUS } from '@/lib/constants';

interface BlockProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

/** A single shimmering block. */
export function SkeletonBlock({ width = '100%', height = 16, radius = RADIUS.sm, style }: BlockProps) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceLight, opacity: pulse }, style]}
    />
  );
}

/** A ready-made card-shaped skeleton: title bar + a few lines. */
export function SkeletonCard({ lines = 3, style }: { lines?: number; style?: ViewStyle }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityLabel="Yükleniyor"
      style={[{ backgroundColor: colors.card, borderRadius: RADIUS.lg, padding: 16, borderWidth: 0.5, borderColor: colors.border, gap: 10 }, style]}
    >
      <SkeletonBlock width="55%" height={18} />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock key={i} width={i === lines - 1 ? '70%' : '100%'} height={12} />
      ))}
    </View>
  );
}

/** A full-screen list of skeleton cards — drop-in for a screen's loading branch. */
export function SkeletonScreen({ cards = 3, topGap = 0 }: { cards?: number; topGap?: number }) {
  return (
    <View style={{ padding: 16, paddingTop: 16 + topGap, gap: 12 }}>
      {Array.from({ length: cards }).map((_, i) => (
        <SkeletonCard key={i} lines={i === 0 ? 4 : 3} />
      ))}
    </View>
  );
}

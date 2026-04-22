/**
 * Profile completion donut — home screen hero (MASTER_PLAN §5 Phase 4).
 *
 * Reads profile from the store, computes weighted completion via
 * profile-completion.ts, renders an animated SVG donut with % in the center
 * and a one-line hint about the next biggest gap.
 *
 * Tap routes to the Kochko tab's onboarding task list.
 */
import { useEffect, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, Animated, Easing } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import {
  calculateProfileCompletion,
  CATEGORY_LABELS,
  type ProfileCategory,
} from '@/lib/profile-completion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  profile: Record<string, unknown> | null;
  size?: number;   // outer diameter
  stroke?: number; // ring thickness
}

export function ProfileCompletionDonut({ profile, size = 120, stroke = 10 }: Props) {
  const { colors } = useTheme();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = useRef(new Animated.Value(0)).current;

  const result = useMemo(() => {
    if (!profile) return null;
    return calculateProfileCompletion(profile);
  }, [profile]);

  const pct = result?.percentage ?? 0;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: pct / 100,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [pct, progress]);

  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  // Color scale: < 40 red, 40-70 amber, > 70 green.
  const ringColor = pct < 40 ? '#EF4444' : pct < 70 ? '#F59E0B' : '#22C55E';

  const hintLine = useMemo(() => {
    if (!result) return 'Profil yukleniyor…';
    if (result.missingRequired.length > 0) {
      return `${result.missingRequired.length} temel bilgi eksik`;
    }
    if (result.lowestCategory) {
      return `${CATEGORY_LABELS[result.lowestCategory as ProfileCategory]} tamamla`;
    }
    return 'Profilin tamam — Kochko seni tam tanıyor';
  }, [result]);

  return (
    <TouchableOpacity
      onPress={() => router.push('/(tabs)/chat' as never)}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Profil tamamlama yüzdesi ${pct}. ${hintLine}`}
      accessibilityHint="Görevleri açmak için dokun"
      style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: colors.border,
        padding: SPACING.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.md,
      }}
    >
      {/* Donut */}
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
          {/* track */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={colors.progressTrack ?? colors.surfaceLight}
            strokeWidth={stroke}
          />
          {/* progress */}
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={stroke}
            strokeDasharray={`${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </Svg>
        <View style={{ position: 'absolute', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontSize: FONT.xxl, fontWeight: '800' }}>
            {pct}%
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 9, fontWeight: '600', letterSpacing: 1 }}>
            PROFIL
          </Text>
        </View>
      </View>

      {/* Right side: hint + CTA */}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700' }}>
          {pct === 100 ? 'Profilin hazır' : 'Profilini tamamla'}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 2 }}>
          {hintLine}
        </Text>
        {pct < 100 ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              marginTop: SPACING.sm,
              alignSelf: 'flex-start',
              backgroundColor: ringColor + '18',
              borderRadius: RADIUS.full,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Ionicons name="arrow-forward-circle" size={11} color={ringColor} />
            <Text style={{ color: ringColor, fontSize: 10, fontWeight: '700' }}>
              Görevlere git
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

/**
 * Horizontal scrollable stat cards with gradient backgrounds.
 * Floats over the hero section bottom edge for layered look.
 */
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, GRADIENTS } from '@/lib/theme';
import { SPACING, FONT, RADIUS, HERO, ELEVATED_SHADOW } from '@/lib/constants';

interface Props {
  waterLiters: number;
  waterTarget: number;
  steps: number | null;
  sleepHours: number | null;
  weightKg: number | null;
  onAddWater: () => void;
}

interface StatCardProps {
  icon: string;
  value: string;
  label: string;
  gradient: [string, string];
  onPress?: () => void;
  isDark: boolean;
}

function StatCard({ icon, value, label, gradient, onPress, isDark }: StatCardProps) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      {...(onPress ? { onPress, activeOpacity: 0.8 } : {})}
      style={{
        width: HERO.STAT_CARD_WIDTH,
        height: HERO.STAT_CARD_HEIGHT,
        borderRadius: RADIUS.xl,
        overflow: 'hidden',
        ...ELEVATED_SHADOW,
      }}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: SPACING.sm,
        }}
      >
        <Ionicons name={icon as any} size={20} color="#FFFFFF" style={{ marginBottom: 4 }} />
        <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: '#FFFFFF' }}>{value}</Text>
        <Text style={{ fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.8)' }}>{label}</Text>
      </LinearGradient>
    </Wrapper>
  );
}

export function StatStrip({ waterLiters, waterTarget, steps, sleepHours, weightKg, onAddWater }: Props) {
  const { isDark } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingLeft: SPACING.md, paddingRight: SPACING.xl, gap: SPACING.sm }}
      snapToInterval={HERO.STAT_CARD_WIDTH + SPACING.sm}
      decelerationRate="fast"
    >
      <StatCard
        icon="water"
        value={`${waterLiters.toFixed(1)}L`}
        label={`Bas: +0.25L`}
        gradient={GRADIENTS.water}
        onPress={onAddWater}
        isDark={isDark}
      />
      <StatCard
        icon="footsteps"
        value={steps ? `${Math.round(steps / 1000)}k` : '-'}
        label="adım"
        gradient={GRADIENTS.steps}
        isDark={isDark}
      />
      <StatCard
        icon="moon"
        value={sleepHours ? `${sleepHours}` : '-'}
        label="saat uyku"
        gradient={GRADIENTS.sleep}
        isDark={isDark}
      />
      <StatCard
        icon="scale"
        value={weightKg ? `${weightKg}` : '-'}
        label="kg"
        gradient={GRADIENTS.weight}
        isDark={isDark}
      />
    </ScrollView>
  );
}

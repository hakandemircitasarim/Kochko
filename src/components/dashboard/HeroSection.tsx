/**
 * Dashboard Hero Section
 * Full-width gradient background with calorie ring, header, macro pills.
 * This is the visual anchor of the dashboard.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, HERO_GRADIENTS, GRADIENTS } from '@/lib/theme';
import { CircularProgress } from '@/components/ui/CircularProgress';
import { StreakBadge } from '@/components/tracking/StreakBadge';
import { IFTimerWidget } from '@/components/tracking/IFTimerWidget';
import { SPACING, FONT, RADIUS, HERO } from '@/lib/constants';

interface Props {
  today: string;
  streak: number;
  isOffline: boolean;
  focusMessage: string | null;
  // Calories
  consumed: number;
  targetMin: number;
  targetMax: number;
  protein: number;
  proteinTarget: number;
  carbs: number;
  fat: number;
  // IF
  ifActive: boolean;
  ifEatingStart: string | null;
  ifEatingEnd: string | null;
}

function MacroPill({ label, value, dotColor }: { label: string; value: string; dotColor: string }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: 'rgba(255,255,255,0.15)',
      borderRadius: RADIUS.full,
      paddingVertical: 6, paddingHorizontal: 12,
    }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
      <Text style={{ color: '#FFFFFF', fontSize: FONT.xs, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>{label}</Text>
    </View>
  );
}

export function HeroSection({
  today, streak, isOffline, focusMessage,
  consumed, targetMin, targetMax, protein, proteinTarget, carbs, fat,
  ifActive, ifEatingStart, ifEatingEnd,
}: Props) {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const targetMid = Math.round((targetMin + targetMax) / 2);
  const remaining = targetMid - consumed;
  const pct = targetMax > 0 ? Math.min(1, consumed / targetMax) : 0;
  const over = consumed > targetMax;
  const inRange = consumed >= targetMin && consumed <= targetMax;
  const ringColor = over ? '#FF6B6B' : inRange ? '#4ADE80' : '#FFFFFF';

  return (
    <LinearGradient
      colors={isDark ? HERO_GRADIENTS.dark : HERO_GRADIENTS.light}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        paddingTop: insets.top + 8,
        paddingHorizontal: SPACING.lg,
        paddingBottom: SPACING.xl + 12,
        borderBottomLeftRadius: 32,
        borderBottomRightRadius: 32,
      }}
    >
      {/* Header Row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
        <View>
          <Text style={{ fontSize: FONT.hero, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1 }}>
            Bugün
          </Text>
          <Text style={{ fontSize: FONT.sm, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>{today}</Text>
        </View>
        <StreakBadge days={streak} />
      </View>

      {/* Offline Banner */}
      {isOffline && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
          backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: RADIUS.md,
          padding: SPACING.sm, marginBottom: SPACING.sm,
        }}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={{ color: '#fff', fontSize: FONT.xs, fontWeight: '500' }}>Çevrimdışı - kayıtların senkronize edilecek</Text>
        </View>
      )}

      {/* Focus Message */}
      {focusMessage && (
        <View style={{
          flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm,
          backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: RADIUS.lg,
          padding: SPACING.sm + 2, marginBottom: SPACING.sm,
          borderLeftWidth: 3, borderLeftColor: 'rgba(255,255,255,0.4)',
        }}>
          <Ionicons name="bulb" size={16} color="rgba(255,255,255,0.9)" />
          <Text style={{ flex: 1, color: 'rgba(255,255,255,0.9)', fontSize: FONT.xs, lineHeight: 18 }}>{focusMessage}</Text>
        </View>
      )}

      {/* IF Timer (compact on hero) */}
      {ifActive && ifEatingStart && ifEatingEnd && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
          backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: RADIUS.full,
          paddingVertical: 6, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm,
          alignSelf: 'center',
        }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ADE80' }} />
          <Text style={{ color: '#FFFFFF', fontSize: FONT.xs, fontWeight: '600' }}>
            {ifEatingStart} - {ifEatingEnd}
          </Text>
        </View>
      )}

      {/* Calorie Ring */}
      <View style={{ alignItems: 'center', marginVertical: SPACING.md }}>
        <CircularProgress
          variant="hero"
          progress={pct}
          size={HERO.RING_SIZE}
          strokeWidth={HERO.RING_STROKE}
          color={ringColor}
          value={remaining >= 0 ? remaining : `+${Math.abs(remaining)}`}
          unit="kcal"
          label={remaining >= 0 ? 'kalan' : 'fazla'}
          sublabel={`${consumed} / ${targetMin}-${targetMax}`}
        />
      </View>

      {/* Macro Pills */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm }}>
        <MacroPill label="P" value={`${protein}g`} dotColor={GRADIENTS.protein[0]} />
        <MacroPill label="K" value={`${carbs}g`} dotColor={GRADIENTS.carbs[0]} />
        <MacroPill label="Y" value={`${fat}g`} dotColor={GRADIENTS.fat[0]} />
      </View>
    </LinearGradient>
  );
}

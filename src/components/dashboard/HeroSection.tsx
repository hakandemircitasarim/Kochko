/**
 * Dashboard Hero Section — flat dark design
 * Full-width card with calorie ring, header, macro bars.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { CircularProgress } from '@/components/ui/CircularProgress';
import { StreakBadge } from '@/components/tracking/StreakBadge';
import { SPACING, FONT, RADIUS, HERO } from '@/lib/constants';

interface Props {
  today: string;
  streak: number;
  isOffline: boolean;
  focusMessage: string | null;
  consumed: number;
  targetMin: number;
  targetMax: number;
  protein: number;
  proteinTarget: number;
  carbs: number;
  carbsTarget?: number;
  fat: number;
  fatTarget?: number;
  ifActive: boolean;
  ifEatingStart: string | null;
  ifEatingEnd: string | null;
  userName?: string;
}

function MacroBar({ label, value, target, color }: { label: string; value: number; target: number; color: string }) {
  const { colors } = useTheme();
  const pct = target > 0 ? Math.min(1, value / target) : 0;

  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: 4 }}>{label}</Text>
      <View style={{ height: 6, backgroundColor: colors.progressTrack, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 3 }}>{value}/{target}g</Text>
    </View>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'İyi geceler';
  if (hour < 12) return 'Günaydın';
  if (hour < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

export function HeroSection({
  today, streak, isOffline, focusMessage,
  consumed, targetMin, targetMax, protein, proteinTarget,
  carbs, carbsTarget = 200, fat, fatTarget = 65,
  ifActive, ifEatingStart, ifEatingEnd, userName,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const hasTargets = targetMax > 0;
  const targetMid = hasTargets ? Math.round((targetMin + targetMax) / 2) : 0;
  const pct = hasTargets ? Math.min(1, consumed / targetMax) : 0;

  return (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: SPACING.xl }}>
      {/* Header: Greeting + Streak */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
        <View>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>
            {getGreeting()}{userName ? `, ${userName}` : ''}
          </Text>
        </View>
        <StreakBadge days={streak} />
      </View>

      {/* Offline Banner */}
      {isOffline && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
          backgroundColor: colors.cardElevated, borderRadius: RADIUS.md,
          padding: SPACING.sm, marginBottom: SPACING.md,
          borderWidth: 0.5, borderColor: colors.border,
        }}>
          <Ionicons name="cloud-offline-outline" size={14} color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500' }}>Çevrimdışı — kayıtların senkronize edilecek</Text>
        </View>
      )}

      {/* Calorie Ring Card */}
      <View style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.md,
        borderWidth: 0.5,
        borderColor: colors.border,
        padding: SPACING.lg,
        alignItems: 'center',
        marginBottom: SPACING.md,
      }}>
        {hasTargets ? (
          <>
            <CircularProgress
              progress={pct}
              size={HERO.RING_SIZE}
              strokeWidth={HERO.RING_STROKE}
              color={METRIC_COLORS.calories}
              value={consumed}
              label={`/ ${targetMid} kcal`}
            />
            <View style={{ flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.xl, width: '100%' }}>
              <MacroBar label="Protein" value={protein} target={proteinTarget} color={METRIC_COLORS.protein} />
              <MacroBar label="Karbonhidrat" value={carbs} target={carbsTarget} color={METRIC_COLORS.carbs} />
              <MacroBar label="Yağ" value={fat} target={fatTarget} color={METRIC_COLORS.fat} />
            </View>
          </>
        ) : (
          <View style={{ alignItems: 'center', paddingVertical: SPACING.xxl }}>
            <Ionicons name="nutrition-outline" size={36} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: SPACING.md, textAlign: 'center' }}>
              Henüz hedef belirlenmedi
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4, textAlign: 'center' }}>
              Koçuna hedeflerini anlat
            </Text>
          </View>
        )}
      </View>

      {/* IF Timer */}
      {ifActive && ifEatingStart && ifEatingEnd && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
          backgroundColor: colors.card, borderRadius: RADIUS.pill,
          paddingVertical: 6, paddingHorizontal: SPACING.xl, marginBottom: SPACING.md,
          borderWidth: 0.5, borderColor: colors.border,
          alignSelf: 'center',
        }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
          <Text style={{ color: colors.text, fontSize: 11, fontWeight: '500' }}>
            {ifEatingStart} - {ifEatingEnd}
          </Text>
        </View>
      )}

      {/* Focus Message */}
      {focusMessage && (
        <View style={{
          backgroundColor: colors.card,
          borderRadius: RADIUS.md,
          padding: SPACING.lg,
          marginBottom: SPACING.md,
          borderWidth: 0.5,
          borderColor: colors.border,
          borderLeftWidth: 3,
          borderLeftColor: colors.primary,
        }}>
          <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>{focusMessage}</Text>
        </View>
      )}
    </View>
  );
}

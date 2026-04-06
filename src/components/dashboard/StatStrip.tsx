/**
 * Quick stat grid — 2 column layout (water + steps)
 * Flat design, no gradients
 */
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, FONT, RADIUS, WATER_INCREMENT } from '@/lib/constants';

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
  color: string;
  sublabel?: string;
  progress?: number;
  onPress?: () => void;
}

function StatCard({ icon, value, label, color, sublabel, progress, onPress }: StatCardProps) {
  const { colors } = useTheme();
  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      {...(onPress ? { onPress, activeOpacity: 0.7 } : {})}
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        borderWidth: 0.5,
        borderColor: colors.border,
      }}
    >
      <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: SPACING.sm }}>{label}</Text>
      <Text style={{ color, fontSize: 16, fontWeight: '700' }}>{value}</Text>
      {sublabel && <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>{sublabel}</Text>}
      {progress !== undefined && (
        <View style={{ height: 4, backgroundColor: colors.progressTrack, borderRadius: 2, overflow: 'hidden', marginTop: SPACING.sm }}>
          <View style={{ height: '100%', width: `${Math.min(100, progress * 100)}%`, backgroundColor: color, borderRadius: 2 }} />
        </View>
      )}
    </Wrapper>
  );
}

export function StatStrip({ waterLiters, waterTarget, steps, onAddWater }: Props) {
  const waterPct = waterTarget > 0 ? waterLiters / waterTarget : 0;

  return (
    <View style={{ flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.xl }}>
      <StatCard
        icon="water"
        value={waterTarget > 0 ? `${waterLiters.toFixed(1)} / ${waterTarget.toFixed(1)}L` : `${waterLiters.toFixed(1)}L`}
        label="Su"
        color={METRIC_COLORS.water}
        progress={waterTarget > 0 ? waterPct : undefined}
        onPress={onAddWater}
      />
      <StatCard
        icon="footsteps"
        value={steps ? steps.toLocaleString('tr-TR') : '-'}
        label="Adım"
        color={METRIC_COLORS.steps}
      />
    </View>
  );
}

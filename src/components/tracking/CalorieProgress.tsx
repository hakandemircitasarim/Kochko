/**
 * Calorie Progress Ring / Bar
 * Shows today's calorie consumption vs target with visual progress.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  consumed: number;
  targetMin: number;
  targetMax: number;
  protein: number;
  proteinTarget: number;
}

export function CalorieProgress({ consumed, targetMin, targetMax, protein, proteinTarget }: Props) {
  const targetMid = Math.round((targetMin + targetMax) / 2);
  const pct = targetMax > 0 ? Math.min(1.3, consumed / targetMax) : 0;
  const remaining = targetMid - consumed;
  const inRange = consumed >= targetMin && consumed <= targetMax;
  const over = consumed > targetMax;

  const barColor = over ? COLORS.error : inRange ? COLORS.success : COLORS.primary;
  const proteinPct = proteinTarget > 0 ? Math.min(1, protein / proteinTarget) : 0;

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      {/* Calorie main display */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
        <View>
          <Text style={{ color: barColor, fontSize: FONT.xxl, fontWeight: '800' }}>{consumed}</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>/ {targetMin}-{targetMax} kcal</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: remaining >= 0 ? COLORS.text : COLORS.error, fontSize: FONT.lg, fontWeight: '700' }}>
            {remaining >= 0 ? remaining : `+${Math.abs(remaining)}`}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{remaining >= 0 ? 'kalan' : 'fazla'}</Text>
        </View>
      </View>

      {/* Calorie bar */}
      <View style={{ height: 10, backgroundColor: COLORS.surfaceLight, borderRadius: 5, overflow: 'hidden', marginBottom: SPACING.md }}>
        <View style={{ height: '100%', width: `${Math.min(100, pct * 100)}%`, backgroundColor: barColor, borderRadius: 5 }} />
        {/* Target zone markers */}
        <View style={{ position: 'absolute', left: `${(targetMin / targetMax) * 100}%`, top: 0, bottom: 0, width: 1, backgroundColor: COLORS.textMuted }} />
      </View>

      {/* Protein bar */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>Protein</Text>
        <Text style={{ color: COLORS.text, fontSize: FONT.xs, fontWeight: '600' }}>{protein}g / {proteinTarget}g</Text>
      </View>
      <View style={{ height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${proteinPct * 100}%`, backgroundColor: proteinPct >= 1 ? COLORS.success : COLORS.primary, borderRadius: 3 }} />
      </View>
    </View>
  );
}

/**
 * Calorie Progress - Modern circular ring design
 * Shows today's calorie consumption vs target with visual progress ring + macro bars.
 */
import { View, Text } from 'react-native';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, CARD_SHADOW, RADIUS } from '@/lib/constants';
import { CircularProgress } from '@/components/ui/CircularProgress';

interface Props {
  consumed: number;
  targetMin: number;
  targetMax: number;
  protein: number;
  proteinTarget: number;
  carbs?: number;
  carbsTarget?: number;
  fat?: number;
  fatTarget?: number;
}

function MacroBar({ label, value, target, color, colors }: { label: string; value: number; target: number; color: string; colors: any }) {
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontSize: FONT.xs, color: colors.textMuted, fontWeight: '500' }}>{label}</Text>
        <Text style={{ fontSize: FONT.xs, color: colors.text, fontWeight: '700' }}>{value}g</Text>
      </View>
      <View style={{ height: 6, backgroundColor: colors.surfaceLight, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}

export function CalorieProgress({ consumed, targetMin, targetMax, protein, proteinTarget, carbs = 0, carbsTarget = 200, fat = 0, fatTarget = 70 }: Props) {
  const { colors, isDark } = useTheme();
  const targetMid = Math.round((targetMin + targetMax) / 2);
  const remaining = targetMid - consumed;
  const pct = targetMax > 0 ? Math.min(1, consumed / targetMax) : 0;
  const over = consumed > targetMax;
  const inRange = consumed >= targetMin && consumed <= targetMax;

  const ringColor = over ? colors.error : inRange ? colors.success : '#1D9E75';

  return (
    <View style={{
      backgroundColor: colors.card,
      borderRadius: RADIUS.xxl,
      padding: SPACING.md,
      borderLeftWidth: 4,
      borderLeftColor: ringColor,
      ...(isDark ? { borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderLeftColor: ringColor } : CARD_SHADOW),
    }}>
      {/* Ring */}
      <View style={{ alignItems: 'center', marginBottom: SPACING.sm }}>
        <CircularProgress
          progress={pct}
          size={150}
          strokeWidth={12}
          color={ringColor}
          value={remaining >= 0 ? remaining : `+${Math.abs(remaining)}`}
          unit="kcal"
          label={remaining >= 0 ? 'kalan' : 'fazla'}
          sublabel={`${consumed} / ${targetMin}-${targetMax}`}
        />
      </View>

      {/* Macro bars */}
      <View style={{ flexDirection: 'row', gap: SPACING.md }}>
        <MacroBar label="Protein" value={protein} target={proteinTarget} color="#667EEA" colors={colors} />
        <MacroBar label="Karb" value={carbs} target={carbsTarget} color="#F59E0B" colors={colors} />
        <MacroBar label="Yağ" value={fat} target={fatTarget} color="#EF4444" colors={colors} />
      </View>
    </View>
  );
}

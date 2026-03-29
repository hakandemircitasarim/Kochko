/**
 * Calorie Progress Display — Spec 8.5
 * Shows daily calorie consumption vs target range.
 * Includes: calorie bar, protein bar, carbs bar, fat bar, alcohol if present.
 * Color-coded: green = in range, red = over, purple = under.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

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
  alcohol?: number; // kcal from alcohol
}

export function CalorieProgress({
  consumed, targetMin, targetMax, protein, proteinTarget,
  carbs, carbsTarget, fat, fatTarget, alcohol,
}: Props) {
  const targetMid = Math.round((targetMin + targetMax) / 2);
  const pct = targetMax > 0 ? Math.min(1.3, consumed / targetMax) : 0;
  const remaining = targetMid - consumed;
  const inRange = consumed >= targetMin && consumed <= targetMax;
  const over = consumed > targetMax;

  const barColor = over ? COLORS.error : inRange ? COLORS.success : COLORS.primary;

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      {/* Calorie header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
        <View>
          <Text style={{ color: barColor, fontSize: FONT.xxl, fontWeight: '800' }}>{consumed}</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>/ {targetMin}-{targetMax} kcal</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: remaining >= 0 ? COLORS.text : COLORS.error, fontSize: FONT.lg, fontWeight: '700' }}>
            {remaining >= 0 ? remaining : `+${Math.abs(remaining)}`}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
            {remaining >= 0 ? 'kalan' : 'fazla'} kcal
          </Text>
        </View>
      </View>

      {/* Calorie bar with zone marker */}
      <View style={{ height: 12, backgroundColor: COLORS.surfaceLight, borderRadius: 6, overflow: 'hidden', marginBottom: SPACING.md }}>
        <View style={{ height: '100%', width: `${Math.min(100, pct * 100)}%`, backgroundColor: barColor, borderRadius: 6 }} />
        {targetMax > 0 && (
          <View style={{
            position: 'absolute', left: `${(targetMin / (targetMax * 1.3)) * 100}%`,
            top: 0, bottom: 0, width: 2, backgroundColor: COLORS.textMuted + '60',
          }} />
        )}
      </View>

      {/* Macro bars */}
      <MacroBar label="Protein" current={protein} target={proteinTarget} unit="g" color={COLORS.protein} />
      {carbsTarget != null && carbsTarget > 0 && (
        <MacroBar label="Karb" current={carbs ?? 0} target={carbsTarget} unit="g" color={COLORS.carbs} />
      )}
      {fatTarget != null && fatTarget > 0 && (
        <MacroBar label="Yag" current={fat ?? 0} target={fatTarget} unit="g" color={COLORS.fat} />
      )}

      {/* Alcohol display if present */}
      {alcohol != null && alcohol > 0 && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.xs, paddingTop: SPACING.xs, borderTopWidth: 1, borderTopColor: COLORS.border }}>
          <Text style={{ color: COLORS.alcohol, fontSize: FONT.xs }}>Alkol</Text>
          <Text style={{ color: COLORS.alcohol, fontSize: FONT.xs, fontWeight: '600' }}>{alcohol} kcal</Text>
        </View>
      )}
    </View>
  );
}

function MacroBar({ label, current, target, unit, color }: {
  label: string; current: number; target: number; unit: string; color: string;
}) {
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  const isComplete = pct >= 1;

  return (
    <View style={{ marginBottom: SPACING.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>{label}</Text>
        <Text style={{ color: isComplete ? color : COLORS.text, fontSize: FONT.xs, fontWeight: '600' }}>
          {Math.round(current)}{unit} / {target}{unit}
        </Text>
      </View>
      <View style={{ height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{
          height: '100%', width: `${pct * 100}%`,
          backgroundColor: isComplete ? COLORS.success : color,
          borderRadius: 3,
        }} />
      </View>
    </View>
  );
}

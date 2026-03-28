/**
 * Day Targets Card - shows today's calorie, protein, water targets
 * with current progress.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  calorieMin: number;
  calorieMax: number;
  calorieConsumed: number;
  proteinTarget: number;
  proteinConsumed: number;
  carbsTarget?: number;
  carbsConsumed?: number;
  fatTarget?: number;
  fatConsumed?: number;
  waterTarget: number;
  waterConsumed: number;
  isTrainingDay: boolean;
}

export function DayTargets(props: Props) {
  const calMid = Math.round((props.calorieMin + props.calorieMax) / 2);
  const calRemaining = calMid - props.calorieConsumed;

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      {/* Day type badge */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>Gunun Hedefleri</Text>
        <View style={{ backgroundColor: props.isTrainingDay ? COLORS.primary : COLORS.surfaceLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ color: props.isTrainingDay ? '#fff' : COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600' }}>
            {props.isTrainingDay ? 'Antrenman' : 'Dinlenme'}
          </Text>
        </View>
      </View>

      {/* Calorie main display */}
      <View style={{ alignItems: 'center', marginBottom: SPACING.md }}>
        <Text style={{ color: calRemaining >= 0 ? COLORS.primary : COLORS.error, fontSize: 40, fontWeight: '800' }}>
          {calRemaining >= 0 ? calRemaining : `+${Math.abs(calRemaining)}`}
        </Text>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>
          {calRemaining >= 0 ? 'kcal kaldi' : 'kcal fazla'}
        </Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>
          {props.calorieConsumed} / {props.calorieMin}-{props.calorieMax} kcal
        </Text>
      </View>

      {/* Macro bars */}
      <MacroRow label="Protein" current={props.proteinConsumed} target={props.proteinTarget} unit="g" color={COLORS.primary} />
      {props.carbsTarget && <MacroRow label="Karbonhidrat" current={props.carbsConsumed ?? 0} target={props.carbsTarget} unit="g" color={COLORS.success} />}
      {props.fatTarget && <MacroRow label="Yag" current={props.fatConsumed ?? 0} target={props.fatTarget} unit="g" color={COLORS.warning} />}
      <MacroRow label="Su" current={props.waterConsumed} target={props.waterTarget} unit="L" color="#2196F3" decimal />
    </View>
  );
}

function MacroRow({ label, current, target, unit, color, decimal }: {
  label: string; current: number; target: number; unit: string; color: string; decimal?: boolean;
}) {
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  const display = decimal ? current.toFixed(1) : Math.round(current);
  const targetDisplay = decimal ? target.toFixed(1) : target;

  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>{label}</Text>
        <Text style={{ color: COLORS.text, fontSize: FONT.xs, fontWeight: '600' }}>{display} / {targetDisplay}{unit}</Text>
      </View>
      <View style={{ height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{
          height: '100%',
          width: `${Math.min(100, pct * 100)}%`,
          backgroundColor: pct >= 1 ? COLORS.success : color,
          borderRadius: 3,
        }} />
      </View>
    </View>
  );
}

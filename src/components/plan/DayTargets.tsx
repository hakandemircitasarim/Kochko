/**
 * Day Targets Card — Spec 7.1
 * Shows today's calorie/macro/water targets with live progress.
 * Features: training/rest day badge, calorie zone indicator,
 * alcohol display, IF window indicator, remaining calculation.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

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
  alcoholCalories?: number;
  isTrainingDay: boolean;
  ifWindow?: string | null; // e.g. "12:00-20:00"
  weeklyBudgetRemaining?: number | null;
}

export function DayTargets(props: Props) {
  const calMid = Math.round((props.calorieMin + props.calorieMax) / 2);
  const calRemaining = calMid - props.calorieConsumed;
  const inRange = props.calorieConsumed >= props.calorieMin && props.calorieConsumed <= props.calorieMax;
  const over = props.calorieConsumed > props.calorieMax;
  const calColor = over ? COLORS.error : inRange ? COLORS.success : COLORS.primary;

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      {/* Header: title + day type + IF window */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>Gunun Hedefleri</Text>
        <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
          {props.ifWindow && (
            <View style={{ backgroundColor: COLORS.info + '20', borderRadius: RADIUS.xs, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ color: COLORS.info, fontSize: 10, fontWeight: '600' }}>IF {props.ifWindow}</Text>
            </View>
          )}
          <View style={{
            backgroundColor: props.isTrainingDay ? COLORS.primary : COLORS.surfaceLight,
            borderRadius: RADIUS.xs, paddingHorizontal: SPACING.sm, paddingVertical: 3,
          }}>
            <Text style={{ color: props.isTrainingDay ? '#fff' : COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600' }}>
              {props.isTrainingDay ? 'Antrenman' : 'Dinlenme'}
            </Text>
          </View>
        </View>
      </View>

      {/* Calorie hero display */}
      <View style={{ alignItems: 'center', marginBottom: SPACING.md }}>
        <Text style={{ color: calColor, fontSize: 44, fontWeight: '800', lineHeight: 48 }}>
          {calRemaining >= 0 ? calRemaining : `+${Math.abs(calRemaining)}`}
        </Text>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>
          {calRemaining >= 0 ? 'kcal kaldi' : 'kcal fazla'}
        </Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.xxs }}>
          {props.calorieConsumed} / {props.calorieMin}-{props.calorieMax} kcal
        </Text>
        {inRange && (
          <View style={{ backgroundColor: COLORS.success + '20', borderRadius: RADIUS.xs, paddingHorizontal: SPACING.sm, paddingVertical: 1, marginTop: SPACING.xs }}>
            <Text style={{ color: COLORS.success, fontSize: 10, fontWeight: '600' }}>Hedef araliginda</Text>
          </View>
        )}
      </View>

      {/* Calorie progress bar with zone */}
      <View style={{ height: 8, backgroundColor: COLORS.surfaceLight, borderRadius: 4, overflow: 'hidden', marginBottom: SPACING.md }}>
        <View style={{
          height: '100%',
          width: `${Math.min(100, (props.calorieConsumed / (props.calorieMax * 1.2)) * 100)}%`,
          backgroundColor: calColor, borderRadius: 4,
        }} />
        {/* Min marker */}
        <View style={{
          position: 'absolute',
          left: `${(props.calorieMin / (props.calorieMax * 1.2)) * 100}%`,
          top: 0, bottom: 0, width: 2, backgroundColor: COLORS.textMuted + '60',
        }} />
      </View>

      {/* Macro progress bars */}
      <MacroRow label="Protein" current={props.proteinConsumed} target={props.proteinTarget} unit="g" color={COLORS.protein} />
      {props.carbsTarget != null && props.carbsTarget > 0 && (
        <MacroRow label="Karbonhidrat" current={props.carbsConsumed ?? 0} target={props.carbsTarget} unit="g" color={COLORS.carbs} />
      )}
      {props.fatTarget != null && props.fatTarget > 0 && (
        <MacroRow label="Yag" current={props.fatConsumed ?? 0} target={props.fatTarget} unit="g" color={COLORS.fat} />
      )}
      <MacroRow label="Su" current={props.waterConsumed} target={props.waterTarget} unit="L" color={COLORS.water} decimal />

      {/* Alcohol display */}
      {props.alcoholCalories != null && props.alcoholCalories > 0 && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.xs, paddingTop: SPACING.xs, borderTopWidth: 1, borderTopColor: COLORS.border }}>
          <Text style={{ color: COLORS.alcohol, fontSize: FONT.xs }}>Alkol</Text>
          <Text style={{ color: COLORS.alcohol, fontSize: FONT.xs, fontWeight: '600' }}>{props.alcoholCalories} kcal</Text>
        </View>
      )}

      {/* Weekly budget context */}
      {props.weeklyBudgetRemaining != null && (
        <View style={{ marginTop: SPACING.xs, paddingTop: SPACING.xs, borderTopWidth: 1, borderTopColor: COLORS.border }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, textAlign: 'center' }}>
            Haftalik butceden kalan: {props.weeklyBudgetRemaining.toLocaleString('tr-TR')} kcal
          </Text>
        </View>
      )}
    </View>
  );
}

function MacroRow({ label, current, target, unit, color, decimal }: {
  label: string; current: number; target: number; unit: string; color: string; decimal?: boolean;
}) {
  const pct = target > 0 ? Math.min(1.2, current / target) : 0;
  const displayPct = Math.min(1, pct);
  const display = decimal ? current.toFixed(1) : Math.round(current);
  const targetDisplay = decimal ? target.toFixed(1) : target;
  const isComplete = pct >= 1;

  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>{label}</Text>
        <Text style={{ color: isComplete ? color : COLORS.text, fontSize: FONT.xs, fontWeight: '600' }}>
          {display} / {targetDisplay}{unit} {isComplete ? '✓' : ''}
        </Text>
      </View>
      <View style={{ height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{
          height: '100%', width: `${displayPct * 100}%`,
          backgroundColor: isComplete ? COLORS.success : color, borderRadius: 3,
        }} />
      </View>
    </View>
  );
}

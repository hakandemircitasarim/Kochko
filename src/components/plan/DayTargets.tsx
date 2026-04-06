/**
 * Day Targets Card - Theme-aware with circular progress
 */
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { CircularProgress } from '@/components/ui/CircularProgress';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';

interface Props {
  calorieMin: number; calorieMax: number; calorieConsumed: number;
  proteinTarget: number; proteinConsumed: number;
  carbsTarget?: number; carbsConsumed?: number;
  fatTarget?: number; fatConsumed?: number;
  waterTarget: number; waterConsumed: number;
  isTrainingDay: boolean;
}

export function DayTargets(props: Props) {
  const { colors, isDark } = useTheme();
  const calMid = Math.round((props.calorieMin + props.calorieMax) / 2);
  const calRemaining = calMid - props.calorieConsumed;
  const calPct = props.calorieMax > 0 ? Math.min(1, props.calorieConsumed / props.calorieMax) : 0;
  const over = props.calorieConsumed > props.calorieMax;
  const ringColor = over ? colors.error : calPct > 0.8 ? colors.success : colors.primary;

  return (
    <View style={{
      backgroundColor: colors.card, borderRadius: RADIUS.xxl, padding: SPACING.md,
      ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
        <Text style={{ color: colors.text, fontSize: FONT.lg, fontWeight: '700' }}>Günün Hedefleri</Text>
        <View style={{
          backgroundColor: props.isTrainingDay ? colors.primary + '18' : colors.surfaceLight,
          borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4,
        }}>
          <Text style={{ color: props.isTrainingDay ? colors.primary : colors.textSecondary, fontSize: FONT.xs, fontWeight: '700' }}>
            {props.isTrainingDay ? 'Antrenman' : 'Dinlenme'}
          </Text>
        </View>
      </View>

      <View style={{ alignItems: 'center', marginBottom: SPACING.md }}>
        <CircularProgress
          progress={calPct} size={140} strokeWidth={12} color={ringColor}
          value={calRemaining >= 0 ? calRemaining : `+${Math.abs(calRemaining)}`}
          unit="kcal" label={calRemaining >= 0 ? 'kalan' : 'fazla'}
        />
        <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: SPACING.xs }}>
          {props.calorieConsumed} / {props.calorieMin}-{props.calorieMax} kcal
        </Text>
      </View>

      <MacroRow label="Protein" current={props.proteinConsumed} target={props.proteinTarget} unit="g" color="#667EEA" colors={colors} />
      {props.carbsTarget != null && <MacroRow label="Karbonhidrat" current={props.carbsConsumed ?? 0} target={props.carbsTarget} unit="g" color="#F59E0B" colors={colors} />}
      {props.fatTarget != null && <MacroRow label="Yag" current={props.fatConsumed ?? 0} target={props.fatTarget} unit="g" color="#EF4444" colors={colors} />}
      <MacroRow label="Su" current={props.waterConsumed} target={props.waterTarget} unit="L" color="#2F80ED" colors={colors} decimal />
    </View>
  );
}

function MacroRow({ label, current, target, unit, color, colors, decimal }: {
  label: string; current: number; target: number; unit: string; color: string; colors: any; decimal?: boolean;
}) {
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  const display = decimal ? current.toFixed(1) : Math.round(current);
  const targetDisplay = decimal ? target.toFixed(1) : target;
  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>{label}</Text>
        <Text style={{ color: colors.text, fontSize: FONT.xs, fontWeight: '600' }}>{display} / {targetDisplay}{unit}</Text>
      </View>
      <View style={{ height: 6, backgroundColor: colors.surfaceLight, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${Math.min(100, pct * 100)}%`, backgroundColor: pct >= 1 ? colors.success : color, borderRadius: 3 }} />
      </View>
    </View>
  );
}

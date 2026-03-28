/**
 * Weekly Calorie Budget Widget
 * Spec 2.6: Haftalık kalori bütçesi dashboard widget.
 * Shows consumed vs total with visual progress and rebalance message.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  consumed: number;
  total: number;
  daysLeft: number;
  rebalanceMessage: string | null;
}

export function WeeklyBudgetWidget({ consumed, total, daysLeft, rebalanceMessage }: Props) {
  const remaining = total - consumed;
  const pct = total > 0 ? Math.min(1.1, consumed / total) : 0;
  const avgPerDay = daysLeft > 0 ? Math.round(remaining / daysLeft) : 0;
  const overBudget = remaining < 0;
  const barColor = overBudget ? COLORS.error : pct > 0.85 ? COLORS.warning : COLORS.primary;

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>Haftalik Butce</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{daysLeft} gun kaldi</Text>
      </View>

      {/* Progress bar */}
      <View style={{ height: 10, backgroundColor: COLORS.surfaceLight, borderRadius: 5, overflow: 'hidden', marginBottom: SPACING.sm }}>
        <View style={{ height: '100%', width: `${Math.min(100, pct * 100)}%`, backgroundColor: barColor, borderRadius: 5 }} />
      </View>

      {/* Numbers */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{consumed.toLocaleString('tr-TR')}</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>tuketilen</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: overBudget ? COLORS.error : COLORS.success, fontSize: FONT.md, fontWeight: '600' }}>
            {overBudget ? `-${Math.abs(remaining).toLocaleString('tr-TR')}` : remaining.toLocaleString('tr-TR')}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{overBudget ? 'fazla' : 'kalan'}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{total.toLocaleString('tr-TR')}</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>toplam</Text>
        </View>
      </View>

      {/* Avg per remaining day */}
      {daysLeft > 0 && !overBudget && (
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.sm }}>
          Kalan gunlerde ortalama {avgPerDay.toLocaleString('tr-TR')} kcal/gun
        </Text>
      )}

      {/* Rebalance message */}
      {rebalanceMessage && (
        <View style={{ marginTop: SPACING.sm, padding: SPACING.sm, backgroundColor: COLORS.surfaceLight, borderRadius: 8, borderLeftWidth: 3, borderLeftColor: COLORS.primary }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.xs, lineHeight: 18 }}>{rebalanceMessage}</Text>
        </View>
      )}
    </View>
  );
}

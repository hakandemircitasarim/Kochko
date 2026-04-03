/**
 * Widget Preview Component
 * Spec 23: In-app preview of what a home screen widget would look like.
 *
 * Displays a mini card with calories progress bar, water bar,
 * streak badge, and steps counter.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { WidgetData } from '@/services/widget.service';
import { a11yProgress } from '@/lib/accessibility';

interface Props {
  data: WidgetData;
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: COLORS.border, overflow: 'hidden' }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: color, width: `${pct}%` as unknown as number }} />
    </View>
  );
}

export function WidgetPreview({ data }: Props) {
  const calPct = data.calorieTarget > 0 ? Math.round((data.todayCalories / data.calorieTarget) * 100) : 0;
  const waterPct = data.waterTarget > 0 ? Math.round((data.waterLiters / data.waterTarget) * 100) : 0;

  return (
    <View
      style={{
        backgroundColor: COLORS.card,
        borderRadius: 16,
        padding: SPACING.md,
        gap: SPACING.sm,
        borderWidth: 1,
        borderColor: COLORS.border,
      }}
    >
      {/* Title row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '700' }}>Kochko</Text>
        {data.streak > 1 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: FONT.xs, color: COLORS.success, fontWeight: '700' }}>{data.streak}</Text>
            <Text style={{ fontSize: FONT.xs, color: COLORS.textSecondary }}>gun</Text>
          </View>
        )}
      </View>

      {/* Calories */}
      <View {...a11yProgress('Kalori', data.todayCalories, data.calorieTarget)}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>Kalori</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.xs, fontWeight: '600' }}>
            {data.todayCalories}/{data.calorieTarget} kcal ({calPct}%)
          </Text>
        </View>
        <ProgressBar value={data.todayCalories} max={data.calorieTarget} color={COLORS.primary} />
      </View>

      {/* Protein */}
      <View {...a11yProgress('Protein', data.todayProtein, data.proteinTarget)}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>Protein</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.xs, fontWeight: '600' }}>
            {data.todayProtein}/{data.proteinTarget}g
          </Text>
        </View>
        <ProgressBar value={data.todayProtein} max={data.proteinTarget} color={COLORS.success} />
      </View>

      {/* Water */}
      <View {...a11yProgress('Su', data.waterLiters, data.waterTarget)}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>Su</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.xs, fontWeight: '600' }}>
            {data.waterLiters}/{data.waterTarget}L ({waterPct}%)
          </Text>
        </View>
        <ProgressBar value={data.waterLiters} max={data.waterTarget} color="#4FC3F7" />
      </View>

      {/* Bottom row: Steps + Budget */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.xs }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>
          {data.steps.toLocaleString('tr-TR')} / {data.stepsTarget.toLocaleString('tr-TR')} adim
        </Text>
        {data.weeklyBudgetRemaining != null && (
          <Text style={{ color: data.weeklyBudgetRemaining >= 0 ? COLORS.success : COLORS.error, fontSize: FONT.xs }}>
            {data.weeklyBudgetRemaining >= 0 ? '+' : ''}{data.weeklyBudgetRemaining} kcal hafta
          </Text>
        )}
      </View>

      {/* Focus message */}
      {data.focusMessage && (
        <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontStyle: 'italic', marginTop: 2 }} numberOfLines={1}>
          {data.focusMessage}
        </Text>
      )}
    </View>
  );
}

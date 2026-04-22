/**
 * Sticky preview card at the top of the plan screen during the
 * draft-in-progress state. Compact — day strip + macro ring + calorie
 * label. Taps open the FullPlanModal.
 *
 * Shows a version badge ("v2 · az önce güncellendi") that updates each
 * time a new snapshot arrives. This pairs with hasViewedFullPlan reset
 * (MASTER_PLAN §4.2 rev2.1) so users can tell which version they'd be
 * approving.
 */
import { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import type { DietPlanData, WorkoutPlanData, PlanData } from '@/services/plan.service';
import { DAY_LABELS_TR } from '@/services/plan.service';

interface Props {
  plan: PlanData;
  planType: 'diet' | 'workout';
  onPress: () => void;
  updatedLabel?: string; // e.g. "az önce güncellendi"
}

function DietStrip({ plan }: { plan: DietPlanData }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 4, marginTop: SPACING.xs }}>
      {plan.days.map(d => (
        <View
          key={d.day_index}
          style={{
            flex: 1,
            height: 28,
            borderRadius: 6,
            backgroundColor: d.meals.length > 0 ? '#22C55E22' : colors.surfaceLight,
            borderWidth: 0.5,
            borderColor: d.meals.length > 0 ? '#22C55E' : colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontSize: 9,
              color: d.meals.length > 0 ? '#22C55E' : colors.textMuted,
              fontWeight: '700',
            }}
          >
            {DAY_LABELS_TR[d.day_index]?.[0]}
          </Text>
        </View>
      ))}
    </View>
  );
}

function WorkoutStrip({ plan }: { plan: WorkoutPlanData }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 4, marginTop: SPACING.xs }}>
      {plan.days.map(d => {
        const tone = d.rest_day
          ? { bg: colors.surfaceLight, bd: colors.border, fg: colors.textMuted }
          : { bg: '#6366F122', bd: '#6366F1', fg: '#6366F1' };
        return (
          <View
            key={d.day_index}
            style={{
              flex: 1,
              height: 28,
              borderRadius: 6,
              backgroundColor: tone.bg,
              borderWidth: 0.5,
              borderColor: tone.bd,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 9, color: tone.fg, fontWeight: '700' }}>
              {d.rest_day ? '–' : `${d.exercises.length}`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function PlanPreviewCard({ plan, planType, onPress, updatedLabel }: Props) {
  const { colors, isDark } = useTheme();

  const summary = useMemo(() => {
    if (plan.plan_type === 'diet') {
      const d = plan as DietPlanData;
      const totalKcal = d.days.reduce((s, day) => s + day.total_kcal, 0);
      const avgKcal = Math.round(totalKcal / Math.max(1, d.days.filter(x => x.meals.length > 0).length));
      return {
        primary: `${avgKcal} kcal/gün`,
        secondary: `P ${d.targets.protein}g · K ${d.targets.carbs}g · Y ${d.targets.fat}g`,
      };
    }
    const w = plan as WorkoutPlanData;
    const activeDays = w.days.filter(d => !d.rest_day).length;
    const totalExercises = w.days.reduce((s, d) => s + d.exercises.length, 0);
    return {
      primary: `${activeDays} aktif gün`,
      secondary: `${totalExercises} egzersiz`,
    };
  }, [plan]);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.xl,
        padding: SPACING.md,
        borderWidth: 1,
        borderColor: colors.border,
        ...(isDark ? {} : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 }),
      }}
    >
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
        <Ionicons
          name={planType === 'diet' ? 'restaurant-outline' : 'barbell-outline'}
          size={18}
          color={planType === 'diet' ? '#22C55E' : '#6366F1'}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700' }}>
            {planType === 'diet' ? 'Bu haftaki diyetin' : 'Bu haftaki sporun'}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 1 }}>
            Hafta {plan.week_start} · v{plan.version ?? 1}
            {updatedLabel ? ` · ${updatedLabel}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700' }}>
            {summary.primary}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 10 }}>{summary.secondary}</Text>
        </View>
        <Ionicons name="expand-outline" size={14} color={colors.textMuted} />
      </View>

      {/* Day strip */}
      {plan.plan_type === 'diet' ? (
        <DietStrip plan={plan as DietPlanData} />
      ) : (
        <WorkoutStrip plan={plan as WorkoutPlanData} />
      )}

      <Text
        style={{
          color: colors.textMuted,
          fontSize: 10,
          marginTop: SPACING.xs,
          textAlign: 'center',
        }}
      >
        Detayı görmek için dokun
      </Text>
    </TouchableOpacity>
  );
}

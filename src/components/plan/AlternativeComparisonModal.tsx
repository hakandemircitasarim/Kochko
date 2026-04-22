/**
 * Side-by-side comparison of two plan drafts. Used when the user taps
 * "Alternatif gör": the AI produces a second candidate with same inputs
 * but a different approach, this modal lets the user pick one (the
 * other is discarded to archived).
 *
 * Intentionally compact (summary-level, not full meal detail) — users
 * can open FullPlanModal after picking if they want to drill in.
 */
import { View, Text, ScrollView, TouchableOpacity, Modal, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import type { DietPlanData, WorkoutPlanData, PlanData } from '@/services/plan.service';
import { DAY_LABELS_TR } from '@/services/plan.service';

interface Props {
  visible: boolean;
  onClose: () => void;
  planA: PlanData;
  planB: PlanData;
  onPickA: () => void;
  onPickB: () => void;
  onRequestMore?: () => void; // "Hiçbiri olmadı, 2 tane daha göster"
}

function DietSummary({ plan, label, accent, onPick, colors }: { plan: DietPlanData; label: string; accent: string; onPick: () => void; colors: any }) {
  const totalKcal = plan.days.reduce((s, d) => s + d.total_kcal, 0);
  const activeDays = plan.days.filter(d => d.meals.length > 0).length;
  const avgKcal = Math.round(totalKcal / Math.max(1, activeDays));
  const sampleDay = plan.days.find(d => d.meals.length > 0);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: accent + '44',
        padding: SPACING.md,
      }}
    >
      <View
        style={{
          alignSelf: 'flex-start',
          backgroundColor: accent + '22',
          paddingHorizontal: 9,
          paddingVertical: 3,
          borderRadius: 999,
        }}
      >
        <Text style={{ color: accent, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>
          PLAN {label}
        </Text>
      </View>
      <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '800', marginTop: SPACING.sm }}>
        {avgKcal} kcal/gün
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
        P {plan.targets.protein}g · K {plan.targets.carbs}g · Y {plan.targets.fat}g
      </Text>

      {sampleDay ? (
        <View style={{ marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 0.5, borderTopColor: colors.divider }}>
          <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>
            ÖRNEK GÜN ({sampleDay.day_label})
          </Text>
          {sampleDay.meals.slice(0, 3).map((m, i) => (
            <Text key={i} style={{ color: colors.text, fontSize: 11, marginTop: 3 }} numberOfLines={1}>
              • {m.name}
            </Text>
          ))}
        </View>
      ) : null}

      <TouchableOpacity
        onPress={onPick}
        accessibilityRole="button"
        accessibilityLabel={`Plan ${label}'yı seç`}
        style={{
          marginTop: SPACING.md,
          backgroundColor: accent,
          borderRadius: RADIUS.md,
          paddingVertical: SPACING.sm,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '700' }}>Bunu seç</Text>
      </TouchableOpacity>
    </View>
  );
}

function WorkoutSummary({ plan, label, accent, onPick, colors }: { plan: WorkoutPlanData; label: string; accent: string; onPick: () => void; colors: any }) {
  const active = plan.days.filter(d => !d.rest_day);
  const total = active.reduce((s, d) => s + d.exercises.length, 0);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: accent + '44',
        padding: SPACING.md,
      }}
    >
      <View
        style={{
          alignSelf: 'flex-start',
          backgroundColor: accent + '22',
          paddingHorizontal: 9,
          paddingVertical: 3,
          borderRadius: 999,
        }}
      >
        <Text style={{ color: accent, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>
          PLAN {label}
        </Text>
      </View>
      <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '800', marginTop: SPACING.sm }}>
        {active.length} aktif gün
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
        {total} toplam egzersiz
      </Text>

      <View style={{ marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 0.5, borderTopColor: colors.divider }}>
        <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>
          HAFTALIK BÖLÜM
        </Text>
        {active.slice(0, 4).map((d, i) => (
          <Text key={i} style={{ color: colors.text, fontSize: 11, marginTop: 3 }} numberOfLines={1}>
            • {DAY_LABELS_TR[d.day_index]}: {d.focus ?? `${d.exercises.length} egzersiz`}
          </Text>
        ))}
      </View>

      <TouchableOpacity
        onPress={onPick}
        accessibilityRole="button"
        accessibilityLabel={`Plan ${label}'yı seç`}
        style={{
          marginTop: SPACING.md,
          backgroundColor: accent,
          borderRadius: RADIUS.md,
          paddingVertical: SPACING.sm,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '700' }}>Bunu seç</Text>
      </TouchableOpacity>
    </View>
  );
}

export function AlternativeComparisonModal({
  visible,
  onClose,
  planA,
  planB,
  onPickA,
  onPickB,
  onRequestMore,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const isDiet = planA.plan_type === 'diet';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View
          style={{
            paddingTop: Platform.OS === 'web' ? 12 : Math.max(insets.top, 12),
            paddingHorizontal: SPACING.xl,
            paddingBottom: SPACING.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACING.md,
          }}
        >
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', flex: 1 }}>
            İki alternatif
          </Text>
        </View>

        <Text
          style={{
            color: colors.textMuted,
            fontSize: FONT.xs,
            paddingHorizontal: SPACING.xl,
            marginBottom: SPACING.md,
          }}
        >
          Aynı profilinle iki farklı yaklaşım. Hangisi sana daha uygun?
        </Text>

        <ScrollView
          contentContainerStyle={{
            padding: SPACING.md,
            paddingBottom: Math.max(insets.bottom, SPACING.lg) + SPACING.lg,
          }}
        >
          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            {isDiet ? (
              <>
                <DietSummary plan={planA as DietPlanData} label="A" accent="#22C55E" onPick={onPickA} colors={colors} />
                <DietSummary plan={planB as DietPlanData} label="B" accent="#3B82F6" onPick={onPickB} colors={colors} />
              </>
            ) : (
              <>
                <WorkoutSummary plan={planA as WorkoutPlanData} label="A" accent="#6366F1" onPick={onPickA} colors={colors} />
                <WorkoutSummary plan={planB as WorkoutPlanData} label="B" accent="#EC4899" onPick={onPickB} colors={colors} />
              </>
            )}
          </View>

          {onRequestMore ? (
            <TouchableOpacity
              onPress={onRequestMore}
              style={{
                marginTop: SPACING.lg,
                alignSelf: 'center',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: colors.surfaceLight,
                borderRadius: RADIUS.full,
                paddingHorizontal: SPACING.md,
                paddingVertical: SPACING.sm,
              }}
            >
              <Ionicons name="refresh" size={14} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, fontWeight: '600' }}>
                Hiçbiri olmadı, 2 alternatif daha göster
              </Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

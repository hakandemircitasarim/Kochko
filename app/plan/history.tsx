/**
 * Plan history — archived diet/workout plans (MASTER_PLAN §4.3).
 *
 * Shows superseded active plans + discarded drafts grouped by plan_type.
 * Read-only. Tap an entry → see the snapshot summary (no edit; the plan is
 * frozen). Plans approved long ago are still useful as a record of
 * negotiation history and past meal/workout ideas.
 */
import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { useAuthStore } from '@/stores/auth.store';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import {
  getHistory,
  dayLabelTR,
  type PlanRow,
  type PlanType,
  type DietPlanData,
  type WorkoutPlanData,
} from '@/services/plan.service';

const REASON_LABELS: Record<string, string> = {
  superseded: 'Yeni plan onaylandı',
  user_discarded: 'Sen vazgeçtin',
  alternative_rejected: 'Alternatif seçilmedi',
  plan_drift: 'Profil değişti',
};

// Maps an archived-reason key to a theme color token (resolved at render time).
const REASON_COLOR_TOKENS: Record<string, keyof ReturnType<typeof useTheme>['colors']> = {
  superseded: 'success',
  user_discarded: 'textMuted',
  alternative_rejected: 'textMuted',
  plan_drift: 'warning',
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

export default function PlanHistoryScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ type?: string }>();
  const initialType: PlanType = params.type === 'workout' ? 'workout' : 'diet';
  const user = useAuthStore(s => s.user);

  const [planType, setPlanType] = useState<PlanType>(initialType);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  // FIX (fix-pass 07-12, item 8c): getHistory now THROWS on a Supabase error instead
  // of returning [] — error ≠ empty. Track it and offer a retry instead of showing
  // "arşiv boş" over a network failure.
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setLoadError(false);
    try {
      const list = await getHistory(user.id, planType, 30);
      setRows(list);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user?.id, planType]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: 'Geçmiş planlar',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      />

      {/* Type switcher */}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: colors.cardElevated,
          borderRadius: RADIUS.sm,
          padding: 3,
          margin: SPACING.md,
        }}
      >
        {(['diet', 'workout'] as const).map(t => {
          const active = planType === t;
          return (
            <TouchableOpacity
              key={t}
              onPress={() => setPlanType(t)}
              accessibilityRole="button"
              accessibilityLabel={t === 'diet' ? 'Diyet planları' : 'Antrenman planları'}
              style={{
                flex: 1,
                paddingVertical: SPACING.sm,
                borderRadius: RADIUS.sm - 2,
                backgroundColor: active ? colors.text : 'transparent',
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  color: active ? colors.background : colors.textSecondary,
                  fontSize: 13,
                  fontWeight: '600',
                }}
              >
                {t === 'diet' ? 'Diyet' : 'Antrenman'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : loadError ? (
        // FIX (fix-pass 07-12, item 8c): network failure gets its own state + retry —
        // mirrors the diet/workout screens' error branch. (refactor: shared LoadErrorState)
        <LoadErrorState title="Geçmiş yüklenemedi" onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="archive-outline"
          title="Henüz arşivde plan yok."
          subtitle="Onayladığın planlar burada birikecek."
        />
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: SPACING.md,
            paddingBottom: Math.max(insets.bottom, SPACING.xxl) + SPACING.lg,
            gap: SPACING.sm,
          }}
        >
          {rows.map(row => (
            <HistoryRow key={row.id} row={row} planType={planType} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function HistoryRow({ row, planType }: { row: PlanRow; planType: PlanType }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const reason = row.archived_reason ?? 'superseded';
  const reasonColor = colors[REASON_COLOR_TOKENS[reason] ?? 'textMuted'];
  const reasonLabel = REASON_LABELS[reason] ?? reason;

  const summary = (() => {
    // #S2: plan_data is raw LLM-authored JSON (archived rows include user-discarded drafts);
    // guard days/meals/exercises like every sibling plan component (PlanActiveView/FullPlanModal)
    // so a malformed snapshot degrades to "0" instead of crashing the History tab.
    if (planType === 'diet') {
      const d = row.plan_data as DietPlanData;
      const days = Array.isArray(d?.days) ? d.days : [];
      const avg = Math.round(
        days.reduce((s, x) => s + (x.total_kcal ?? 0), 0) / Math.max(1, days.length)
      );
      // FIX (audit UI-PLN-02): round raw LLM-authored protein target so decimals don't leak in
      return `${avg} kcal/gün ort. · ${Math.round(d?.targets?.protein ?? 0)}g protein`;
    }
    const w = row.plan_data as WorkoutPlanData;
    const days = Array.isArray(w?.days) ? w.days : [];
    const active = days.filter(x => !x.rest_day).length;
    const ex = days.reduce((s, x) => s + (x.rest_day ? 0 : (x.exercises?.length ?? 0)), 0);
    return `${active} aktif gün · ${ex} egzersiz`;
  })();

  return (
    <TouchableOpacity
      onPress={() => setExpanded(e => !e)}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${formatDate(row.generated_at)} planı, ${reasonLabel}`}
      style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.lg,
        padding: SPACING.md,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700' }}>
            {formatDate(row.generated_at)}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 2 }}>
            {summary}
          </Text>
        </View>
        <View
          style={{
            backgroundColor: reasonColor + '18',
            borderRadius: RADIUS.full,
            paddingHorizontal: 8,
            paddingVertical: 3,
          }}
        >
          <Text style={{ color: reasonColor, fontSize: 11, fontWeight: '700' }}>
            {reasonLabel}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textMuted}
        />
      </View>

      {expanded ? (
        <View style={{ marginTop: SPACING.md, paddingTop: SPACING.sm, borderTopWidth: 0.5, borderTopColor: colors.divider }}>
          {planType === 'diet' ? (
            <DietExpanded plan={row.plan_data as DietPlanData} />
          ) : (
            <WorkoutExpanded plan={row.plan_data as WorkoutPlanData} />
          )}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function DietExpanded({ plan }: { plan: DietPlanData }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {/* FIX (audit UI-PLN-06): key by array position, not untrusted LLM day_index */}
      {(Array.isArray(plan?.days) ? plan.days : []).slice(0, 7).map((day, i) => (
        <View key={`${day.day_index}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {/* FIX (fix-pass 07-12, item 3): canonicalize LLM-mangled day labels ('Sali') */}
            {dayLabelTR(day.day_index, day.day_label)}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            {/* FIX (audit UI-PLN-02): round day total (raw LLM JSON may carry decimals) */}
            {day.meals?.length ?? 0} öğün · {Math.round(day.total_kcal ?? 0)} kcal
          </Text>
        </View>
      ))}
    </View>
  );
}

function WorkoutExpanded({ plan }: { plan: WorkoutPlanData }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {/* FIX (audit UI-PLN-06): key by array position, not untrusted LLM day_index */}
      {(Array.isArray(plan?.days) ? plan.days : []).slice(0, 7).map((day, i) => (
        <View key={`${day.day_index}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {/* FIX (fix-pass 07-12, item 3): canonicalize LLM-mangled day labels ('Sali') */}
            {dayLabelTR(day.day_index, day.day_label)}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            {day.rest_day ? 'Dinlenme' : `${day.focus ?? (day.exercises?.length ?? 0) + ' egzersiz'}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

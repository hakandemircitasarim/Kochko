/**
 * Plan history — archived diet/workout plans (MASTER_PLAN §4.3).
 *
 * Shows superseded active plans + discarded drafts grouped by plan_type.
 * Read-only. Tap an entry → see the snapshot summary (no edit; the plan is
 * frozen). Plans approved long ago are still useful as a record of
 * negotiation history and past meal/workout ideas.
 *
 * DUOLINGO DİLİ (2026-11-04): tür seçici iki gövdeli kutucuk (seçili = açık marka yüz +
 * marka çerçeve + koyu raf, ChoiceTile'ın seçili hâliyle aynı), arşiv satırları gövdeli
 * kartlar (ShelfPressable; basınca rafa iner, açılınca özet içeride).
 */
import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE, mix } from '@/lib/design';
import { ShelfPressable } from '@/components/ui/ShelfPressable';
import { useAuthStore } from '@/stores/auth.store';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { SkeletonScreen } from '@/components/ui/Skeleton';
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
  const { colors, isDark } = useTheme();
  const grey = isDark ? colors.border : colors.progressTrack;
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

      {/* Type switcher — iki gövdeli kutucuk. */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, margin: SPACING.md }}>
        {(['diet', 'workout'] as const).map(t => {
          const active = planType === t;
          return (
            <ShelfPressable
              key={t}
              onPress={() => setPlanType(t)}
              accessibilityRole="button"
              accessibilityLabel={t === 'diet' ? 'Diyet planları' : 'Antrenman planları'}
              accessibilityState={{ selected: active }}
              radius={RADIUS.md}
              shelfColor={active ? colors.primaryDark : grey}
              style={{ flex: 1 }}
              faceStyle={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: SPACING.sm + 2,
                borderWidth: 2,
                borderColor: active ? colors.primary : grey,
                backgroundColor: active ? mix(colors.primary, colors.card, isDark ? 0.22 : 0.1) : colors.card,
              }}
            >
              <Ionicons name={t === 'diet' ? 'restaurant' : 'barbell'} size={16} color={active ? colors.primary : colors.textMuted} />
              <Text
                style={{
                  ...TYPE.bodyStrong,
                  fontWeight: active ? '800' : '600',
                  color: active ? colors.primary : colors.textSecondary,
                }}
              >
                {t === 'diet' ? 'Diyet' : 'Antrenman'}
              </Text>
            </ShelfPressable>
          );
        })}
      </View>

      {loading ? (
        // FIX (ux-round4 #29): shared skeleton instead of a lone centered spinner — matches the
        // sibling list screens (achievements, session-viewer, challenges) and avoids the
        // centered-spinner → top-anchored-list layout jump.
        <SkeletonScreen cards={4} topGap={SPACING.md} />
      ) : loadError ? (
        // FIX (fix-pass 07-12, item 8c): network failure gets its own state + retry —
        // mirrors the diet/workout screens' error branch. (refactor: shared LoadErrorState)
        <LoadErrorState title="Geçmiş yüklenemedi" onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState
          mascot="happy"
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
  const { colors, isDark } = useTheme();
  const grey = isDark ? colors.border : colors.progressTrack;
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
    <ShelfPressable
      onPress={() => setExpanded(e => !e)}
      accessibilityRole="button"
      accessibilityLabel={`${formatDate(row.generated_at)} planı, ${reasonLabel}`}
      accessibilityState={{ expanded }}
      radius={RADIUS.lg}
      shelfColor={grey}
      faceStyle={{
        backgroundColor: colors.card,
        padding: SPACING.md,
        borderWidth: 2,
        borderColor: grey,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
        <View
          accessible={false}
          style={{
            width: 36, height: 36, borderRadius: 12,
            backgroundColor: mix(planType === 'diet' ? colors.primary : colors.purple, colors.card, isDark ? 0.24 : 0.12),
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Ionicons name={planType === 'diet' ? 'restaurant' : 'barbell'} size={17} color={planType === 'diet' ? colors.primary : colors.purple} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...TYPE.bodyStrong, color: colors.text, fontWeight: '700' }}>
            {formatDate(row.generated_at)}
          </Text>
          <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 2 }}>
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
          <Text style={{ ...TYPE.caption, color: reasonColor, fontWeight: '700' }}>
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
        <View style={{ marginTop: SPACING.md, paddingTop: SPACING.sm, borderTopWidth: 2, borderTopColor: grey }}>
          {planType === 'diet' ? (
            <DietExpanded plan={row.plan_data as DietPlanData} />
          ) : (
            <WorkoutExpanded plan={row.plan_data as WorkoutPlanData} />
          )}
        </View>
      ) : null}
    </ShelfPressable>
  );
}

function DietExpanded({ plan }: { plan: DietPlanData }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {/* FIX (audit UI-PLN-06): key by array position, not untrusted LLM day_index */}
      {(Array.isArray(plan?.days) ? plan.days : []).slice(0, 7).map((day, i) => (
        <View key={`${day.day_index}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ ...TYPE.caption, color: colors.textSecondary }}>
            {/* FIX (fix-pass 07-12, item 3): canonicalize LLM-mangled day labels ('Sali') */}
            {dayLabelTR(day.day_index, day.day_label)}
          </Text>
          <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
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
          <Text style={{ ...TYPE.caption, color: colors.textSecondary }}>
            {/* FIX (fix-pass 07-12, item 3): canonicalize LLM-mangled day labels ('Sali') */}
            {dayLabelTR(day.day_index, day.day_label)}
          </Text>
          <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
            {day.rest_day ? 'Dinlenme' : `${day.focus ?? (day.exercises?.length ?? 0) + ' egzersiz'}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

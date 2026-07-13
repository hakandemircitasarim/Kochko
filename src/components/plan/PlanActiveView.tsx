/**
 * Active plan state (post-approval): plan is the primary content, optionally
 * open a revision chat overlay, see history, and surface the drift banner
 * when the user's profile has materially changed since approval.
 */
import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { haptics } from '@/lib/haptics';
import { getEffectiveDate } from '@/lib/day-boundary';
import { MealCard } from './MealCard';
import { ExerciseCard } from './ExerciseCard';
import {
  dayLabelTR,
  formatWeekStartTR,
  isPlanStale,
  planWeeksAgo,
  logPlannedMeal,
  undoPlannedMealLog,
  type PlanRow,
  type DietPlanData,
  type DietMeal,
  type WorkoutPlanData,
} from '@/services/plan.service';
import type { Profile } from '@/types/database';

interface Props {
  plan: PlanRow;
  profile: Profile | null;
  goal?: { goal_type?: string; target_weight_kg?: number } | null;
  onStartRevision: () => void;
  onOpenHistory: () => void;
  /** Start a brand-new draft via the normal generation flow (same path as the
   *  empty-state 'Plan oluştur'). Used by the stale-plan banner CTA. */
  onCreateFresh?: () => void;
  creatingRevision?: boolean;
}

// 0 = Monday in our day_index convention (matches the dashboard helper).
// The day-of-week index (0=Mon..6=Sun) of TODAY within a specific plan's week,
// or -1 when today falls outside [week_start, week_start+6]. Weekday-name matching
// alone was wrong: a plan for a future week (generated on a Sunday, week_start =
// next Monday) or a stale past week would still label one of its days "Bugün".
// Only a plan whose week actually contains today has a "today" row.
function todayIndexInWeek(weekStart: string): number {
  if (!weekStart) return -1;
  // Parse the 'YYYY-MM-DD' week_start as LOCAL midnight (bare `new Date('YYYY-MM-DD')`
  // parses as UTC, shifting the day for UTC+ users).
  const start = new Date(weekStart.length <= 10 ? `${weekStart}T00:00:00` : weekStart);
  if (isNaN(start.getTime())) return -1;
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - start.getTime()) / 86_400_000);
  return diffDays >= 0 && diffDays <= 6 ? diffDays : -1;
}

// Drift detection per MASTER_PLAN §4.8.
function detectDrift(
  plan: PlanRow,
  profile: Profile | null,
  currentGoal: { goal_type?: string; target_weight_kg?: number } | null | undefined,
): { soft: string[]; hard: string[] } {
  const soft: string[] = [];
  const hard: string[] = [];
  const snap = plan.approval_snapshot as Record<string, unknown> | null;
  if (!snap || !profile) return { soft, hard };

  const snapWeight = snap.weight_kg as number | null;
  const snapHeight = snap.height_cm as number | null;
  const snapActivity = snap.activity_level as string | null;
  const snapDietMode = snap.diet_mode as string | null;
  const snapGoal = (snap.goal as { goal_type?: string; target_weight_kg?: number } | null) ?? null;

  if (snapWeight && profile.weight_kg && Math.abs(profile.weight_kg - snapWeight) > 3) {
    soft.push(`Kilon ${snapWeight}kg'dan ${profile.weight_kg}kg'a değişmiş`);
  }
  if (snapHeight && profile.height_cm && profile.height_cm !== snapHeight) {
    soft.push('Boy güncellendi');
  }
  if (snapActivity && profile.activity_level && profile.activity_level !== snapActivity) {
    soft.push('Aktivite düzeyin değişmiş');
  }
  if (snapDietMode && profile.diet_mode && profile.diet_mode !== snapDietMode) {
    hard.push('Beslenme modun değişmiş — planı gözden geçirelim');
  }
  if (snapGoal?.goal_type && currentGoal?.goal_type && snapGoal.goal_type !== currentGoal.goal_type) {
    soft.push('Hedefin değişmiş');
  }
  if (
    snapGoal?.target_weight_kg && currentGoal?.target_weight_kg
    && Math.abs(currentGoal.target_weight_kg - snapGoal.target_weight_kg) > 1
  ) {
    soft.push(`Hedef kilon ${snapGoal.target_weight_kg}kg → ${currentGoal.target_weight_kg}kg`);
  }
  return { soft, hard };
}

export function PlanActiveView({ plan, profile, goal, onStartRevision, onOpenHistory, onCreateFresh, creatingRevision }: Props) {
  const { colors } = useTheme();

  const drift = useMemo(() => detectDrift(plan, profile, goal ?? null), [plan, profile, goal]);

  const data = plan.plan_data;
  const isDiet = data.plan_type === 'diet';
  // plan_data is raw LLM-authored JSON — a structurally-incomplete snapshot can
  // slip past the approve gate (a real active row with days=null exists). Guard
  // like every sibling plan component so a malformed plan doesn't crash the tab (#R6-1).
  type AnyDay = DietPlanData['days'][number] | WorkoutPlanData['days'][number];
  const days: AnyDay[] = Array.isArray((data as { days?: unknown }).days)
    ? ((data as { days: AnyDay[] }).days)
    : [];

  // FIX (fix-pass 07-12, item 5): today used to be buried as the 6th row of the
  // 7-day list. Pin today's section to the top ("Bugün · Cumartesi") and keep the
  // remaining days in week order below — least invasive way to make the day the
  // user actually needs reachable without scrolling.
  // -1 when today is outside this plan's week (future or stale plan) — then no day
  // is "Bugün" and the list stays in natural Mon..Sun order.
  const todayDayIndex = todayIndexInWeek(plan.week_start);
  const orderedDays = useMemo(() => {
    if (todayDayIndex < 0) return days; // today outside this plan's week → keep natural order
    const i = days.findIndex(d => d.day_index === todayDayIndex);
    if (i <= 0) return days; // today already first, or not found → keep week order
    return [days[i], ...days.slice(0, i), ...days.slice(i + 1)];
  }, [days, todayDayIndex]);

  // FIX (audit UI-PLN-06): track the expanded day by ARRAY POSITION, not the
  // untrusted LLM-authored day_index (duplicate indices would collide on key +
  // toggle). Today is pinned to position 0, so 0 opens on today whenever the
  // plan has a slot for it, and the list never lands fully collapsed.
  const [expandedDay, setExpandedDay] = useState(0);
  const [expandedMeal, setExpandedMeal] = useState<string | null>(null);

  // ── 'Bunu yedim' (fix-pass 07-12, item 9): one-tap deterministic plan→diary. ──
  const [mealLogState, setMealLogState] = useState<Record<string, 'saving' | 'done'>>({});
  const handleLogMeal = async (key: string, meal: DietMeal) => {
    if (mealLogState[key]) return;
    setMealLogState(s => ({ ...s, [key]: 'saving' }));
    // Review fix (ux-pass2): honor the user's configured day boundary like every
    // other logging surface — the bare default split diaries at custom boundaries.
    const dayBoundaryHour = (profile?.day_boundary_hour as number) ?? 4;
    const { mealLogId, error } = await logPlannedMeal(meal, getEffectiveDate(new Date(), dayBoundaryHour));
    if (error || !mealLogId) {
      haptics.error();
      setMealLogState(s => {
        const next = { ...s };
        delete next[key];
        return next;
      });
      Alert.alert('Eklenemedi', 'Öğün günlüğe eklenemedi. Bağlantını kontrol edip tekrar dene.');
      return;
    }
    haptics.success();
    setMealLogState(s => ({ ...s, [key]: 'done' }));
    Alert.alert('Günlüğe eklendi', `"${meal.name}" bugünkü öğünlerine eklendi.`, [
      {
        text: 'Geri al',
        onPress: async () => {
          await undoPlannedMealLog(mealLogId);
          setMealLogState(s => {
            const next = { ...s };
            delete next[key];
            return next;
          });
        },
      },
      { text: 'Tamam' },
    ]);
  };

  // FIX (fix-pass 07-12, item 1): weekly plan whose week is over = STALE.
  const stale = isPlanStale(plan.week_start);
  const staleWeeks = planWeeksAgo(plan.week_start);

  return (
    <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm }}>
      {/* Header: summary + revision CTA */}
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: colors.border,
          padding: SPACING.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons
            name={isDiet ? 'restaurant' : 'barbell'}
            size={20}
            color={isDiet ? colors.primary : colors.purple}
          />
          <View style={{ flex: 1, marginLeft: SPACING.sm }}>
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '800' }}>
              {isDiet ? 'Aktif diyet planın' : 'Aktif spor planın'}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
              {/* FIX (fix-pass 07-12, item 4a): '2026-06-15 · onaylandı · 19.06.2026' karışık
                  format yerine '15 Haziran haftası · onaylandı 19 Haziran'. */}
              {formatWeekStartTR(plan.week_start)} · onaylandı
              {plan.approved_at
                ? ` ${new Date(plan.approved_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}`
                : ''}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: SPACING.xs, marginTop: SPACING.sm }}>
          <TouchableOpacity
            onPress={onStartRevision}
            disabled={creatingRevision}
            // FIX (ux-pass5): announce as a button with busy/disabled state (was a text blob).
            accessibilityRole="button"
            accessibilityLabel="Kochko ile konuş"
            accessibilityState={{ disabled: !!creatingRevision, busy: !!creatingRevision }}
            style={{
              flex: 1,
              backgroundColor: colors.primary,
              borderRadius: RADIUS.md,
              paddingVertical: SPACING.sm,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
              opacity: creatingRevision ? 0.6 : 1,
            }}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={14} color={getContrastColor(colors.primary)} />
            <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '700' }}>
              Kochko ile konuş
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onOpenHistory}
            // FIX (ux-pass5): announce as a button (was a text blob to TalkBack).
            accessibilityRole="button"
            accessibilityLabel="Plan geçmişi"
            style={{
              backgroundColor: colors.surfaceLight,
              borderRadius: RADIUS.md,
              paddingVertical: SPACING.sm,
              paddingHorizontal: SPACING.md,
              alignItems: 'center',
              flexDirection: 'row',
              gap: 4,
            }}
          >
            <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, fontWeight: '600' }}>
              Geçmiş
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* FIX (fix-pass 07-12, item 1): stale-plan banner. A "weekly" plan lived 4 weeks
          live because nothing rolls it over — surface it and offer a fresh draft via the
          normal generation flow. The old plan is NOT deleted; approving the new draft
          archives it (superseded), same as always. */}
      {stale && onCreateFresh ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: colors.primary,
            padding: SPACING.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="calendar-outline" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: FONT.sm, fontWeight: '700', flex: 1 }}>
              Bu plan {Math.max(1, staleWeeks)} hafta önceydi
            </Text>
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, marginTop: 4 }}>
            Sana güncel bir haftalık plan hazırlayayım — onayladığında bu plan geçmişe kaydolur.
          </Text>
          <TouchableOpacity
            onPress={onCreateFresh}
            disabled={creatingRevision}
            accessibilityRole="button"
            accessibilityLabel="Yeni haftalık plan hazırla"
            accessibilityState={{ disabled: !!creatingRevision, busy: !!creatingRevision }}
            style={{
              backgroundColor: colors.primary,
              borderRadius: RADIUS.md,
              paddingVertical: SPACING.sm,
              alignItems: 'center',
              marginTop: SPACING.sm,
              opacity: creatingRevision ? 0.6 : 1,
            }}
          >
            <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '700' }}>
              {creatingRevision ? 'Hazırlanıyor...' : 'Yeni haftalık plan hazırla'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Drift banners */}
      {drift.hard.length > 0 ? (
        <View
          style={{
            backgroundColor: colors.errorLight,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: colors.error,
            padding: SPACING.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="warning" size={16} color={colors.error} />
            <Text style={{ color: colors.error, fontSize: FONT.sm, fontWeight: '700' }}>
              Güvenliğin için planı güncelleyelim
            </Text>
          </View>
          {drift.hard.map((m, i) => (
            <Text key={i} style={{ color: colors.text, fontSize: FONT.xs, marginTop: 4 }}>
              • {m}
            </Text>
          ))}
          <TouchableOpacity
            onPress={onStartRevision}
            style={{
              backgroundColor: colors.error,
              borderRadius: RADIUS.md,
              paddingVertical: SPACING.sm,
              alignItems: 'center',
              marginTop: SPACING.sm,
            }}
          >
            <Text style={{ color: getContrastColor(colors.error), fontSize: FONT.sm, fontWeight: '700' }}>
              Planı güncelle
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {drift.soft.length > 0 && drift.hard.length === 0 ? (
        <View
          style={{
            backgroundColor: colors.warningLight,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: colors.warning,
            padding: SPACING.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="information-circle-outline" size={14} color={colors.warning} />
            <Text style={{ color: colors.warning, fontSize: FONT.xs, fontWeight: '700' }}>
              Verilerinde değişiklik var
            </Text>
          </View>
          {drift.soft.map((m, i) => (
            <Text key={i} style={{ color: colors.textSecondary, fontSize: FONT.xs, marginTop: 2 }}>
              • {m}
            </Text>
          ))}
          {/* FIX (ux-pass5): the banner's only action was a bare ~15px text link with no
              role — padding + hitSlop lift it to ≥44px effective and TalkBack gets a button. */}
          <TouchableOpacity
            onPress={onStartRevision}
            accessibilityRole="button"
            accessibilityLabel="Planı güncelle"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ marginTop: SPACING.xs, alignSelf: 'flex-start', paddingVertical: SPACING.sm }}
          >
            <Text style={{ color: colors.warning, fontSize: FONT.xs, fontWeight: '700' }}>
              Planı güncelle →
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Days */}
      {days.length === 0 ? (
        <Text style={{ color: colors.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.xl }}>
          Bu planın içeriği eksik görünüyor. Plan sekmesinden yeni bir plan oluşturabilirsin.
        </Text>
      ) : orderedDays.map((day, dayIdx) => {
        // FIX (audit UI-PLN-06): compare/key by array position, not day.day_index.
        const isOpen = expandedDay === dayIdx;
        const isToday = todayDayIndex >= 0 && day.day_index === todayDayIndex;
        // FIX (fix-pass 07-12, item 3): canonicalize LLM-mangled labels ('Sali' → 'Salı').
        const label = dayLabelTR(day.day_index, day.day_label);
        return (
          <View key={`${day.day_index}-${dayIdx}`}>
            <TouchableOpacity
              onPress={() => setExpandedDay(isOpen ? -1 : dayIdx)}
              activeOpacity={0.8}
              // FIX (ux-pass5): same a11y treatment as the visually identical draft accordion
              // (PlanDayAccordion) — role + label + expanded state for the daily-use plan.
              accessibilityRole="button"
              accessibilityLabel={`${isToday ? `Bugün, ${label}` : label}, ${isOpen ? 'açık' : 'aç'}`}
              accessibilityState={{ expanded: isOpen }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.surfaceLight,
                borderRadius: RADIUS.md,
                borderWidth: isToday ? 1 : 0,
                borderColor: isToday ? colors.primary + '66' : undefined,
                paddingHorizontal: SPACING.md,
                paddingVertical: SPACING.sm,
                gap: SPACING.sm,
              }}
            >
              <Text style={{ color: isToday ? colors.primary : colors.text, fontSize: FONT.sm, fontWeight: '700', flex: 1 }}>
                {isToday ? `Bugün · ${label}` : label}
              </Text>
              {isDiet ? (
                <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
                  {/* FIX (audit UI-PLN-02): round day total (raw LLM JSON may carry decimals) */}
                  {Math.round((day as DietPlanData['days'][number]).total_kcal)} kcal
                </Text>
              ) : (
                <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
                  {(day as WorkoutPlanData['days'][number]).rest_day
                    ? 'Dinlenme'
                    : `${(day as WorkoutPlanData['days'][number]).exercises?.length ?? 0} egzersiz`}
                </Text>
              )}
              <Ionicons
                name={isOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            </TouchableOpacity>
            {isOpen ? (
              <View style={{ marginTop: SPACING.sm }}>
                {isDiet ? (
                  ((day as DietPlanData['days'][number]).meals ?? []).map(meal => {
                    // FIX (audit UI-PLN-06): scope meal key by array position so
                    // duplicate day_index values can't share expand-state.
                    const key = `${dayIdx}-${meal.meal_type}`;
                    return (
                      <MealCard
                        key={key}
                        meal={meal}
                        expanded={expandedMeal === key}
                        onToggle={() => setExpandedMeal(expandedMeal === key ? null : key)}
                        // 'Bunu yedim' only on the ACTIVE plan's TODAY (fix-pass 07-12, item 9).
                        onLogPress={isToday ? () => handleLogMeal(key, meal) : undefined}
                        logStatus={mealLogState[key]}
                      />
                    );
                  })
                ) : (day as WorkoutPlanData['days'][number]).rest_day ? (
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: FONT.xs,
                      fontStyle: 'italic',
                      textAlign: 'center',
                      paddingVertical: SPACING.md,
                    }}
                  >
                    Dinlenme günü.
                  </Text>
                ) : (
                  ((day as WorkoutPlanData['days'][number]).exercises ?? []).map((ex, i) => (
                    <ExerciseCard key={i} exercise={ex} />
                  ))
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

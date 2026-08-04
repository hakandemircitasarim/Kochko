/**
 * Active plan state (post-approval): plan is the primary content, optionally
 * open a revision chat overlay, see history, and surface the drift banner
 * when the user's profile has materially changed since approval.
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, LayoutAnimation } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { MEAL_TYPE_LABELS_TR } from '@/lib/labels';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { haptics } from '@/lib/haptics';
import { getEffectiveDate } from '@/lib/day-boundary';
import { supabase } from '@/lib/supabase';
import { MealCard } from './MealCard';
import { ExerciseCard } from './ExerciseCard';
import {
  dayLabelTR,
  formatWeekStartTR,
  isPlanStale,
  planWeeksAgo,
  logPlannedMeal,
  undoPlannedMealLog,
  logPlannedExercise,
  undoPlannedExerciseLog,
  type PlanRow,
  type DietPlanData,
  type DietDay,
  type DietMeal,
  type WorkoutPlanData,
  type WorkoutExercise,
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
  // FIX (ux-round4 #11): the coach's rationale (plan_data.reasoning) was stored on approval but
  // never shown again — surface it as a collapsed "Bu plan neden böyle?" note.
  const [showReasoning, setShowReasoning] = useState(false);

  // FIX (ux-round4 #3): give the plan a yardstick. Diet → daily kcal/protein target + week average;
  // workout → training/rest day counts + weekly minutes. All from plan_data already in memory.
  const planSummary = useMemo(() => {
    if (isDiet) {
      const t = (data as DietPlanData).targets;
      const dd = days as DietDay[];
      const withKcal = dd.filter(d => (d.total_kcal ?? 0) > 0);
      const avgKcal = withKcal.length
        ? Math.round(withKcal.reduce((s, d) => s + d.total_kcal, 0) / withKcal.length)
        : null;
      return { kind: 'diet' as const, targetKcal: t?.kcal ?? null, targetProtein: t?.protein ?? null, avgKcal };
    }
    const wd = days as WorkoutPlanData['days'];
    const training = wd.filter(d => !d.rest_day && (d.exercises?.length ?? 0) > 0).length;
    const rest = wd.filter(d => d.rest_day).length;
    const weeklyMin = wd.reduce((s, d) => s + (d.estimated_duration_min ?? 0), 0);
    return { kind: 'workout' as const, training, rest, weeklyMin };
  }, [data, days, isDiet]);

  // ── 'Bunu yedim' (fix-pass 07-12, item 9): one-tap deterministic plan→diary. ──
  // FIX (ux-ideas #18): the "done" state used to be local-only and reset on nav-away (and could
  // double-log). It's now hydrated from today's actual logs (effect below) so it survives
  // leaving/returning the tab. Immediate undo lives in the "Geri al" alert; a reload-marked log
  // is undoable from the dashboard timeline.
  const [mealLogState, setMealLogState] = useState<Record<string, 'saving' | 'done'>>({});
  const dayBoundaryHour = (profile?.day_boundary_hour as number) ?? 4;

  const handleLogMeal = async (key: string, meal: DietMeal) => {
    if (mealLogState[key]) return;
    setMealLogState(s => ({ ...s, [key]: 'saving' }));
    // Review fix (ux-pass2): honor the user's configured day boundary like every
    // other logging surface — the bare default split diaries at custom boundaries.
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
          setMealLogState(s => { const next = { ...s }; delete next[key]; return next; });
        },
      },
      { text: 'Tamam' },
    ]);
  };

  // ── 'Bunu yaptım' (ux-ideas #19): one-tap plan→workout diary, mirrors handleLogMeal. ──
  const [exLogState, setExLogState] = useState<Record<string, 'saving' | 'done'>>({});
  const handleLogExercise = async (key: string, exercise: WorkoutExercise) => {
    if (exLogState[key]) return;
    setExLogState(s => ({ ...s, [key]: 'saving' }));
    const { workoutLogId, error } = await logPlannedExercise(exercise, getEffectiveDate(new Date(), dayBoundaryHour));
    if (error || !workoutLogId) {
      haptics.error();
      setExLogState(s => { const next = { ...s }; delete next[key]; return next; });
      Alert.alert('Eklenemedi', 'Egzersiz günlüğe eklenemedi. Bağlantını kontrol edip tekrar dene.');
      return;
    }
    haptics.success();
    setExLogState(s => ({ ...s, [key]: 'done' }));
    Alert.alert('Günlüğe eklendi', `"${exercise.name}" bugünkü antrenmanına eklendi.`, [
      {
        text: 'Geri al',
        onPress: async () => {
          await undoPlannedExerciseLog(workoutLogId);
          setExLogState(s => { const next = { ...s }; delete next[key]; return next; });
        },
      },
      { text: 'Tamam' },
    ]);
  };

  // FIX (ux-ideas #18/#19): hydrate "done" state from today's actual logs so it survives
  // leaving and returning to the tab (and prevents accidental double-logging). Match the
  // '[Plan] {name}' tag the two log helpers write. Today is pinned to array position 0,
  // so keys are '0-{mealIndex}' / 'ex-0-{i}' to match the render below.
  useEffect(() => {
    if (todayDayIndex < 0) return;
    let cancelled = false;
    (async () => {
      const dateStr = getEffectiveDate(new Date(), dayBoundaryHour);
      const todayDay = days.find(d => d.day_index === todayDayIndex);
      if (!todayDay) return;
      if (isDiet) {
        const meals = (todayDay as DietDay).meals ?? [];
        const { data } = await supabase.from('meal_logs')
          .select('id, raw_input').eq('logged_for_date', dateStr).eq('is_deleted', false)
          .like('raw_input', '[Plan] %');
        if (cancelled || !data) return;
        const byRaw = new Map<string, string>();
        for (const r of data as { id: string; raw_input: string }[]) byRaw.set(r.raw_input, r.id);
        const st: Record<string, 'done'> = {};
        meals.forEach((m, mi) => { const id = byRaw.get(`[Plan] ${m.name}`); if (id) { st[`0-${mi}`] = 'done'; } });
        setMealLogState(s => ({ ...st, ...s }));
      } else {
        const exercises = (todayDay as WorkoutPlanData['days'][number]).exercises ?? [];
        const { data } = await supabase.from('workout_logs')
          .select('id, raw_input').eq('logged_for_date', dateStr)
          .like('raw_input', '[Plan] %');
        if (cancelled || !data) return;
        const rawSet = new Map<string, string>();
        for (const r of data as { id: string; raw_input: string }[]) rawSet.set(r.raw_input, r.id);
        const st: Record<string, 'done'> = {};
        exercises.forEach((ex, i) => {
          const loadText = ex.weight_kg ? `${ex.sets}×${ex.reps} · ${ex.weight_kg} kg` : `${ex.sets}×${ex.reps}`;
          if (rawSet.has(`[Plan] ${ex.name} — ${loadText}`)) { st[`ex-0-${i}`] = 'done'; }
        });
        setExLogState(s => ({ ...st, ...s }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id, todayDayIndex, isDiet]);

  // FIX (ux-ideas #18/#19): today's completion counts for the header badge.
  const todayCompletion = useMemo(() => {
    if (todayDayIndex < 0) return null;
    const todayDay = days.find(d => d.day_index === todayDayIndex);
    if (!todayDay) return null;
    if (isDiet) {
      const meals = (todayDay as DietDay).meals ?? [];
      if (meals.length === 0) return null;
      const done = meals.filter((_, mi) => mealLogState[`0-${mi}`] === 'done').length;
      return { done, total: meals.length, unit: 'öğün' };
    }
    const exs = (todayDay as WorkoutPlanData['days'][number]).exercises ?? [];
    if ((todayDay as WorkoutPlanData['days'][number]).rest_day || exs.length === 0) return null;
    const done = exs.filter((_, i) => exLogState[`ex-0-${i}`] === 'done').length;
    return { done, total: exs.length, unit: 'egzersiz' };
  }, [days, todayDayIndex, isDiet, mealLogState, exLogState]);

  // FIX (ux-ideas #9): "şimdi sırada" — the next meal by clock time (or today's workout summary),
  // pulled into a single highlighted card right under the header so "ne yiyeyim/yapayım şimdi?"
  // is answered at a glance, without opening the accordion. Uses meal.time (already present).
  const nowNext = useMemo(() => {
    if (todayDayIndex < 0) return null;
    const todayDay = days.find(d => d.day_index === todayDayIndex);
    if (!todayDay) return null;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const toMin = (t?: string): number | null => {
      if (!t) return null;
      const [h, m] = t.split(':').map(Number);
      return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : null;
    };
    if (isDiet) {
      const meals = (todayDay as DietDay).meals ?? [];
      const timed = meals
        .map((meal, mi) => ({ meal, mi, min: toMin(meal.time) }))
        .filter((x): x is { meal: DietMeal; mi: number; min: number } => x.min != null)
        .sort((a, b) => a.min - b.min);
      const pick = timed.find(x => x.min >= nowMin);
      if (!pick) return null; // all of today's timed meals are past → nothing "next"
      return { kind: 'meal' as const, meal: pick.meal, mi: pick.mi, done: mealLogState[`0-${pick.mi}`] === 'done' };
    }
    const wday = todayDay as WorkoutPlanData['days'][number];
    if (wday.rest_day) return { kind: 'rest' as const };
    const exs = wday.exercises ?? [];
    if (exs.length === 0) return null;
    return { kind: 'workout' as const, count: exs.length, doneCount: exs.filter((_, i) => exLogState[`ex-0-${i}`] === 'done').length };
  }, [days, todayDayIndex, isDiet, mealLogState, exLogState]);

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
            <Text style={{ ...TYPE.headline, color: colors.text }}>
              {isDiet ? 'Aktif diyet planın' : 'Aktif spor planın'}
            </Text>
            <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
              {/* FIX (fix-pass 07-12, item 4a): '2026-06-15 · onaylandı · 19.06.2026' karışık
                  format yerine '15 Haziran haftası · onaylandı 19 Haziran'. */}
              {formatWeekStartTR(plan.week_start)} · onaylandı
              {plan.approved_at
                ? ` ${new Date(plan.approved_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}`
                : ''}
            </Text>
          </View>
        </View>
        {/* FIX (ux-round4 #3): daily target / week overview — the yardstick the per-day numbers lacked.
            08-04, cihazda: metin 13'e cikinca tek satira sigmadi ve flexWrap onu KOMPLE alt satira
            atti — bayrak ikonu kendi basina bir satirda kaldi. flex:1 metni ikonun yaninda tutar
            ve sarmayi metnin kendi icinde yapar. */}
        {planSummary.kind === 'diet' && planSummary.targetKcal ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: SPACING.sm }}>
            <Ionicons name="flag-outline" size={13} color={colors.textSecondary} style={{ marginTop: 3 }} />
            <Text style={{ ...TYPE.caption, color: colors.textSecondary, flex: 1 }}>
              Günlük hedef: ~{Math.round(planSummary.targetKcal)} kcal
              {planSummary.targetProtein ? ` · ${Math.round(planSummary.targetProtein)}g protein` : ''}
              {planSummary.avgKcal ? ` · hafta ort. ${planSummary.avgKcal} kcal` : ''}
            </Text>
          </View>
        ) : null}
        {planSummary.kind === 'workout' && planSummary.training > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: SPACING.sm }}>
            <Ionicons name="calendar-outline" size={13} color={colors.textSecondary} style={{ marginTop: 3 }} />
            <Text style={{ ...TYPE.caption, color: colors.textSecondary, flex: 1 }}>
              {planSummary.training} antrenman · {planSummary.rest} dinlenme
              {planSummary.weeklyMin > 0 ? ` · ~${planSummary.weeklyMin} dk/hafta` : ''}
            </Text>
          </View>
        ) : null}
        {/* FIX (ux-ideas #18/#19): today's completion at a glance */}
        {todayCompletion && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.sm,
            alignSelf: 'flex-start', backgroundColor: colors.primary + '18',
            borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 4,
          }}>
            <Ionicons name="checkmark-done-outline" size={13} color={colors.primary} />
            <Text style={{ ...TYPE.caption, color: colors.primary, fontWeight: '700' }}>
              Bugün {todayCompletion.done}/{todayCompletion.total} {todayCompletion.unit}
            </Text>
          </View>
        )}
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
            <Text style={{ ...TYPE.bodyStrong, color: getContrastColor(colors.primary), fontWeight: '700' }}>
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
            <Text style={{ ...TYPE.bodyStrong, color: colors.textSecondary }}>
              Geçmiş
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* FIX (ux-round4 #11): the coach's rationale, kept available after approval (collapsed). */}
      {data.reasoning ? (
        <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: SPACING.md }}>
          <TouchableOpacity
            onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setShowReasoning(v => !v); }}
            accessibilityRole="button"
            accessibilityLabel="Bu plan neden böyle"
            accessibilityState={{ expanded: showReasoning }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: SPACING.sm }}
          >
            <Ionicons name="bulb-outline" size={14} color={colors.textSecondary} />
            <Text style={{ ...TYPE.bodyStrong, color: colors.textSecondary, flex: 1 }}>Bu plan neden böyle?</Text>
            <Ionicons name={showReasoning ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
          </TouchableOpacity>
          {showReasoning ? (
            <Text style={{ ...TYPE.body, color: colors.textSecondary, paddingBottom: SPACING.md }}>
              {data.reasoning}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* FIX (ux-ideas #9): "şimdi sırada" highlight — answers "ne şimdi?" without scrolling. */}
      {nowNext && (
        <View style={{
          backgroundColor: colors.primary + '12', borderRadius: RADIUS.lg,
          borderWidth: 1, borderColor: colors.primary + '40', padding: SPACING.md,
          flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
        }}>
          <Ionicons
            name={nowNext.kind === 'meal' ? 'restaurant' : nowNext.kind === 'rest' ? 'bed-outline' : 'barbell'}
            size={18} color={colors.primary}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ ...TYPE.overline, color: colors.primary }}>ŞİMDİ SIRADA</Text>
            {/* This strip crammed meal type + time + name onto ONE line while a "Bunu yedim" button
                takes the right half, so the name — the only part that says WHAT to eat — was what
                got cut ("Kahvaltı · 08:30 — Peynirli to…"). Split it: the type/time is a label, the
                name is the content, and the name gets two lines if it needs them. */}
            {nowNext.kind === 'meal' && (
              <>
                <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 2 }} numberOfLines={1}>
                  {MEAL_TYPE_LABELS_TR[nowNext.meal.meal_type]}{nowNext.meal.time ? ` · ${nowNext.meal.time}` : ''}
                </Text>
                <Text style={{ ...TYPE.bodyStrong, color: colors.text }} numberOfLines={2}>
                  {nowNext.meal.name}
                </Text>
              </>
            )}
            {nowNext.kind === 'workout' && (
              <Text style={{ ...TYPE.bodyStrong, color: colors.text, marginTop: 2 }}>
                Bugünkü antrenman · {nowNext.count} egzersiz{nowNext.doneCount > 0 ? ` · ${nowNext.doneCount} bitti` : ''}
              </Text>
            )}
            {nowNext.kind === 'rest' && (
              <Text style={{ ...TYPE.bodyStrong, color: colors.text, marginTop: 2 }}>Bugün dinlenme günü</Text>
            )}
          </View>
          {nowNext.kind === 'meal' && (
            nowNext.done ? (
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            ) : (
              <TouchableOpacity
                onPress={() => handleLogMeal(`0-${nowNext.mi}`, nowNext.meal)}
                disabled={mealLogState[`0-${nowNext.mi}`] === 'saving'}
                accessibilityRole="button"
                accessibilityLabel={`${nowNext.meal.name}, bunu yedim, günlüğe ekle`}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 7 }}
              >
                {mealLogState[`0-${nowNext.mi}`] === 'saving'
                  ? <ActivityIndicator size="small" color={getContrastColor(colors.primary)} style={{ transform: [{ scale: 0.7 }] }} />
                  : <Ionicons name="add-circle-outline" size={14} color={getContrastColor(colors.primary)} />}
                <Text style={{ ...TYPE.caption, color: getContrastColor(colors.primary), fontWeight: '700' }}>Bunu yedim</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      )}

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
            <Text style={{ ...TYPE.bodyStrong, color: colors.primary, fontWeight: '700', flex: 1 }}>
              Bu plan {Math.max(1, staleWeeks)} hafta önceydi
            </Text>
          </View>
          <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 4 }}>
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
            <Text style={{ ...TYPE.bodyStrong, color: getContrastColor(colors.primary), fontWeight: '700' }}>
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
            <Text style={{ ...TYPE.bodyStrong, color: colors.error, fontWeight: '700' }}>
              Güvenliğin için planı güncelleyelim
            </Text>
          </View>
          {drift.hard.map((m, i) => (
            <Text key={i} style={{ ...TYPE.caption, color: colors.text, marginTop: 4 }}>
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
            <Text style={{ ...TYPE.bodyStrong, color: getContrastColor(colors.error), fontWeight: '700' }}>
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
            <Text style={{ ...TYPE.bodyStrong, color: colors.warning, fontWeight: '700' }}>
              Verilerinde değişiklik var
            </Text>
          </View>
          {drift.soft.map((m, i) => (
            <Text key={i} style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 2 }}>
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
            <Text style={{ ...TYPE.bodyStrong, color: colors.warning, fontWeight: '700' }}>
              Planı güncelle →
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Days */}
      {days.length === 0 ? (
        <Text style={{ ...TYPE.body, color: colors.textMuted, textAlign: 'center', paddingVertical: SPACING.xl }}>
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
              onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setExpandedDay(isOpen ? -1 : dayIdx); }}
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
              <Text style={{ ...TYPE.bodyStrong, color: isToday ? colors.primary : colors.text, fontWeight: '700', flex: 1 }}>
                {isToday ? `Bugün · ${label}` : label}
              </Text>
              {isDiet ? (
                <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
                  {/* FIX (audit UI-PLN-02): round day total (raw LLM JSON may carry decimals);
                      ux-round4 review: ?? 0 guard so a legacy day missing total_kcal isn't "NaN kcal". */}
                  {Math.round((day as DietPlanData['days'][number]).total_kcal ?? 0)} kcal
                  {/* FIX (ux-round4 #7): protein is the macro the coaching model revolves around —
                      show it in the collapsed row instead of hiding it behind an expand. */}
                  {(day as DietPlanData['days'][number]).total_protein
                    ? ` · ${Math.round((day as DietPlanData['days'][number]).total_protein)}g P`
                    : ''}
                </Text>
              ) : (
                <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
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
                  ((day as DietPlanData['days'][number]).meals ?? []).map((meal, mi) => {
                    // FIX (audit UI-PLN-06 + ux-review): scope meal key by array position, NOT
                    // meal_type — a day with two 'snack' (ara öğün) meals would collide on
                    // '0-snack', so logging one marked BOTH done and over-counted the badge.
                    const key = `${dayIdx}-${mi}`;
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
                      ...TYPE.callout,
                      color: colors.textMuted,
                      fontStyle: 'italic',
                      textAlign: 'center',
                      paddingVertical: SPACING.md,
                    }}
                  >
                    Dinlenme günü.
                  </Text>
                ) : (
                  ((day as WorkoutPlanData['days'][number]).exercises ?? []).map((ex, i) => {
                    const exKey = `ex-${dayIdx}-${i}`;
                    return (
                      <ExerciseCard
                        key={i}
                        exercise={ex}
                        // 'Bunu yaptım' only on the ACTIVE plan's TODAY (ux-ideas #19).
                        onLogPress={isToday ? () => handleLogExercise(exKey, ex) : undefined}
                        logStatus={exLogState[exKey]}
                      />
                    );
                  })
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

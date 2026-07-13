import { useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, useWindowDimensions, ActivityIndicator, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LineChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { detectPlateau, selectBestStrategy, applyPlateauStrategy, type PlateauStatus, type PlateauStrategy, type StrategyRecommendation } from '@/services/plateau.service';
import { getMaintenanceStatus, shouldTriggerMiniCut, type MaintenanceStatus } from '@/services/maintenance.service';
import { getTimelineData } from '@/services/goals.service';
import { getEngagementMetrics, type EngagementMetrics } from '@/services/analytics.service';
import { PhaseTimeline } from '@/components/plan/PhaseTimeline';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

interface MetricPt { date: string; weight_kg: number | null; water_liters: number; sleep_hours: number | null; steps: number | null; }
interface CompPt { date: string; compliance_score: number; calorie_actual: number | null; workout_completed: boolean | null; }

// FIX (ux-pass raporlar): daily_reports rows can exist for days the user logged NOTHING
// (the report job still runs and the score clamps to 0). Those fabricated zeros poisoned
// the uyum chart (wall of zeros), the "En Kötü" pick (an unlogged day branded worst) and
// the tile average. A day counts as "logged" only if it has a meal (calorie_actual > 0),
// a completed workout, or any daily_metrics entry (weight/water/sleep/steps).
const metricHasLog = (m: MetricPt) =>
  m.weight_kg != null || (m.water_liters ?? 0) > 0 || m.sleep_hours != null || (m.steps ?? 0) > 0;
const filterLoggedCompliance = (comp: CompPt[], mets: MetricPt[]): CompPt[] => {
  const loggedDates = new Set(mets.filter(metricHasLog).map(m => m.date));
  return comp.filter(c => (c.calorie_actual ?? 0) > 0 || c.workout_completed === true || loggedDates.has(c.date));
};

// FIX (completeness audit): applying a plateau strategy / mini-cut writes the new band to profiles,
// but today's ALREADY-projected daily_plans row keeps the OLD calorie/protein targets until the next
// daily roll-forward — so the dashboard + plan the user is actually following show a stale target.
// Push the new band into today's plan row immediately (mirrors ai-chat maintenance_start /
// mini_cut_start and maintenance.service.writeReverseDietToPlan). Best-effort: RLS plans_upd lets the
// owner update; a failure here must not undo the (already-succeeded) profile change.
async function reprojectTodayPlanBand(
  userId: string,
  dayBoundaryHour: number,
  calMin: number,
  calMax: number,
  proteinG?: number,
): Promise<void> {
  // Key "today" with the SAME effective-date logic the dashboard/log flow uses (local calendar +
  // day-boundary subtraction), NOT raw UTC — otherwise in the 00:00–04:00 window the band lands on
  // the adjacent calendar row and the dashboard (which reads getEffectiveDate) never sees it.
  const today = getEffectiveDate(new Date(), dayBoundaryHour);
  const { data: existing } = await supabase
    .from('daily_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('date', today)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!existing) return; // no projected row today → next roll-forward already uses the new profile band
  const patch: Record<string, number> = { calorie_target_min: calMin, calorie_target_max: calMax };
  if (proteinG != null && Number.isFinite(proteinG) && proteinG > 0) patch.protein_target_g = Math.round(proteinG);
  await supabase.from('daily_plans').update(patch).eq('id', (existing as { id: string }).id);
}

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();
  // FIX (audit UI-TAB-01/UI-TAB-02): derive chart width per-render from useWindowDimensions
  // (recomputes on rotate/split-screen) and subtract the REAL inset — ScrollView pad
  // (SPACING.md*2) + Card inner pad (SPACING.lg*2) — so the chart isn't clipped by the
  // overflow:'hidden' Card. (was a stale module constant of window − SPACING.md*4).
  const { width: windowWidth } = useWindowDimensions();
  const chartWidth = windowWidth - SPACING.md * 2 - SPACING.lg * 2;
  const { colors, isDark } = useTheme();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const [metrics, setMetrics] = useState<MetricPt[]>([]);
  const [compliance, setCompliance] = useState<CompPt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false); // pull-to-refresh: keep content visible, no skeleton teardown
  const hasLoadedOnce = useRef(false);
  const [error, setError] = useState(false); // FIX (audit UI-STA-05): distinguish load failure from empty data
  const [plateauMsg, setPlateauMsg] = useState<string | null>(null);
  const [plateauStatus, setPlateauStatus] = useState<PlateauStatus | null>(null);
  const [strategyRec, setStrategyRec] = useState<StrategyRecommendation | null>(null);
  const [maintenanceMsg, setMaintenanceMsg] = useState<string | null>(null);
  const [maintenanceData, setMaintenanceData] = useState<MaintenanceStatus | null>(null);
  const [miniCutOffered, setMiniCutOffered] = useState(false);
  const [miniCutLoading, setMiniCutLoading] = useState(false);
  const [timelinePhases, setTimelinePhases] = useState<{ phases: { id: string; label: string; goalType: string; targetWeeks: number; isActive: boolean; isCompleted: boolean }[]; currentWeek: number } | null>(null);
  const [engagement, setEngagement] = useState<EngagementMetrics | null>(null);

  const chartConfig = {
    backgroundGradientFrom: colors.card,
    backgroundGradientTo: colors.card,
    decimalPlaces: 1,
    color: (o = 1) => `rgba(29, 158, 117, ${o})`,
    labelColor: () => colors.textSecondary,
    propsForDots: { r: '3', strokeWidth: '1.5', stroke: colors.primary },
    propsForBackgroundLines: { stroke: colors.border },
  };

  // FIX (audit weight-chart-color): kilo trendi her yerde METRIC_COLORS.weight (pembe)
  // ile gösterilsin (özet ikonu colors.pink ile tutarlı). Uyum grafiği teal'de kalır.
  const weightChartConfig = {
    ...chartConfig,
    color: (o = 1) => `rgba(212, 83, 126, ${o})`, // #D4537E (METRIC_COLORS.weight)
    propsForDots: { r: '3', strokeWidth: '1.5', stroke: colors.pink },
  };

  const load = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    const from = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
    try {
      const [m, c, plateau, maintenance, timeline, engagementData] = await Promise.all([
        supabase.from('daily_metrics').select('date, weight_kg, water_liters, sleep_hours, steps').eq('user_id', user.id).gte('date', from).order('date'),
        // calorie_actual + workout_completed: needed to tell a REAL 0-compliance day from a
        // report row generated for a day the user never opened the app (see filterLoggedCompliance).
        supabase.from('daily_reports').select('date, compliance_score, calorie_actual, workout_completed').eq('user_id', user.id).gte('date', from).order('date'),
        detectPlateau(user.id),
        getMaintenanceStatus(user.id),
        getTimelineData(user.id),
        getEngagementMetrics(user.id),
      ]);
      const metricData = (m.data ?? []) as MetricPt[];
      setMetrics(metricData);
      const compData = (c.data ?? []) as CompPt[];
      setCompliance(compData);

      if (plateau.isInPlateau) {
        setPlateauMsg(plateau.message);
        setPlateauStatus(plateau);
        // Average over LOGGED days only — fabricated zero-days dragged the strategy heuristic down.
        const loggedComp = filterLoggedCompliance(compData, metricData);
        const avgComp = loggedComp.length > 0 ? Math.round(loggedComp.reduce((s, cc) => s + cc.compliance_score, 0) / loggedComp.length) : null;
        // FIX (ux-pass raporlar #7): read the profile via getState() instead of closing over the
        // whole store object — a new profile identity no longer recreates `load` (which re-ran the
        // focus effect and tore the screen down to the skeleton gratuitously).
        const prof = useProfileStore.getState().profile;
        const trainingStyle = (prof?.training_style as string | null) ?? null;
        const deficit = ((prof?.tdee_calculated as number) ?? 2000) - ((prof?.calorie_range_rest_min as number) ?? 1800);
        const rec = selectBestStrategy(plateau.weeksSinceChange, trainingStyle, avgComp, deficit);
        setStrategyRec(rec);
      }

      if (maintenance.isInMaintenance) {
        setMaintenanceMsg(maintenance.message);
        setMaintenanceData(maintenance);
        if (maintenance.bandStatus === 'exceeded') {
          const miniCut = shouldTriggerMiniCut(maintenance.bandStatus, maintenance.weeksSinceGoalReached >= 2 ? 2 : 1);
          if (miniCut.trigger) {
            setMiniCutOffered(true);
          }
        }
      }

      if (timeline.phases.length > 1) {
        setTimelinePhases(timeline);
      }

      setEngagement(engagementData);
      // Clear the error flag only AFTER a successful fetch — clearing it up-front made a failed
      // silent retry flash the empty new-user layout between error screens.
      setError(false);
    } catch (err) {
      // Never leave the primary Raporlar tab stuck on the spinner — a single
      // rejected promise (e.g. a network drop) must still clear loading (#R3-1).
      console.warn('[progress] load failed', err);
      setError(true); // FIX (audit UI-STA-05): surface a retry path instead of looking like an empty new-user screen
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // FIX (ux-pass raporlar #1): the tab loaded on MOUNT only — log a meal/weight elsewhere,
  // switch to Raporlar, and everything was stale. Refresh on every focus (same pattern as
  // app/(tabs)/index.tsx); the skeleton shows only on the very first load, later focuses
  // refresh silently under the existing content.
  useFocusEffect(useCallback(() => {
    if (!hasLoadedOnce.current) { hasLoadedOnce.current = true; setLoading(true); }
    load();
  }, [load]));

  // D4: Apply plateau strategy
  const handleApplyStrategy = async (strategyId: string) => {
    if (!profile || !user?.id) return;
    const currentCalorie = {
      min: (profile.calorie_range_rest_min as number) ?? 1800,
      max: (profile.calorie_range_rest_max as number) ?? 2200,
    };
    const weightKg = (profile.weight_kg as number | null) ?? null;
    const proteinPerKg = (profile.protein_per_kg as number | null) ?? null;
    const currentProtein = (weightKg && proteinPerKg) ? Math.round(weightKg * proteinPerKg) : 120;
    const result = applyPlateauStrategy(strategyId, currentCalorie, currentProtein);

    const profileUpdate: Record<string, number> = {
      calorie_range_rest_min: result.adjustedCalorie.min,
      calorie_range_rest_max: result.adjustedCalorie.max,
    };
    // protein_target_g is not a profiles column (it lives on daily_plans); persist the
    // protein intent via protein_per_kg instead so the adjusted protein is not lost.
    if (weightKg) profileUpdate.protein_per_kg = Math.round((result.adjustedProtein / weightKg) * 10) / 10;

    const { error } = await supabase.from('profiles').update(profileUpdate).eq('id', user.id);

    if (error) {
      haptics.error();
      Alert.alert('Hata', 'Strateji uygulanamadı, lütfen tekrar dene.', [{ text: 'Tamam' }]);
      return;
    }

    // Reflect the new band on today's plan now (not next roll-forward).
    await reprojectTodayPlanBand(user.id, (profile.day_boundary_hour as number) ?? 4, result.adjustedCalorie.min, result.adjustedCalorie.max, result.adjustedProtein);

    haptics.success();
    useProfileStore.getState().fetch(user.id);
    Alert.alert('Strateji Uygulandı', result.instructions, [{ text: 'Tamam' }]);
    setStrategyRec(null);
  };

  // D6: Activate mini-cut mode
  const handleMiniCut = async () => {
    if (!user?.id || !profile) return;
    setMiniCutLoading(true);
    try {
      const tdee = (profile.tdee_calculated as number) ?? 2000;
      const miniCutCalories = Math.round(tdee * 0.85);
      const currentWeight = (profile.weight_kg as number | null) ?? null;
      // A weight target keeps goal-progress math sane: without one,
      // calculateGoalProgress treated target=current → "goal reached" on day 1.
      const targetWeight = currentWeight ? Math.round((currentWeight - 1.5) * 10) / 10 : null;

      const { error: profErr } = await supabase.from('profiles').update({
        calorie_range_rest_min: miniCutCalories - 100,
        calorie_range_rest_max: miniCutCalories + 100,
      }).eq('id', user.id);
      if (profErr) throw profErr;

      // Single-active-goal invariant (migration 033): deactivate the current goal first.
      const { error: deactErr } = await supabase.from('goals').update({ is_active: false }).eq('user_id', user.id).eq('is_active', true);
      if (deactErr) throw deactErr;
      const { error: insErr } = await supabase.from('goals').insert({
        user_id: user.id,
        goal_type: 'lose_weight',
        target_weeks: 3,
        phase_label: 'Mini-Cut',
        priority: 'sustainable',
        restriction_mode: 'sustainable',
        start_weight_kg: currentWeight,
        target_weight_kg: targetWeight,
        weekly_rate: 0.5,
        is_active: true,
      });
      if (insErr) throw insErr;

      // Reflect the mini-cut band on today's plan now (not next roll-forward).
      await reprojectTodayPlanBand(user.id, (profile.day_boundary_hour as number) ?? 4, miniCutCalories - 100, miniCutCalories + 100);

      haptics.success();
      Alert.alert('Mini-Cut Başlatıldı', `3 haftalık mini-cut: ${miniCutCalories - 100}-${miniCutCalories + 100} kcal. Sonra tekrar bakıma dönersin.`);
      setMiniCutOffered(false);
    } catch (e) {
      haptics.error();
      Alert.alert('Hata', 'Mini-cut başlatılamadı, lütfen tekrar dene.\n\n' + ((e as { message?: string }).message ?? ''));
    } finally {
      setMiniCutLoading(false);
    }
  };

  if (loading) return <SkeletonScreen cards={3} topGap={insets.top} />;

  // FIX (audit UI-STA-05): when the load failed AND we have no data to show, render a
  // retry surface (matching the sibling report screens) instead of empty zero-value cards
  // that look identical to a brand-new user. Stale data, if any, is kept silently.
  if (error && metrics.length === 0 && compliance.length === 0) return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, padding: SPACING.xl }}>
      <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
      <Text style={{ color: colors.text, fontSize: FONT.lg, fontWeight: '600', marginTop: SPACING.md, textAlign: 'center' }}>Veriler yüklenemedi</Text>
      <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xs, marginBottom: SPACING.lg, textAlign: 'center' }}>Bağlantını kontrol edip tekrar dene.</Text>
      <Button title="Tekrar dene" onPress={() => { setLoading(true); load(); }} size="lg" />
    </View>
  );

  const weights = metrics.filter(m => m.weight_kg != null);
  // FIX (ux-pass raporlar #5): '5/7' style D/M labels matched nothing else in the app —
  // use the same tr-TR short form as monthly.tsx ('5 Tem'). Note: react-native-chart-kit has
  // no true time axis — points are index-spaced, so uneven gaps (4 days vs 23 days) render
  // equidistant. We do NOT fabricate interpolated points to hide that; only real logged days
  // are plotted and labeled.
  const fmtLabel = (d: string) => new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  // Cap at ~5 labels ('5 Tem' is wider than '5/7'); when data is sparse (≤5 points) every
  // real point keeps its label — no thinning.
  const labelsFor = (dates: string[]) => {
    const step = Math.max(1, Math.ceil(dates.length / 5));
    return dates.map((d, i) => (i % step === 0 ? fmtLabel(d) : ''));
  };
  const latestW = weights.length > 0 ? weights[weights.length - 1].weight_kg : null;
  const firstW = weights.length > 0 ? weights[0].weight_kg : null;
  const wChange = latestW && firstW ? latestW - firstW : null;
  // FIX (ux-pass raporlar #2/#3/#4): only days with real logs feed the uyum average, the
  // trend chart and best/worst — report rows fabricated for unlogged days are excluded.
  const loggedCompliance = filterLoggedCompliance(compliance, metrics);
  const avgComp = loggedCompliance.length > 0 ? Math.round(loggedCompliance.reduce((s, c) => s + c.compliance_score, 0) / loggedCompliance.length) : null;
  // Water: average over days the user actually logged water — averaging zeros from untouched
  // days produced the meaningless '0.0 L/gün' tile.
  const waterDays = metrics.filter(m => (m.water_liters ?? 0) > 0);
  const avgWater = waterDays.length > 0 ? (waterDays.reduce((s, m) => s + m.water_liters, 0) / waterDays.length).toFixed(1) : null;
  const sleepDays = metrics.filter(m => m.sleep_hours != null);
  const avgSleep = sleepDays.length > 0 ? (sleepDays.reduce((s, m) => s + (m.sleep_hours ?? 0), 0) / sleepDays.length).toFixed(1) : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: SPACING.md, paddingTop: insets.top + 8, paddingBottom: 100 + insets.bottom }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }} tintColor={colors.primary} />}
    >
      {/* FIX (audit UI-TAB-05): match the shared tab-title pattern (FONT.xl2/700, insets.top+8, accessibilityRole="header") used by profile.tsx + HeroSection. */}
      <Text accessibilityRole="header" style={{ fontSize: FONT.xl2, fontWeight: '700', color: colors.text, marginBottom: SPACING.md }}>Raporlar</Text>

      {/* Summary — FIX (ux-pass raporlar #2): '2 uyum' told the user nothing. compliance_score
          is a 0-100 percent (ai-report clamps it, monthly shows %X) → show it as %X and make
          every tile's period explicit (son 28 gün penceresi). */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md, gap: SPACING.sm }}>
        <SummaryBox icon="scale-outline" iconColor={colors.pink} value={latestW ? `${latestW}` : '-'} label="kg" period="son tartı" delta={wChange} />
        <SummaryBox icon="checkmark-circle-outline" iconColor={colors.success} value={avgComp != null ? `%${avgComp}` : '-'} label="uyum" period="28 gün ort." />
        <SummaryBox icon="water-outline" iconColor={METRIC_COLORS.water} value={avgWater ?? '-'} label="L/gün" period="28 gün ort." />
        <SummaryBox icon="moon-outline" iconColor={colors.purple} value={avgSleep ?? '-'} label="sa/gün" period="28 gün ort." />
      </View>

      {/* Weight Chart */}
      {weights.length >= 2 ? (
        <Card title="Kilo Trendi">
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Kilo trendi grafiği. ${weights.length} kayıt. İlk ${firstW} kilogramdan son ${latestW} kilograma.`}
          >
            <LineChart
              data={{
                // FIX (audit ui-progress-charts): labels must be SAME length as data so
                // chart-kit aligns each tick to its data index (was filtered → left-clustered).
                labels: labelsFor(weights.map(w => w.date)),
                datasets: [{ data: weights.map(w => w.weight_kg as number) }],
              }}
              width={chartWidth} height={180} chartConfig={weightChartConfig} bezier style={{ borderRadius: RADIUS.md }}
            />
          </View>
        </Card>
      ) : (
        <Card title="Kilo Trendi">
          <View style={{ alignItems: 'center', paddingVertical: SPACING.lg }}>
            <View style={{ width: 56, height: 56, borderRadius: RADIUS.lg, backgroundColor: colors.pink + '15', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm }}>
              <Ionicons name="analytics-outline" size={28} color={colors.pink} />
            </View>
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600', marginBottom: 4 }}>Henüz yeterli veri yok</Text>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>En az 2 tartı kaydı gerekli</Text>
          </View>
        </Card>
      )}

      {/* Compliance Chart — FIX (ux-pass raporlar #3): only LOGGED days are plotted (the wall of
          fabricated zeros for untracked days is gone), and the y-axis is pinned to 0-100 with %
          labels so the scale reads as the percent it is everywhere else (was auto-scaling to the
          data max, e.g. 0-20). */}
      {loggedCompliance.length >= 2 ? (
        <Card title="Uyum Puanı Trendi">
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Uyum puanı trendi grafiği. ${loggedCompliance.length} kayıtlı gün.${avgComp != null ? ` Ortalama yüzde ${avgComp}.` : ''}`}
          >
            <LineChart
              data={{
                // FIX (audit ui-progress-charts): labels veri ile EŞİT uzunlukta (sola kümelenme giderildi).
                labels: labelsFor(loggedCompliance.map(c => c.date)),
                datasets: [
                  { data: loggedCompliance.map(c => c.compliance_score) },
                  // Invisible 0/100 anchor dataset: pins chart-kit's auto-scale to the full
                  // percent range (the lib has no explicit yMin/yMax API).
                  { data: [0, 100], withDots: false, strokeWidth: 0, color: () => 'transparent' },
                ],
              }}
              width={chartWidth} height={180}
              chartConfig={{ ...chartConfig, decimalPlaces: 0 }}
              formatYLabel={(y) => `%${y}`}
              segments={5}
              fromZero
              // FIX (ux-pass5, emulator): chart-kit fills the area under EVERY dataset and has
              // no per-dataset opt-out — the invisible 0→100 scale-anchor line above got its own
              // bezier fill, ballooning a phantom area to the top-right of the card. Kill fills
              // on this chart; the line+dots carry the data.
              withShadow={false}
              bezier style={{ borderRadius: RADIUS.md }}
            />
          </View>
        </Card>
      ) : (
        <Card title="Uyum">
          <View style={{ alignItems: 'center', paddingVertical: SPACING.lg }}>
            <View style={{ width: 56, height: 56, borderRadius: RADIUS.lg, backgroundColor: colors.success + '15', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm }}>
              <Ionicons name="checkmark-circle-outline" size={28} color={colors.success} />
            </View>
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600', marginBottom: 4 }}>Henüz yeterli uyum verisi yok</Text>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>Kayıt tuttuğun günler burada görünecek</Text>
          </View>
        </Card>
      )}

      {/* Best/Worst — FIX (ux-pass raporlar #4): a day with NO logs used to get branded 'En Kötü 0'.
          Only logged days compete; with fewer than 2 logged days the card hides entirely. */}
      {loggedCompliance.length >= 2 && (
        <Card title="En İyi / En Kötü">
          {(() => {
            const sorted = [...loggedCompliance].sort((a, b) => b.compliance_score - a.compliance_score);
            const best = sorted[0]; const worst = sorted[sorted.length - 1];
            return (
              <>
                <DayRow label="En İyi" date={best.date} score={best.compliance_score} color={colors.success} />
                <DayRow label="En Kötü" date={worst.date} score={worst.compliance_score} color={colors.error} />
              </>
            );
          })()}
        </Card>
      )}

      {/* D16: Phase Timeline */}
      {timelinePhases && timelinePhases.phases.length > 1 && (
        <View style={{ marginBottom: SPACING.md }}>
          <PhaseTimeline phases={timelinePhases.phases} currentWeek={timelinePhases.currentWeek} />
        </View>
      )}

      {/* Plateau Warning + D4: Strategy Cards */}
      {plateauMsg && (
        <Card style={{ borderColor: colors.warning, borderWidth: 2, borderRadius: RADIUS.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm, gap: SPACING.sm }}>
            <View style={{ width: 36, height: 36, borderRadius: RADIUS.full, backgroundColor: colors.warningLight, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="warning" size={20} color={colors.warning} />
            </View>
            <Text style={{ color: colors.warning, fontSize: FONT.md, fontWeight: '700', flex: 1 }}>Plateau Tespiti</Text>
          </View>
          <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 20 }}>{plateauMsg}</Text>

          {/* D4: Plateau strategy recommendation cards */}
          {strategyRec && (
            <View style={{ marginTop: SPACING.md }}>
              <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, fontWeight: '700', marginBottom: SPACING.sm, letterSpacing: 1 }}>ÖNERİLEN STRATEJİLER</Text>
              <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 20, marginBottom: SPACING.sm }}>{strategyRec.reasoning}</Text>

              {/* Primary strategy */}
              <TouchableOpacity
                onPress={() => { haptics.tap(); handleApplyStrategy(strategyRec.primary.id); }}
                accessibilityRole="button"
                accessibilityLabel={`${strategyRec.primary.name} stratejisini onayla`}
                style={{
                  backgroundColor: colors.card,
                  borderRadius: RADIUS.md,
                  padding: SPACING.md,
                  marginBottom: SPACING.sm,
                  borderWidth: 0.5, borderColor: colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.xs }}>
                  <Ionicons name="flash" size={20} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontSize: FONT.md, fontWeight: '700', flex: 1 }}>{strategyRec.primary.name}</Text>
                </View>
                <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 4, lineHeight: 20 }}>{strategyRec.primary.description}</Text>
                <View style={{ backgroundColor: colors.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.sm, alignItems: 'center', marginTop: SPACING.sm }}>
                  <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '600' }}>Onayla</Text>
                </View>
              </TouchableOpacity>

              {/* Secondary strategy */}
              {strategyRec.secondary && (
                <TouchableOpacity
                  onPress={() => { haptics.tap(); handleApplyStrategy(strategyRec.secondary!.id); }}
                  accessibilityRole="button"
                  accessibilityLabel={`${strategyRec.secondary.name} stratejisini dene`}
                  style={{
                    backgroundColor: colors.card,
                    borderRadius: RADIUS.md,
                    padding: SPACING.md,
                    borderWidth: 0.5, borderColor: colors.border,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.xs }}>
                    <Ionicons name="swap-horizontal" size={20} color={colors.textSecondary} />
                    <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600', flex: 1 }}>{strategyRec.secondary.name}</Text>
                  </View>
                  <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 4, lineHeight: 20 }}>{strategyRec.secondary.description}</Text>
                  <View style={{ backgroundColor: colors.surfaceLight, borderRadius: RADIUS.md, paddingVertical: SPACING.sm, alignItems: 'center', marginTop: SPACING.sm, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>Bunu Dene</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          )}

          {!strategyRec && (
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: SPACING.sm }}>Koçunla konuşarak strateji belirleyebilirsin.</Text>
          )}
        </Card>
      )}

      {/* Maintenance Mode + D6: Mini-Cut UI */}
      {maintenanceMsg && (
        <Card style={{ borderColor: colors.success, borderWidth: 2, borderRadius: RADIUS.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm, gap: SPACING.sm }}>
            <View style={{ width: 36, height: 36, borderRadius: RADIUS.full, backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="shield-checkmark" size={20} color={colors.success} />
            </View>
            <Text style={{ color: colors.success, fontSize: FONT.md, fontWeight: '700', flex: 1 }}>Bakım Modu</Text>
          </View>
          <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 20 }}>{maintenanceMsg}</Text>

          {/* D6: Tolerance band info */}
          {maintenanceData?.toleranceBand && maintenanceData.toleranceBand.min != null && maintenanceData.toleranceBand.max != null && (
            <View style={{ marginTop: SPACING.sm, flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surfaceLight, borderRadius: RADIUS.md, padding: SPACING.sm }}>
              <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>
                Band: {maintenanceData.toleranceBand.min.toFixed(1)} - {maintenanceData.toleranceBand.max.toFixed(1)} kg
              </Text>
              <Text style={{
                // FIX (audit UI-STA-06): FONT.xs status label on surfaceLight — base error is
                // <4.5:1; use the lighter `errorText` tone. success/warning already pass AA-small.
                color: maintenanceData.bandStatus === 'in_band' ? colors.success
                  : maintenanceData.bandStatus === 'approaching_limit' ? colors.warning : colors.errorText,
                fontSize: FONT.xs, fontWeight: '600',
              }}>
                {maintenanceData.bandStatus === 'in_band' ? 'Bandda' : maintenanceData.bandStatus === 'approaching_limit' ? 'Sınıra Yakın' : 'Band Aşıldı'}
              </Text>
            </View>
          )}

          {/* D6: Mini-cut suggestion */}
          {miniCutOffered && (
            <View style={{ marginTop: SPACING.md, backgroundColor: colors.errorLight, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: colors.error }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.xs }}>
                <Ionicons name="cut" size={18} color={colors.error} />
                <Text style={{ color: colors.error, fontSize: FONT.sm, fontWeight: '700' }}>Mini-Cut Önerisi</Text>
              </View>
              <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 20, marginBottom: SPACING.sm }}>
                Tolerans bandının dışına çıktın. 2-3 haftalık hafif kalori açığı ile dengeye dönebilirsin.
              </Text>
              <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                <TouchableOpacity onPress={handleMiniCut} disabled={miniCutLoading}
                  accessibilityRole="button" accessibilityLabel="Mini-cut başlat"
                  accessibilityState={{ disabled: miniCutLoading, busy: miniCutLoading }}
                  style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: colors.primary, alignItems: 'center', opacity: miniCutLoading ? 0.6 : 1 }}>
                  {miniCutLoading
                    ? <ActivityIndicator size="small" color={getContrastColor(colors.primary)} />
                    : <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '600' }}>Mini-Cut Başlat</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { haptics.tap(); setMiniCutOffered(false); }}
                  accessibilityRole="button" accessibilityLabel="Mini-cut önerisini şimdilik kapat"
                  style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: colors.surfaceLight, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>Şimdilik Değil</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Card>
      )}

      {/* Engagement Metrics (Spec 24) */}
      {engagement && (
        <Card title="Etkileşim">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm }}>
            <View style={{ flex: 1, backgroundColor: colors.surfaceLight, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' }}>
              <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: colors.primary }}>{engagement.avgDailyMeals}</Text>
              <Text style={{ fontSize: FONT.xs, color: colors.textSecondary, marginTop: 2 }}>Öğün/Gün</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: colors.surfaceLight, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' }}>
              <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: colors.primary }}>{engagement.avgDailyMessages}</Text>
              <Text style={{ fontSize: FONT.xs, color: colors.textSecondary, marginTop: 2 }}>Mesaj/Gün</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: colors.surfaceLight, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' }}>
              <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: colors.primary }}>{engagement.featureUsage.daily_tracking ?? 0}</Text>
              <Text style={{ fontSize: FONT.xs, color: colors.textSecondary, marginTop: 2 }}>Aktif Gün</Text>
            </View>
          </View>
        </Card>
      )}

      {/* Raporlar — daily/weekly/monthly/all-time were built but had no nav entry. */}
      <Card title="Raporlar" style={{ marginTop: SPACING.sm }}>
        <ReportLink label="Gün Sonu Raporu" icon="today-outline" onPress={() => router.push('/reports/daily')} colors={colors} />
        <ReportLink label="Haftalık Rapor" icon="calendar-outline" onPress={() => router.push('/reports/weekly')} colors={colors} />
        <ReportLink label="Aylık Rapor" icon="calendar-number-outline" onPress={() => router.push('/reports/monthly')} colors={colors} />
        <ReportLink label="Tüm Zamanlar" icon="trophy-outline" onPress={() => router.push('/reports/all-time')} colors={colors} />
        <ReportLink label="Takvim Görünümü" icon="grid-outline" onPress={() => router.push('/reports/calendar')} colors={colors} last />
      </Card>
    </ScrollView>
  );
}

function ReportLink({ label, icon, onPress, colors, last }: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; colors: any; last?: boolean }) {
  return (
    <TouchableOpacity
      onPress={() => { haptics.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={`${label} raporunu aç`}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingVertical: SPACING.sm + 2, borderBottomWidth: last ? 0 : 0.5, borderBottomColor: colors.border }}
    >
      <Ionicons name={icon} size={20} color={colors.primary} style={{ marginRight: SPACING.sm }} />
      <Text style={{ flex: 1, color: colors.text, fontSize: FONT.md }}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

function SummaryBox({ icon, iconColor, value, label, period, delta }: { icon: keyof typeof Ionicons.glyphMap; iconColor?: string; value: string; label: string; period?: string; delta?: number | null }) {
  const { colors, isDark } = useTheme();
  const tint = iconColor || colors.primary;
  return (
    <View style={{
      backgroundColor: isDark ? colors.card : tint + '08',
      borderRadius: RADIUS.md,
      padding: SPACING.sm + 2,
      alignItems: 'center',
      flex: 1,
      minHeight: 95,
      justifyContent: 'center',
      borderWidth: 0.5, borderColor: colors.border,
    }}>
      <View style={{
        width: 36, height: 36, borderRadius: RADIUS.sm,
        backgroundColor: tint + '20',
        alignItems: 'center', justifyContent: 'center',
        marginBottom: SPACING.xs,
      }}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: colors.text }}>{value}</Text>
      <Text style={{ fontSize: FONT.xs, color: colors.textSecondary, marginTop: 1 }}>{label}</Text>
      {/* FIX (ux-pass raporlar #2): the period the number covers, spelled out on the tile. */}
      {period != null && <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 1, textAlign: 'center' }}>{period}</Text>}
      {/* FIX (audit UI-STA-06): at FONT.xs (11px) the base error (#E24B4A) is only 4.39:1 on
          card — below AA-small. Use the lighter `errorText` tone (>=4.5:1). success passes as-is. */}
      {delta != null && <Text style={{ fontSize: FONT.xs, fontWeight: '700', marginTop: 1, color: delta <= 0 ? colors.success : colors.errorText }}>{delta <= 0 ? '' : '+'}{delta.toFixed(1)}</Text>}
    </View>
  );
}

function DayRow({ label, date, score, color }: { label: string; date: string; score: number; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs, gap: SPACING.md }}>
      <Text style={{ fontSize: FONT.sm, fontWeight: '600', width: 50, color }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: FONT.md, flex: 1 }}>{new Date(date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' })}</Text>
      {/* FIX (ux-pass raporlar #2): bare '0'/'85' okundu — uyum her yerde yüzde, burada da öyle. */}
      <Text style={{ fontSize: FONT.lg, fontWeight: '700', color }}>%{score}</Text>
    </View>
  );
}

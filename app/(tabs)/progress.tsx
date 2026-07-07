import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, useWindowDimensions, ActivityIndicator, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LineChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
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
interface CompPt { date: string; compliance_score: number; }

// FIX (completeness audit): applying a plateau strategy / mini-cut writes the new band to profiles,
// but today's ALREADY-projected daily_plans row keeps the OLD calorie/protein targets until the next
// daily roll-forward — so the dashboard + plan the user is actually following show a stale target.
// Push the new band into today's plan row immediately (mirrors ai-chat maintenance_start /
// mini_cut_start and maintenance.service.writeReverseDietToPlan). Best-effort: RLS plans_upd lets the
// owner update; a failure here must not undo the (already-succeeded) profile change.
async function reprojectTodayPlanBand(
  userId: string,
  calMin: number,
  calMax: number,
  proteinG?: number,
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
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
    setError(false); // FIX (audit UI-STA-05): reset before each attempt
    try {
      const [m, c, plateau, maintenance, timeline, engagementData] = await Promise.all([
        supabase.from('daily_metrics').select('date, weight_kg, water_liters, sleep_hours, steps').eq('user_id', user.id).gte('date', from).order('date'),
        supabase.from('daily_reports').select('date, compliance_score').eq('user_id', user.id).gte('date', from).order('date'),
        detectPlateau(user.id),
        getMaintenanceStatus(user.id),
        getTimelineData(user.id),
        getEngagementMetrics(user.id),
      ]);
      setMetrics((m.data ?? []) as MetricPt[]);
      const compData = (c.data ?? []) as CompPt[];
      setCompliance(compData);

      if (plateau.isInPlateau) {
        setPlateauMsg(plateau.message);
        setPlateauStatus(plateau);
        const avgComp = compData.length > 0 ? Math.round(compData.reduce((s, cc) => s + cc.compliance_score, 0) / compData.length) : null;
        const trainingStyle = profile?.training_style as string | null ?? null;
        const deficit = (profile?.tdee_calculated as number ?? 2000) - (profile?.calorie_range_rest_min as number ?? 1800);
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
    } catch (err) {
      // Never leave the primary Raporlar tab stuck on the spinner — a single
      // rejected promise (e.g. a network drop) must still clear loading (#R3-1).
      console.warn('[progress] load failed', err);
      setError(true); // FIX (audit UI-STA-05): surface a retry path instead of looking like an empty new-user screen
    } finally {
      setLoading(false);
    }
  }, [user?.id, profile]);

  useEffect(() => { setLoading(true); load(); }, [load]);

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
    await reprojectTodayPlanBand(user.id, result.adjustedCalorie.min, result.adjustedCalorie.max, result.adjustedProtein);

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
      await reprojectTodayPlanBand(user.id, miniCutCalories - 100, miniCutCalories + 100);

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
  const fmtLabel = (d: string) => `${new Date(d).getDate()}/${new Date(d).getMonth() + 1}`;
  const latestW = weights.length > 0 ? weights[weights.length - 1].weight_kg : null;
  const firstW = weights.length > 0 ? weights[0].weight_kg : null;
  const wChange = latestW && firstW ? latestW - firstW : null;
  const avgComp = compliance.length > 0 ? Math.round(compliance.reduce((s, c) => s + c.compliance_score, 0) / compliance.length) : null;
  const avgWater = metrics.length > 0 ? (metrics.reduce((s, m) => s + m.water_liters, 0) / metrics.length).toFixed(1) : null;
  const sleepDays = metrics.filter(m => m.sleep_hours != null);
  const avgSleep = sleepDays.length > 0 ? (sleepDays.reduce((s, m) => s + (m.sleep_hours ?? 0), 0) / sleepDays.length).toFixed(1) : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: SPACING.md, paddingTop: insets.top + 8, paddingBottom: 100 + insets.bottom }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { setLoading(true); load(); }} tintColor={colors.primary} />}
    >
      {/* FIX (audit UI-TAB-05): match the shared tab-title pattern (FONT.xl2/700, insets.top+8, accessibilityRole="header") used by profile.tsx + HeroSection. */}
      <Text accessibilityRole="header" style={{ fontSize: FONT.xl2, fontWeight: '700', color: colors.text, marginBottom: SPACING.md }}>Raporlar</Text>

      {/* Summary */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md, gap: SPACING.sm }}>
        <SummaryBox icon="scale-outline" iconColor={colors.pink} value={latestW ? `${latestW}` : '-'} label="kg" delta={wChange} />
        <SummaryBox icon="checkmark-circle-outline" iconColor={colors.success} value={avgComp != null ? `${avgComp}` : '-'} label="uyum" />
        <SummaryBox icon="water-outline" iconColor={METRIC_COLORS.water} value={avgWater ?? '-'} label="L/gün" />
        <SummaryBox icon="moon-outline" iconColor={colors.purple} value={avgSleep ?? '-'} label="sa/gün" />
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
                labels: (() => { const step = Math.max(1, Math.floor(weights.length / 5)); return weights.map((w, i) => (i % step === 0 ? fmtLabel(w.date) : '')); })(),
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

      {/* Compliance Chart */}
      {compliance.length >= 2 ? (
        <Card title="Uyum Puanı Trendi">
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Uyum puanı trendi grafiği. ${compliance.length} kayıt.${avgComp != null ? ` Ortalama ${avgComp} puan.` : ''}`}
          >
            <LineChart
              data={{
                // FIX (audit ui-progress-charts): labels veri ile EŞİT uzunlukta (sola kümelenme giderildi).
                labels: (() => { const step = Math.max(1, Math.floor(compliance.length / 5)); return compliance.map((c, i) => (i % step === 0 ? fmtLabel(c.date) : '')); })(),
                datasets: [{ data: compliance.map(c => c.compliance_score) }],
              }}
              width={chartWidth} height={180}
              chartConfig={chartConfig}
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
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600', marginBottom: 4 }}>Henüz rapor yok</Text>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>Gün sonu raporları oluşturuldukça görünecek</Text>
          </View>
        </Card>
      )}

      {/* Best/Worst */}
      {compliance.length > 0 && (
        <Card title="En İyi / En Kötü">
          {(() => {
            const sorted = [...compliance].sort((a, b) => b.compliance_score - a.compliance_score);
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

function SummaryBox({ icon, iconColor, value, label, delta }: { icon: keyof typeof Ionicons.glyphMap; iconColor?: string; value: string; label: string; delta?: number | null }) {
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
      <Text style={{ fontSize: FONT.lg, fontWeight: '700', color }}>{score}</Text>
    </View>
  );
}

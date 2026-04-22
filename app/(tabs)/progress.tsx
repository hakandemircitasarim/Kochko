import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Dimensions, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
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
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';

const chartWidth = Dimensions.get('window').width - SPACING.md * 4;

interface MetricPt { date: string; weight_kg: number | null; water_liters: number; sleep_hours: number | null; steps: number | null; }
interface CompPt { date: string; compliance_score: number; }

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const [metrics, setMetrics] = useState<MetricPt[]>([]);
  const [compliance, setCompliance] = useState<CompPt[]>([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    if (!user?.id) return;
    const from = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
    Promise.all([
      supabase.from('daily_metrics').select('date, weight_kg, water_liters, sleep_hours, steps').eq('user_id', user.id).gte('date', from).order('date'),
      supabase.from('daily_reports').select('date, compliance_score').eq('user_id', user.id).gte('date', from).order('date'),
      detectPlateau(user.id),
      getMaintenanceStatus(user.id),
      getTimelineData(user.id),
      getEngagementMetrics(user.id),
    ]).then(([m, c, plateau, maintenance, timeline, engagementData]) => {
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

      setLoading(false);
    });
  }, [user?.id, profile]);

  // D4: Apply plateau strategy
  const handleApplyStrategy = async (strategyId: string) => {
    if (!profile || !user?.id) return;
    const currentCalorie = {
      min: (profile.calorie_range_rest_min as number) ?? 1800,
      max: (profile.calorie_range_rest_max as number) ?? 2200,
    };
    const currentProtein = (profile.protein_target_g as number) ?? 120;
    const result = applyPlateauStrategy(strategyId, currentCalorie, currentProtein);

    await supabase.from('profiles').update({
      calorie_range_rest_min: result.adjustedCalorie.min,
      calorie_range_rest_max: result.adjustedCalorie.max,
      protein_target_g: result.adjustedProtein,
    }).eq('id', user.id);

    useProfileStore.getState().fetch(user.id);
    Alert.alert('Strateji Uygulandı', result.instructions, [{ text: 'Tamam' }]);
    setStrategyRec(null);
  };

  // D6: Activate mini-cut mode
  const handleMiniCut = async () => {
    if (!user?.id || !profile) return;
    setMiniCutLoading(true);
    const tdee = (profile.tdee_calculated as number) ?? 2000;
    const miniCutCalories = Math.round(tdee * 0.85);

    await supabase.from('profiles').update({
      calorie_range_rest_min: miniCutCalories - 100,
      calorie_range_rest_max: miniCutCalories + 100,
    }).eq('id', user.id);

    await supabase.from('goals').insert({
      user_id: user.id,
      goal_type: 'lose_weight',
      target_weeks: 3,
      phase_label: 'Mini-Cut',
      priority: 'sustainable',
      restriction_mode: 'sustainable',
      is_active: true,
    });

    Alert.alert('Mini-Cut Başlatıldı', `3 haftalık mini-cut: ${miniCutCalories - 100}-${miniCutCalories + 100} kcal. Sonra tekrar bakıma dönersin.`);
    setMiniCutOffered(false);
    setMiniCutLoading(false);
  };

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}><ActivityIndicator size="large" color={colors.primary} /></View>;

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
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: SPACING.md }}>Raporlar</Text>

      {/* Summary */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md, gap: SPACING.sm }}>
        <SummaryBox icon="scale-outline" iconColor="#EC4899" value={latestW ? `${latestW}` : '-'} label="kg" delta={wChange} />
        <SummaryBox icon="checkmark-circle-outline" iconColor="#22C55E" value={avgComp != null ? `${avgComp}` : '-'} label="uyum" />
        <SummaryBox icon="water-outline" iconColor="#56CCF2" value={avgWater ?? '-'} label="L/gün" />
        <SummaryBox icon="moon-outline" iconColor="#7F77DD" value={avgSleep ?? '-'} label="sa/gün" />
      </View>

      {/* Weight Chart */}
      {weights.length >= 2 ? (
        <Card title="Kilo Trendi">
          <LineChart
            data={{
              labels: weights.filter((_, i) => i % Math.max(1, Math.floor(weights.length / 5)) === 0).map(w => fmtLabel(w.date)),
              datasets: [{ data: weights.map(w => w.weight_kg as number) }],
            }}
            width={chartWidth} height={180} chartConfig={chartConfig} bezier style={{ borderRadius: RADIUS.md }}
          />
        </Card>
      ) : (
        <Card title="Kilo Trendi">
          <View style={{ alignItems: 'center', paddingVertical: SPACING.lg }}>
            <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: '#EC489915', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm }}>
              <Ionicons name="analytics-outline" size={28} color="#EC4899" />
            </View>
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600', marginBottom: 4 }}>Henüz yeterli veri yok</Text>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>En az 2 tartı kaydı gerekli</Text>
          </View>
        </Card>
      )}

      {/* Compliance Chart */}
      {compliance.length >= 2 ? (
        <Card title="Uyum Puani Trendi">
          <LineChart
            data={{
              labels: compliance.filter((_, i) => i % Math.max(1, Math.floor(compliance.length / 5)) === 0).map(c => fmtLabel(c.date)),
              datasets: [{ data: compliance.map(c => c.compliance_score) }],
            }}
            width={chartWidth} height={180}
            chartConfig={{ ...chartConfig, color: (o = 1) => `rgba(76, 175, 80, ${o})` }}
            bezier style={{ borderRadius: RADIUS.md }}
          />
        </Card>
      ) : (
        <Card title="Uyum">
          <View style={{ alignItems: 'center', paddingVertical: SPACING.lg }}>
            <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: '#22C55E15', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm }}>
              <Ionicons name="checkmark-circle-outline" size={28} color="#22C55E" />
            </View>
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '600', marginBottom: 4 }}>Henüz rapor yok</Text>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>Gün sonu raporları oluşturuldukça görünecek</Text>
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
        <Card style={{ borderColor: colors.warning, borderWidth: 2, borderRadius: RADIUS.xl }}>
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
                onPress={() => handleApplyStrategy(strategyRec.primary.id)}
                style={{
                  backgroundColor: colors.card,
                  borderRadius: RADIUS.xl,
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
                  <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600' }}>Onayla</Text>
                </View>
              </TouchableOpacity>

              {/* Secondary strategy */}
              {strategyRec.secondary && (
                <TouchableOpacity
                  onPress={() => handleApplyStrategy(strategyRec.secondary!.id)}
                  style={{
                    backgroundColor: colors.card,
                    borderRadius: RADIUS.xl,
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
        <Card style={{ borderColor: colors.success, borderWidth: 2, borderRadius: RADIUS.xl }}>
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
              <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
                Band: {maintenanceData.toleranceBand.min.toFixed(1)} - {maintenanceData.toleranceBand.max.toFixed(1)} kg
              </Text>
              <Text style={{
                color: maintenanceData.bandStatus === 'in_band' ? colors.success
                  : maintenanceData.bandStatus === 'approaching_limit' ? colors.warning : colors.error,
                fontSize: FONT.xs, fontWeight: '600',
              }}>
                {maintenanceData.bandStatus === 'in_band' ? 'Bandda' : maintenanceData.bandStatus === 'approaching_limit' ? 'Sınıra Yakın' : 'Band Aşıldı'}
              </Text>
            </View>
          )}

          {/* D6: Mini-cut suggestion */}
          {miniCutOffered && (
            <View style={{ marginTop: SPACING.md, backgroundColor: colors.errorLight, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: colors.error }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.xs }}>
                <Ionicons name="cut" size={18} color={colors.error} />
                <Text style={{ color: colors.error, fontSize: FONT.sm, fontWeight: '700' }}>Mini-Cut Önerisi</Text>
              </View>
              <Text style={{ color: colors.text, fontSize: FONT.sm, lineHeight: 20, marginBottom: SPACING.sm }}>
                Tolerans bandının dışına çıktın. 2-3 haftalık hafif kalori açığı ile dengeye dönebilirsin.
              </Text>
              <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                <TouchableOpacity onPress={handleMiniCut} disabled={miniCutLoading}
                  style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: colors.primary, alignItems: 'center', opacity: miniCutLoading ? 0.6 : 1 }}>
                  {miniCutLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600' }}>Mini-Cut Başlat</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setMiniCutOffered(false)}
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
            <View style={{ flex: 1, backgroundColor: colors.surfaceLight, borderRadius: RADIUS.lg, padding: SPACING.md, alignItems: 'center' }}>
              <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: colors.primary }}>{engagement.avgDailyMeals}</Text>
              <Text style={{ fontSize: FONT.xs, color: colors.textMuted, marginTop: 2 }}>Öğün/Gün</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: colors.surfaceLight, borderRadius: RADIUS.lg, padding: SPACING.md, alignItems: 'center' }}>
              <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: colors.primary }}>{engagement.avgDailyMessages}</Text>
              <Text style={{ fontSize: FONT.xs, color: colors.textMuted, marginTop: 2 }}>Mesaj/Gün</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: colors.surfaceLight, borderRadius: RADIUS.lg, padding: SPACING.md, alignItems: 'center' }}>
              <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: colors.primary }}>{engagement.featureUsage.daily_tracking ?? 0}</Text>
              <Text style={{ fontSize: FONT.xs, color: colors.textMuted, marginTop: 2 }}>Aktif Gün</Text>
            </View>
          </View>
        </Card>
      )}

      {/* Calendar Link */}
      <Button
        title="Takvim Görünümü"
        variant="outline"
        onPress={() => router.push('/reports/calendar')}
        style={{ marginTop: SPACING.sm }}
      />
    </ScrollView>
  );
}

function SummaryBox({ icon, iconColor, value, label, delta }: { icon: keyof typeof Ionicons.glyphMap; iconColor?: string; value: string; label: string; delta?: number | null }) {
  const { colors, isDark } = useTheme();
  const tint = iconColor || colors.primary;
  return (
    <View style={{
      backgroundColor: isDark ? colors.card : tint + '08',
      borderRadius: RADIUS.xl,
      padding: SPACING.sm + 2,
      alignItems: 'center',
      flex: 1,
      minHeight: 95,
      justifyContent: 'center',
      borderWidth: 0.5, borderColor: colors.border,
    }}>
      <View style={{
        width: 36, height: 36, borderRadius: 10,
        backgroundColor: tint + '20',
        alignItems: 'center', justifyContent: 'center',
        marginBottom: SPACING.xs,
      }}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: colors.text }}>{value}</Text>
      <Text style={{ fontSize: FONT.xs, color: colors.textMuted, marginTop: 1 }}>{label}</Text>
      {delta != null && <Text style={{ fontSize: FONT.xs, fontWeight: '700', marginTop: 1, color: delta <= 0 ? colors.success : colors.error }}>{delta <= 0 ? '' : '+'}{delta.toFixed(1)}</Text>}
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

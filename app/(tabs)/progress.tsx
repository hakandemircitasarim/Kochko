import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Dimensions, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { LineChart } from 'react-native-chart-kit';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { detectPlateau, selectBestStrategy, applyPlateauStrategy, type PlateauStatus, type PlateauStrategy, type StrategyRecommendation } from '@/services/plateau.service';
import { getMaintenanceStatus, shouldTriggerMiniCut, type MaintenanceStatus } from '@/services/maintenance.service';
import { getTimelineData } from '@/services/goals.service';
import { PhaseTimeline } from '@/components/plan/PhaseTimeline';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const chartWidth = Dimensions.get('window').width - SPACING.md * 4;
const chartConfig = {
  backgroundGradientFrom: COLORS.card,
  backgroundGradientTo: COLORS.card,
  decimalPlaces: 1,
  color: (o = 1) => `rgba(108, 99, 255, ${o})`,
  labelColor: () => COLORS.textSecondary,
  propsForDots: { r: '3', strokeWidth: '1.5', stroke: COLORS.primary },
  propsForBackgroundLines: { stroke: COLORS.border },
};

interface MetricPt { date: string; weight_kg: number | null; water_liters: number; sleep_hours: number | null; steps: number | null; }
interface CompPt { date: string; compliance_score: number; }

export default function ProgressScreen() {
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
  const [timelinePhases, setTimelinePhases] = useState<{ phases: { id: string; label: string; goalType: string; targetWeeks: number; isActive: boolean; isCompleted: boolean }[]; currentWeek: number } | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    const from = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
    Promise.all([
      supabase.from('daily_metrics').select('date, weight_kg, water_liters, sleep_hours, steps').eq('user_id', user.id).gte('date', from).order('date'),
      supabase.from('daily_reports').select('date, compliance_score').eq('user_id', user.id).gte('date', from).order('date'),
      detectPlateau(user.id),
      getMaintenanceStatus(user.id),
      getTimelineData(user.id),
    ]).then(([m, c, plateau, maintenance, timeline]) => {
      setMetrics((m.data ?? []) as MetricPt[]);
      const compData = (c.data ?? []) as CompPt[];
      setCompliance(compData);

      if (plateau.isInPlateau) {
        setPlateauMsg(plateau.message);
        setPlateauStatus(plateau);
        // Calculate best strategy recommendation
        const avgComp = compData.length > 0 ? Math.round(compData.reduce((s, cc) => s + cc.compliance_score, 0) / compData.length) : null;
        const trainingStyle = profile?.training_style as string | null ?? null;
        const deficit = (profile?.tdee_calculated as number ?? 2000) - (profile?.calorie_range_rest_min as number ?? 1800);
        const rec = selectBestStrategy(plateau.weeksSinceChange, trainingStyle, avgComp, deficit);
        setStrategyRec(rec);
      }

      if (maintenance.isInMaintenance) {
        setMaintenanceMsg(maintenance.message);
        setMaintenanceData(maintenance);
        // D6: Check if mini-cut should be triggered
        if (maintenance.bandStatus === 'exceeded') {
          // Count weeks exceeded from maintenance data
          const miniCut = shouldTriggerMiniCut(maintenance.bandStatus, maintenance.weeksSinceGoalReached >= 2 ? 2 : 1);
          if (miniCut.trigger) {
            setMiniCutOffered(true);
          }
        }
      }

      // D16: PhaseTimeline data
      if (timeline.phases.length > 1) {
        setTimelinePhases(timeline);
      }

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

    // Update profile with adjusted calories
    await supabase.from('profiles').update({
      calorie_range_rest_min: result.adjustedCalorie.min,
      calorie_range_rest_max: result.adjustedCalorie.max,
      protein_target_g: result.adjustedProtein,
    }).eq('id', user.id);

    Alert.alert('Strateji Uygulandi', result.instructions, [{ text: 'Tamam' }]);
    setStrategyRec(null);
  };

  // D6: Activate mini-cut mode
  const handleMiniCut = async () => {
    if (!user?.id || !profile) return;
    const tdee = (profile.tdee_calculated as number) ?? 2000;
    const miniCutCalories = Math.round(tdee * 0.85); // 15% deficit for mini-cut

    await supabase.from('profiles').update({
      calorie_range_rest_min: miniCutCalories - 100,
      calorie_range_rest_max: miniCutCalories + 100,
    }).eq('id', user.id);

    // Create a temporary mini-cut goal
    await supabase.from('goals').insert({
      user_id: user.id,
      goal_type: 'lose_weight',
      target_weeks: 3,
      phase_label: 'Mini-Cut',
      priority: 'sustainable',
      restriction_mode: 'sustainable',
      is_active: true,
    });

    Alert.alert('Mini-Cut Baslatildi', `3 haftalik mini-cut: ${miniCutCalories - 100}-${miniCutCalories + 100} kcal. Sonra tekrar bakima donersin.`);
    setMiniCutOffered(false);
  };

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

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
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Ilerleme</Text>

      {/* Summary */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.lg }}>
        <SummaryBox value={latestW ? `${latestW}` : '-'} label="kg" delta={wChange} />
        <SummaryBox value={avgComp != null ? `${avgComp}` : '-'} label="uyum" />
        <SummaryBox value={avgWater ?? '-'} label="L/gun" />
        <SummaryBox value={avgSleep ?? '-'} label="sa/gun" />
      </View>

      {/* Weight Chart */}
      {weights.length >= 2 ? (
        <Card title="Kilo Trendi">
          <LineChart
            data={{
              labels: weights.filter((_, i) => i % Math.max(1, Math.floor(weights.length / 5)) === 0).map(w => fmtLabel(w.date)),
              datasets: [{ data: weights.map(w => w.weight_kg as number) }],
            }}
            width={chartWidth} height={180} chartConfig={chartConfig} bezier style={{ borderRadius: 12 }}
          />
        </Card>
      ) : (
        <Card title="Kilo Trendi"><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>En az 2 tarti kaydı gerekli.</Text></Card>
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
            bezier style={{ borderRadius: 12 }}
          />
        </Card>
      ) : (
        <Card title="Uyum"><Text style={{ color: COLORS.textMuted, fontSize: FONT.sm }}>Gun sonu raporlari olusturuldukca gorunecek.</Text></Card>
      )}

      {/* Best/Worst */}
      {compliance.length > 0 && (
        <Card title="En Iyi / En Kotu">
          {(() => {
            const sorted = [...compliance].sort((a, b) => b.compliance_score - a.compliance_score);
            const best = sorted[0]; const worst = sorted[sorted.length - 1];
            return (
              <>
                <DayRow label="En Iyi" date={best.date} score={best.compliance_score} color={COLORS.success} />
                <DayRow label="En Kotu" date={worst.date} score={worst.compliance_score} color={COLORS.error} />
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
        <Card style={{ borderColor: COLORS.warning, borderWidth: 2 }}>
          <Text style={{ color: COLORS.warning, fontSize: FONT.sm, fontWeight: '600', marginBottom: SPACING.xs }}>Plateau Tespiti</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>{plateauMsg}</Text>

          {/* D4: Plateau strategy recommendation cards */}
          {strategyRec && (
            <View style={{ marginTop: SPACING.md }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm }}>ONERILEN STRATEJILER</Text>
              <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20, marginBottom: SPACING.sm }}>{strategyRec.reasoning}</Text>

              {/* Primary strategy */}
              <TouchableOpacity
                onPress={() => handleApplyStrategy(strategyRec.primary.id)}
                style={{ backgroundColor: COLORS.card, borderRadius: 10, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 2, borderColor: COLORS.primary }}
              >
                <Text style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '700' }}>{strategyRec.primary.name}</Text>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: 4, lineHeight: 20 }}>{strategyRec.primary.description}</Text>
                <View style={{ backgroundColor: COLORS.primary, borderRadius: 8, paddingVertical: SPACING.sm, alignItems: 'center', marginTop: SPACING.sm }}>
                  <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600' }}>Onayla</Text>
                </View>
              </TouchableOpacity>

              {/* Secondary strategy */}
              {strategyRec.secondary && (
                <TouchableOpacity
                  onPress={() => handleApplyStrategy(strategyRec.secondary!.id)}
                  style={{ backgroundColor: COLORS.card, borderRadius: 10, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}
                >
                  <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{strategyRec.secondary.name}</Text>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: 4, lineHeight: 20 }}>{strategyRec.secondary.description}</Text>
                  <View style={{ backgroundColor: COLORS.surfaceLight, borderRadius: 8, paddingVertical: SPACING.sm, alignItems: 'center', marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.border }}>
                    <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>Bunu Dene</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          )}

          {!strategyRec && (
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.sm }}>Kocunla konusarak strateji belirleyebilirsin.</Text>
          )}
        </Card>
      )}

      {/* Maintenance Mode + D6: Mini-Cut UI */}
      {maintenanceMsg && (
        <Card style={{ borderColor: COLORS.success, borderWidth: 2 }}>
          <Text style={{ color: COLORS.success, fontSize: FONT.sm, fontWeight: '600', marginBottom: SPACING.xs }}>Bakim Modu</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>{maintenanceMsg}</Text>

          {/* D6: Tolerance band info */}
          {maintenanceData?.toleranceBand && (
            <View style={{ marginTop: SPACING.sm, flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>
                Band: {maintenanceData.toleranceBand.min.toFixed(1)} - {maintenanceData.toleranceBand.max.toFixed(1)} kg
              </Text>
              <Text style={{
                color: maintenanceData.bandStatus === 'in_band' ? COLORS.success
                  : maintenanceData.bandStatus === 'approaching_limit' ? COLORS.warning : COLORS.error,
                fontSize: FONT.xs, fontWeight: '600',
              }}>
                {maintenanceData.bandStatus === 'in_band' ? 'Bandda' : maintenanceData.bandStatus === 'approaching_limit' ? 'Sinira Yakin' : 'Band Asildi'}
              </Text>
            </View>
          )}

          {/* D6: Mini-cut suggestion */}
          {miniCutOffered && (
            <View style={{ marginTop: SPACING.md, backgroundColor: COLORS.surfaceLight, borderRadius: 10, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.error }}>
              <Text style={{ color: COLORS.error, fontSize: FONT.sm, fontWeight: '600', marginBottom: SPACING.xs }}>Mini-Cut Onerisi</Text>
              <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20, marginBottom: SPACING.sm }}>
                Tolerans bandinin disina ciktin. 2-3 haftalik hafif kalori acigi ile dengeye donebilirsin.
              </Text>
              <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                <TouchableOpacity onPress={handleMiniCut}
                  style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: 8, backgroundColor: COLORS.primary, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600' }}>Mini-Cut Baslat</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setMiniCutOffered(false)}
                  style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: 8, backgroundColor: COLORS.surfaceLight, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>Simdilik Degil</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Card>
      )}

      {/* Calendar Link */}
      <Button
        title="Takvim Gorunumu"
        variant="outline"
        onPress={() => router.push('/reports/calendar')}
        style={{ marginTop: SPACING.sm }}
      />
    </ScrollView>
  );
}

function SummaryBox({ value, label, delta }: { value: string; label: string; delta?: number | null }) {
  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, alignItems: 'center', flex: 1, marginHorizontal: 3, borderWidth: 1, borderColor: COLORS.border }}>
      <Text style={{ fontSize: FONT.xl, fontWeight: '700', color: COLORS.primary }}>{value}</Text>
      <Text style={{ fontSize: FONT.xs, color: COLORS.textSecondary, marginTop: 2 }}>{label}</Text>
      {delta != null && <Text style={{ fontSize: FONT.xs, fontWeight: '600', marginTop: 2, color: delta <= 0 ? COLORS.success : COLORS.error }}>{delta <= 0 ? '' : '+'}{delta.toFixed(1)}</Text>}
    </View>
  );
}

function DayRow({ label, date, score, color }: { label: string; date: string; score: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs, gap: SPACING.md }}>
      <Text style={{ fontSize: FONT.sm, fontWeight: '600', width: 50, color }}>{label}</Text>
      <Text style={{ color: COLORS.text, fontSize: FONT.md, flex: 1 }}>{new Date(date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' })}</Text>
      <Text style={{ fontSize: FONT.lg, fontWeight: '700', color }}>{score}</Text>
    </View>
  );
}

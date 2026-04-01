import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Dimensions, ActivityIndicator, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { LineChart } from 'react-native-chart-kit';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { detectPlateau, selectBestStrategy, applyPlateauStrategy } from '@/services/plateau.service';
import type { PlateauStatus, StrategyRecommendation } from '@/services/plateau.service';
import { getMaintenanceStatus } from '@/services/maintenance.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { PhaseTimeline } from '@/components/plan/PhaseTimeline';

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
  const [metrics, setMetrics] = useState<MetricPt[]>([]);
  const [compliance, setCompliance] = useState<CompPt[]>([]);
  const [loading, setLoading] = useState(true);
  const [plateauMsg, setPlateauMsg] = useState<string | null>(null);
  const [plateauStatus, setPlateauStatus] = useState<PlateauStatus | null>(null);
  const [strategyRec, setStrategyRec] = useState<StrategyRecommendation | null>(null);
  const [strategyApplied, setStrategyApplied] = useState(false);
  const [maintenanceMsg, setMaintenanceMsg] = useState<string | null>(null);
  const [phases, setPhases] = useState<{ id: string; label: string; goalType: string; targetWeeks: number; isActive: boolean; isCompleted: boolean }[]>([]);
  const [currentWeek, setCurrentWeek] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    const from = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
    Promise.all([
      supabase.from('daily_metrics').select('date, weight_kg, water_liters, sleep_hours, steps').eq('user_id', user.id).gte('date', from).order('date'),
      supabase.from('daily_reports').select('date, compliance_score').eq('user_id', user.id).gte('date', from).order('date'),
      detectPlateau(user.id),
      getMaintenanceStatus(user.id),
      supabase.from('goals').select('id, goal_type, target_weeks, phase_order, phase_label, is_active, created_at').eq('user_id', user.id).not('phase_order', 'is', null).order('phase_order', { ascending: true }),
    ]).then(([m, c, plateau, maintenance, phasesResult]) => {
      setMetrics((m.data ?? []) as MetricPt[]);
      setCompliance((c.data ?? []) as CompPt[]);
      if (plateau.isInPlateau) setPlateauMsg(plateau.message);
      if (maintenance.isInMaintenance) setMaintenanceMsg(maintenance.message);

      const rawPhases = (phasesResult.data ?? []) as { id: string; goal_type: string; target_weeks: number | null; phase_order: number; phase_label: string | null; is_active: boolean; created_at: string }[];
      if (rawPhases.length > 1) {
        const activePhase = rawPhases.find(p => p.is_active);
        const week = activePhase
          ? Math.max(1, Math.round((Date.now() - new Date(activePhase.created_at).getTime()) / (7 * 86400000)))
          : 0;
        setCurrentWeek(week);
        setPhases(rawPhases.map((p, i) => ({
          id: p.id,
          label: p.phase_label ?? p.goal_type,
          goalType: p.goal_type,
          targetWeeks: p.target_weeks ?? 12,
          isActive: p.is_active,
          isCompleted: !p.is_active && activePhase ? p.phase_order < activePhase.phase_order : false,
        })));
      }

      setLoading(false);
    });
  }, [user?.id]);

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

      {/* Phase Timeline */}
      {phases.length > 1 && (
        <View style={{ marginBottom: SPACING.md }}>
          <PhaseTimeline phases={phases} currentWeek={currentWeek} />
        </View>
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

      {/* Plateau Warning */}
      {plateauMsg && (
        <Card style={{ borderColor: COLORS.warning, borderWidth: 2 }}>
          <Text style={{ color: COLORS.warning, fontSize: FONT.sm, fontWeight: '600', marginBottom: SPACING.xs }}>Plateau Tespiti</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>{plateauMsg}</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.sm }}>Kocunla konusarak strateji belirleyebilirsin.</Text>
        </Card>
      )}

      {/* Maintenance Mode */}
      {maintenanceMsg && (
        <Card style={{ borderColor: COLORS.success, borderWidth: 2 }}>
          <Text style={{ color: COLORS.success, fontSize: FONT.sm, fontWeight: '600', marginBottom: SPACING.xs }}>Bakim Modu</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>{maintenanceMsg}</Text>
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

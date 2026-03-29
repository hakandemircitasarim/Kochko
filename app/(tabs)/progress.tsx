/**
 * Progress Screen — Spec 8.5: Görsel Dashboard
 * Shows all 14 trend visualizations: weight, compliance, calories,
 * protein, water, sleep, steps, mood, weekly budget, goal progress,
 * plus plateau/maintenance alerts.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Dimensions, ActivityIndicator, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { LineChart } from 'react-native-chart-kit';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { detectPlateau } from '@/services/plateau.service';
import { getMaintenanceStatus } from '@/services/maintenance.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const W = Dimensions.get('window').width - SPACING.md * 4;
const baseChart = {
  backgroundGradientFrom: COLORS.card,
  backgroundGradientTo: COLORS.card,
  decimalPlaces: 1,
  labelColor: () => COLORS.textSecondary,
  propsForDots: { r: '2.5', strokeWidth: '1', stroke: COLORS.primary },
  propsForBackgroundLines: { stroke: COLORS.border },
};
const purple = (o = 1) => `rgba(108,99,255,${o})`;
const green = (o = 1) => `rgba(76,175,80,${o})`;
const blue = (o = 1) => `rgba(33,150,243,${o})`;
const orange = (o = 1) => `rgba(255,152,0,${o})`;
const pink = (o = 1) => `rgba(233,30,99,${o})`;
const teal = (o = 1) => `rgba(0,150,136,${o})`;

interface MetricPt { date: string; weight_kg: number | null; water_liters: number; sleep_hours: number | null; steps: number | null; mood_score: number | null; }
interface ReportPt { date: string; compliance_score: number; calorie_actual: number; protein_actual: number; }
interface GoalData { target_weight_kg: number | null; goal_type: string; }

export default function ProgressScreen() {
  const user = useAuthStore(s => s.user);
  const [metrics, setMetrics] = useState<MetricPt[]>([]);
  const [reports, setReports] = useState<ReportPt[]>([]);
  const [goal, setGoal] = useState<GoalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [plateauMsg, setPlateauMsg] = useState<string | null>(null);
  const [maintenanceMsg, setMaintenanceMsg] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['weight', 'compliance']));

  const toggle = (key: string) => setExpandedSections(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  useEffect(() => {
    if (!user?.id) return;
    const from = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
    Promise.all([
      supabase.from('daily_metrics').select('date, weight_kg, water_liters, sleep_hours, steps, mood_score').eq('user_id', user.id).gte('date', from).order('date'),
      supabase.from('daily_reports').select('date, compliance_score, calorie_actual, protein_actual').eq('user_id', user.id).gte('date', from).order('date'),
      supabase.from('goals').select('target_weight_kg, goal_type').eq('user_id', user.id).eq('is_active', true).limit(1).single(),
      detectPlateau(user.id),
      getMaintenanceStatus(user.id),
    ]).then(([m, r, g, plateau, maint]) => {
      setMetrics((m.data ?? []) as MetricPt[]);
      setReports((r.data ?? []) as ReportPt[]);
      if (g.data) setGoal(g.data as GoalData);
      if (plateau.isInPlateau) setPlateauMsg(plateau.message);
      if (maint.isInMaintenance) setMaintenanceMsg(maint.message);
      setLoading(false);
    });
  }, [user?.id]);

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  const fmtLabel = (d: string) => `${new Date(d).getDate()}/${new Date(d).getMonth() + 1}`;
  const weights = metrics.filter(m => m.weight_kg != null);
  const latestW = weights.length > 0 ? weights[weights.length - 1].weight_kg : null;
  const firstW = weights.length > 0 ? weights[0].weight_kg : null;
  const wChange = latestW && firstW ? latestW - firstW : null;
  const avgComp = reports.length > 0 ? Math.round(reports.reduce((s, c) => s + c.compliance_score, 0) / reports.length) : null;
  const avgWater = metrics.length > 0 ? (metrics.reduce((s, m) => s + m.water_liters, 0) / metrics.length).toFixed(1) : null;
  const sleepDays = metrics.filter(m => m.sleep_hours != null);
  const avgSleep = sleepDays.length > 0 ? (sleepDays.reduce((s, m) => s + (m.sleep_hours ?? 0), 0) / sleepDays.length).toFixed(1) : null;

  function makeLabels(data: { date: string }[]) {
    return data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 5)) === 0).map(d => fmtLabel(d.date));
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Ilerleme</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.lg }}>Son 28 gunluk trendler</Text>

      {/* Summary Row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.lg }}>
        <SummaryBox value={latestW ? `${latestW}` : '-'} label="kg" delta={wChange} />
        <SummaryBox value={avgComp != null ? `${avgComp}` : '-'} label="uyum %" />
        <SummaryBox value={avgWater ?? '-'} label="L/gun" />
        <SummaryBox value={avgSleep ?? '-'} label="sa/gun" />
      </View>

      {/* Goal Progress */}
      {goal?.target_weight_kg && latestW && (
        <Card title="Hedefe Kalan Yol">
          <GoalProgress current={latestW} target={goal.target_weight_kg} goalType={goal.goal_type} />
        </Card>
      )}

      {/* Weight Chart */}
      <ChartSection title="Kilo Trendi" sectionKey="weight" expanded={expandedSections} toggle={toggle}>
        {weights.length >= 2 ? (
          <LineChart data={{ labels: makeLabels(weights), datasets: [{ data: weights.map(w => w.weight_kg as number) }] }}
            width={W} height={160} chartConfig={{ ...baseChart, color: purple }} bezier style={{ borderRadius: 12 }} />
        ) : <EmptyChart text="En az 2 tarti kaydi gerekli." />}
      </ChartSection>

      {/* Compliance Chart */}
      <ChartSection title="Uyum Puani" sectionKey="compliance" expanded={expandedSections} toggle={toggle}>
        {reports.length >= 2 ? (
          <LineChart data={{ labels: makeLabels(reports), datasets: [{ data: reports.map(r => r.compliance_score) }] }}
            width={W} height={160} chartConfig={{ ...baseChart, color: green }} bezier style={{ borderRadius: 12 }} />
        ) : <EmptyChart text="Gun sonu raporlari olustrukca gorunecek." />}
      </ChartSection>

      {/* Calorie Trend */}
      <ChartSection title="Kalori Trendi" sectionKey="calories" expanded={expandedSections} toggle={toggle}>
        {reports.length >= 2 ? (
          <LineChart data={{ labels: makeLabels(reports), datasets: [{ data: reports.map(r => r.calorie_actual || 0) }] }}
            width={W} height={160} chartConfig={{ ...baseChart, color: orange }} bezier style={{ borderRadius: 12 }} />
        ) : <EmptyChart text="Rapor verisi gerekli." />}
      </ChartSection>

      {/* Protein Trend */}
      <ChartSection title="Protein Trendi" sectionKey="protein" expanded={expandedSections} toggle={toggle}>
        {reports.length >= 2 ? (
          <LineChart data={{ labels: makeLabels(reports), datasets: [{ data: reports.map(r => r.protein_actual || 0) }] }}
            width={W} height={160} chartConfig={{ ...baseChart, color: pink }} bezier style={{ borderRadius: 12 }} />
        ) : <EmptyChart text="Rapor verisi gerekli." />}
      </ChartSection>

      {/* Water Trend */}
      <ChartSection title="Su Tüketimi" sectionKey="water" expanded={expandedSections} toggle={toggle}>
        {metrics.length >= 2 ? (
          <LineChart data={{ labels: makeLabels(metrics), datasets: [{ data: metrics.map(m => m.water_liters || 0) }] }}
            width={W} height={160} chartConfig={{ ...baseChart, color: blue }} bezier style={{ borderRadius: 12 }} />
        ) : <EmptyChart text="Su verisi gerekli." />}
      </ChartSection>

      {/* Sleep Trend */}
      <ChartSection title="Uyku Trendi" sectionKey="sleep" expanded={expandedSections} toggle={toggle}>
        {sleepDays.length >= 2 ? (
          <LineChart data={{ labels: makeLabels(sleepDays), datasets: [{ data: sleepDays.map(m => m.sleep_hours as number) }] }}
            width={W} height={160} chartConfig={{ ...baseChart, color: teal }} bezier style={{ borderRadius: 12 }} />
        ) : <EmptyChart text="Uyku verisi gerekli." />}
      </ChartSection>

      {/* Steps Trend */}
      <ChartSection title="Adim Trendi" sectionKey="steps" expanded={expandedSections} toggle={toggle}>
        {(() => {
          const stepDays = metrics.filter(m => m.steps != null && (m.steps as number) > 0);
          return stepDays.length >= 2 ? (
            <LineChart data={{ labels: makeLabels(stepDays), datasets: [{ data: stepDays.map(m => m.steps as number) }] }}
              width={W} height={160} chartConfig={{ ...baseChart, color: green, decimalPlaces: 0 }} bezier style={{ borderRadius: 12 }} />
          ) : <EmptyChart text="Adim verisi gerekli." />;
        })()}
      </ChartSection>

      {/* Mood Trend */}
      <ChartSection title="Ruh Hali Trendi" sectionKey="mood" expanded={expandedSections} toggle={toggle}>
        {(() => {
          const moodDays = metrics.filter(m => m.mood_score != null);
          return moodDays.length >= 2 ? (
            <LineChart data={{ labels: makeLabels(moodDays), datasets: [{ data: moodDays.map(m => m.mood_score as number) }] }}
              width={W} height={160} yAxisSuffix="" chartConfig={{ ...baseChart, color: orange, decimalPlaces: 0 }} bezier style={{ borderRadius: 12 }} />
          ) : <EmptyChart text="Mood verisi gerekli." />;
        })()}
      </ChartSection>

      {/* Best/Worst Days */}
      {reports.length > 0 && (
        <Card title="En Iyi / En Kotu">
          {(() => {
            const sorted = [...reports].sort((a, b) => b.compliance_score - a.compliance_score);
            return (
              <>
                <DayRow label="En Iyi" date={sorted[0].date} score={sorted[0].compliance_score} color={COLORS.success} />
                <DayRow label="En Kotu" date={sorted[sorted.length - 1].date} score={sorted[sorted.length - 1].compliance_score} color={COLORS.error} />
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

      {/* Navigation */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
        <Button title="Takvim" variant="outline" onPress={() => router.push('/reports/calendar')} style={{ flex: 1 }} />
        <Button title="Ilerleme Foto" variant="outline" onPress={() => router.push('/settings/progress-photos')} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}

// --- Sub-components ---

function SummaryBox({ value, label, delta }: { value: string; label: string; delta?: number | null }) {
  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, alignItems: 'center', flex: 1, marginHorizontal: 3, borderWidth: 1, borderColor: COLORS.border }}>
      <Text style={{ fontSize: FONT.xl, fontWeight: '700', color: COLORS.primary }}>{value}</Text>
      <Text style={{ fontSize: FONT.xs, color: COLORS.textSecondary, marginTop: 2 }}>{label}</Text>
      {delta != null && <Text style={{ fontSize: FONT.xs, fontWeight: '600', marginTop: 2, color: delta <= 0 ? COLORS.success : COLORS.error }}>{delta <= 0 ? '' : '+'}{delta.toFixed(1)}</Text>}
    </View>
  );
}

function ChartSection({ title, sectionKey, expanded, toggle, children }: {
  title: string; sectionKey: string; expanded: Set<string>; toggle: (k: string) => void; children: React.ReactNode;
}) {
  const isOpen = expanded.has(sectionKey);
  return (
    <Card>
      <TouchableOpacity onPress={() => toggle(sectionKey)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.lg }}>{isOpen ? '−' : '+'}</Text>
      </TouchableOpacity>
      {isOpen && <View style={{ marginTop: SPACING.sm }}>{children}</View>}
    </Card>
  );
}

function EmptyChart({ text }: { text: string }) {
  return <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, paddingVertical: SPACING.md }}>{text}</Text>;
}

function GoalProgress({ current, target, goalType }: { current: number; target: number; goalType: string }) {
  const isLosing = goalType === 'lose_weight';
  const total = Math.abs(current - target);
  // For weight loss: higher start, lower target. For gain: lower start, higher target.
  const startWeight = isLosing ? current + total : current - total; // approximate start
  const totalRange = Math.abs(startWeight - target);
  const progress = totalRange > 0 ? Math.min(1, Math.max(0, 1 - (total / totalRange))) : 0;
  const pct = Math.round(progress * 100);

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs }}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Simdiki: {current} kg</Text>
        <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>Hedef: {target} kg</Text>
      </View>
      <View style={{ height: 10, backgroundColor: COLORS.surfaceLight, borderRadius: 5, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct}%`, backgroundColor: COLORS.primary, borderRadius: 5 }} />
      </View>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 4 }}>
        {Math.abs(total).toFixed(1)} kg kaldi · %{pct} tamamlandi
      </Text>
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

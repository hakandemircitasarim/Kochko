import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

const screenWidth = Dimensions.get('window').width - SPACING.md * 2;

const chartConfig = {
  backgroundGradientFrom: COLORS.card,
  backgroundGradientTo: COLORS.card,
  decimalPlaces: 1,
  color: (opacity = 1) => `rgba(108, 99, 255, ${opacity})`,
  labelColor: () => COLORS.textSecondary,
  propsForDots: {
    r: '4',
    strokeWidth: '2',
    stroke: COLORS.primary,
  },
  propsForBackgroundLines: {
    stroke: COLORS.border,
  },
};

interface MetricPoint {
  date: string;
  weight_kg: number | null;
  water_liters: number;
  sleep_hours: number | null;
  steps: number | null;
}

interface CompliancePoint {
  date: string;
  compliance_score: number;
}

export default function ProgressScreen() {
  const user = useAuthStore((s) => s.user);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [compliance, setCompliance] = useState<CompliancePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!user?.id) return;

      const fourWeeksAgo = new Date();
      fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
      const fromDate = fourWeeksAgo.toISOString().split('T')[0];

      const [metricsRes, complianceRes] = await Promise.all([
        supabase
          .from('daily_metrics')
          .select('date, weight_kg, water_liters, sleep_hours, steps')
          .eq('user_id', user.id)
          .gte('date', fromDate)
          .order('date'),
        supabase
          .from('daily_reports')
          .select('date, compliance_score')
          .eq('user_id', user.id)
          .gte('date', fromDate)
          .order('date'),
      ]);

      setMetrics((metricsRes.data as MetricPoint[]) ?? []);
      setCompliance((complianceRes.data as CompliancePoint[]) ?? []);
      setLoading(false);
    }
    loadData();
  }, [user?.id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const weightData = metrics.filter((m) => m.weight_kg !== null);
  const hasWeightData = weightData.length >= 2;
  const hasComplianceData = compliance.length >= 2;

  const formatLabel = (d: string) => {
    const date = new Date(d);
    return `${date.getDate()}/${date.getMonth() + 1}`;
  };

  // Summary stats
  const latestWeight = weightData.length > 0 ? weightData[weightData.length - 1].weight_kg : null;
  const firstWeight = weightData.length > 0 ? weightData[0].weight_kg : null;
  const weightChange = latestWeight && firstWeight ? latestWeight - firstWeight : null;

  const avgCompliance =
    compliance.length > 0
      ? Math.round(compliance.reduce((s, c) => s + c.compliance_score, 0) / compliance.length)
      : null;

  const avgWater =
    metrics.length > 0
      ? (metrics.reduce((s, m) => s + (m.water_liters || 0), 0) / metrics.length).toFixed(1)
      : null;

  const avgSleep = (() => {
    const sleepDays = metrics.filter((m) => m.sleep_hours !== null);
    return sleepDays.length > 0
      ? (sleepDays.reduce((s, m) => s + (m.sleep_hours ?? 0), 0) / sleepDays.length).toFixed(1)
      : null;
  })();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>İlerleme</Text>

      {/* Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>
            {latestWeight ? `${latestWeight}` : '-'}
          </Text>
          <Text style={styles.summaryLabel}>kg</Text>
          {weightChange !== null && (
            <Text
              style={[
                styles.summaryDelta,
                { color: weightChange <= 0 ? COLORS.success : COLORS.error },
              ]}
            >
              {weightChange <= 0 ? '' : '+'}{weightChange.toFixed(1)}
            </Text>
          )}
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{avgCompliance ?? '-'}</Text>
          <Text style={styles.summaryLabel}>uyum</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{avgWater ?? '-'}</Text>
          <Text style={styles.summaryLabel}>L/gün</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{avgSleep ?? '-'}</Text>
          <Text style={styles.summaryLabel}>saat</Text>
        </View>
      </View>

      {/* Weight Chart */}
      {hasWeightData ? (
        <Card title="Kilo Trendi (Son 4 Hafta)">
          <LineChart
            data={{
              labels: weightData.filter((_, i) => i % Math.max(1, Math.floor(weightData.length / 6)) === 0).map((w) => formatLabel(w.date)),
              datasets: [{ data: weightData.map((w) => w.weight_kg as number) }],
            }}
            width={screenWidth - SPACING.md * 2}
            height={200}
            chartConfig={chartConfig}
            bezier
            style={styles.chart}
          />
        </Card>
      ) : (
        <Card title="Kilo Trendi">
          <Text style={styles.emptyText}>
            En az 2 tartı kaydı gerekli. Her gün tartılmaya devam et.
          </Text>
        </Card>
      )}

      {/* Compliance Chart */}
      {hasComplianceData ? (
        <Card title="Uyum Puanı Trendi">
          <LineChart
            data={{
              labels: compliance.filter((_, i) => i % Math.max(1, Math.floor(compliance.length / 6)) === 0).map((c) => formatLabel(c.date)),
              datasets: [{ data: compliance.map((c) => c.compliance_score) }],
            }}
            width={screenWidth - SPACING.md * 2}
            height={200}
            chartConfig={{
              ...chartConfig,
              color: (opacity = 1) => `rgba(76, 175, 80, ${opacity})`,
            }}
            bezier
            style={styles.chart}
          />
        </Card>
      ) : (
        <Card title="Uyum Puanı">
          <Text style={styles.emptyText}>
            Gün sonu raporları üretildikçe trend burada görünecek.
          </Text>
        </Card>
      )}

      {/* Best/Worst Days */}
      {compliance.length > 0 && (
        <Card title="En İyi / En Kötü Günler">
          {(() => {
            const sorted = [...compliance].sort((a, b) => b.compliance_score - a.compliance_score);
            const best = sorted[0];
            const worst = sorted[sorted.length - 1];
            return (
              <>
                <View style={styles.dayRow}>
                  <Text style={[styles.dayLabel, { color: COLORS.success }]}>En İyi</Text>
                  <Text style={styles.dayDate}>
                    {new Date(best.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' })}
                  </Text>
                  <Text style={[styles.dayScore, { color: COLORS.success }]}>{best.compliance_score}</Text>
                </View>
                <View style={styles.dayRow}>
                  <Text style={[styles.dayLabel, { color: COLORS.error }]}>En Kötü</Text>
                  <Text style={styles.dayDate}>
                    {new Date(worst.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' })}
                  </Text>
                  <Text style={[styles.dayScore, { color: COLORS.error }]}>{worst.compliance_score}</Text>
                </View>
              </>
            );
          })()}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  title: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.lg },
  summaryCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryValue: { fontSize: FONT_SIZE.xl, fontWeight: '700', color: COLORS.primary },
  summaryLabel: { fontSize: FONT_SIZE.xs, color: COLORS.textSecondary, marginTop: 2 },
  summaryDelta: { fontSize: FONT_SIZE.xs, fontWeight: '600', marginTop: 2 },
  chart: { borderRadius: 12, marginTop: SPACING.sm },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZE.sm, lineHeight: 20 },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs, gap: SPACING.md },
  dayLabel: { fontSize: FONT_SIZE.sm, fontWeight: '600', width: 50 },
  dayDate: { color: COLORS.text, fontSize: FONT_SIZE.md, flex: 1 },
  dayScore: { fontSize: FONT_SIZE.lg, fontWeight: '700' },
});

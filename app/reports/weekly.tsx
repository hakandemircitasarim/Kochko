import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

interface WeeklyData {
  week_start: string;
  weight_trend: { date: string; kg: number }[];
  avg_compliance: number;
  top_deviation: string;
  next_week_strategy: string;
  plan_revision: Record<string, unknown>;
}

export default function WeeklyReportScreen() {
  const user = useAuthStore((s) => s.user);
  const [report, setReport] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadReport() {
      if (!user?.id) return;
      const { data } = await supabase
        .from('weekly_reports')
        .select('*')
        .eq('user_id', user.id)
        .order('week_start', { ascending: false })
        .limit(1)
        .single();

      if (data) setReport(data as WeeklyData);
      setLoading(false);
    }
    loadReport();
  }, [user?.id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!report) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title}>Haftalık Rapor</Text>
          <Card>
            <Text style={styles.emptyText}>
              Henüz haftalık rapor yok. En az 7 gün veri toplandığında
              ilk raporunuz otomatik üretilecek.
            </Text>
          </Card>
        </View>
      </View>
    );
  }

  const complianceColor =
    report.avg_compliance >= 70
      ? COLORS.success
      : report.avg_compliance >= 40
        ? COLORS.warning
        : COLORS.error;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Haftalık Rapor</Text>
      <Text style={styles.date}>
        Hafta: {new Date(report.week_start).toLocaleDateString('tr-TR', {
          day: 'numeric',
          month: 'long',
        })}
      </Text>

      {/* Compliance */}
      <Card>
        <View style={styles.scoreContainer}>
          <Text style={[styles.scoreValue, { color: complianceColor }]}>
            {report.avg_compliance}
          </Text>
          <Text style={styles.scoreLabel}>Ortalama Uyum</Text>
        </View>
      </Card>

      {/* Weight Trend */}
      {report.weight_trend.length > 0 && (
        <Card title="Kilo Trendi">
          {report.weight_trend.map((w, i) => (
            <View key={i} style={styles.weightRow}>
              <Text style={styles.weightDate}>
                {new Date(w.date).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric' })}
              </Text>
              <Text style={styles.weightValue}>{w.kg} kg</Text>
              {i > 0 && (
                <Text
                  style={[
                    styles.weightDiff,
                    {
                      color:
                        w.kg < report.weight_trend[i - 1].kg
                          ? COLORS.success
                          : w.kg > report.weight_trend[i - 1].kg
                            ? COLORS.error
                            : COLORS.textMuted,
                    },
                  ]}
                >
                  {w.kg < report.weight_trend[i - 1].kg ? '' : '+'}
                  {(w.kg - report.weight_trend[i - 1].kg).toFixed(1)}
                </Text>
              )}
            </View>
          ))}
        </Card>
      )}

      {/* Top Deviation */}
      {report.top_deviation && (
        <Card title="En Çok Sapılan Konu">
          <Text style={styles.deviationText}>{report.top_deviation}</Text>
        </Card>
      )}

      {/* Strategy */}
      <Card title="Gelecek Hafta Stratejisi">
        <Text style={styles.strategyText}>{report.next_week_strategy}</Text>
      </Card>

      {/* Plan Revision */}
      {report.plan_revision && Object.keys(report.plan_revision).length > 0 && (
        <Card title="Plan Revizyonu">
          {Object.entries(report.plan_revision).map(([key, val]) => (
            val !== null && (
              <View key={key} style={styles.revisionRow}>
                <Text style={styles.revisionKey}>
                  {key === 'calorie_adjustment' ? 'Kalori'
                    : key === 'protein_adjustment' ? 'Protein'
                    : key === 'workout_volume_change' ? 'Antrenman hacmi'
                    : key}
                </Text>
                <Text style={styles.revisionValue}>{String(val)}</Text>
              </View>
            )
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  title: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text },
  date: { fontSize: FONT_SIZE.md, color: COLORS.textSecondary, marginBottom: SPACING.lg },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZE.md, lineHeight: 22 },
  scoreContainer: { alignItems: 'center', paddingVertical: SPACING.md },
  scoreValue: { fontSize: 56, fontWeight: '800' },
  scoreLabel: { fontSize: FONT_SIZE.md, color: COLORS.textSecondary, marginTop: SPACING.xs },
  weightRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs, gap: SPACING.md },
  weightDate: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm, width: 60 },
  weightValue: { color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '600', flex: 1 },
  weightDiff: { fontSize: FONT_SIZE.sm, fontWeight: '500' },
  deviationText: { color: COLORS.warning, fontSize: FONT_SIZE.md, fontWeight: '500' },
  strategyText: { color: COLORS.text, fontSize: FONT_SIZE.md, lineHeight: 24 },
  revisionRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs },
  revisionKey: { color: COLORS.textSecondary, fontSize: FONT_SIZE.md },
  revisionValue: { color: COLORS.primary, fontSize: FONT_SIZE.md, fontWeight: '600' },
});

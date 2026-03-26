import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { generateDailyReport, type GeneratedReport } from '@/services/ai.service';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

export default function DailyReportScreen() {
  const { date: paramDate } = useLocalSearchParams<{ date?: string }>();
  const user = useAuthStore((s) => s.user);
  const reportDate = paramDate ?? new Date().toISOString().split('T')[0];

  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [storedData, setStoredData] = useState<{
    calorie_actual: number;
    protein_actual: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    async function loadReport() {
      if (!user?.id) return;
      const { data } = await supabase
        .from('daily_reports')
        .select('*')
        .eq('user_id', user.id)
        .eq('date', reportDate)
        .single();

      if (data) {
        setReport({
          compliance_score: data.compliance_score,
          calorie_target_met: data.calorie_target_met,
          protein_target_met: data.protein_target_met,
          workout_completed: data.workout_completed,
          sleep_impact: data.sleep_impact,
          water_impact: data.water_impact,
          deviation_reason: data.deviation_reason,
          tomorrow_action: data.tomorrow_action,
          full_report: data.full_report,
        });
        setStoredData({
          calorie_actual: data.calorie_actual,
          protein_actual: data.protein_actual,
        });
      }
      setLoading(false);
    }
    loadReport();
  }, [user?.id, reportDate]);

  const handleGenerate = async () => {
    setGenerating(true);
    const { data } = await generateDailyReport(reportDate);
    if (data) setReport(data);
    setGenerating(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const scoreColor =
    (report?.compliance_score ?? 0) >= 70
      ? COLORS.success
      : (report?.compliance_score ?? 0) >= 40
        ? COLORS.warning
        : COLORS.error;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Gün Sonu Raporu</Text>
      <Text style={styles.date}>
        {new Date(reportDate).toLocaleDateString('tr-TR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
      </Text>

      {!report ? (
        <Card>
          <Text style={styles.emptyText}>
            Bu gün için rapor henüz üretilmemiş.
          </Text>
          <Button
            title="Rapor Üret"
            onPress={handleGenerate}
            loading={generating}
            size="lg"
          />
        </Card>
      ) : (
        <>
          {/* Compliance Score */}
          <Card>
            <View style={styles.scoreContainer}>
              <Text style={[styles.scoreValue, { color: scoreColor }]}>
                {report.compliance_score}
              </Text>
              <Text style={styles.scoreLabel}>Uyum Puanı</Text>
            </View>
          </Card>

          {/* Checklist */}
          <Card title="Hedef Kontrolü">
            <CheckItem
              label="Kalori hedefi"
              met={report.calorie_target_met}
              detail={storedData ? `${storedData.calorie_actual} kcal` : undefined}
            />
            <CheckItem
              label="Protein hedefi"
              met={report.protein_target_met}
              detail={storedData ? `${storedData.protein_actual}g` : undefined}
            />
            <CheckItem label="Antrenman" met={report.workout_completed} />
          </Card>

          {/* Impacts */}
          {(report.sleep_impact || report.water_impact) && (
            <Card title="Etkiler">
              {report.sleep_impact && (
                <Text style={styles.impactText}>Uyku: {report.sleep_impact}</Text>
              )}
              {report.water_impact && (
                <Text style={styles.impactText}>Su: {report.water_impact}</Text>
              )}
            </Card>
          )}

          {/* Deviation */}
          {report.deviation_reason && report.deviation_reason !== 'yok' && (
            <Card title="Sapma Nedeni">
              <Text style={styles.deviationText}>{report.deviation_reason}</Text>
            </Card>
          )}

          {/* Full Report */}
          <Card title="Değerlendirme">
            <Text style={styles.reportText}>{report.full_report}</Text>
          </Card>

          {/* Tomorrow's Action */}
          <Card title="Yarın İçin Tek Aksiyon">
            <Text style={styles.actionText}>{report.tomorrow_action}</Text>
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function CheckItem({
  label,
  met,
  detail,
}: {
  label: string;
  met: boolean;
  detail?: string;
}) {
  return (
    <View style={styles.checkItem}>
      <Text style={[styles.checkIcon, { color: met ? COLORS.success : COLORS.error }]}>
        {met ? '+' : '-'}
      </Text>
      <Text style={styles.checkLabel}>{label}</Text>
      {detail && <Text style={styles.checkDetail}>{detail}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  title: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text },
  date: { fontSize: FONT_SIZE.md, color: COLORS.textSecondary, marginBottom: SPACING.lg },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZE.md, marginBottom: SPACING.lg },
  scoreContainer: { alignItems: 'center', paddingVertical: SPACING.md },
  scoreValue: { fontSize: 64, fontWeight: '800' },
  scoreLabel: { fontSize: FONT_SIZE.md, color: COLORS.textSecondary, marginTop: SPACING.xs },
  checkItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, gap: SPACING.sm },
  checkIcon: { fontSize: FONT_SIZE.xl, fontWeight: '800', width: 24 },
  checkLabel: { color: COLORS.text, fontSize: FONT_SIZE.md, flex: 1 },
  checkDetail: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm },
  impactText: { color: COLORS.text, fontSize: FONT_SIZE.md, lineHeight: 22, marginBottom: SPACING.xs },
  deviationText: { color: COLORS.warning, fontSize: FONT_SIZE.md, fontWeight: '500' },
  reportText: { color: COLORS.text, fontSize: FONT_SIZE.md, lineHeight: 24 },
  actionText: { color: COLORS.primary, fontSize: FONT_SIZE.lg, fontWeight: '600', lineHeight: 26 },
});

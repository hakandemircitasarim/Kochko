import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ComplianceScore } from '@/components/reports/ComplianceScore';
import { DeviationTag } from '@/components/reports/DeviationTag';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { haptics } from '@/lib/haptics';

interface DailyReport {
  compliance_score: number;
  calorie_actual: number;
  protein_actual: number;
  carbs_actual: number;
  fat_actual: number;
  alcohol_calories: number;
  calorie_target_met: boolean;
  protein_target_met: boolean;
  workout_completed: boolean;
  water_target_met: boolean;
  steps_actual: number | null;
  sleep_impact: string | null;
  water_impact: string | null;
  deviation_reason: string | null;
  weekly_budget_status: string | null;
  tomorrow_action: string;
  full_report: string;
}

const DEVIATION_LABELS: Record<string, string> = {
  stres: 'Stres', aclik: 'Açlık yönetimi', disarida_yemek: 'Dışarıda yemek',
  plansiz_atistirma: 'Plansız atıştırma', sosyal: 'Sosyal ortam', alkol: 'Alkol', yok: '-',
};

export default function DailyReportScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [generating, setGenerating] = useState(false);
  const today = new Date().toISOString().split('T')[0];

  const loadReport = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(false);
    try {
      const { data } = await supabase.from('daily_reports').select('*').eq('user_id', user.id).eq('date', today).single();
      if (data) setReport(data as DailyReport);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [user?.id, today]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const handleGenerate = async () => {
    if (!user?.id) return;
    setGenerating(true);
    // The ai-report response omits the computed actuals (calorie_actual, etc. — they
    // are only written to the row). Re-read the persisted row so the UI shows real
    // numbers instead of "undefined".
    try {
      const { error: invokeError } = await supabase.functions.invoke('ai-report', { body: { report_type: 'daily', date: today, force: true } });
      if (invokeError) throw invokeError;
      const { data } = await supabase.from('daily_reports').select('*').eq('user_id', user.id).eq('date', today).single();
      if (data) {
        setReport(data as DailyReport);
        haptics.success();
      } else {
        // Invoke succeeded but no row came back — don't leave the user on the empty
        // state thinking nothing happened.
        haptics.error();
        Alert.alert('Rapor hazır değil', 'Koç bugün için yeterli veri bulamadı. Gün ilerledikçe tekrar dene.');
      }
    } catch {
      haptics.error();
      Alert.alert('Rapor oluşturulamadı', 'Koç şu an yanıt veremiyor, birazdan tekrar dene.');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  if (error) return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background, padding: SPACING.xl }}>
      <Ionicons name="cloud-offline-outline" size={48} color={COLORS.textMuted} />
      <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '600', marginTop: SPACING.md, textAlign: 'center' }}>Rapor yüklenemedi</Text>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xs, marginBottom: SPACING.lg, textAlign: 'center' }}>Bağlantını kontrol edip tekrar dene.</Text>
      <Button title="Tekrar dene" onPress={loadReport} size="lg" />
    </View>
  );

  const scoreColor = (report?.compliance_score ?? 0) >= 70 ? COLORS.success : (report?.compliance_score ?? 0) >= 40 ? COLORS.warning : COLORS.error;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>
        {new Date(today).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </Text>

      {!report ? (
        <Card>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.lg }}>Rapor henüz oluşturulmamış.</Text>
          <Button title="Rapor Oluştur" onPress={handleGenerate} loading={generating} size="lg" />
          {generating && (
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginTop: SPACING.sm, textAlign: 'center' }}>Koç günü değerlendiriyor, bu birkaç saniye sürebilir…</Text>
          )}
        </Card>
      ) : (
        <>
          {/* Score */}
          <Card>
            <ComplianceScore score={report.compliance_score} />
          </Card>

          {/* Checklist */}
          <Card title="Hedef Kontrolü">
            <CheckItem label="Kalori" met={report.calorie_target_met} detail={`${report.calorie_actual} kcal`} />
            <CheckItem label="Protein" met={report.protein_target_met} detail={`${report.protein_actual}g`} />
            <CheckItem label="Antrenman" met={report.workout_completed} />
            <CheckItem label="Su" met={report.water_target_met ?? false} />
          </Card>

          {/* Macros */}
          <Card title="Makro Dağılımı">
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              <MacroCircle label="Protein" value={report.protein_actual} unit="g" color={COLORS.protein} />
              <MacroCircle label="Karb" value={report.carbs_actual} unit="g" color={COLORS.carbs} />
              <MacroCircle label="Yağ" value={report.fat_actual} unit="g" color={COLORS.fat} />
              {report.alcohol_calories > 0 && <MacroCircle label="Alkol" value={report.alcohol_calories} unit="kcal" color={COLORS.error} />}
            </View>
          </Card>

          {/* Impacts */}
          {(report.sleep_impact || report.water_impact) && (
            <Card title="Etkiler">
              {report.sleep_impact && <Text style={{ color: COLORS.text, fontSize: FONT.md, lineHeight: 22, marginBottom: SPACING.xs }}>Uyku: {report.sleep_impact}</Text>}
              {report.water_impact && <Text style={{ color: COLORS.text, fontSize: FONT.md, lineHeight: 22 }}>Su: {report.water_impact}</Text>}
            </Card>
          )}

          {/* Deviation */}
          {report.deviation_reason && report.deviation_reason !== 'yok' && (
            <Card title="Sapma Nedeni">
              <DeviationTag reason={report.deviation_reason} />
            </Card>
          )}

          {/* Weekly Budget */}
          {report.weekly_budget_status && (
            <Card title="Haftalık Bütçe">
              <Text style={{ color: COLORS.text, fontSize: FONT.md, lineHeight: 22 }}>{report.weekly_budget_status}</Text>
            </Card>
          )}

          {/* Full Report */}
          <Card title="Değerlendirme">
            <Text style={{ color: COLORS.text, fontSize: FONT.md, lineHeight: 24 }}>{report.full_report}</Text>
          </Card>

          {/* Tomorrow */}
          <Card title="Yarın İçin Tek Aksiyon">
            <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '600', lineHeight: 26 }}>{report.tomorrow_action}</Text>
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function CheckItem({ label, met, detail }: { label: string; met: boolean; detail?: string }) {
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, gap: SPACING.sm }}
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${met ? 'hedef tutturuldu' : 'hedef tutturulmadı'}${detail ? `, ${detail}` : ''}`}
    >
      <Ionicons name={met ? 'checkmark-circle' : 'close-circle'} size={24} color={met ? COLORS.success : COLORS.error} />
      <Text style={{ color: COLORS.text, fontSize: FONT.md, flex: 1 }}>{label}</Text>
      {detail && <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{detail}</Text>}
    </View>
  );
}

function MacroCircle({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <View style={{ alignItems: 'center' }} accessibilityRole="text" accessibilityLabel={`${label}: ${value} ${unit}`}>
      <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 3, borderColor: color, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color, fontSize: FONT.md, fontWeight: '700' }}>{value}</Text>
      </View>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginTop: 4 }}>{label}</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{unit}</Text>
    </View>
  );
}

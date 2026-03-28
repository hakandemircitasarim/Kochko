import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

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
  stres: 'Stres', aclik: 'Aclik yonetimi', disarida_yemek: 'Disarida yemek',
  plansiz_atistirma: 'Plansiz atistirma', sosyal: 'Sosyal ortam', alkol: 'Alkol', yok: '-',
};

export default function DailyReportScreen() {
  const user = useAuthStore(s => s.user);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('daily_reports').select('*').eq('user_id', user.id).eq('date', today).single()
      .then(({ data }) => { if (data) setReport(data as DailyReport); setLoading(false); });
  }, [user?.id, today]);

  const handleGenerate = async () => {
    setGenerating(true);
    const { data } = await supabase.functions.invoke('ai-report', { body: { report_type: 'daily', date: today } });
    if (data) setReport(data as DailyReport);
    setGenerating(false);
  };

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  const scoreColor = (report?.compliance_score ?? 0) >= 70 ? COLORS.success : (report?.compliance_score ?? 0) >= 40 ? COLORS.warning : COLORS.error;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text }}>Gun Sonu Raporu</Text>
      <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>
        {new Date(today).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </Text>

      {!report ? (
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: SPACING.lg }}>Rapor henuz olusturulmamis.</Text>
          <Button title="Rapor Olustur" onPress={handleGenerate} loading={generating} size="lg" />
        </Card>
      ) : (
        <>
          {/* Score */}
          <Card>
            <View style={{ alignItems: 'center', paddingVertical: SPACING.md }}>
              <Text style={{ fontSize: 64, fontWeight: '800', color: scoreColor }}>{report.compliance_score}</Text>
              <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary }}>Uyum Puani</Text>
            </View>
          </Card>

          {/* Checklist */}
          <Card title="Hedef Kontrolu">
            <CheckItem label="Kalori" met={report.calorie_target_met} detail={`${report.calorie_actual} kcal`} />
            <CheckItem label="Protein" met={report.protein_target_met} detail={`${report.protein_actual}g`} />
            <CheckItem label="Antrenman" met={report.workout_completed} />
            <CheckItem label="Su" met={report.water_target_met ?? false} />
          </Card>

          {/* Macros */}
          <Card title="Makro Dagilimi">
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              <MacroCircle label="Protein" value={report.protein_actual} unit="g" color={COLORS.primary} />
              <MacroCircle label="Karb" value={report.carbs_actual} unit="g" color={COLORS.success} />
              <MacroCircle label="Yag" value={report.fat_actual} unit="g" color={COLORS.warning} />
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
              <Text style={{ color: COLORS.warning, fontSize: FONT.md, fontWeight: '500' }}>
                {DEVIATION_LABELS[report.deviation_reason] ?? report.deviation_reason}
              </Text>
            </Card>
          )}

          {/* Weekly Budget */}
          {report.weekly_budget_status && (
            <Card title="Haftalik Butce">
              <Text style={{ color: COLORS.text, fontSize: FONT.md, lineHeight: 22 }}>{report.weekly_budget_status}</Text>
            </Card>
          )}

          {/* Full Report */}
          <Card title="Degerlendirme">
            <Text style={{ color: COLORS.text, fontSize: FONT.md, lineHeight: 24 }}>{report.full_report}</Text>
          </Card>

          {/* Tomorrow */}
          <Card title="Yarin Icin Tek Aksiyon">
            <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '600', lineHeight: 26 }}>{report.tomorrow_action}</Text>
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function CheckItem({ label, met, detail }: { label: string; met: boolean; detail?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, gap: SPACING.sm }}>
      <Text style={{ color: met ? COLORS.success : COLORS.error, fontSize: FONT.xl, fontWeight: '800', width: 24 }}>{met ? '+' : '-'}</Text>
      <Text style={{ color: COLORS.text, fontSize: FONT.md, flex: 1 }}>{label}</Text>
      {detail && <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{detail}</Text>}
    </View>
  );
}

function MacroCircle({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 3, borderColor: color, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color, fontSize: FONT.md, fontWeight: '700' }}>{value}</Text>
      </View>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginTop: 4 }}>{label}</Text>
    </View>
  );
}

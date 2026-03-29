import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { shareWeeklyReport } from '@/services/sharing.service';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface WeeklyReport {
  week_start: string;
  weight_trend: { date: string; kg: number }[];
  avg_compliance: number;
  weekly_budget_compliance: boolean | null;
  top_deviation: string | null;
  best_day: string | null;
  worst_day: string | null;
  strength_summary: string | null;
  ai_learning_note: string | null;
  next_week_strategy: string;
  plan_revision: Record<string, unknown>;
  // Spec 8.2 additional trends
  protein_avg: number | null;
  carbs_avg: number | null;
  fat_avg: number | null;
  water_avg: number | null;
  sleep_avg: number | null;
  steps_avg: number | null;
  alcohol_total_calories: number | null;
  micro_nutrient_note: string | null;
}

export default function WeeklyReportScreen() {
  const user = useAuthStore(s => s.user);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('weekly_reports').select('*').eq('user_id', user.id).order('week_start', { ascending: false }).limit(1).single()
      .then(({ data }) => { if (data) setReport(data as WeeklyReport); setLoading(false); });
  }, [user?.id]);

  const handleGenerate = async () => {
    setGenerating(true);
    const { data } = await supabase.functions.invoke('ai-report', { body: { report_type: 'weekly' } });
    if (data) setReport(data as WeeklyReport);
    setGenerating(false);
  };

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  const compColor = (report?.avg_compliance ?? 0) >= 70 ? COLORS.success : (report?.avg_compliance ?? 0) >= 40 ? COLORS.warning : COLORS.error;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text }}>Haftalik Rapor</Text>
      {report && <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>Hafta: {report.week_start}</Text>}

      {!report ? (
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: SPACING.lg }}>Henuz haftalik rapor yok.</Text>
          <Button title="Rapor Olustur" onPress={handleGenerate} loading={generating} size="lg" />
        </Card>
      ) : (
        <>
          {/* Compliance */}
          <Card>
            <View style={{ alignItems: 'center', paddingVertical: SPACING.md }}>
              <Text style={{ fontSize: 56, fontWeight: '800', color: compColor }}>{report.avg_compliance}</Text>
              <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary }}>Ortalama Uyum</Text>
              {report.weekly_budget_compliance != null && (
                <Text style={{ color: report.weekly_budget_compliance ? COLORS.success : COLORS.warning, fontSize: FONT.sm, marginTop: SPACING.xs }}>
                  Haftalik butce: {report.weekly_budget_compliance ? 'Tutturuldu' : 'Asildi'}
                </Text>
              )}
            </View>
          </Card>

          {/* Weight Trend */}
          {report.weight_trend.length > 0 && (
            <Card title="Kilo Trendi">
              {report.weight_trend.map((w, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs, gap: SPACING.md }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, width: 60 }}>
                    {new Date(w.date).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric' })}
                  </Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600', flex: 1 }}>{w.kg} kg</Text>
                  {i > 0 && (
                    <Text style={{ fontSize: FONT.sm, fontWeight: '500', color: w.kg < report.weight_trend[i - 1].kg ? COLORS.success : w.kg > report.weight_trend[i - 1].kg ? COLORS.error : COLORS.textMuted }}>
                      {w.kg < report.weight_trend[i - 1].kg ? '' : '+'}{(w.kg - report.weight_trend[i - 1].kg).toFixed(1)}
                    </Text>
                  )}
                </View>
              ))}
            </Card>
          )}

          {/* Best/Worst Day */}
          {(report.best_day || report.worst_day) && (
            <Card title="Haftanin Gunleri">
              {report.best_day && (
                <View style={{ flexDirection: 'row', gap: SPACING.md, paddingVertical: SPACING.xs }}>
                  <Text style={{ color: COLORS.success, fontSize: FONT.sm, fontWeight: '600', width: 50 }}>En Iyi</Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{new Date(report.best_day).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric' })}</Text>
                </View>
              )}
              {report.worst_day && (
                <View style={{ flexDirection: 'row', gap: SPACING.md, paddingVertical: SPACING.xs }}>
                  <Text style={{ color: COLORS.error, fontSize: FONT.sm, fontWeight: '600', width: 50 }}>En Kotu</Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{new Date(report.worst_day).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric' })}</Text>
                </View>
              )}
            </Card>
          )}

          {/* Top Deviation */}
          {report.top_deviation && (
            <Card title="En Cok Sapilan Konu">
              <Text style={{ color: COLORS.warning, fontSize: FONT.md, fontWeight: '500' }}>{report.top_deviation}</Text>
            </Card>
          )}

          {/* Strength Summary */}
          {report.strength_summary && (
            <Card title="Guc Ozeti">
              <Text style={{ color: COLORS.text, fontSize: FONT.md, lineHeight: 22 }}>{report.strength_summary}</Text>
            </Card>
          )}

          {/* Additional Trends (Spec 8.2) */}
          {(report.protein_avg || report.water_avg || report.sleep_avg || report.steps_avg) && (
            <Card title="Haftalik Trendler">
              {report.protein_avg != null && <TrendRow label="Protein ort." value={`${report.protein_avg}g/gun`} />}
              {report.carbs_avg != null && <TrendRow label="Karbonhidrat ort." value={`${report.carbs_avg}g/gun`} />}
              {report.fat_avg != null && <TrendRow label="Yag ort." value={`${report.fat_avg}g/gun`} />}
              {report.water_avg != null && <TrendRow label="Su ort." value={`${report.water_avg}L/gun`} />}
              {report.sleep_avg != null && <TrendRow label="Uyku ort." value={`${report.sleep_avg}sa/gun`} />}
              {report.steps_avg != null && <TrendRow label="Adim ort." value={`${report.steps_avg?.toLocaleString('tr-TR')}/gun`} />}
              {report.alcohol_total_calories != null && report.alcohol_total_calories > 0 && (
                <TrendRow label="Alkol toplam" value={`${report.alcohol_total_calories} kcal`} color={COLORS.error} />
              )}
            </Card>
          )}

          {/* Micro Nutrient Note (Spec 5.16) */}
          {report.micro_nutrient_note && (
            <Card title="Mikro Besin Notu">
              <Text style={{ color: COLORS.warning, fontSize: FONT.sm, lineHeight: 20 }}>{report.micro_nutrient_note}</Text>
            </Card>
          )}

          {/* AI Learning Note */}
          {report.ai_learning_note && (
            <Card title="Bu Hafta Seni Daha Iyi Tanidim">
              <Text style={{ color: COLORS.primary, fontSize: FONT.md, lineHeight: 22, fontStyle: 'italic' }}>{report.ai_learning_note}</Text>
            </Card>
          )}

          {/* Strategy */}
          <Card title="Gelecek Hafta Stratejisi">
            <Text style={{ color: COLORS.text, fontSize: FONT.md, lineHeight: 24 }}>{report.next_week_strategy}</Text>
          </Card>

          {/* Plan Revision */}
          {report.plan_revision && Object.keys(report.plan_revision).length > 0 && (
            <Card title="Plan Revizyonu">
              {Object.entries(report.plan_revision).map(([key, val]) =>
                val != null ? (
                  <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs }}>
                    <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>{key.replace(/_/g, ' ')}</Text>
                    <Text style={{ color: COLORS.primary, fontSize: FONT.md, fontWeight: '600' }}>{String(val)}</Text>
                  </View>
                ) : null
              )}
            </Card>
          )}

          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            <Button title="Yeniden Olustur" variant="outline" onPress={handleGenerate} loading={generating} style={{ flex: 1 }} />
            <Button title="Paylas" variant="ghost" onPress={() => {
              if (report) {
                const wt = report.weight_trend;
                const delta = wt.length >= 2 ? wt[wt.length - 1].kg - wt[0].kg : 0;
                shareWeeklyReport(report.avg_compliance, delta);
              }
            }} style={{ flex: 1 }} />
          </View>
        </>
      )}
    </ScrollView>
  );
}

function TrendRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{label}</Text>
      <Text style={{ color: color ?? COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

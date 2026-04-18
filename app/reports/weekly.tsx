import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
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
  alcohol_total_calories: number | null;
  next_week_strategy: string;
  plan_revision: Record<string, unknown>;
}

interface AlcoholWeeklyData {
  thisWeek: number;
  prevWeek: number;
  weekdayKcal: number;
  weekendKcal: number;
}

export default function WeeklyReportScreen() {
  const user = useAuthStore(s => s.user);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [alcohol, setAlcohol] = useState<AlcoholWeeklyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase.from('weekly_reports').select('*').eq('user_id', user.id).order('week_start', { ascending: false }).limit(1).single();
      if (data) {
        setReport(data as WeeklyReport);
        await loadAlcoholData(user.id, (data as WeeklyReport).week_start);
      }
      setLoading(false);
    })();
  }, [user?.id]);

  const loadAlcoholData = async (userId: string, weekStart: string) => {
    const ws = new Date(weekStart);
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    const prevWs = new Date(ws); prevWs.setDate(ws.getDate() - 7);
    const prevWe = new Date(ws); prevWe.setDate(ws.getDate() - 1);

    const [thisWeekRows, prevWeekRows] = await Promise.all([
      supabase.from('daily_reports').select('date, alcohol_calories').eq('user_id', userId).gte('date', ws.toISOString().split('T')[0]).lte('date', we.toISOString().split('T')[0]),
      supabase.from('daily_reports').select('alcohol_calories').eq('user_id', userId).gte('date', prevWs.toISOString().split('T')[0]).lte('date', prevWe.toISOString().split('T')[0]),
    ]);

    let weekdayKcal = 0, weekendKcal = 0, thisWeekTotal = 0;
    for (const r of (thisWeekRows.data ?? []) as { date: string; alcohol_calories: number | null }[]) {
      const kcal = r.alcohol_calories ?? 0;
      thisWeekTotal += kcal;
      const d = new Date(r.date).getDay();
      if (d === 0 || d === 5 || d === 6) weekendKcal += kcal;
      else weekdayKcal += kcal;
    }
    const prevWeekTotal = ((prevWeekRows.data ?? []) as { alcohol_calories: number | null }[])
      .reduce((s, r) => s + (r.alcohol_calories ?? 0), 0);

    setAlcohol({ thisWeek: thisWeekTotal, prevWeek: prevWeekTotal, weekdayKcal, weekendKcal });
  };

  const handleGenerate = async () => {
    setGenerating(true);
    const { data } = await supabase.functions.invoke('ai-report', { body: { report_type: 'weekly' } });
    if (data) {
      setReport(data as WeeklyReport);
      if (user?.id && (data as WeeklyReport).week_start) {
        await loadAlcoholData(user.id, (data as WeeklyReport).week_start);
      }
    }
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

          {/* Alcohol Summary — Spec 3.1, 8.2 */}
          {alcohol && alcohol.thisWeek > 0 && (
            <Card title="Alkol Ozeti">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Bu hafta toplam</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{alcohol.thisWeek} kcal</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Hafta ici</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.sm }}>{alcohol.weekdayKcal} kcal</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Hafta sonu</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.sm }}>{alcohol.weekendKcal} kcal</Text>
              </View>
              {alcohol.prevWeek > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs, marginTop: SPACING.xs, borderTopWidth: 1, borderTopColor: COLORS.border }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Gecen hafta</Text>
                  <Text style={{ color: alcohol.thisWeek < alcohol.prevWeek ? COLORS.success : alcohol.thisWeek > alcohol.prevWeek ? COLORS.warning : COLORS.textMuted, fontSize: FONT.sm, fontWeight: '500' }}>
                    {alcohol.prevWeek} kcal ({alcohol.thisWeek > alcohol.prevWeek ? '+' : ''}{alcohol.thisWeek - alcohol.prevWeek})
                  </Text>
                </View>
              )}
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

          <Button title="Yeniden Olustur" variant="outline" onPress={handleGenerate} loading={generating} />
        </>
      )}
    </ScrollView>
  );
}

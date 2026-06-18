/**
 * Monthly Report Screen
 * Spec 8.3: Aylik rapor - hedefe yaklasma, trend, risk sinyalleri.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ComplianceScore } from '@/components/reports/ComplianceScore';
import { ProgressChart } from '@/components/reports/ProgressChart';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface MonthlyAIReport {
  monthly_summary?: string;
  avg_compliance?: number;
  trend_direction?: 'yukselis' | 'dusus' | 'stabil';
  weight_change_kg?: number | null;
  risk_signals?: string[];
  behavioral_patterns?: string[];
  top_achievement?: string;
  deviation_distribution?: Record<string, number>;
  next_month_focus?: string;
}

export default function MonthlyReportScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [loading, setLoading] = useState(true);
  const [weeklyReports, setWeeklyReports] = useState<Record<string, unknown>[]>([]);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [aiReport, setAiReport] = useState<MonthlyAIReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [weightData, setWeightData] = useState<{ label: string; value: number }[]>([]);
  const [dailyAvgCompliance, setDailyAvgCompliance] = useState<number>(0);

  useEffect(() => {
    if (!user?.id) return;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];

    Promise.all([
      supabase.from('weekly_reports').select('*').eq('user_id', user.id)
        .gte('week_start', fourWeeksAgo).order('week_start'),
      supabase.from('goals').select('target_weight_kg').eq('user_id', user.id).eq('is_active', true).limit(1),
      supabase.from('monthly_reports').select('*').eq('user_id', user.id)
        .eq('month_start', monthStart).single(),
      supabase.from('daily_metrics').select('date, weight_kg').eq('user_id', user.id)
        .gte('date', monthStart).lte('date', monthEnd).order('date'),
      // Daily-report compliance fallback: early users often have daily_reports but
      // no weekly_reports yet, so weekly-only avg shows 0 despite compliant days (#R2-15).
      supabase.from('daily_reports').select('compliance_score').eq('user_id', user.id)
        .gte('date', monthStart).lte('date', monthEnd),
    ]).then(([reportsRes, goalRes, monthlyRes, metricsRes, dailyRes]) => {
      const dailyScores = ((dailyRes.data ?? []) as { compliance_score: number | null }[])
        .map(d => d.compliance_score).filter((s): s is number => typeof s === 'number' && s > 0);
      setDailyAvgCompliance(dailyScores.length > 0
        ? Math.round(dailyScores.reduce((a, b) => a + b, 0) / dailyScores.length) : 0);
      setWeeklyReports((reportsRes.data ?? []) as Record<string, unknown>[]);
      setProfile((goalRes.data as { target_weight_kg: number | null }[] | null)?.[0] ?? null);
      if (monthlyRes.data) {
        setAiReport(monthlyRes.data as unknown as MonthlyAIReport);
      }
      const weights = ((metricsRes.data ?? []) as { date: string; weight_kg: number | null }[])
        .filter(m => m.weight_kg != null)
        .map(m => ({ label: m.date, value: m.weight_kg as number }));
      setWeightData(weights);
      setLoading(false);
    });
  }, [user?.id]);

  const handleGenerateReport = async () => {
    if (!user?.id) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-report', {
        body: { report_type: 'monthly', force: true },
      });
      if (error) throw error;
      setAiReport(data as MonthlyAIReport);
    } catch (err) {
      Alert.alert('Hata', 'Rapor olusturulamadi. Lutfen tekrar deneyin.');
    } finally {
      setGenerating(false);
    }
  };

  const trendColor = (dir?: string) => {
    if (dir === 'yukselis') return COLORS.success;
    if (dir === 'dusus') return COLORS.error;
    return COLORS.warning;
  };

  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>;
  }

  const weeklyAvgCompliance = weeklyReports.length > 0
    ? Math.round(weeklyReports.reduce((s, r) => s + (r.avg_compliance as number ?? 0), 0) / weeklyReports.length)
    : 0;
  // Prefer weekly aggregate; fall back to the daily-report average so early users
  // (daily_reports but no weekly_reports yet) don't see a misleading 0 (#R2-15).
  const avgCompliance = weeklyAvgCompliance > 0 ? weeklyAvgCompliance : dailyAvgCompliance;

  // weekly_reports has no weight_start/weight_end columns — derive month-boundary weights from
  // the daily_metrics weights already loaded (weightData is ascending by date).
  const firstWeight: number | null = weightData.length > 0 ? weightData[0].value : null;
  const lastWeight: number | null = weightData.length > 0 ? weightData[weightData.length - 1].value : null;
  const weightChange: number | null = firstWeight !== null && lastWeight !== null ? lastWeight - firstWeight : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.md }}>Aylık Rapor</Text>

      {/* Overall Compliance */}
      <Card title="Ortalama Uyum">
        <ComplianceScore score={aiReport?.avg_compliance ?? avgCompliance} />
      </Card>

      {/* Weight Chart */}
      {weightData.length > 0 && (
        <Card title="Kilo Grafigi">
          <ProgressChart data={weightData} unit=" kg" color={COLORS.secondary} height={150} />
        </Card>
      )}

      {/* Weight Trend */}
      {weightChange !== null && (
        <Card title="Kilo Trendi">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Ay başı</Text>
              <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>{firstWeight} kg</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Değişim</Text>
              <Text style={{ color: weightChange < 0 ? COLORS.success : weightChange > 0 ? COLORS.error : COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>
                {weightChange > 0 ? '+' : ''}{weightChange.toFixed(1)} kg
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Ay sonu</Text>
              <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>{lastWeight} kg</Text>
            </View>
          </View>
        </Card>
      )}

      {/* AI Report Section */}
      {!aiReport && (
        <Card title="AI Aylık Analiz">
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: SPACING.md }}>
            Yapay zeka ile aylık performans analizini oluştur.
          </Text>
          <Button
            title="Rapor Oluştur"
            onPress={handleGenerateReport}
            loading={generating}
            disabled={generating}
          />
        </Card>
      )}

      {aiReport && (
        <>
          {/* Monthly Summary */}
          {aiReport.monthly_summary && (
            <Card title="Aylık Özet">
              <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 22 }}>{aiReport.monthly_summary}</Text>
              {aiReport.trend_direction && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACING.sm }}>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Trend: </Text>
                  <Text style={{ color: trendColor(aiReport.trend_direction), fontSize: FONT.sm, fontWeight: '700' }}>
                    {aiReport.trend_direction === 'yukselis' ? 'Yükseliş' : aiReport.trend_direction === 'dusus' ? 'Düşüş' : 'Stabil'}
                  </Text>
                </View>
              )}
            </Card>
          )}

          {/* Top Achievement */}
          {aiReport.top_achievement && (
            <Card title="Ayın Başarısı">
              <Text style={{ color: COLORS.success, fontSize: FONT.md, fontWeight: '600' }}>{aiReport.top_achievement}</Text>
            </Card>
          )}

          {/* Risk Signals */}
          {aiReport.risk_signals && aiReport.risk_signals.length > 0 && (
            <Card title="Risk Sinyalleri">
              {aiReport.risk_signals.map((signal, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: i < aiReport.risk_signals!.length - 1 ? SPACING.xs : 0 }}>
                  <Text style={{ color: COLORS.error, fontSize: FONT.sm, marginRight: SPACING.xs }}>!</Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.sm, flex: 1 }}>{signal}</Text>
                </View>
              ))}
            </Card>
          )}

          {/* Behavioral Patterns */}
          {aiReport.behavioral_patterns && aiReport.behavioral_patterns.length > 0 && (
            <Card title="Davranış Kalıpları">
              {aiReport.behavioral_patterns.map((pattern, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: i < aiReport.behavioral_patterns!.length - 1 ? SPACING.xs : 0 }}>
                  <Text style={{ color: COLORS.primary, fontSize: FONT.sm, marginRight: SPACING.xs }}>-</Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.sm, flex: 1 }}>{pattern}</Text>
                </View>
              ))}
            </Card>
          )}

          {/* Next Month Focus */}
          {aiReport.next_month_focus && (
            <Card title="Gelecek Ay Odak">
              <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 22 }}>{aiReport.next_month_focus}</Text>
            </Card>
          )}

          {/* Regenerate */}
          <Button
            title="Raporu Yenile"
            onPress={handleGenerateReport}
            variant="outline"
            loading={generating}
            disabled={generating}
            style={{ marginTop: SPACING.sm }}
          />
        </>
      )}

      {/* Goal Progress */}
      {!!(profile?.target_weight_kg) && lastWeight && (
        <Card title="Hedefe Kalan">
          <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '600', textAlign: 'center' }}>
            {Math.abs(lastWeight - (profile.target_weight_kg as number)).toFixed(1)} kg
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.xs }}>
            Hedef: {profile.target_weight_kg as number} kg
          </Text>
        </Card>
      )}

      {/* Weekly Summaries */}
      <Card title="Haftalık Özetler">
        {weeklyReports.map((wr, i) => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.sm, borderBottomWidth: i < weeklyReports.length - 1 ? 1 : 0, borderBottomColor: COLORS.border }}>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{wr.week_start as string}</Text>
            <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>%{wr.avg_compliance as number ?? 0}</Text>
          </View>
        ))}
        {weeklyReports.length === 0 && (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center' }}>Henüz haftalık rapor yok.</Text>
        )}
      </Card>
    </ScrollView>
  );
}

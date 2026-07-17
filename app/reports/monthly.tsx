/**
 * Monthly Report Screen
 * Spec 8.3: Aylik rapor - hedefe yaklasma, trend, risk sinyalleri.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CircularProgress } from '@/components/ui/CircularProgress';
import { ProgressChart } from '@/components/reports/ProgressChart';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { METRIC_COLORS } from '@/lib/theme';
import { haptics } from '@/lib/haptics';

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
  // FIX (audit Wave3): error state — the Promise.all loader had no catch, so a network reject
  // never ran setLoading(false) and the SkeletonScreen spun forever.
  const [error, setError] = useState(false);
  const [weeklyReports, setWeeklyReports] = useState<Record<string, unknown>[]>([]);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [aiReport, setAiReport] = useState<MonthlyAIReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [weightData, setWeightData] = useState<{ label: string; value: number }[]>([]);
  const [dailyAvgCompliance, setDailyAvgCompliance] = useState<number>(0);
  // FIX (ux-pass5): remember a successful load so a later refresh failure keeps the shown data
  // instead of swapping it for the full-screen error state.
  const loadedRef = useRef(false);
  const dayBoundaryHour = useProfileStore(s => (s.profile?.day_boundary_hour as number) ?? 4);

  const loadData = useCallback(() => {
    if (!user?.id) return;
    setLoading(true);
    setError(false);
    // #S13: build month bounds as plain calendar strings, NOT via Date->toISOString (which
    // converts LOCAL midnight to UTC and rolls back a day in UTC+ zones, e.g. Turkey gave
    // monthStart '2026-05-31'). That made .eq('month_start', monthStart) never match the
    // edge-persisted UTC '2026-06-01' row, so the cached monthly report never loaded and the
    // screen re-triggered a paid LLM generation every visit. Mirrors calendar.service.ts.
    // FIX (ux-pass5): anchor the month to the user's EFFECTIVE day (day_boundary_hour, default
    // 04:00) like daily.tsx — at 00:51 on the 1st the experiential day is still the previous
    // month; raw getMonth() showed an empty new month + a paid regeneration prompt.
    const eff = getEffectiveDate(new Date(), dayBoundaryHour); // YYYY-MM-DD, local + boundary-aware
    const _y = Number(eff.slice(0, 4));
    const _m = Number(eff.slice(5, 7)) - 1; // 0-based
    const _mm = String(_m + 1).padStart(2, '0');
    const monthStart = `${_y}-${_mm}-01`;
    const monthEnd = `${_y}-${_mm}-${String(new Date(_y, _m + 1, 0).getDate()).padStart(2, '0')}`;
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
      // FIX (ux-pass5): supabase-js never rejects — network failures resolve as { data: null, error }
      // on each result, so the Wave3 .catch below never fired and an offline open rendered a confident
      // all-zero month (uyum %0 + paid "Rapor Oluştur" over the cached row). Check every result's
      // error; PGRST116 (the monthly .single() with 0 rows) is the legit "henüz rapor yok" case.
      const failed = [reportsRes, goalRes, monthlyRes, metricsRes, dailyRes]
        .some(r => r.error && r.error.code !== 'PGRST116');
      if (failed) {
        if (!loadedRef.current) setError(true); // keep already-loaded data on a later refresh failure
        setLoading(false);
        return;
      }
      // #S15: keep legitimate 0-score (fully-missed) days in the average — the edge's
      // authoritative avg_compliance counts zeros, so dropping them here over-reported
      // adherence. Only filter out null/non-numeric.
      const dailyScores = ((dailyRes.data ?? []) as { compliance_score: number | null }[])
        .map(d => d.compliance_score).filter((s): s is number => typeof s === 'number');
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
      loadedRef.current = true; // FIX (ux-pass5)
      setLoading(false);
    }).catch(() => {
      // FIX (audit Wave3): surface the error branch instead of spinning forever.
      setError(true);
      setLoading(false);
    });
  }, [user?.id, dayBoundaryHour]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleGenerateReport = async () => {
    if (!user?.id) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-report', {
        body: { report_type: 'monthly', force: true },
      });
      if (error) throw error;
      setAiReport(data as MonthlyAIReport);
      haptics.success();
    } catch (err) {
      haptics.error();
      Alert.alert('Bir sorun oldu', 'Rapor oluşturulamadı, lütfen tekrar dene.');
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
    return <SkeletonScreen cards={3} />;
  }

  // FIX (audit Wave3): error state with retry — mirrors reports/daily.tsx & weekly.tsx.
  // (refactor: shared LoadErrorState)
  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background }}>
        <LoadErrorState title="Rapor yüklenemedi" onRetry={loadData} />
      </View>
    );
  }

  const weeklyAvgCompliance = weeklyReports.length > 0
    ? Math.round(weeklyReports.reduce((s, r) => s + (r.avg_compliance as number ?? 0), 0) / weeklyReports.length)
    : 0;
  // Prefer weekly aggregate; fall back to the daily-report average so early users
  // (daily_reports but no weekly_reports yet) don't see a misleading 0 (#R2-15).
  const avgCompliance = weeklyAvgCompliance > 0 ? weeklyAvgCompliance : dailyAvgCompliance;
  // FIX (ux-pass5, emulator): compliance is a PERCENT app-wide ("%15 uyum") but the donut showed a
  // bare "1". Values are already 0-100 (ai-report clamps them server-side; the local averages are
  // built from 0-100 compliance_score rows), so format as %N without rescaling.
  const complianceScore = aiReport?.avg_compliance ?? avgCompliance;
  const complianceColor = complianceScore >= 70 ? COLORS.success : complianceScore >= 40 ? COLORS.warning : COLORS.error;

  // weekly_reports has no weight_start/weight_end columns — derive month-boundary weights from
  // the daily_metrics weights already loaded (weightData is ascending by date).
  const firstWeight: number | null = weightData.length > 0 ? weightData[0].value : null;
  const lastWeight: number | null = weightData.length > 0 ? weightData[weightData.length - 1].value : null;
  const weightChange: number | null = firstWeight !== null && lastWeight !== null ? lastWeight - firstWeight : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>

      {/* Overall Compliance */}
      <Card title="Ortalama Uyum">
        {/* FIX (ux-pass5, emulator): ComplianceScore (başka kümenin dosyası) ringde çıplak sayı basıyordu;
            %N için ringi burada doğrudan çiz — görünüm aynı (120/8 ring + alt etiket). */}
        <View style={{ alignItems: 'center', paddingVertical: SPACING.md }}>
          <CircularProgress progress={complianceScore / 100} value={`%${complianceScore}`} size={120} strokeWidth={8} color={complianceColor} a11yLabel="Ortalama uyum" />
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md, marginTop: SPACING.sm }}>Uyum Puanı</Text>
        </View>
      </Card>

      {/* Weight Chart */}
      {weightData.length > 0 && (
        <Card title="Kilo Grafiği">
          <View
            accessible
            accessibilityRole="image"
            // FIX (ux-pass5): TR ondalık — virgül, nokta değil ("73,5 kilodan").
            accessibilityLabel={`Kilo grafiği: ${firstWeight?.toFixed(1).replace('.', ',')} kilodan ${lastWeight?.toFixed(1).replace('.', ',')} kiloya`}
          >
            {/* FIX (audit ui-weight-chart): kilo grafiği marka kilo rengiyle (METRIC_COLORS.weight, pembe) tutarlı; eskiden COLORS.secondary (mor) idi. */}
            {/* FIX (ux-pass5, emulator): height=150 x-ekseni etiketlerini kartın alt kenarında ortadan kesiyordu — ProgressChart'ın yeni 180 varsayılanına bırak (progress.tsx grafikleriyle aynı). */}
            <ProgressChart data={weightData} unit=" kg" color={METRIC_COLORS.weight} />
          </View>
        </Card>
      )}

      {/* Weight Trend */}
      {weightChange !== null && (
        <Card title="Kilo Trendi">
          {/* FIX (ux-pass5): TR ondalık — kilo değerleri virgülle ("73,5 kg", "+1,2 kg"). */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Ay başı</Text>
              <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>{firstWeight?.toFixed(1).replace('.', ',')} kg</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Değişim</Text>
              <Text style={{ color: weightChange < 0 ? COLORS.success : weightChange > 0 ? COLORS.error : COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>
                {weightChange > 0 ? '+' : ''}{weightChange.toFixed(1).replace('.', ',')} kg
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Ay sonu</Text>
              <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>{lastWeight?.toFixed(1).replace('.', ',')} kg</Text>
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
          {generating && (
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.sm }}>
              Koçun ayını analiz ediyor, bu birkaç saniye sürebilir...
            </Text>
          )}
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
          {Array.isArray(aiReport.risk_signals) && aiReport.risk_signals.length > 0 && (
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
          {Array.isArray(aiReport.behavioral_patterns) && aiReport.behavioral_patterns.length > 0 && (
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
          {generating && (
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.sm }}>
              Koçun ayını analiz ediyor, bu birkaç saniye sürebilir...
            </Text>
          )}
        </>
      )}

      {/* Goal Progress */}
      {!!(profile?.target_weight_kg) && lastWeight && (
        <Card title="Hedefe Kalan">
          <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '600', textAlign: 'center' }}>
            {/* FIX (ux-pass5): TR ondalık virgül. */}
            {Math.abs(lastWeight - (profile.target_weight_kg as number)).toFixed(1).replace('.', ',')} kg
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.xs }}>
            Hedef: {profile.target_weight_kg as number} kg
          </Text>
        </Card>
      )}

      {/* Weekly Summaries */}
      <Card title="Haftalık Özetler">
        {weeklyReports.map((wr, i) => {
          const compliance = (wr.avg_compliance as number) ?? 0;
          const weekLabel = new Date(wr.week_start as string)
            .toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
          return (
            <View key={i} style={{ paddingVertical: SPACING.sm, borderBottomWidth: i < weeklyReports.length - 1 ? 1 : 0, borderBottomColor: COLORS.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{weekLabel} haftası</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>%{compliance}</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: COLORS.border, overflow: 'hidden' }}>
                <View style={{ width: `${Math.min(100, Math.max(0, compliance))}%`, height: '100%', borderRadius: 3, backgroundColor: COLORS.primary }} />
              </View>
            </View>
          );
        })}
        {weeklyReports.length === 0 && (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center' }}>Henüz haftalık rapor yok.</Text>
        )}
      </Card>
    </ScrollView>
  );
}

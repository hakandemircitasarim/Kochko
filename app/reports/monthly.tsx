/**
 * Monthly Report Screen
 * Spec 8.3: Aylik rapor - hedefe yaklasma, trend, risk sinyalleri.
 *
 * Duolingo dili (DEVIR §0-A/§0-B, 2026-11): ay seçici gövdeli yuvarlak tuşlar (MonthNav),
 * açılış ComplianceHero (teşvik hapı + iyi ayda rozet yayı; konfeti YOK — o haftalık özette),
 * sapma dağılımı ve haftalık özet çubukları ortak ProgressBar (elle iz+dolgu yok), "Ayın
 * Başarısı" kehribar kupa kartı, boş AI analizi maskotlu. Veri akışı aynen korunur.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { edgeHeaders } from '@/lib/edgeHeaders';
import { getEffectiveDate } from '@/lib/day-boundary';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ComplianceHero, getComplianceColor } from '@/components/reports/ComplianceScore';
import { MonthNav, ReportEmpty, PLATE_INK, STREAK_SHELF, tint } from '@/components/reports/ReportBits';
import { ProgressChart } from '@/components/reports/ProgressChart';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { METRIC_COLORS, useTheme } from '@/lib/theme';
import { haptics } from '@/lib/haptics';
import { ThinkingFor } from '@/components/chat/ThinkingIndicator';

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

// FIX (ux-round3 #1): TR labels for the deviation reasons (mirrors daily.tsx) — used to render the
// previously-invisible deviation_distribution the edge function already computes.
const DEVIATION_LABELS: Record<string, string> = {
  stres: 'Stres', aclik: 'Açlık', disarida_yemek: 'Dışarıda yemek',
  plansiz_atistirma: 'Plansız atıştırma', sosyal: 'Sosyal ortam', alkol: 'Alkol',
};

export default function MonthlyReportScreen() {
  const { colors, isDark } = useTheme();
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
  // FIX (ux-round3 #5): previous month's average compliance for the headline trend (weekly parity).
  const [prevMonthCompliance, setPrevMonthCompliance] = useState<number | null>(null);
  // FIX (ux-pass5): remember a successful load so a later refresh failure keeps the shown data
  // instead of swapping it for the full-screen error state.
  const loadedRef = useRef(false);
  const dayBoundaryHour = useProfileStore(s => (s.profile?.day_boundary_hour as number) ?? 4);
  // ux-sweep (monthly-past-months-unreachable): ay hep efektif aya SABİTTİ — ayın 1'inde biten
  // ayın raporu (DB'de durduğu hâlde) kalıcı erişilmez oluyor, yerine bomboş yeni ay + ücretli
  // 'Rapor Oluştur' çıkıyordu. calendar.tsx'in < Ay > navigasyonu buraya taşındı.
  const effInit = getEffectiveDate(new Date(), dayBoundaryHour);
  const [viewYear, setViewYear] = useState(() => Number(effInit.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => Number(effInit.slice(5, 7))); // 1-12

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
    const _y = viewYear;
    const _m = viewMonth - 1; // 0-based
    const _mm = String(_m + 1).padStart(2, '0');
    const monthStart = `${_y}-${_mm}-01`;
    const monthEnd = `${_y}-${_mm}-${String(new Date(_y, _m + 1, 0).getDate()).padStart(2, '0')}`;
    const fourWeeksAgo = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
    // FIX (ux-round3 #5): previous-month bounds (calendar strings, same convention as above).
    const _pm = _m - 1 < 0 ? 11 : _m - 1;
    const _py = _m - 1 < 0 ? _y - 1 : _y;
    const _pmm = String(_pm + 1).padStart(2, '0');
    const prevMonthStart = `${_py}-${_pmm}-01`;
    const prevMonthEnd = `${_py}-${_pmm}-${String(new Date(_py, _pm + 1, 0).getDate()).padStart(2, '0')}`;

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
      // FIX (ux-round3 #5): previous month's daily compliance (best-effort — NOT in the failure gate).
      supabase.from('daily_reports').select('compliance_score').eq('user_id', user.id)
        .gte('date', prevMonthStart).lte('date', prevMonthEnd),
    ]).then(([reportsRes, goalRes, monthlyRes, metricsRes, dailyRes, prevDailyRes]) => {
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
      // FIX (ux-round3 #5): previous month's average for the headline trend (best-effort).
      const prevScores = ((prevDailyRes.data ?? []) as { compliance_score: number | null }[])
        .map(d => d.compliance_score).filter((s): s is number => typeof s === 'number');
      setPrevMonthCompliance(prevScores.length > 0 ? Math.round(prevScores.reduce((a, b) => a + b, 0) / prevScores.length) : null);
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
  }, [user?.id, dayBoundaryHour, viewYear, viewMonth]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleGenerateReport = async () => {
    if (!user?.id) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-report', {
        body: { report_type: 'monthly', force: true },
        headers: edgeHeaders(),
      });
      if (error) throw error;
      setAiReport(data as MonthlyAIReport);
      haptics.success();
    } catch (err) {
      haptics.error();
      Alert.alert('Koç şu an meşgul', 'Raporun oluşturulamadı, birazdan tekrar dene.');
    } finally {
      setGenerating(false);
    }
  };

  const trendColor = (dir?: string) => {
    if (dir === 'yukselis') return colors.success;
    if (dir === 'dusus') return colors.error;
    return colors.warning;
  };

  if (loading) {
    return <SkeletonScreen cards={3} />;
  }

  // FIX (audit Wave3): error state with retry — mirrors reports/daily.tsx & weekly.tsx.
  // (refactor: shared LoadErrorState)
  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadErrorState title="Rapor yüklenemedi" onRetry={loadData} />
      </View>
    );
  }

  const effNow = getEffectiveDate(new Date(), dayBoundaryHour);
  const isViewingCurrentMonth = viewYear === Number(effNow.slice(0, 4)) && viewMonth === Number(effNow.slice(5, 7));

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

  // weekly_reports has no weight_start/weight_end columns — derive month-boundary weights from
  // the daily_metrics weights already loaded (weightData is ascending by date).
  const firstWeight: number | null = weightData.length > 0 ? weightData[0].value : null;
  const lastWeight: number | null = weightData.length > 0 ? weightData[weightData.length - 1].value : null;
  // Ay icinde tek tarti varsa "Ay basi"/"Ay sonu" AYNI olcumdur ve kart uc sutunda ayni
  // sayiyi yazip "Degisim 0,0 kg" diyordu. Degisim en az iki kayitla vardir.
  const weightChange: number | null = weightData.length >= 2 && firstWeight !== null && lastWeight !== null
    ? lastWeight - firstWeight : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>

      {/* FIX (ux-polish): period header so monthly anchors the reader like daily ("Salı, 14 Temmuz")
          and weekly ("Hafta: …"). review fix: derive it from the SAME day-boundary-aware effective
          month the query uses (raw new Date() could name a different month pre-boundary on the 1st). */}
      {/* ux-sweep: < Ay > navigasyonu (calendar.tsx kalıbı) — geçmiş ay raporları erişilir. */}
      <MonthNav
        title={new Date(viewYear, viewMonth - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}
        onPrev={() => { if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); }}
        onNext={() => { if (!isViewingCurrentMonth) { if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); } }}
        nextDisabled={isViewingCurrentMonth}
      />

      {/* Overall Compliance */}
      <Card title="Ortalama Uyum">
        {/* FIX (ux-pass5, emulator): ComplianceScore (başka kümenin dosyası) ringde çıplak sayı basıyordu;
            %N için ringi burada doğrudan çiz — görünüm aynı (120/8 ring + alt etiket). */}
        <ComplianceHero score={complianceScore} label="Uyum Puanı" a11yLabel="Ortalama uyum">
          {/* FIX (ux-round3 #5): trend vs last month (weekly parity) so '%62' gains direction.
              Hap: yön rengi ikonda/zeminde, söz mürekkepte (küçük renkli metin AA altındaydı). */}
          {prevMonthCompliance != null && (() => {
            const d = complianceScore - prevMonthCompliance;
            const c = d > 0 ? colors.success : d < 0 ? colors.warning : colors.textMuted;
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.sm, paddingVertical: SPACING.xs + 1, paddingHorizontal: SPACING.md, borderRadius: RADIUS.pill, backgroundColor: tint(c, colors, isDark, 1.1) }}>
                <Ionicons name={d > 0 ? 'arrow-up' : d < 0 ? 'arrow-down' : 'remove'} size={15} color={c} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.callout, color: colors.text, fontWeight: '700' }}>
                  {d === 0 ? 'geçen ayla aynı' : `geçen aya göre ${d > 0 ? '+' : '−'}${Math.abs(d)}`}
                </Text>
              </View>
            );
          })()}
        </ComplianceHero>
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
            {/* FIX (audit ui-weight-chart): kilo grafiği marka kilo rengiyle (METRIC_COLORS.weight, pembe) tutarlı; eskiden colors.secondary (mor) idi. */}
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
              <Text style={{ color: colors.textMuted, ...TYPE.caption }}>Ay başı</Text>
              <Text style={{ color: colors.text, ...TYPE.title3 }}>{firstWeight?.toFixed(1).replace('.', ',')} kg</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: colors.textMuted, ...TYPE.caption }}>Değişim</Text>
              <Text style={{ color: weightChange < 0 ? colors.success : weightChange > 0 ? colors.error : colors.text, ...TYPE.title3 }}>
                {weightChange > 0 ? '+' : ''}{weightChange.toFixed(1).replace('.', ',')} kg
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: colors.textMuted, ...TYPE.caption }}>Ay sonu</Text>
              <Text style={{ color: colors.text, ...TYPE.title3 }}>{lastWeight?.toFixed(1).replace('.', ',')} kg</Text>
            </View>
          </View>
        </Card>
      )}

      {/* AI Report Section */}
      {!aiReport && !isViewingCurrentMonth && (
        <Card title="AI Aylık Analiz">
          <ReportEmpty card={false} mood="sleepy" size={64} title="Bu ayın analizi yok" subtitle="Bu aya ait bir AI analizi oluşturulmamış." />
        </Card>
      )}
      {!aiReport && isViewingCurrentMonth && (
        <Card title="AI Aylık Analiz">
          <ReportEmpty card={false} mood="happy" size={72} title="Ayını birlikte okuyalım" subtitle="Yapay zeka ile aylık performans analizini oluştur." />
          <Button
            title="Rapor Oluştur"
            onPress={handleGenerateReport}
            loading={generating}
            disabled={generating}
          />
          {generating && <ThinkingFor kind="report_monthly" style={{ alignSelf: 'center', marginTop: SPACING.md }} />}
        </Card>
      )}

      {aiReport && (
        <>
          {/* Monthly Summary */}
          {aiReport.monthly_summary && (
            <Card title="Aylık Özet">
              <Text style={{ color: colors.text, ...TYPE.body }}>{aiReport.monthly_summary}</Text>
              {aiReport.trend_direction && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACING.sm }}>
                  <Text style={{ color: colors.textMuted, ...TYPE.caption }}>Trend: </Text>
                  <Text style={{ color: trendColor(aiReport.trend_direction), ...TYPE.bodyStrong, fontWeight: '700' }}>
                    {aiReport.trend_direction === 'yukselis' ? 'Yükseliş' : aiReport.trend_direction === 'dusus' ? 'Düşüş' : 'Stabil'}
                  </Text>
                </View>
              )}
            </Card>
          )}

          {/* Top Achievement */}
          {aiReport.top_achievement && (
            // Ayın kutlama anı: kehribar kupa plakası + opak kehribar pastel kart (StreakBadge tonu).
            // Metin mürekkep — gök mavisi başlık açık zeminde 2,8:1 kalıyordu.
            <Card title="Ayın Başarısı" style={{ backgroundColor: tint(METRIC_COLORS.streak, colors, isDark, isDark ? 0.75 : 1.2) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: METRIC_COLORS.streak, borderBottomWidth: 3, borderBottomColor: STREAK_SHELF, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="trophy" size={24} color={PLATE_INK} />
                </View>
                <Text style={{ color: colors.text, ...TYPE.headline, flex: 1 }}>{aiReport.top_achievement}</Text>
              </View>
            </Card>
          )}

          {/* Risk Signals */}
          {Array.isArray(aiReport.risk_signals) && aiReport.risk_signals.length > 0 && (
            <Card title="Risk Sinyalleri">
              {aiReport.risk_signals.map((signal, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: i < aiReport.risk_signals!.length - 1 ? SPACING.xs : 0 }}>
                  <Ionicons name="alert-circle" size={18} color={colors.errorText} style={{ marginRight: SPACING.sm, marginTop: 2 }} />
                  <Text style={{ color: colors.text, ...TYPE.body, flex: 1 }}>{signal}</Text>
                </View>
              ))}
            </Card>
          )}

          {/* FIX (ux-round3 #1): Sapma Dağılımı — render the deviation_distribution the edge already
              computes (was defined on the type but never shown, leaving the monthly view poorer than
              weekly). Sorted most→least frequent, each a labelled bar. */}
          {aiReport.deviation_distribution
            && Object.entries(aiReport.deviation_distribution).some(([k, v]) => k !== 'yok' && v > 0) && (
            <Card title="Sapma Dağılımı">
              {(() => {
                const entries = Object.entries(aiReport.deviation_distribution!)
                  .filter(([k, v]) => k !== 'yok' && v > 0)
                  .sort((a, b) => b[1] - a[1]);
                const max = Math.max(...entries.map(([, v]) => v));
                return entries.map(([k, v]) => (
                  <View key={k} style={{ marginBottom: SPACING.sm }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                      <Text style={{ color: colors.text, ...TYPE.body }}>{DEVIATION_LABELS[k] ?? k}</Text>
                      <Text style={{ color: colors.textMuted, ...TYPE.body }}>{v} gün</Text>
                    </View>
                    <ProgressBar progress={max > 0 ? v / max : 0} color={colors.warning} height={10} />
                  </View>
                ));
              })()}
            </Card>
          )}

          {/* Behavioral Patterns */}
          {Array.isArray(aiReport.behavioral_patterns) && aiReport.behavioral_patterns.length > 0 && (
            <Card title="Davranış Kalıpları">
              {aiReport.behavioral_patterns.map((pattern, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: i < aiReport.behavioral_patterns!.length - 1 ? SPACING.xs : 0 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginRight: SPACING.sm, marginTop: 7 }} />
                  <Text style={{ color: colors.text, ...TYPE.body, flex: 1 }}>{pattern}</Text>
                </View>
              ))}
            </Card>
          )}

          {/* Next Month Focus */}
          {aiReport.next_month_focus && (
            <Card title="Gelecek Ay Odak">
              <Text style={{ color: colors.text, ...TYPE.body }}>{aiReport.next_month_focus}</Text>
            </Card>
          )}

          {/* Regenerate */}
          <Button
            title="Raporu Yenile"
            onPress={handleGenerateReport}
            variant="outline"
            loading={generating}
            disabled={generating}
            // Alt boşluk: buton altındaki "Hedefe Kalan" kartına yapışıyordu.
            style={{ marginTop: SPACING.sm, marginBottom: SPACING.md }}
          />
          {generating && <ThinkingFor kind="report_monthly" style={{ alignSelf: 'center', marginTop: SPACING.md }} />}
        </>
      )}

      {/* Goal Progress */}
      {!!(profile?.target_weight_kg) && lastWeight && (
        <Card title="Hedefe Kalan">
          <Text style={{ color: colors.text, ...TYPE.title3, textAlign: 'center' }}>
            {/* FIX (ux-pass5): TR ondalık virgül. */}
            {Math.abs(lastWeight - (profile.target_weight_kg as number)).toFixed(1).replace('.', ',')} kg
          </Text>
          <Text style={{ color: colors.textMuted, ...TYPE.body, textAlign: 'center', marginTop: SPACING.xs }}>
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
            <View key={i} style={{ paddingVertical: SPACING.sm, borderBottomWidth: i < weeklyReports.length - 1 ? 1 : 0, borderBottomColor: colors.divider }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs }}>
                <Text style={{ color: colors.textSecondary, ...TYPE.body }}>{weekLabel} haftası</Text>
                <Text style={{ color: colors.text, ...TYPE.bodyStrong, fontWeight: '800' }}>%{compliance}</Text>
              </View>
              {/* Çubuk rengi uyum kademesinden (70/40) — halka ve takvimle aynı yargı. */}
              <ProgressBar progress={compliance / 100} color={getComplianceColor(compliance, colors)} height={12} />
            </View>
          );
        })}
        {weeklyReports.length === 0 && (
          <ReportEmpty card={false} mood="sleepy" size={64} title="Henüz haftalık rapor yok" subtitle="Haftalık raporların burada sıralanacak." />
        )}
      </Card>
    </ScrollView>
  );
}

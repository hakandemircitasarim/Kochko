import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { CircularProgress } from '@/components/ui/CircularProgress';
import { Card } from '@/components/ui/Card';
import { SPACING, FONT } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useTheme } from '@/lib/theme';
import { haptics } from '@/lib/haptics';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { LoadErrorState } from '@/components/ui/LoadErrorState';

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

// FIX (final sweep): plan_revision keys are raw English identifiers (calorie_adj…) — map the
// known ones to Turkish; unknown keys keep the old s/_/ / fallback.
const PLAN_REVISION_LABELS: Record<string, string> = {
  calorie_adj: 'Kalori ayarı',
  protein_adj: 'Protein ayarı',
  workout_change: 'Antrenman değişikliği',
};

export default function WeeklyReportScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  // FIX (ux-round2 #14): previous week's compliance for the headline trend.
  const [prevCompliance, setPrevCompliance] = useState<number | null>(null);
  const [alcohol, setAlcohol] = useState<AlcoholWeeklyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadReport = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(false);
    try {
      // FIX (ux-round2 #14): fetch the last 2 weeks (was limit(1).single()) so the headline can show
      // the change vs the previous week. supabase-js never rejects — a real error resolves as
      // { error }; 0 rows is simply the empty state (no PGRST116 without .single()).
      const { data, error: loadError } = await supabase.from('weekly_reports').select('*').eq('user_id', user.id).order('week_start', { ascending: false }).limit(2);
      if (loadError) {
        setError(true);
      } else {
        const rows = (data ?? []) as WeeklyReport[];
        if (rows.length > 0) {
          setReport(rows[0]);
          setPrevCompliance(rows.length > 1 ? rows[1].avg_compliance : null);
          await loadAlcoholData(user.id, rows[0].week_start);
        }
      }
    } catch {
      // Network/auth failure must not strand the user on an infinite spinner — show a
      // recoverable error state with a retry instead (#screen-states).
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const loadAlcoholData = async (userId: string, weekStart: string) => {
    const ws = new Date(weekStart);
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    const prevWs = new Date(ws); prevWs.setDate(ws.getDate() - 7);
    const prevWe = new Date(ws); prevWe.setDate(ws.getDate() - 1);

    const [thisWeekRows, prevWeekRows] = await Promise.all([
      supabase.from('daily_reports').select('date, alcohol_calories').eq('user_id', userId).gte('date', ws.toISOString().split('T')[0]).lte('date', we.toISOString().split('T')[0]),
      supabase.from('daily_reports').select('alcohol_calories').eq('user_id', userId).gte('date', prevWs.toISOString().split('T')[0]).lte('date', prevWe.toISOString().split('T')[0]),
    ]);

    // FIX (ux-pass5): both queries resolve { data: null, error } on failure — don't fabricate a
    // 0 kcal alcohol week from a failed fetch; leave `alcohol` null so the card stays hidden.
    if (thisWeekRows.error || prevWeekRows.error) return;

    let weekdayKcal = 0, weekendKcal = 0, thisWeekTotal = 0;
    for (const r of (thisWeekRows.data ?? []) as { date: string; alcohol_calories: number | null }[]) {
      const kcal = r.alcohol_calories ?? 0;
      thisWeekTotal += kcal;
      const d = new Date(r.date).getDay();
      // Turkish weekend is Saturday(6)+Sunday(0). Friday(5) was wrongly bucketed
      // as weekend, inflating the "Hafta sonu" total (#R2-16).
      if (d === 0 || d === 6) weekendKcal += kcal;
      else weekdayKcal += kcal;
    }
    const prevWeekTotal = ((prevWeekRows.data ?? []) as { alcohol_calories: number | null }[])
      .reduce((s, r) => s + (r.alcohol_calories ?? 0), 0);

    setAlcohol({ thisWeek: thisWeekTotal, prevWeek: prevWeekTotal, weekdayKcal, weekendKcal });
  };

  const handleGenerate = async () => {
    if (!user?.id) return;
    setGenerating(true);
    try {
      // The ai-report response omits persisted fields (weight_trend, actuals); reading
      // the raw response left report.weight_trend undefined → crash at the .length check.
      // Re-read the stored row (NOT NULL weight_trend default []) so the UI is safe + complete.
      const { error: invokeError } = await supabase.functions.invoke('ai-report', { body: { report_type: 'weekly', force: true } });
      if (invokeError) throw invokeError;
      const { data } = await supabase.from('weekly_reports').select('*').eq('user_id', user.id).order('week_start', { ascending: false }).limit(1).single();
      if (data) {
        setReport(data as WeeklyReport);
        if ((data as WeeklyReport).week_start) {
          await loadAlcoholData(user.id, (data as WeeklyReport).week_start);
        }
        haptics.success();
      } else {
        // Invoke succeeded but no row came back — don't leave the user tapping into the void.
        Alert.alert('Rapor hazır değil', 'Henüz yeterli veri yok gibi görünüyor, birazdan tekrar dene.');
      }
    } catch {
      haptics.error();
      // AI-dependent surface: the coach (LLM) can be temporarily unavailable — make it
      // clear it's not the user's fault and that retrying later is the right move.
      Alert.alert('Koç şu an meşgul', 'Raporun oluşturulamadı, birazdan tekrar dene.');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <SkeletonScreen cards={3} />;

  // FIX (ux-pass5): only replace the screen with the error state when nothing is loaded —
  // a refresh failure must not hide an already-shown report. (refactor: shared LoadErrorState)
  if (error && !report) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadErrorState title="Rapor yüklenemedi" subtitle="İnternet bağlantını kontrol et." onRetry={loadReport} />
      </View>
    );
  }

  const compColor = (report?.avg_compliance ?? 0) >= 70 ? colors.success : (report?.avg_compliance ?? 0) >= 40 ? colors.warning : colors.error;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {report && <Text style={{ ...TYPE.body, color: colors.textSecondary, marginBottom: SPACING.lg }}>Hafta: {new Date(report.week_start).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}</Text>}

      {!report ? (
        <Card>
          {/* FIX (ux-polish): iconed empty state with a visual anchor (was a flat left-aligned sentence). */}
          <View style={{ alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.md }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceLight, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="document-text-outline" size={26} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, ...TYPE.headline, textAlign: 'center' }}>Henüz haftalık rapor yok</Text>
            <Text style={{ color: colors.textSecondary, ...TYPE.body, textAlign: 'center', marginBottom: SPACING.sm }}>Haftanı özetleyeyim — birkaç saniye sürer.</Text>
            <Button title="Rapor Oluştur" onPress={handleGenerate} loading={generating} size="lg" />
            {generating && (
              <Text style={{ color: colors.textSecondary, ...TYPE.body, textAlign: 'center', marginTop: SPACING.md }}>
                Koç haftanı analiz ediyor, bu birkaç saniye sürebilir…
              </Text>
            )}
          </View>
        </Card>
      ) : (
        <>
          {/* Compliance */}
          <Card>
            <View style={{ alignItems: 'center', paddingVertical: SPACING.md }}>
              {/* FIX (ux-round2 #14): '%' unit (was a bare '68') + trend vs last week.
                  ux-polish: the compliance ring (same as daily/monthly) instead of a flat number,
                  so all three reports open with the shared hero treatment. */}
              <CircularProgress progress={report.avg_compliance / 100} value={`%${report.avg_compliance}`} size={120} strokeWidth={8} color={compColor} a11yLabel="Ortalama uyum" />
              <Text style={{ ...TYPE.body, color: colors.textSecondary, marginTop: SPACING.sm }}>Ortalama Uyum</Text>
              {prevCompliance != null && (() => {
                const d = report.avg_compliance - prevCompliance;
                if (d === 0) return <Text style={{ color: colors.textMuted, ...TYPE.body, marginTop: SPACING.xs }}>geçen haftayla aynı</Text>;
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: SPACING.xs }}>
                    <Ionicons name={d > 0 ? 'arrow-up' : 'arrow-down'} size={13} color={d > 0 ? colors.success : colors.warning} />
                    <Text style={{ color: d > 0 ? colors.success : colors.warning, ...TYPE.bodyStrong, fontWeight: '700' }}>
                      geçen haftaya göre {d > 0 ? '+' : '−'}{Math.abs(d)}
                    </Text>
                  </View>
                );
              })()}
              {report.weekly_budget_compliance != null && (
                <Text style={{ color: report.weekly_budget_compliance ? colors.success : colors.warning, ...TYPE.body, marginTop: SPACING.xs }}>
                  Haftalık bütçe: {report.weekly_budget_compliance ? 'Tutturuldu' : 'Aşıldı'}
                </Text>
              )}
            </View>
          </Card>

          {/* Weight Trend */}
          {report.weight_trend.length > 0 && (
            <Card title="Kilo Trendi">
              {/* FIX (ux-round4 #9): net-for-the-week headline so "did I actually lose weight?" is
                  answered without eyeballing and summing 7 per-day deltas. Neutral color on purpose —
                  down isn't universally "good" (gain-muscle users want up). */}
              {report.weight_trend.length >= 2 && (() => {
                const net = report.weight_trend[report.weight_trend.length - 1].kg - report.weight_trend[0].kg;
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SPACING.sm, marginBottom: SPACING.sm, paddingBottom: SPACING.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Bu hafta net:</Text>
                    <Text style={{ color: colors.text, ...TYPE.title3 }}>
                      {net > 0 ? '+' : ''}{net.toFixed(1).replace('.', ',')} kg
                    </Text>
                  </View>
                );
              })()}
              {report.weight_trend.map((w, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs, gap: SPACING.md }}>
                  <Text style={{ color: colors.textSecondary, ...TYPE.body, width: 60 }}>
                    {new Date(w.date).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric' })}
                  </Text>
                  <Text style={{ color: colors.text, ...TYPE.headline, flex: 1 }}>{w.kg} kg</Text>
                  {i > 0 && (
                    <Text style={{ ...TYPE.bodyStrong, color: w.kg < report.weight_trend[i - 1].kg ? colors.success : w.kg > report.weight_trend[i - 1].kg ? colors.error : colors.textMuted }}>
                      {/* FIX (ux-pass5): TR ondalık virgül. */}
                      {w.kg < report.weight_trend[i - 1].kg ? '' : '+'}{(w.kg - report.weight_trend[i - 1].kg).toFixed(1).replace('.', ',')}
                    </Text>
                  )}
                </View>
              ))}
            </Card>
          )}

          {/* Best/Worst Day */}
          {/* Ayni gun hem "En Iyi" hem "Zorlu gun" olarak listeleniyordu (cihazda:
              "En Iyi 2 Pazar" / "Zorlu gun 2 Pazar"). Bu, haftanin tek kayitli gunu
              oldugunda oluyor — kiyaslanacak ikinci bir gun yok, ama kart iki uc
              varmis gibi konusuyor. Tek olcumden fark uydurmama kuralinin ayni
              ailesi (bkz. §11): iki uc ancak farkli gunlerse gosterilir. */}
          {(report.best_day || report.worst_day) && report.best_day !== report.worst_day && (
            <Card title="Haftanın Günleri">
              {report.best_day && (
                <View style={{ flexDirection: 'row', gap: SPACING.md, paddingVertical: SPACING.xs }}>
                  <Text style={{ color: colors.success, ...TYPE.bodyStrong, width: 68 }}>En İyi</Text>
                  <Text style={{ color: colors.text, ...TYPE.body }}>{new Date(report.best_day).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric' })}</Text>
                </View>
              )}
              {report.worst_day && (
                <View style={{ flexDirection: 'row', gap: SPACING.md, paddingVertical: SPACING.xs }}>
                  {/* ux-sweep: kardeş progress.tsx bilinçli 'Zorlu gün' der — utandırma dili yok. */}
                  <Text style={{ color: colors.warning, ...TYPE.bodyStrong, width: 68 }}>Zorlu gün</Text>
                  <Text style={{ color: colors.text, ...TYPE.body }}>{new Date(report.worst_day).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric' })}</Text>
                </View>
              )}
            </Card>
          )}

          {/* Top Deviation */}
          {report.top_deviation && (
            <Card title="En Çok Sapılan Konu">
              <Text style={{ color: colors.warning, ...TYPE.headline }}>{report.top_deviation}</Text>
            </Card>
          )}

          {/* Strength Summary */}
          {report.strength_summary && (
            <Card title="Güç Özeti">
              <Text style={{ color: colors.text, ...TYPE.body }}>{report.strength_summary}</Text>
            </Card>
          )}

          {/* Alcohol Summary — Spec 3.1, 8.2 */}
          {alcohol && alcohol.thisWeek > 0 && (
            <Card title="Alkol Özeti">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs }}>
                <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Bu hafta toplam</Text>
                <Text style={{ color: colors.text, ...TYPE.headline }}>{alcohol.thisWeek} kcal</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs }}>
                <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Hafta içi</Text>
                <Text style={{ color: colors.text, ...TYPE.body }}>{alcohol.weekdayKcal} kcal</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs }}>
                <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Hafta sonu</Text>
                <Text style={{ color: colors.text, ...TYPE.body }}>{alcohol.weekendKcal} kcal</Text>
              </View>
              {alcohol.prevWeek > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs, marginTop: SPACING.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Geçen hafta</Text>
                  <Text style={{ color: alcohol.thisWeek < alcohol.prevWeek ? colors.success : alcohol.thisWeek > alcohol.prevWeek ? colors.warning : colors.textMuted, ...TYPE.bodyStrong }}>
                    {alcohol.prevWeek} kcal ({alcohol.thisWeek > alcohol.prevWeek ? '+' : ''}{alcohol.thisWeek - alcohol.prevWeek})
                  </Text>
                </View>
              )}
            </Card>
          )}

          {/* AI Learning Note */}
          {report.ai_learning_note && (
            <Card title="Bu Hafta Seni Daha İyi Tanıdım">
              <Text style={{ color: colors.primary, ...TYPE.body, fontStyle: 'italic' }}>{report.ai_learning_note}</Text>
            </Card>
          )}

          {/* Strategy */}
          <Card title="Gelecek Hafta Stratejisi">
            <Text style={{ color: colors.text, ...TYPE.body }}>{report.next_week_strategy}</Text>
          </Card>

          {/* Plan Revision */}
          {report.plan_revision && Object.keys(report.plan_revision).length > 0 && (
            <Card title="Plan Revizyonu">
              {Object.entries(report.plan_revision).map(([key, val]) =>
                val != null ? (
                  <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs }}>
                    <Text style={{ color: colors.textSecondary, ...TYPE.body }}>{PLAN_REVISION_LABELS[key] ?? key.replace(/_/g, ' ')}</Text>
                    <Text style={{ color: colors.primary, ...TYPE.headline }}>{String(val)}</Text>
                  </View>
                ) : null
              )}
            </Card>
          )}

          <Button title="Yeniden Oluştur" variant="outline" onPress={handleGenerate} loading={generating} />
          {generating && (
            <Text style={{ color: colors.textSecondary, ...TYPE.body, textAlign: 'center', marginTop: SPACING.md }}>
              Koç haftanı analiz ediyor, bu birkaç saniye sürebilir…
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

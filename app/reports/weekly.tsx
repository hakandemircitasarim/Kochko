import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

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
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [alcohol, setAlcohol] = useState<AlcoholWeeklyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadReport = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(false);
    try {
      const { data } = await supabase.from('weekly_reports').select('*').eq('user_id', user.id).order('week_start', { ascending: false }).limit(1).single();
      if (data) {
        setReport(data as WeeklyReport);
        await loadAlcoholData(user.id, (data as WeeklyReport).week_start);
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
      Alert.alert('Koç şu an meşgul', 'Raporun oluşturulamadı. Lütfen birkaç dakika sonra tekrar dene.');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} accessibilityLabel="Rapor yükleniyor" /></View>;

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background, padding: SPACING.xl }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.md, textAlign: 'center', marginBottom: SPACING.lg }}>
          Rapor yüklenemedi. İnternet bağlantını kontrol et.
        </Text>
        <TouchableOpacity
          onPress={loadReport}
          accessibilityRole="button"
          accessibilityLabel="Tekrar dene"
          style={{ backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingVertical: SPACING.md, paddingHorizontal: SPACING.xxl, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: getContrastColor(COLORS.primary), fontSize: FONT.md, fontWeight: '600' }}>Tekrar dene</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const compColor = (report?.avg_compliance ?? 0) >= 70 ? COLORS.success : (report?.avg_compliance ?? 0) >= 40 ? COLORS.warning : COLORS.error;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {report && <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>Hafta: {new Date(report.week_start).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}</Text>}

      {!report ? (
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: SPACING.lg }}>Henüz haftalık rapor yok.</Text>
          <Button title="Rapor Oluştur" onPress={handleGenerate} loading={generating} size="lg" />
          {generating && (
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.md }}>
              Koç haftanı analiz ediyor, bu birkaç saniye sürebilir...
            </Text>
          )}
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
                  Haftalık bütçe: {report.weekly_budget_compliance ? 'Tutturuldu' : 'Aşıldı'}
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
            <Card title="Haftanın Günleri">
              {report.best_day && (
                <View style={{ flexDirection: 'row', gap: SPACING.md, paddingVertical: SPACING.xs }}>
                  <Text style={{ color: COLORS.success, fontSize: FONT.sm, fontWeight: '600', width: 50 }}>En İyi</Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{new Date(report.best_day).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric' })}</Text>
                </View>
              )}
              {report.worst_day && (
                <View style={{ flexDirection: 'row', gap: SPACING.md, paddingVertical: SPACING.xs }}>
                  <Text style={{ color: COLORS.error, fontSize: FONT.sm, fontWeight: '600', width: 50 }}>En Kötü</Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md }}>{new Date(report.worst_day).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric' })}</Text>
                </View>
              )}
            </Card>
          )}

          {/* Top Deviation */}
          {report.top_deviation && (
            <Card title="En Çok Sapılan Konu">
              <Text style={{ color: COLORS.warning, fontSize: FONT.md, fontWeight: '500' }}>{report.top_deviation}</Text>
            </Card>
          )}

          {/* Strength Summary */}
          {report.strength_summary && (
            <Card title="Güç Özeti">
              <Text style={{ color: COLORS.text, fontSize: FONT.md, lineHeight: 22 }}>{report.strength_summary}</Text>
            </Card>
          )}

          {/* Alcohol Summary — Spec 3.1, 8.2 */}
          {alcohol && alcohol.thisWeek > 0 && (
            <Card title="Alkol Özeti">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Bu hafta toplam</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{alcohol.thisWeek} kcal</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Hafta içi</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.sm }}>{alcohol.weekdayKcal} kcal</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Hafta sonu</Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.sm }}>{alcohol.weekendKcal} kcal</Text>
              </View>
              {alcohol.prevWeek > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.xs, marginTop: SPACING.xs, borderTopWidth: 1, borderTopColor: COLORS.border }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Geçen hafta</Text>
                  <Text style={{ color: alcohol.thisWeek < alcohol.prevWeek ? COLORS.success : alcohol.thisWeek > alcohol.prevWeek ? COLORS.warning : COLORS.textMuted, fontSize: FONT.sm, fontWeight: '500' }}>
                    {alcohol.prevWeek} kcal ({alcohol.thisWeek > alcohol.prevWeek ? '+' : ''}{alcohol.thisWeek - alcohol.prevWeek})
                  </Text>
                </View>
              )}
            </Card>
          )}

          {/* AI Learning Note */}
          {report.ai_learning_note && (
            <Card title="Bu Hafta Seni Daha İyi Tanıdım">
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

          <Button title="Yeniden Oluştur" variant="outline" onPress={handleGenerate} loading={generating} />
          {generating && (
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.md }}>
              Koç haftanı analiz ediyor, bu birkaç saniye sürebilir...
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { deriveNutritionTargets } from '@/lib/nutrition-targets';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ComplianceScore } from '@/components/reports/ComplianceScore';
import { DeviationTag } from '@/components/reports/DeviationTag';
import { SkeletonScreen } from '@/components/ui/Skeleton';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { SPACING, FONT } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useTheme } from '@/lib/theme';
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
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [generating, setGenerating] = useState(false);
  // FIX (ux-pass5): 'today' was the UTC calendar date (toISOString jumps to "tomorrow" at local
  // 21:00 in UTC+3) and ignored the user's day boundary — at 00:51 the screen offered a gün-sonu
  // raporu for a day that hasn't experientially started (and would generate a zero-data report
  // for the wrong date). Use the same effective-day anchor as the diary/dashboard.
  const dayBoundaryHour = useProfileStore(s => (s.profile?.day_boundary_hour as number) ?? 4);
  const profile = useProfileStore(s => s.profile);
  const today = getEffectiveDate(new Date(), dayBoundaryHour);
  // FIX (ux-audit major): the Gün Sonu report + the Takvim's per-day tap now reach a SPECIFIC
  // day's rich report (narrative / tomorrow_action / deviation reason) — before, this screen was
  // hardwired to today, so every past day's most valuable AI output evaporated overnight.
  const params = useLocalSearchParams<{ date?: string }>();
  const reportDate = (typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) ? params.date : today;
  const isToday = reportDate === today;
  // FIX (ux-round2 #6): the report showed bare actuals ('1850 kcal') with no target, so a green/red
  // tick had no "how close was I" context. Derive the current targets (the row doesn't store them —
  // an approximation if the band changed since, but the met-boolean stays authoritative).
  const targets = deriveNutritionTargets(profile, { calorieMin: null, calorieMax: null, proteinG: null, carbsG: null, fatG: null });

  const loadReport = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(false);
    try {
      const { data, error: loadError } = await supabase.from('daily_reports').select('*').eq('user_id', user.id).eq('date', reportDate).single();
      // FIX (ux-pass5): supabase-js never rejects — failures resolve as { data: null, error }, so the
      // catch below never fired and an offline open showed "Rapor henüz oluşturulmamış." over an
      // existing report. PGRST116 (.single() with 0 rows) is the legit "rapor yok" case, not a failure.
      if (loadError && loadError.code !== 'PGRST116') setError(true);
      else if (data) setReport(data as DailyReport);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [user?.id, reportDate]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const handleGenerate = async () => {
    if (!user?.id) return;
    setGenerating(true);
    // The ai-report response omits the computed actuals (calorie_actual, etc. — they
    // are only written to the row). Re-read the persisted row so the UI shows real
    // numbers instead of "undefined".
    try {
      const { error: invokeError } = await supabase.functions.invoke('ai-report', { body: { report_type: 'daily', date: reportDate, force: true } });
      if (invokeError) throw invokeError;
      const { data } = await supabase.from('daily_reports').select('*').eq('user_id', user.id).eq('date', reportDate).single();
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
      Alert.alert('Koç şu an meşgul', 'Raporun oluşturulamadı, birazdan tekrar dene.');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <SkeletonScreen cards={3} />;

  // FIX (ux-pass5): only replace the screen with the error state when nothing is loaded —
  // a refresh failure must not hide an already-shown report. (refactor: shared LoadErrorState)
  if (error && !report) return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <LoadErrorState title="Rapor yüklenemedi" onRetry={loadReport} />
    </View>
  );

  const scoreColor = (report?.compliance_score ?? 0) >= 70 ? colors.success : (report?.compliance_score ?? 0) >= 40 ? colors.warning : colors.error;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ ...TYPE.body, color: colors.textSecondary, marginBottom: SPACING.lg }}>
        {new Date(`${reportDate}T00:00:00`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </Text>

      {!report ? (
        <Card>
          {/* FIX (ux-audit major): a past day with no report is not something you retro-generate —
              show it plainly. Only today offers "Rapor Oluştur". */}
          {isToday ? (
            <>
              <Text style={{ color: colors.textSecondary, ...TYPE.body, marginBottom: SPACING.lg }}>Rapor henüz oluşturulmamış.</Text>
              <Button title="Rapor Oluştur" onPress={handleGenerate} loading={generating} size="lg" />
              {generating && (
                <Text style={{ color: colors.textSecondary, ...TYPE.caption, marginTop: SPACING.sm, textAlign: 'center' }}>Koç gününü analiz ediyor, bu birkaç saniye sürebilir…</Text>
              )}
            </>
          ) : (
            <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Bu güne ait bir gün sonu raporu yok.</Text>
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
            <CheckItem label="Kalori" met={report.calorie_target_met} detail={targets.calorieTargetMax > 0 ? `${report.calorie_actual} / ${targets.calorieTargetMin}-${targets.calorieTargetMax} kcal` : `${report.calorie_actual} kcal`} />
            {/* FIX (adversarial-review): proteinG ALWAYS falls back to 120 (deriveNutritionTargets),
                so `proteinG > 0` never hides it — a fabricated '/ 120 g' could contradict the
                authoritative met-tick. Only show the target when the user has real protein data. */}
            <CheckItem label="Protein" met={report.protein_target_met} detail={(profile?.protein_per_kg && profile?.weight_kg) ? `${report.protein_actual} / ${targets.proteinG} g` : `${report.protein_actual}g`} />
            <CheckItem label="Antrenman" met={report.workout_completed} />
            <CheckItem label="Su" met={report.water_target_met ?? false} />
          </Card>

          {/* Macros */}
          <Card title="Makro Dağılımı">
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              <MacroCircle label="Protein" value={report.protein_actual} unit="g" color={colors.protein} />
              <MacroCircle label="Karb" value={report.carbs_actual} unit="g" color={colors.carbs} />
              <MacroCircle label="Yağ" value={report.fat_actual} unit="g" color={colors.fat} />
              {/* FIX (audit UI-STA-06): use the lighter `errorText` tone (>=4.5:1 on card) for the
                  accent value text instead of base `error` (4.39:1, below AA-small). */}
              {report.alcohol_calories > 0 && <MacroCircle label="Alkol" value={report.alcohol_calories} unit="kcal" color={colors.errorText} />}
            </View>
          </Card>

          {/* Impacts */}
          {(report.sleep_impact || report.water_impact) && (
            <Card title="Etkiler">
              {report.sleep_impact && <Text style={{ color: colors.text, ...TYPE.body, marginBottom: SPACING.xs }}>Uyku: {report.sleep_impact}</Text>}
              {report.water_impact && <Text style={{ color: colors.text, ...TYPE.body }}>Su: {report.water_impact}</Text>}
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
              <Text style={{ color: colors.text, ...TYPE.body }}>{report.weekly_budget_status}</Text>
            </Card>
          )}

          {/* Full Report */}
          <Card title="Değerlendirme">
            <Text style={{ color: colors.text, ...TYPE.body }}>{report.full_report}</Text>
          </Card>

          {/* Tomorrow */}
          <Card title="Yarın İçin Tek Aksiyon">
            <Text style={{ color: colors.primary, ...TYPE.title3 }}>{report.tomorrow_action}</Text>
          </Card>

          {/* ux-sweep (daily-no-regenerate): otomatik gece job'ı satırı yazınca kullanıcı butona
              hiç basmadan 'dolu' ekrana düşüyor ve akşamki yeni kayıtlardan sonra raporu tazeleme
              yolu YOKTU — kardeş weekly.tsx kalıbıyla yalnız BUGÜN için yenile. */}
          {isToday && (
            <Button title="Yeniden Oluştur" variant="outline" onPress={handleGenerate} loading={generating} />
          )}
        </>
      )}
    </ScrollView>
  );
}

function CheckItem({ label, met, detail }: { label: string; met: boolean; detail?: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, gap: SPACING.sm }}
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${met ? 'hedef tutturuldu' : 'hedef tutturulmadı'}${detail ? `, ${detail}` : ''}`}
    >
      <Ionicons name={met ? 'checkmark-circle' : 'close-circle'} size={24} color={met ? colors.success : colors.error} />
      <Text style={{ color: colors.text, ...TYPE.body, flex: 1 }}>{label}</Text>
      {detail && <Text style={{ color: colors.textSecondary, ...TYPE.body }}>{detail}</Text>}
    </View>
  );
}

function MacroCircle({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center' }} accessibilityRole="text" accessibilityLabel={`${label}: ${value} ${unit}`}>
      <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 3, borderColor: color, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color, ...TYPE.headline }}>{value}</Text>
      </View>
      <Text style={{ color: colors.textSecondary, ...TYPE.caption, marginTop: 4 }}>{label}</Text>
      <Text style={{ color: colors.textMuted, ...TYPE.caption }}>{unit}</Text>
    </View>
  );
}

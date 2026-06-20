/**
 * Health Professional Export Screen
 * Spec 8.7: Sağlık profesyoneli rapor exportu
 * PDF/CSV format, selected date range, professional-facing format.
 */
import { useState } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { exportPDF } from '@/services/export.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import { haptics } from '@/lib/haptics';

export default function HealthExportScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exporting, setExporting] = useState(false);

  const applyQuickRange = (months: number) => {
    haptics.tap();
    const today = new Date();
    setEndDate(today.toISOString().split('T')[0]);
    setStartDate(new Date(Date.now() - months * 30 * 86400000).toISOString().split('T')[0]);
  };

  const handleExport = async () => {
    if (!user?.id) return;
    const start = startDate || new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]; // default 3 months
    const end = endDate || new Date().toISOString().split('T')[0];

    setExporting(true);

    try {
      // Gather all relevant health data
      const [profileRes, metricsRes, reportsRes, labRes, workoutsRes] = await Promise.all([
        supabase.from('profiles').select('height_cm, weight_kg, birth_year, gender, activity_level').eq('id', user.id).single(),
        supabase.from('daily_metrics').select('date, weight_kg, sleep_hours, steps').eq('user_id', user.id).gte('date', start).lte('date', end).order('date'),
        supabase.from('daily_reports').select('date, compliance_score, calorie_actual, protein_actual').eq('user_id', user.id).gte('date', start).lte('date', end).order('date'),
        supabase.from('lab_values').select('parameter_name, value, unit, reference_min, reference_max, measured_at, is_out_of_range').eq('user_id', user.id).gte('measured_at', start).lte('measured_at', end).order('measured_at'),
        supabase.from('workout_logs').select('logged_for_date, workout_type, duration_min, intensity').eq('user_id', user.id).gte('logged_for_date', start).lte('logged_for_date', end).order('logged_for_date'),
      ]);

      const profile = profileRes.data;
      const metrics = metricsRes.data ?? [];
      const reports = reportsRes.data ?? [];
      const labs = labRes.data ?? [];
      const workouts = workoutsRes.data ?? [];

      const age = profile?.birth_year ? new Date().getFullYear() - (profile.birth_year as number) : null;

      // Weight trend
      const weights = (metrics as { date: string; weight_kg: number | null }[]).filter(m => m.weight_kg);
      const weightChange = weights.length >= 2
        ? (weights[weights.length - 1].weight_kg as number) - (weights[0].weight_kg as number)
        : null;

      // Nutrition averages
      const typedReports = reports as { date: string; compliance_score: number; calorie_actual: number; protein_actual: number }[];
      const avgCompliance = typedReports.length > 0
        ? Math.round(typedReports.reduce((s, r) => s + r.compliance_score, 0) / typedReports.length)
        : 0;
      const avgCal = typedReports.length > 0
        ? Math.round(typedReports.reduce((s, r) => s + r.calorie_actual, 0) / typedReports.length)
        : 0;
      const avgPro = typedReports.length > 0
        ? Math.round(typedReports.reduce((s, r) => s + r.protein_actual, 0) / typedReports.length)
        : 0;

      // Build insights list
      const insights: string[] = [];
      insights.push(`Hasta: Yaş ${age ?? '-'} | Cinsiyet: ${profile?.gender ?? '-'} | Boy: ${profile?.height_cm ?? '-'} cm | Kilo: ${profile?.weight_kg ?? '-'} kg`);
      if (avgCal > 0) insights.push(`Ortalama günlük kalori: ${avgCal} kcal | Protein: ${avgPro} g`);
      const typedWorkouts = workouts as { duration_min: number }[];
      if (typedWorkouts.length > 0) {
        const totalMin = typedWorkouts.reduce((s, w) => s + w.duration_min, 0);
        insights.push(`Toplam antrenman: ${workouts.length} seans | ${totalMin} dakika`);
      }
      for (const l of labs as { parameter_name: string; value: number; unit: string; reference_min: number | null; reference_max: number | null; measured_at: string; is_out_of_range: boolean }[]) {
        if (l.is_out_of_range) {
          insights.push(`[REFERANS DIŞI] ${l.parameter_name}: ${l.value} ${l.unit} (ref: ${l.reference_min ?? '-'}-${l.reference_max ?? '-'}) — ${l.measured_at}`);
        }
      }

      // Build weekly data from reports
      const weeklyData = typedReports.slice(-8).map(r => ({
        week: r.date,
        compliance: r.compliance_score,
        weight: null as number | null,
      }));

      const summaryParts: string[] = [];
      summaryParts.push(`Tarih aralığı: ${start} - ${end}.`);
      summaryParts.push(`Hasta bilgileri: Yaş ${age ?? '-'}, ${profile?.gender ?? '-'}, ${profile?.height_cm ?? '-'} cm.`);
      if (weightChange !== null) summaryParts.push(`Kilo değişimi: ${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)} kg.`);
      summaryParts.push('Bu rapor Kochko yaşam tarzı koçluk uygulaması tarafından oluşturulmuştur. Tıbbi değerlendirme için sağlık profesyonelinin yorumu gereklidir.');

      await exportPDF({
        title: 'Kochko Sağlık Profesyoneli Raporu',
        period: `${start} - ${end}`,
        compliance: avgCompliance,
        weightChange,
        summary: summaryParts.join(' '),
        insights,
        weeklyData,
      });
      haptics.success();
    } catch (err) {
      haptics.error();
      Alert.alert('Hata', 'Rapor oluşturulurken bir hata oluştu. Lütfen tekrar dene.');
    }

    setExporting(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Doktoruna veya diyetisyenine gösterebileceğin formatta bir rapor oluştur. Kilo trendi, beslenme özeti, lab değerleri ve egzersiz bilgileri içerir.
      </Text>

      <Card title="Tarih Aralığı">
        <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
          {[
            { label: 'Son 1 ay', months: 1 },
            { label: 'Son 3 ay', months: 3 },
            { label: 'Son 6 ay', months: 6 },
          ].map(chip => (
            <TouchableOpacity
              key={chip.months}
              onPress={() => applyQuickRange(chip.months)}
              accessibilityRole="button"
              accessibilityLabel={`${chip.label} aralığını seç`}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              style={{
                flex: 1,
                paddingVertical: SPACING.sm,
                borderRadius: RADIUS.pill,
                borderWidth: 0.5,
                borderColor: COLORS.border,
                backgroundColor: COLORS.inputBg,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500' }}>{chip.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
          <View style={{ flex: 1 }}>
            <Input
              label="Başlangıç"
              placeholder="2024-01-01"
              value={startDate}
              onChangeText={setStartDate}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              accessibilityLabel="Başlangıç tarihi, yıl-ay-gün biçiminde"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Bitiş"
              placeholder="2024-03-31"
              value={endDate}
              onChangeText={setEndDate}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              accessibilityLabel="Bitiş tarihi, yıl-ay-gün biçiminde"
            />
          </View>
        </View>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Boş bırakırsan son 3 ay kullanılır.</Text>
      </Card>

      <Card title="Rapor İçeriği">
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>
          - Hasta bilgileri (yaş, cinsiyet, boy, kilo){'\n'}
          - Kilo trendi (başlangıç → son){'\n'}
          - Beslenme özeti (ortalama kalori/protein){'\n'}
          - Lab değerleri (referans dışı işareti ile){'\n'}
          - Egzersiz özeti{'\n'}
          {'\n'}
          Not: Hassas veriler (sohbet geçmişi, ruh hali notları, AI notları) bu rapora dahil EDİLMEZ.
        </Text>
      </Card>

      <Button title="Rapor Oluştur ve Paylaş" onPress={handleExport} loading={exporting} size="lg" />
    </ScrollView>
  );
}

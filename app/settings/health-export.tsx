/**
 * Health Professional Export Screen
 * Spec 8.7: Sağlık profesyoneli rapor exportu
 * PDF/CSV format, selected date range, professional-facing format.
 */
import { useState } from 'react';
import { View, Text, ScrollView, Share, Alert } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export default function HealthExportScreen() {
  const user = useAuthStore(s => s.user);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exporting, setExporting] = useState(false);

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

      // Build professional report text
      let report = `KOCHKO - SAGLIK PROFESYONELI RAPORU\n`;
      report += `Tarih Araligi: ${start} - ${end}\n`;
      report += `Olusturulma: ${new Date().toISOString().split('T')[0]}\n`;
      report += `================================================\n\n`;

      report += `HASTA BILGILERI\n`;
      report += `Yas: ${age ?? '-'} | Cinsiyet: ${profile?.gender ?? '-'} | Boy: ${profile?.height_cm ?? '-'}cm\n`;
      report += `Mevcut Kilo: ${profile?.weight_kg ?? '-'}kg | Aktivite: ${profile?.activity_level ?? '-'}\n\n`;

      // Weight trend
      const weights = (metrics as { date: string; weight_kg: number | null }[]).filter(m => m.weight_kg);
      if (weights.length > 0) {
        report += `KILO TRENDI\n`;
        report += `Baslangic: ${weights[0].weight_kg}kg (${weights[0].date})\n`;
        report += `Son: ${weights[weights.length - 1].weight_kg}kg (${weights[weights.length - 1].date})\n`;
        report += `Degisim: ${((weights[weights.length - 1].weight_kg as number) - (weights[0].weight_kg as number)).toFixed(1)}kg\n\n`;
      }

      // Nutrition
      if (reports.length > 0) {
        const avgCal = Math.round((reports as { calorie_actual: number }[]).reduce((s, r) => s + r.calorie_actual, 0) / reports.length);
        const avgPro = Math.round((reports as { protein_actual: number }[]).reduce((s, r) => s + r.protein_actual, 0) / reports.length);
        report += `BESLENME (ortalama/gun)\n`;
        report += `Kalori: ${avgCal} kcal | Protein: ${avgPro}g\n\n`;
      }

      // Lab values
      if (labs.length > 0) {
        report += `LAB DEGERLERI\n`;
        for (const l of labs as { parameter_name: string; value: number; unit: string; reference_min: number | null; reference_max: number | null; measured_at: string; is_out_of_range: boolean }[]) {
          const flag = l.is_out_of_range ? ' [REFERANS DISI]' : '';
          report += `${l.measured_at} | ${l.parameter_name}: ${l.value} ${l.unit} (ref: ${l.reference_min ?? '-'}-${l.reference_max ?? '-'})${flag}\n`;
        }
        report += '\n';
      }

      // Exercise
      if (workouts.length > 0) {
        const totalMin = (workouts as { duration_min: number }[]).reduce((s, w) => s + w.duration_min, 0);
        report += `EGZERSIZ\n`;
        report += `Toplam antrenman: ${workouts.length} seans | Toplam sure: ${totalMin} dakika\n\n`;
      }

      report += `================================================\n`;
      report += `Bu rapor Kochko yasam tarzi kocluk uygulamasi tarafindan kullanici verileriyle olusturulmustur.\n`;
      report += `Tibbi degerlendirme icin saglik profesyonelinin yorumu gereklidir.\n`;

      await Share.share({ title: 'Kochko Saglik Raporu', message: report });
    } catch (err) {
      Alert.alert('Hata', 'Export sirasinda hata olustu.');
    }

    setExporting(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Saglik Profesyoneli Raporu</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Doktorunuza veya diyetisyeninize gosterebileceginiz formatta rapor olusturun. Kilo trendi, beslenme ozeti, lab degerleri ve egzersiz bilgileri icerir.
      </Text>

      <Card title="Tarih Araligi">
        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
          <View style={{ flex: 1 }}><Input label="Baslangic" placeholder="2024-01-01" value={startDate} onChangeText={setStartDate} /></View>
          <View style={{ flex: 1 }}><Input label="Bitis" placeholder="2024-03-31" value={endDate} onChangeText={setEndDate} /></View>
        </View>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Bos birakirsaniz son 3 ay kullanilir.</Text>
      </Card>

      <Card title="Rapor Icerigi">
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>
          - Hasta bilgileri (yas, cinsiyet, boy, kilo){'\n'}
          - Kilo trendi (baslangic → son){'\n'}
          - Beslenme ozeti (ortalama kalori/protein){'\n'}
          - Lab degerleri (referans disi isareti ile){'\n'}
          - Egzersiz ozeti{'\n'}
          {'\n'}
          Not: Hassas veriler (sohbet gecmisi, ruh hali notlari, AI notlari) bu rapora dahil EDILMEZ.
        </Text>
      </Card>

      <Button title="Rapor Olustur ve Paylas" onPress={handleExport} loading={exporting} size="lg" />
    </ScrollView>
  );
}

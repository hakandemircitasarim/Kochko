import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Share,
} from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

export default function ExportScreen() {
  const user = useAuthStore((s) => s.user);
  const [exporting, setExporting] = useState(false);

  const handleExportJSON = async () => {
    if (!user?.id) return;
    setExporting(true);

    try {
      const [profileRes, goalsRes, mealsRes, workoutsRes, metricsRes, reportsRes, labRes, prefsRes] =
        await Promise.all([
          supabase.from('profiles').select('*').eq('id', user.id).single(),
          supabase.from('goals').select('*').eq('user_id', user.id),
          supabase.from('meal_logs').select('*, meal_log_items(*)').eq('user_id', user.id).order('logged_at'),
          supabase.from('workout_logs').select('*').eq('user_id', user.id).order('logged_at'),
          supabase.from('daily_metrics').select('*').eq('user_id', user.id).order('date'),
          supabase.from('daily_reports').select('*').eq('user_id', user.id).order('date'),
          supabase.from('lab_values').select('*').eq('user_id', user.id).order('measured_at'),
          supabase.from('food_preferences').select('*').eq('user_id', user.id),
        ]);

      const exportData = {
        exported_at: new Date().toISOString(),
        profile: profileRes.data,
        goals: goalsRes.data ?? [],
        meal_logs: mealsRes.data ?? [],
        workout_logs: workoutsRes.data ?? [],
        daily_metrics: metricsRes.data ?? [],
        daily_reports: reportsRes.data ?? [],
        lab_values: labRes.data ?? [],
        food_preferences: prefsRes.data ?? [],
      };

      const jsonStr = JSON.stringify(exportData, null, 2);

      await Share.share({
        title: 'Kochko Veri Export',
        message: jsonStr,
      });
    } catch (err) {
      Alert.alert('Hata', 'Export sırasında hata oluştu.');
    }

    setExporting(false);
  };

  const handleExportCSV = async () => {
    if (!user?.id) return;
    setExporting(true);

    try {
      const { data: metrics } = await supabase
        .from('daily_metrics')
        .select('date, weight_kg, water_liters, sleep_hours, steps')
        .eq('user_id', user.id)
        .order('date');

      const { data: reports } = await supabase
        .from('daily_reports')
        .select('date, compliance_score, calorie_actual, protein_actual')
        .eq('user_id', user.id)
        .order('date');

      // Build CSV
      let csv = 'Tarih,Kilo (kg),Su (L),Uyku (saat),Adım,Uyum Puanı,Kalori,Protein (g)\n';

      const allDates = new Set([
        ...(metrics ?? []).map((m: { date: string }) => m.date),
        ...(reports ?? []).map((r: { date: string }) => r.date),
      ]);

      const sortedDates = [...allDates].sort();

      for (const date of sortedDates) {
        const m = (metrics ?? []).find((x: { date: string }) => x.date === date) as { weight_kg: number | null; water_liters: number; sleep_hours: number | null; steps: number | null } | undefined;
        const r = (reports ?? []).find((x: { date: string }) => x.date === date) as { compliance_score: number; calorie_actual: number; protein_actual: number } | undefined;
        csv += `${date},${m?.weight_kg ?? ''},${m?.water_liters ?? ''},${m?.sleep_hours ?? ''},${m?.steps ?? ''},${r?.compliance_score ?? ''},${r?.calorie_actual ?? ''},${r?.protein_actual ?? ''}\n`;
      }

      await Share.share({
        title: 'Kochko CSV Export',
        message: csv,
      });
    } catch {
      Alert.alert('Hata', 'Export sırasında hata oluştu.');
    }

    setExporting(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Veri Dışa Aktar</Text>

      <Card title="JSON Export">
        <Text style={styles.desc}>
          Tüm verilerinizi JSON formatında dışa aktarın. Profil, öğünler, antrenmanlar,
          metrikler, raporlar, lab değerleri ve tercihler dahil.
        </Text>
        <Button
          title="JSON Olarak Paylaş"
          onPress={handleExportJSON}
          loading={exporting}
        />
      </Card>

      <Card title="CSV Export">
        <Text style={styles.desc}>
          Günlük metriklerinizi (kilo, su, uyku, adım, uyum puanı, kalori, protein)
          CSV formatında dışa aktarın. Excel veya Google Sheets ile açılabilir.
        </Text>
        <Button
          title="CSV Olarak Paylaş"
          onPress={handleExportCSV}
          loading={exporting}
          variant="outline"
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  title: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg },
  desc: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm, lineHeight: 20, marginBottom: SPACING.md },
});

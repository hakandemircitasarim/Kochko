/**
 * Koç Özeti — derlenmiş, paylaşılabilir kullanıcı özeti (PDF).
 *
 * ÜRÜN NETLEŞMESİ (final sweep): bu ekran eskiden bir "insan koç canlı paneli"
 * için davet-kodu + veri-paylaşım onayı topluyordu — panel hiç var olmadı ve
 * ürün vizyonunda da yok (tek koç AI olan Kochko). Sahibinin asıl niyeti:
 * gerçek hayattaki antrenörüne/diyetisyenine ELDEN verebileceği derli toplu bir
 * özet ÇIKTISI. Ekran artık tam bunu yapıyor: bölüm seç → PDF oluştur → paylaş.
 * (health-export.tsx'in doktor-raporu deseninin koç-yüzlü eşi.)
 */
import { useState } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { exportPDF } from '@/services/export.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import { haptics } from '@/lib/haptics';
import { genderLabelTR, goalInfinitiveLabelTR, activityLevelLabelTR } from '@/lib/labels';

type SectionKey = 'profile' | 'weight' | 'nutrition' | 'workouts' | 'plan';

const SECTIONS: { key: SectionKey; label: string; desc: string }[] = [
  { key: 'profile', label: 'Profil ve Hedef', desc: 'Yaş, boy, kilo, aktivite, hedef' },
  { key: 'weight', label: 'Kilo Trendi', desc: 'Dönem içi tartı kayıtları ve değişim' },
  { key: 'nutrition', label: 'Beslenme Özeti', desc: 'Ortalama kalori/protein ve uyum' },
  { key: 'workouts', label: 'Antrenman Özeti', desc: 'Seans sayısı ve toplam süre' },
  { key: 'plan', label: 'Aktif Plan Hedefleri', desc: 'Günlük kalori bandı ve makrolar' },
];

export default function CoachSummaryScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [rangeDays, setRangeDays] = useState(30);
  const [included, setIncluded] = useState<Record<SectionKey, boolean>>({
    profile: true, weight: true, nutrition: true, workouts: true, plan: true,
  });
  const [exporting, setExporting] = useState(false);

  const toggle = (k: SectionKey) => {
    haptics.tap();
    setIncluded(prev => ({ ...prev, [k]: !prev[k] }));
  };

  const handleExport = async () => {
    if (!user?.id) return;
    if (!Object.values(included).some(Boolean)) {
      Alert.alert('Bölüm seç', 'Özete en az bir bölüm eklemelisin.');
      return;
    }
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - rangeDays * 86400000).toISOString().split('T')[0];
    setExporting(true);
    try {
      const [profileRes, goalRes, metricsRes, reportsRes, workoutsRes, planRes] = await Promise.all([
        supabase.from('profiles').select('height_cm, weight_kg, birth_year, gender, activity_level').eq('id', user.id).single(),
        supabase.from('goals').select('goal_type, target_weight_kg, weekly_rate').eq('user_id', user.id).eq('is_active', true).limit(1),
        supabase.from('daily_metrics').select('date, weight_kg').eq('user_id', user.id).gte('date', start).lte('date', end).order('date'),
        supabase.from('daily_reports').select('date, compliance_score, calorie_actual, protein_actual').eq('user_id', user.id).gte('date', start).lte('date', end).order('date'),
        supabase.from('workout_logs').select('logged_for_date, duration_min').eq('user_id', user.id).gte('logged_for_date', start).lte('logged_for_date', end),
        supabase.from('weekly_plans').select('plan_data').eq('user_id', user.id).eq('plan_type', 'diet').is('plan_subtype', null).eq('status', 'active').limit(1),
      ]);
      // Hata ≠ boş: eksik veriyle "geçerli görünen" özet basma (health-export deseni).
      if (profileRes.error || !profileRes.data || goalRes.error || metricsRes.error || reportsRes.error || workoutsRes.error || planRes.error) {
        haptics.error();
        Alert.alert('Özet oluşturulamadı', 'Verilerin alınamadı. Bağlantını kontrol edip tekrar dene.');
        return;
      }

      const profile = profileRes.data;
      const goal = (goalRes.data as { goal_type?: string; target_weight_kg?: number | null; weekly_rate?: number | null }[] | null)?.[0] ?? null;
      const weights = ((metricsRes.data ?? []) as { date: string; weight_kg: number | null }[]).filter(m => m.weight_kg != null);
      const reports = (reportsRes.data ?? []) as { date: string; compliance_score: number; calorie_actual: number | null; protein_actual: number | null }[];
      const workouts = (workoutsRes.data ?? []) as { duration_min: number | null }[];
      const planTargets = ((planRes.data as { plan_data?: { targets?: { kcal?: number; protein?: number; carbs?: number; fat?: number } } }[] | null)?.[0]?.plan_data?.targets) ?? null;

      const age = profile.birth_year ? new Date().getFullYear() - (profile.birth_year as number) : null;
      const weightChange = weights.length >= 2
        ? (weights[weights.length - 1].weight_kg as number) - (weights[0].weight_kg as number)
        : null;
      const loggedReports = reports.filter(r => (r.calorie_actual ?? 0) > 0);
      const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
      const avgCal = avg(loggedReports.map(r => r.calorie_actual ?? 0));
      const avgPro = avg(loggedReports.map(r => r.protein_actual ?? 0));
      const avgCompliance = avg(reports.map(r => r.compliance_score));

      const insights: string[] = [];
      if (included.profile) {
        insights.push(`Danışan: Yaş ${age ?? '-'} | ${profile.gender ? genderLabelTR(profile.gender as string) : '-'} | Boy ${profile.height_cm ?? '-'} cm | Kilo ${profile.weight_kg ?? '-'} kg | Aktivite: ${profile.activity_level ? activityLevelLabelTR(profile.activity_level as string) : '-'}`);
        if (goal?.goal_type) insights.push(`Hedef: ${goalInfinitiveLabelTR(goal.goal_type)}${goal.target_weight_kg ? ` (${String(goal.target_weight_kg).replace('.', ',')} kg)` : ''}${goal.weekly_rate ? ` | Tempo: ${String(goal.weekly_rate).replace('.', ',')} kg/hafta` : ''}`);
      }
      if (included.weight && weights.length > 0) {
        const first = weights[0]; const last = weights[weights.length - 1];
        insights.push(`Kilo trendi (${rangeDays} gün): ${String(first.weight_kg).replace('.', ',')} kg → ${String(last.weight_kg).replace('.', ',')} kg (${weights.length} tartı)`);
      }
      if (included.nutrition && loggedReports.length > 0) {
        insights.push(`Beslenme (${loggedReports.length} kayıtlı gün): ort. ${avgCal} kcal/gün | ort. ${avgPro} g protein | uyum %${avgCompliance}`);
      }
      if (included.workouts && workouts.length > 0) {
        const totalMin = workouts.reduce((s, w) => s + (w.duration_min ?? 0), 0);
        insights.push(`Antrenman: ${workouts.length} seans | toplam ${totalMin} dk`);
      }
      if (included.plan && planTargets) {
        insights.push(`Aktif plan hedefi: ${planTargets.kcal ?? '-'} kcal/gün | P ${planTargets.protein ?? '-'} g | K ${planTargets.carbs ?? '-'} g | Y ${planTargets.fat ?? '-'} g`);
      }

      const summaryParts = [
        `Dönem: ${start} — ${end}.`,
        'Bu özet, Kochko yaşam tarzı koçluğu uygulamasındaki kayıtlardan danışanın kendisi tarafından derlenmiştir.',
        'Sohbet geçmişi, ruh hali notları ve sağlık olayları özete dahil edilmez.',
      ];

      await exportPDF({
        title: 'Kochko Koç Özeti',
        period: `${start} - ${end}`,
        compliance: avgCompliance,
        weightChange,
        summary: summaryParts.join(' '),
        insights,
        weeklyData: reports.slice(-8).map(r => ({ week: r.date, compliance: r.compliance_score, weight: null as number | null })),
      });
      haptics.success();
    } catch (err) {
      console.warn('coach-summary export failed', err);
      haptics.error();
      Alert.alert('Hata', 'Özet oluşturulurken bir sorun oluştu. Lütfen tekrar dene.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg, lineHeight: 20 }}>
        Antrenörüne veya diyetisyenine verebileceğin derli toplu bir özet oluştur. Hangi bölümlerin dahil olacağını sen seç — PDF olarak paylaşılır.
      </Text>

      <Card title="Dönem">
        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
          {[{ label: 'Son 30 gün', days: 30 }, { label: 'Son 90 gün', days: 90 }].map(chip => (
            <TouchableOpacity
              key={chip.days}
              onPress={() => { haptics.tap(); setRangeDays(chip.days); }}
              accessibilityRole="button"
              accessibilityLabel={chip.label}
              accessibilityState={{ selected: rangeDays === chip.days }}
              style={{
                flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, alignItems: 'center',
                borderWidth: 0.5, borderColor: rangeDays === chip.days ? COLORS.primary : COLORS.border,
                backgroundColor: rangeDays === chip.days ? COLORS.primary + '22' : COLORS.inputBg,
              }}
            >
              <Text style={{ color: rangeDays === chip.days ? COLORS.primary : COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>{chip.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      <Card title="Özete Dahil Olacaklar">
        {SECTIONS.map((s, i) => (
          <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, borderTopWidth: i === 0 ? 0 : 0.5, borderTopColor: COLORS.border }}>
            <View style={{ flex: 1, marginRight: SPACING.md }}>
              <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>{s.label}</Text>
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 1 }}>{s.desc}</Text>
            </View>
            <Switch
              value={included[s.key]}
              onValueChange={() => toggle(s.key)}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              accessibilityLabel={`${s.label} bölümünü özete dahil et`}
            />
          </View>
        ))}
      </Card>

      <Button title="Özeti Oluştur ve Paylaş" onPress={handleExport} loading={exporting} size="lg" />
    </ScrollView>
  );
}

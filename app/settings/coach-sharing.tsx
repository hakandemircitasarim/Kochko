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
import { genderLabelTR, goalInfinitiveLabelTR, activityLevelLabelTR, mealTypeLabelTR } from '@/lib/labels';

// FIX (kullanıcı bulgusu): "raporda uyum/kilo değil HER ŞEY olmalı" — uygulamanın ve AI'ın
// kullanıcı hakkında bildikleri (genel özet, yiyecek tercihleri, sağlık kısıtları, yeme düzeni)
// da ayrı toggle'lı bölümler olarak özete girebiliyor.
type SectionKey =
  | 'profile' | 'weight' | 'nutrition' | 'workouts' | 'plan'
  | 'coach_summary' | 'food_prefs' | 'constraints' | 'habits';

const SECTIONS: { key: SectionKey; label: string; desc: string }[] = [
  { key: 'profile', label: 'Profil ve Hedef', desc: 'Yaş, boy, kilo, aktivite, hedef' },
  { key: 'weight', label: 'Kilo Trendi', desc: 'Dönem içi tartı kayıtları ve değişim' },
  { key: 'nutrition', label: 'Beslenme Özeti', desc: 'Ortalama kalori/protein ve uyum' },
  { key: 'workouts', label: 'Antrenman Özeti', desc: 'Seans sayısı ve toplam süre' },
  { key: 'plan', label: 'Aktif Plan Hedefleri', desc: 'Günlük kalori bandı ve makrolar' },
  { key: 'coach_summary', label: 'Koçun Genel Özeti', desc: 'AI koçun senin hakkında yazdığı genel not' },
  { key: 'food_prefs', label: 'Yiyecek Tercihleri', desc: 'Alerjenler, sevdiklerin ve sevmediklerin' },
  { key: 'constraints', label: 'Kısıtlar ve Sağlık Notları', desc: 'Alerjen, intolerans, diyet kısıtı, sakatlık' },
  { key: 'habits', label: 'Yeme Düzeni ve Alışkanlıklar', desc: 'Öğün saatleri ve öğrenilen alışkanlıklar' },
];

// user_constraints.kind → Türkçe etiket (coach-memory ekranındaki adlandırmayla aynı aile).
const CONSTRAINT_KIND_ORDER = ['allergen', 'intolerance', 'dietary', 'injury', 'surgery', 'condition', 'medication'] as const;
const CONSTRAINT_KIND_LABELS: Record<string, string> = {
  allergen: 'Alerjenler', intolerance: 'İntoleranslar', dietary: 'Diyet kısıtı',
  injury: 'Sakatlık', surgery: 'Ameliyat', condition: 'Kronik durum', medication: 'İlaç',
};

// FIX (kullanıcı bulgusu): PDF şişmesin — liste satırları en çok 10 öğe, kalanı "+N daha".
const capList = (items: string[], max = 10): string =>
  items.length > max ? `${items.slice(0, max).join(', ')} +${items.length - max} daha` : items.join(', ');

export default function CoachSummaryScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [rangeDays, setRangeDays] = useState(30);
  const [included, setIncluded] = useState<Record<SectionKey, boolean>>({
    profile: true, weight: true, nutrition: true, workouts: true, plan: true,
    coach_summary: true, food_prefs: true, constraints: true, habits: true,
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
      const [profileRes, goalRes, metricsRes, reportsRes, workoutsRes, planRes, aiSummaryRes, foodPrefRes, constraintsRes] = await Promise.all([
        // FIX (kullanıcı bulgusu): dietary_restriction + onboarding alışkanlık alanları da özete girsin.
        supabase.from('profiles').select('height_cm, weight_kg, birth_year, gender, activity_level, dietary_restriction, skipped_meals, night_eating_habit, emotional_eating, snacking_habit').eq('id', user.id).single(),
        supabase.from('goals').select('goal_type, target_weight_kg, weekly_rate').eq('user_id', user.id).eq('is_active', true).limit(1),
        supabase.from('daily_metrics').select('date, weight_kg').eq('user_id', user.id).gte('date', start).lte('date', end).order('date'),
        supabase.from('daily_reports').select('date, compliance_score, calorie_actual, protein_actual').eq('user_id', user.id).gte('date', start).lte('date', end).order('date'),
        supabase.from('workout_logs').select('logged_for_date, duration_min').eq('user_id', user.id).gte('logged_for_date', start).lte('logged_for_date', end),
        supabase.from('weekly_plans').select('plan_data').eq('user_id', user.id).eq('plan_type', 'diet').is('plan_subtype', null).eq('status', 'active').limit(1),
        // FIX (kullanıcı bulgusu): AI'ın bildikleri — genel özet + öğrenilen öğün saatleri.
        supabase.from('ai_summary').select('general_summary, learned_meal_times').eq('user_id', user.id).maybeSingle(),
        supabase.from('food_preferences').select('food_name, preference, is_allergen').eq('user_id', user.id).order('food_name'),
        supabase.from('user_constraints').select('kind, subject').eq('user_id', user.id).eq('active', true),
      ]);
      // Hata ≠ boş: eksik veriyle "geçerli görünen" özet basma (health-export deseni).
      if (profileRes.error || !profileRes.data || goalRes.error || metricsRes.error || reportsRes.error || workoutsRes.error || planRes.error
        || aiSummaryRes.error || foodPrefRes.error || constraintsRes.error) {
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
      // FIX (kullanıcı bulgusu): AI-bilgisi kaynakları (satır yoksa bölüm sessizce atlanır).
      const aiSummary = (aiSummaryRes.data ?? null) as { general_summary?: string | null; learned_meal_times?: Record<string, unknown> | null } | null;
      const foodPrefs = (foodPrefRes.data ?? []) as { food_name: string; preference: string; is_allergen: boolean }[];
      const constraints = (constraintsRes.data ?? []) as { kind: string; subject: string }[];

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

      // FIX (kullanıcı bulgusu): 'Koçun Genel Özeti' — ai_summary.general_summary, satır satır.
      if (included.coach_summary && aiSummary?.general_summary) {
        const lines = aiSummary.general_summary.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 10);
        lines.forEach((line, i) => insights.push(i === 0 ? `Koçun genel özeti: ${line}` : line));
      }

      // FIX (kullanıcı bulgusu): 'Yiyecek Tercihleri' — love+like → sevdikleri, dislike+never →
      // sevmedikleri; alerjen satırı ayrı. (can_cook damak tercihi değil beceri — özete girmez.)
      const prefAllergens = foodPrefs.filter(f => f.is_allergen).map(f => f.food_name);
      if (included.food_prefs && foodPrefs.length > 0) {
        const disliked = foodPrefs.filter(f => !f.is_allergen && (f.preference === 'dislike' || f.preference === 'never')).map(f => f.food_name);
        const liked = foodPrefs.filter(f => f.preference === 'love' || f.preference === 'like').map(f => f.food_name);
        if (prefAllergens.length) insights.push(`Alerjenler: ${capList(prefAllergens)}`);
        if (disliked.length) insights.push(`Sevmedikleri: ${capList(disliked)}`);
        if (liked.length) insights.push(`Sevdikleri: ${capList(liked)}`);
      }

      // FIX (kullanıcı bulgusu): 'Kısıtlar ve Sağlık Notları' — user_constraints (aktif) tür türe.
      if (included.constraints) {
        // Alerjenler iki kaynakta da yaşıyor (food_preferences.is_allergen ↔ user_constraints.allergen
        // senkron) — Yiyecek Tercihleri bölümü açıksa aynı alerjeni ikinci kez basma.
        const prefAllergenSet = new Set(included.food_prefs ? prefAllergens : []);
        for (const kind of CONSTRAINT_KIND_ORDER) {
          const subjects = constraints
            .filter(c => c.kind === kind)
            .map(c => c.subject)
            .filter(s => kind !== 'allergen' || !prefAllergenSet.has(s))
            .map(s => s.replace(/_/g, ' '));
          if (subjects.length) insights.push(`${CONSTRAINT_KIND_LABELS[kind]}: ${capList(subjects)}`);
        }
        // profiles.dietary_restriction — kanonik omurgada birebir karşılığı yoksa ayrıca yaz.
        const dietaryProfile = typeof profile.dietary_restriction === 'string' ? profile.dietary_restriction.trim() : '';
        if (dietaryProfile && !constraints.some(c => c.kind === 'dietary' && c.subject === dietaryProfile.toLocaleLowerCase('tr-TR'))) {
          insights.push(`Beslenme kısıtı (profil): ${dietaryProfile}`);
        }
      }

      // FIX (kullanıcı bulgusu): 'Yeme Düzeni ve Alışkanlıklar' — ai_summary.learned_meal_times +
      // onboarding'den öğrenilen serbest-metin alışkanlıklar (sunucu context-builders adlandırması).
      if (included.habits) {
        const mealTimes = aiSummary?.learned_meal_times;
        if (mealTimes && typeof mealTimes === 'object') {
          const times = Object.entries(mealTimes)
            .filter(([, t]) => typeof t === 'string' && t.trim() !== '')
            .slice(0, 10)
            .map(([meal, t]) => `${mealTypeLabelTR(meal)} ${String(t).trim()}`);
          if (times.length) insights.push(`Öğrenilen öğün saatleri: ${times.join(', ')}`);
        }
        const habitFields: [string, unknown][] = [
          ['Atlanan öğünler', profile.skipped_meals],
          ['Gece yeme', profile.night_eating_habit],
          ['Duygusal yeme', profile.emotional_eating],
          ['Atıştırma alışkanlığı', profile.snacking_habit],
        ];
        for (const [label, value] of habitFields) {
          const text = typeof value === 'string' ? value.trim() : '';
          if (text) insights.push(`${label}: ${text}`);
        }
      }

      const summaryParts = [
        `Dönem: ${start} — ${end}.`,
        'Bu özet, Kochko yaşam tarzı koçluğu uygulamasındaki kayıtlardan danışanın kendisi tarafından derlenmiştir.',
        // FIX (kullanıcı bulgusu): gizlilik notu içerikle örtüşmeli — sağlık kısıtları artık
        // kullanıcının seçimiyle özete girebiliyor; sohbet geçmişi ve ruh hali her zaman hariç.
        'Sohbet geçmişi ve ruh hali notları özete dahil edilmez.',
      ];
      if (included.constraints) {
        summaryParts.push('Sağlık kısıtları ve notları danışanın kendi seçimiyle özete dahildir.');
      }

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

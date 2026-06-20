/**
 * Meal Prep Plan Screen
 * Package 9: Displays generated meal prep plans with prep order, storage info, and timing.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { useAuthStore } from '@/stores/auth.store';
import { generateMealPrepPlan, getMealPrepPrefs, setMealPrepPrefs, type MealPrepPlan } from '@/services/meal-prep.service';
import { getCurrentWeeklyPlan } from '@/services/weekly-plan.service';

const PREP_DAY_OPTIONS = [
  { value: 0, label: 'Paz' }, { value: 1, label: 'Pzt' }, { value: 2, label: 'Sal' },
  { value: 3, label: 'Çar' }, { value: 4, label: 'Per' }, { value: 5, label: 'Cum' }, { value: 6, label: 'Cmt' },
];

export default function MealPrepPlanScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [plan, setPlan] = useState<MealPrepPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [active, setActive] = useState(false);
  const [prepDay, setPrepDay] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    getMealPrepPrefs(user.id)
      .then(p => { setActive(p.active); setPrepDay(p.prepDays[0] ?? 0); })
      .finally(() => setPrefsLoaded(true));
  }, [user?.id]);

  const handleActivate = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { error: err } = await setMealPrepPrefs(user.id, true, [prepDay]);
    if (err) { setError('Tercihin kaydedilemedi, lütfen tekrar dene.'); haptics.error(); }
    else { setActive(true); setError(null); haptics.success(); }
    setLoading(false);
  };

  const handleGenerate = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const weeklyPlan = await getCurrentWeeklyPlan();
      if (!weeklyPlan) {
        setError('Önce haftalık menünü oluştur, sonra meal prep planı yapabiliriz.');
        haptics.error();
        return;
      }
      const result = await generateMealPrepPlan(user.id, weeklyPlan.id);
      if (!result) {
        setError('Bu haftanın menüsünde toplu hazırlamaya uygun yemek bulunamadı.');
        haptics.error();
        return;
      }
      setPlan(result);
      haptics.success();
    } catch {
      setError('Bir şeyler ters gitti, lütfen tekrar dene.');
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  // Activation gate: meal_prep_active was previously impossible to enable from
  // ANY screen (the feature was a permanent dead-end) — this is the toggle.
  if (prefsLoaded && !active) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
        {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}
        <Card>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.md }}>
            Toplu hazırlık modunu aktif et ve hazırlık gününü seç — haftalık menünden otomatik prep planı çıkaralım.
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: SPACING.lg, flexWrap: 'wrap' }}>
            {PREP_DAY_OPTIONS.map(d => (
              <TouchableOpacity key={d.value} onPress={() => { haptics.tap(); setPrepDay(d.value); }}
                accessibilityRole="button"
                accessibilityLabel={`Hazırlık günü: ${d.label}`}
                accessibilityState={{ selected: prepDay === d.value }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ paddingHorizontal: SPACING.sm, paddingVertical: 6, borderRadius: 8, backgroundColor: prepDay === d.value ? COLORS.primary : COLORS.surfaceLight }}>
                <Text style={{ color: prepDay === d.value ? getContrastColor(COLORS.primary) : COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600' }}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {error && <Text style={{ color: COLORS.error, fontSize: FONT.sm, marginBottom: SPACING.sm }}>{error}</Text>}
          <Button title="Meal Prep Modunu Aktif Et" onPress={handleActivate} loading={loading} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.lg }}>
        Haftanın yemeklerini önceden hazırla, zamandan ve paradan tasarruf et.
      </Text>

      {!plan ? (
        <View style={{ alignItems: 'center', paddingVertical: SPACING.xl }}>
          {loading ? (
            <ActivityIndicator size="large" color={COLORS.primary} />
          ) : (
            <>
              {error && (
                <Text style={{ color: COLORS.error, fontSize: FONT.sm, textAlign: 'center', marginBottom: SPACING.md }}>
                  {error}
                </Text>
              )}
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', marginBottom: SPACING.lg }}>
                Kayıtlı tariflerine ve haftalık planına göre bir meal prep planı oluşturalım.
              </Text>
              <Button title="Plan Oluştur" onPress={handleGenerate} />
            </>
          )}
        </View>
      ) : (
        <>
          {/* Total Prep Time */}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Hazırlama</Text>
              <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '700' }}>{plan.totalPrepTime} dk</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.xs }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Pişirme</Text>
              <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '700' }}>{plan.totalCookTime} dk</Text>
            </View>
          </Card>

          {/* Prep Items */}
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm, marginTop: SPACING.sm }}>HAZIRLANACAKLAR</Text>
          {plan.items.map((item, i) => (
            <Card key={i}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{item.recipeName}</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{item.quantity}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: COLORS.success, fontSize: FONT.sm, fontWeight: '600' }}>{item.storageDays} gün</Text>
                </View>
              </View>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginTop: SPACING.xs }}>Saklama: {item.storageInstructions}</Text>
            </Card>
          ))}

          {/* Prep Order */}
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm, marginTop: SPACING.sm }}>HAZIRLAMA SIRASI</Text>
          <Card>
            {plan.prepOrder.map((step, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: i < plan.prepOrder.length - 1 ? SPACING.sm : 0, alignItems: 'flex-start' }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: getContrastColor(COLORS.primary), fontSize: FONT.xs, fontWeight: '700' }}>{step.order}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 22 }}>{step.action}</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{step.durationMin} dk — {step.reason_tr}</Text>
                </View>
              </View>
            ))}
          </Card>

          {/* Regenerate */}
          <View style={{ marginTop: SPACING.md }}>
            <Button title="Yeni Plan Oluştur" onPress={handleGenerate} variant="outline" loading={loading} />
          </View>
        </>
      )}
    </ScrollView>
  );
}

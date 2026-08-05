import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProfileStore } from '@/stores/profile.store';
import { usePremium } from '@/hooks/usePremium';
import { getCurrentWeeklyPlan, generateWeeklyPlan, toggleShoppingItem, type WeeklyPlan } from '@/services/weekly-plan.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SPACING, FONT } from '@/lib/constants';
import { TYPE, MOTION } from '@/lib/design';
import { useTheme } from '@/lib/theme';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { mealTypeLabelTR } from '@/lib/labels';

const CATEGORY_LABELS: Record<string, string> = { protein: 'Protein', vegetable: 'Sebze', fruit: 'Meyve', dairy: 'Süt Ürünü', grain: 'Tahıl', other: 'Diğer' };

export default function WeeklyMenuScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // FIX (ux-readiness): this premium screen lacked its own guard — a free user reaching it via deep
  // link / chat navigate / trial-expiry-while-open stayed inside and could trigger an AI generation.
  // Mirror the sibling premium screens (meal-prep-plan etc.): redirect to the paywall once resolved.
  const { isPremium } = usePremium();
  const profileLoading = useProfileStore(s => s.loading);
  const profile = useProfileStore(s => s.profile);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'menu' | 'shopping'>('menu');

  useEffect(() => {
    if (!profileLoading && profile !== null && !isPremium) {
      router.replace('/settings/premium');
    }
  }, [profileLoading, profile, isPremium, router]);

  useEffect(() => {
    getCurrentWeeklyPlan()
      .then(p => setPlan(p))
      .catch(() => setError('Menü yüklenemedi. Lütfen tekrar dene.'))
      .finally(() => setLoading(false));
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    const { data, error } = await generateWeeklyPlan();
    if (error) {
      setError(error);
      haptics.error();
    } else if (data) {
      setPlan(data);
      haptics.success();
    }
    setGenerating(false);
  };

  const handleToggleItem = async (index: number) => {
    if (!plan) return;
    const newChecked = !plan.shopping_list[index].checked;
    haptics.tap();
    await toggleShoppingItem(plan.id, index, newChecked);
    setPlan(prev => {
      if (!prev) return null;
      const list = [...prev.shopping_list];
      list[index] = { ...list[index], checked: newChecked };
      return { ...prev, shopping_list: list };
    });
  };

  // FIX (ux-readiness): blank while the redirect effect runs, so a free user never sees the content.
  if (!isPremium && profile !== null && !profileLoading) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}

      {loading ? (
        <Card>
          <Text style={{ color: colors.textSecondary, ...TYPE.body }}>Menü yükleniyor…</Text>
        </Card>
      ) : !plan ? (
        // LoadErrorState'e taşınmadı: hata ayrı bir retry kartı değil — boş-durum kartına gömülü
        // metin, CTA'sı da yeniden yükleme değil "Menü Oluştur" (üretim) aksiyonu.
        <Card>
          <Text style={{ color: colors.textSecondary, ...TYPE.body, marginBottom: SPACING.lg }}>
            {error ? error : 'Haftalık menü henüz oluşturulmamış.'}
          </Text>
          <Button title="Menü Oluştur" onPress={handleGenerate} loading={generating} size="lg" />
        </Card>
      ) : (
        <>
          {/* Tabs */}
          <View style={{ flexDirection: 'row', marginBottom: SPACING.md, gap: SPACING.sm }}>
            <TouchableOpacity activeOpacity={MOTION.pressOpacity} onPress={() => { haptics.tap(); setTab('menu'); }}
              accessibilityRole="tab" accessibilityLabel="Menü" accessibilityState={{ selected: tab === 'menu' }}
              style={{ flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: SPACING.sm, borderRadius: 8, alignItems: 'center', backgroundColor: tab === 'menu' ? colors.primary : colors.card }}>
              <Text style={{ color: tab === 'menu' ? getContrastColor(colors.primary) : colors.textSecondary, ...TYPE.bodyStrong }}>Menü</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={MOTION.pressOpacity} onPress={() => { haptics.tap(); setTab('shopping'); }}
              accessibilityRole="tab" accessibilityLabel="Alışveriş" accessibilityState={{ selected: tab === 'shopping' }}
              style={{ flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: SPACING.sm, borderRadius: 8, alignItems: 'center', backgroundColor: tab === 'shopping' ? colors.primary : colors.card }}>
              <Text style={{ color: tab === 'shopping' ? getContrastColor(colors.primary) : colors.textSecondary, ...TYPE.bodyStrong }}>Alışveriş</Text>
            </TouchableOpacity>
          </View>

          {tab === 'menu' ? (
            // Weekly Menu
            plan.plan_data.map((day, di) => (
              <Card key={di} title={`${day.dayName}${day.isTrainingDay === undefined ? '' : day.isTrainingDay ? ' (Antrenman)' : ' (Dinlenme)'}`}>
                {day.meals.map((meal, mi) => (
                  <View key={mi} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: mi < day.meals.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.primary, ...TYPE.caption, fontWeight: '600' }}>{mealTypeLabelTR(meal.meal_type)}</Text>
                      <Text style={{ color: colors.text, ...TYPE.body }}>{meal.suggestion.name}</Text>
                    </View>
                    <Text style={{ color: colors.textSecondary, ...TYPE.body }}>{meal.suggestion.calories} kcal</Text>
                  </View>
                ))}
              </Card>
            ))
          ) : (
            // Shopping List
            <>
              {Object.entries(
                plan.shopping_list.reduce<Record<string, { item: typeof plan.shopping_list[0]; index: number }[]>>((acc, item, i) => {
                  const cat = item.category || 'other';
                  if (!acc[cat]) acc[cat] = [];
                  acc[cat].push({ item, index: i });
                  return acc;
                }, {})
              ).map(([category, items]) => (
                <Card key={category} title={CATEGORY_LABELS[category] ?? category}>
                  {items.map(({ item, index }) => (
                    <TouchableOpacity activeOpacity={MOTION.pressOpacity} key={index} onPress={() => handleToggleItem(index)}
                      accessibilityRole="checkbox" accessibilityLabel={`${item.name} ${item.amount}`} accessibilityState={{ checked: item.checked }}
                      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingVertical: 4, gap: SPACING.sm }}>
                      <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: item.checked ? colors.success : colors.border, backgroundColor: item.checked ? colors.success : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
                        {item.checked && <Text style={{ color: getContrastColor(colors.success), fontSize: 12, fontWeight: '700' }}>+</Text>}
                      </View>
                      <Text style={{ color: item.checked ? colors.textMuted : colors.text, ...TYPE.body, flex: 1, textDecorationLine: item.checked ? 'line-through' : 'none' }}>{item.name}</Text>
                      <Text style={{ color: colors.textSecondary, ...TYPE.body }}>{item.amount}</Text>
                    </TouchableOpacity>
                  ))}
                </Card>
              ))}
            </>
          )}

          {error && <Text style={{ color: colors.error, ...TYPE.body, marginBottom: SPACING.sm }}>{error}</Text>}
          {/* ux-sweep (WM-01): onaysız yeniden üretim mevcut menüyü + alışveriş işaretlerini siliyordu. */}
          <Button title="Menüyü Yeniden Oluştur" variant="outline" loading={generating} onPress={() => {
            Alert.alert('Yeniden oluşturulsun mu?', 'Mevcut menü ve alışveriş listesi işaretlerin silinecek.', [
              { text: 'Vazgeç', style: 'cancel' },
              { text: 'Yeniden Oluştur', onPress: handleGenerate },
            ]);
          }} />
        </>
      )}
    </ScrollView>
  );
}

import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getCurrentWeeklyPlan, generateWeeklyPlan, toggleShoppingItem, type WeeklyPlan } from '@/services/weekly-plan.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';

const MEAL_LABELS: Record<string, string> = { breakfast: 'Kahvaltı', lunch: 'Öğle', dinner: 'Akşam', snack: 'Ara' };
const CATEGORY_LABELS: Record<string, string> = { protein: 'Protein', vegetable: 'Sebze', fruit: 'Meyve', dairy: 'Süt Ürünü', grain: 'Tahıl', other: 'Diğer' };

export default function WeeklyMenuScreen() {
  const insets = useSafeAreaInsets();
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'menu' | 'shopping'>('menu');

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

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit duplicate-title): Native header renders the title; in-body H1 removed as redundant. */}

      {loading ? (
        <Card>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Menü yükleniyor…</Text>
        </Card>
      ) : !plan ? (
        <Card>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.lg }}>
            {error ? error : 'Haftalık menü henüz oluşturulmamış.'}
          </Text>
          <Button title="Menü Oluştur" onPress={handleGenerate} loading={generating} size="lg" />
        </Card>
      ) : (
        <>
          {/* Tabs */}
          <View style={{ flexDirection: 'row', marginBottom: SPACING.md, gap: SPACING.sm }}>
            <TouchableOpacity onPress={() => { haptics.tap(); setTab('menu'); }}
              accessibilityRole="tab" accessibilityLabel="Menü" accessibilityState={{ selected: tab === 'menu' }}
              style={{ flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: SPACING.sm, borderRadius: 8, alignItems: 'center', backgroundColor: tab === 'menu' ? COLORS.primary : COLORS.card }}>
              <Text style={{ color: tab === 'menu' ? getContrastColor(COLORS.primary) : COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>Menü</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { haptics.tap(); setTab('shopping'); }}
              accessibilityRole="tab" accessibilityLabel="Alışveriş" accessibilityState={{ selected: tab === 'shopping' }}
              style={{ flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: SPACING.sm, borderRadius: 8, alignItems: 'center', backgroundColor: tab === 'shopping' ? COLORS.primary : COLORS.card }}>
              <Text style={{ color: tab === 'shopping' ? getContrastColor(COLORS.primary) : COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>Alışveriş</Text>
            </TouchableOpacity>
          </View>

          {tab === 'menu' ? (
            // Weekly Menu
            plan.plan_data.map((day, di) => (
              <Card key={di} title={`${day.dayName}${day.isTrainingDay === undefined ? '' : day.isTrainingDay ? ' (Antrenman)' : ' (Dinlenme)'}`}>
                {day.meals.map((meal, mi) => (
                  <View key={mi} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: mi < day.meals.length - 1 ? 1 : 0, borderBottomColor: COLORS.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '600' }}>{MEAL_LABELS[meal.meal_type] ?? meal.meal_type}</Text>
                      <Text style={{ color: COLORS.text, fontSize: FONT.sm }}>{meal.suggestion.name}</Text>
                    </View>
                    <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{meal.suggestion.calories} kcal</Text>
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
                    <TouchableOpacity key={index} onPress={() => handleToggleItem(index)}
                      accessibilityRole="checkbox" accessibilityLabel={`${item.name} ${item.amount}`} accessibilityState={{ checked: item.checked }}
                      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingVertical: 4, gap: SPACING.sm }}>
                      <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: item.checked ? COLORS.success : COLORS.border, backgroundColor: item.checked ? COLORS.success : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
                        {item.checked && <Text style={{ color: getContrastColor(COLORS.success), fontSize: 12, fontWeight: '700' }}>+</Text>}
                      </View>
                      <Text style={{ color: item.checked ? COLORS.textMuted : COLORS.text, fontSize: FONT.md, flex: 1, textDecorationLine: item.checked ? 'line-through' : 'none' }}>{item.name}</Text>
                      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{item.amount}</Text>
                    </TouchableOpacity>
                  ))}
                </Card>
              ))}
            </>
          )}

          {error && <Text style={{ color: COLORS.error, fontSize: FONT.sm, marginBottom: SPACING.sm }}>{error}</Text>}
          <Button title="Menüyü Yeniden Oluştur" variant="outline" onPress={handleGenerate} loading={generating} />
        </>
      )}
    </ScrollView>
  );
}

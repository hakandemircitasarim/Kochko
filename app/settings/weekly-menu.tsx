import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { getCurrentWeeklyPlan, generateWeeklyPlan, toggleShoppingItem, type WeeklyPlan } from '@/services/weekly-plan.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const MEAL_LABELS: Record<string, string> = { breakfast: 'Kahvalti', lunch: 'Ogle', dinner: 'Aksam', snack: 'Ara' };
const CATEGORY_LABELS: Record<string, string> = { protein: 'Protein', vegetable: 'Sebze', fruit: 'Meyve', dairy: 'Sut Urunu', grain: 'Tahil', other: 'Diger' };

export default function WeeklyMenuScreen() {
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [tab, setTab] = useState<'menu' | 'shopping'>('menu');

  useEffect(() => { getCurrentWeeklyPlan().then(p => { setPlan(p); setLoading(false); }); }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    const { data } = await generateWeeklyPlan();
    if (data) setPlan(data);
    setGenerating(false);
  };

  const handleToggleItem = async (index: number) => {
    if (!plan) return;
    const newChecked = !plan.shopping_list[index].checked;
    await toggleShoppingItem(plan.id, index, newChecked);
    setPlan(prev => {
      if (!prev) return null;
      const list = [...prev.shopping_list];
      list[index] = { ...list[index], checked: newChecked };
      return { ...prev, shopping_list: list };
    });
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Haftalik Menu</Text>

      {!plan ? (
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: SPACING.lg }}>Haftalik menu henuz olusturulmamis.</Text>
          <Button title="Menu Olustur" onPress={handleGenerate} loading={generating} size="lg" />
        </Card>
      ) : (
        <>
          {/* Tabs */}
          <View style={{ flexDirection: 'row', marginBottom: SPACING.md, gap: SPACING.sm }}>
            <TouchableOpacity onPress={() => setTab('menu')}
              style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: 8, alignItems: 'center', backgroundColor: tab === 'menu' ? COLORS.primary : COLORS.card }}>
              <Text style={{ color: tab === 'menu' ? '#fff' : COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>Menu</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setTab('shopping')}
              style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: 8, alignItems: 'center', backgroundColor: tab === 'shopping' ? COLORS.primary : COLORS.card }}>
              <Text style={{ color: tab === 'shopping' ? '#fff' : COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>Alisveris</Text>
            </TouchableOpacity>
          </View>

          {tab === 'menu' ? (
            // Weekly Menu
            plan.plan_data.map((day, di) => (
              <Card key={di} title={`${day.dayName} ${day.isTrainingDay ? '(Antrenman)' : '(Dinlenme)'}`}>
                {day.meals.map((meal, mi) => (
                  <View key={mi} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: mi < day.meals.length - 1 ? 1 : 0, borderBottomColor: COLORS.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '600' }}>{MEAL_LABELS[meal.meal_type] ?? meal.meal_type}</Text>
                      <Text style={{ color: COLORS.text, fontSize: FONT.sm }}>{meal.suggestion.name}</Text>
                    </View>
                    <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{meal.suggestion.calories} kcal</Text>
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
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: SPACING.sm }}>
                      <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: item.checked ? COLORS.success : COLORS.border, backgroundColor: item.checked ? COLORS.success : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
                        {item.checked && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>+</Text>}
                      </View>
                      <Text style={{ color: item.checked ? COLORS.textMuted : COLORS.text, fontSize: FONT.md, flex: 1, textDecorationLine: item.checked ? 'line-through' : 'none' }}>{item.name}</Text>
                      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{item.amount}</Text>
                    </TouchableOpacity>
                  ))}
                </Card>
              ))}
            </>
          )}

          <Button title="Menuyu Yeniden Olustur" variant="outline" onPress={handleGenerate} loading={generating} />
        </>
      )}
    </ScrollView>
  );
}

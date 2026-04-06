/**
 * Weekly Menu Planning — 7-day calendar view
 * Created via AI coach conversation, displayed here for tracking
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { getCurrentWeeklyPlan, type WeeklyPlan, type ShoppingItem } from '@/services/weekly-plan.service';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Kahvaltı', lunch: 'Öğle', dinner: 'Akşam', snack: 'Ara',
};
const MEAL_COLORS: Record<string, string> = {
  breakfast: '#1D9E75', lunch: '#EF9F27', dinner: '#D85A30', snack: '#7F77DD',
};

export default function WeeklyMenuScreen() {
  const { colors } = useTheme();
  const user = useAuthStore(s => s.user);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(0);
  const [showShopping, setShowShopping] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadPlan();
  }, []);

  const loadPlan = async () => {
    setLoading(true);
    const data = await getCurrentWeeklyPlan();
    setPlan(data);
    setLoading(false);
  };

  const toggleShoppingItem = (name: string) => {
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: SPACING.xl, paddingBottom: 100 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.xxl }}>
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: SPACING.md }}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>Haftalık Menü</Text>
        </View>

        {!plan ? (
          <View style={{
            backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.xxl,
            alignItems: 'center', borderWidth: 0.5, borderColor: colors.border,
          }}>
            <Ionicons name="calendar-outline" size={48} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: SPACING.md, textAlign: 'center' }}>
              Henüz haftalık plan oluşturulmamış
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: SPACING.sm, textAlign: 'center' }}>
              Koçuna 'haftalık menü planla' de
            </Text>
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/(tabs)/chat', params: { prefill: 'Bu hafta için haftalık menü planla' } })}
              style={{
                marginTop: SPACING.xxl, borderWidth: 0.5, borderColor: colors.primary,
                borderRadius: RADIUS.sm, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.xl,
              }}
            >
              <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '500' }}>Plan oluştur</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Day selector — horizontal scroll */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SPACING.md }}>
              <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                {plan.plan_data.map((day, idx) => {
                  const isActive = selectedDay === idx;
                  const dayShort = day.dayName.slice(0, 3);
                  const dateNum = new Date(day.date).getDate();
                  return (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => setSelectedDay(idx)}
                      style={{
                        width: 52, paddingVertical: SPACING.md, borderRadius: RADIUS.md,
                        backgroundColor: isActive ? colors.primary : colors.card,
                        borderWidth: isActive ? 0 : 0.5, borderColor: colors.border,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: isActive ? '#fff' : colors.textMuted, fontSize: 11, fontWeight: '500' }}>{dayShort}</Text>
                      <Text style={{ color: isActive ? '#fff' : colors.text, fontSize: 16, fontWeight: '700', marginTop: 2 }}>{dateNum}</Text>
                      {day.isTrainingDay && (
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isActive ? '#fff' : METRIC_COLORS.workout, marginTop: 4 }} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            {/* Selected day meals */}
            {plan.plan_data[selectedDay] && (
              <View style={{
                backgroundColor: colors.card, borderRadius: RADIUS.md,
                borderWidth: 0.5, borderColor: colors.border, marginBottom: SPACING.md,
              }}>
                {plan.plan_data[selectedDay].isTrainingDay && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.lg, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
                    <Ionicons name="barbell" size={14} color={METRIC_COLORS.workout} />
                    <Text style={{ color: METRIC_COLORS.workout, fontSize: 11, fontWeight: '500' }}>Antrenman günü</Text>
                  </View>
                )}
                {plan.plan_data[selectedDay].meals.map((meal, idx) => {
                  const dotColor = MEAL_COLORS[meal.meal_type] ?? colors.primary;
                  return (
                    <View key={idx} style={{
                      flexDirection: 'row', alignItems: 'center', padding: SPACING.lg,
                      borderBottomWidth: idx < plan.plan_data[selectedDay].meals.length - 1 ? 0.5 : 0,
                      borderBottomColor: colors.border,
                    }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor, marginRight: SPACING.md }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500' }}>
                          {MEAL_LABELS[meal.meal_type] ?? meal.meal_type}
                        </Text>
                        <Text style={{ color: colors.text, fontSize: 13, marginTop: 2 }}>
                          {meal.suggestion.name}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: colors.textMuted, fontSize: 12 }}>{meal.suggestion.calories} kcal</Text>
                        <Text style={{ color: METRIC_COLORS.protein, fontSize: 11 }}>{meal.suggestion.protein_g}g P</Text>
                      </View>
                    </View>
                  );
                })}
                {/* Daily total */}
                <View style={{ padding: SPACING.lg, borderTopWidth: 0.5, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>Gün toplamı</Text>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                      {plan.plan_data[selectedDay].meals.reduce((s, m) => s + m.suggestion.calories, 0)} kcal
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Shopping list toggle */}
            {plan.shopping_list && plan.shopping_list.length > 0 && (
              <>
                <TouchableOpacity
                  onPress={() => setShowShopping(!showShopping)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg,
                    borderWidth: 0.5, borderColor: colors.border, marginBottom: SPACING.sm,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                    <Ionicons name="cart-outline" size={18} color={colors.primary} />
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '500' }}>Alışveriş listesi</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                      {checkedItems.size}/{plan.shopping_list.length}
                    </Text>
                    <Ionicons name={showShopping ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                  </View>
                </TouchableOpacity>

                {showShopping && (
                  <View style={{
                    backgroundColor: colors.card, borderRadius: RADIUS.md,
                    borderWidth: 0.5, borderColor: colors.border, marginBottom: SPACING.md,
                  }}>
                    {plan.shopping_list.map((item, idx) => {
                      const checked = checkedItems.has(item.name);
                      return (
                        <TouchableOpacity
                          key={idx}
                          onPress={() => toggleShoppingItem(item.name)}
                          style={{
                            flexDirection: 'row', alignItems: 'center', padding: SPACING.lg, gap: SPACING.md,
                            borderBottomWidth: idx < plan.shopping_list.length - 1 ? 0.5 : 0,
                            borderBottomColor: colors.border,
                            opacity: checked ? 0.5 : 1,
                          }}
                        >
                          <Ionicons name={checked ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={checked ? colors.primary : colors.textMuted} />
                          <Text style={{ color: colors.text, fontSize: 13, flex: 1, textDecorationLine: checked ? 'line-through' : 'none' }}>
                            {item.name}
                          </Text>
                          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{item.amount}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

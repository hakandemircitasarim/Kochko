/**
 * Weekly Menu Planning — 7-day calendar view
 * Created via AI coach conversation, displayed here for tracking
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { getCurrentWeeklyPlan, approveWeeklyPlan, requestMenuModification, type WeeklyPlan, type ShoppingItem } from '@/services/weekly-plan.service';
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
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(0);
  const [showShopping, setShowShopping] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [modRequestOpen, setModRequestOpen] = useState(false);
  const [modText, setModText] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    loadPlan();
  }, []);

  // Cross-device realtime sync: if another device approves/regenerates, refresh here (Spec 16.4)
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`weekly_plans_realtime_${user.id}`)
      .on(
        'postgres_changes' as 'system',
        {
          event: '*',
          schema: 'public',
          table: 'weekly_plans',
          filter: `user_id=eq.${user.id}`,
        } as Record<string, unknown>,
        () => { loadPlan(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const loadPlan = async () => {
    setLoading(true);
    const data = await getCurrentWeeklyPlan();
    setPlan(data);
    setLoading(false);
  };

  const handleApprove = async () => {
    if (!plan) return;
    setApproving(true);
    await approveWeeklyPlan(plan.id);
    setPlan({ ...plan, approved_at: new Date().toISOString() });
    setApproving(false);
  };

  const handleRequestModification = async () => {
    if (!plan || !modText.trim()) {
      Alert.alert('Boş', 'Neyi değiştirmek istediğini yazar mısın?');
      return;
    }
    setRegenerating(true);
    const { data, error } = await requestMenuModification(plan.id, modText.trim());
    if (data) {
      await loadPlan(); // reload latest
      setModRequestOpen(false);
      setModText('');
    } else if (error) {
      Alert.alert('Hata', error);
    }
    setRegenerating(false);
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
      <ScrollView contentContainerStyle={{ padding: SPACING.xl, paddingTop: insets.top + 12, paddingBottom: 40 + insets.bottom }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.xxl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => router.back()} style={{ marginRight: SPACING.md }}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>Haftalık Menü</Text>
          </View>
          {plan?.approved_at && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary + '20', paddingVertical: 4, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.pill }}>
              <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '500' }}>Onaylandı</Text>
            </View>
          )}
        </View>

        {/* Approval actions — only show when plan exists and not yet approved */}
        {plan && !plan.approved_at && !modRequestOpen && (
          <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xl }}>
            <TouchableOpacity
              onPress={handleApprove}
              disabled={approving}
              style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{approving ? 'Onaylanıyor...' : 'Menüyü Onayla'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setModRequestOpen(true)}
              style={{ flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, borderWidth: 0.5, borderColor: colors.border, alignItems: 'center' }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '500' }}>Şunu Değiştir</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Modification request input */}
        {modRequestOpen && (
          <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.xl, borderWidth: 0.5, borderColor: colors.border }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: SPACING.sm }}>
              Neyi değiştirelim? (örn. "Salı günü akşamını değiştir", "balığı tavuğa çevir")
            </Text>
            <TextInput
              value={modText}
              onChangeText={setModText}
              multiline
              placeholder="Talebini yaz..."
              placeholderTextColor={colors.textMuted}
              style={{
                color: colors.text, fontSize: 14, minHeight: 60,
                backgroundColor: colors.background, padding: SPACING.sm,
                borderRadius: RADIUS.sm, textAlignVertical: 'top',
              }}
            />
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
              <TouchableOpacity
                onPress={handleRequestModification}
                disabled={regenerating}
                style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500' }}>{regenerating ? 'Yeniden üretiliyor...' : 'Gönder'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setModRequestOpen(false); setModText(''); }}
                disabled={regenerating}
                style={{ paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: RADIUS.sm, borderWidth: 0.5, borderColor: colors.border }}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>İptal</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

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
                    {/* Generation metadata: when was this list produced + revision */}
                    <View style={{ padding: SPACING.sm, borderBottomWidth: 0.5, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.textMuted, fontSize: 10 }}>
                        {plan.revision_count > 0 ? `Revizyon #${plan.revision_count} — ` : ''}
                        {new Date(plan.generated_at).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
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

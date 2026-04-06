/**
 * Diet Plan Detail — current plan + past plans history
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import { MealOptionCard } from '@/components/plan/MealOptionCard';

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Kahvaltı', lunch: 'Öğle', dinner: 'Akşam', snack: 'Atıştırmalık',
};
const MEAL_COLORS: Record<string, string> = {
  breakfast: '#1D9E75', lunch: '#EF9F27', dinner: '#D85A30', snack: '#7F77DD',
};

interface MealOption {
  name: string; description: string; calories: number;
  protein_g: number; carbs_g: number; fat_g: number; prep_time_min?: number;
}

interface PlanData {
  id?: string;
  date: string;
  plan_type: string;
  calorie_target_min: number;
  calorie_target_max: number;
  protein_target_g: number;
  carbs_target_g: number;
  fat_target_g: number;
  focus_message: string;
  meal_suggestions: { meal_type: string; options: MealOption[] }[];
  snack_strategy: string | null;
  status: string;
  created_at?: string;
}

export default function DietPlanScreen() {
  const { colors } = useTheme();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const dayBoundaryHour = profile?.day_boundary_hour as number ?? 4;
  const today = getEffectiveDate(new Date(), dayBoundaryHour);

  const [currentPlan, setCurrentPlan] = useState<PlanData | null>(null);
  const [pastPlans, setPastPlans] = useState<PlanData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    loadPlans();
  }, [user?.id]);

  const loadPlans = async () => {
    if (!user?.id) return;
    setLoading(true);
    // Current plan
    const { data: current } = await supabase.from('daily_plans').select('*')
      .eq('user_id', user.id).eq('date', today)
      .order('version', { ascending: false }).limit(1).single();
    if (current) setCurrentPlan(current as unknown as PlanData);

    // Past plans (last 14 days)
    const { data: past } = await supabase.from('daily_plans').select('*')
      .eq('user_id', user.id).neq('date', today)
      .order('date', { ascending: false }).limit(14);
    if (past) setPastPlans(past as unknown as PlanData[]);
    setLoading(false);
  };

  const handleMealSelect = async (mealType: string, option: MealOption) => {
    if (!user?.id) return;
    const { data: mealLog } = await supabase.from('meal_logs').insert({
      user_id: user.id, raw_input: `${option.name} (plan secimi)`,
      meal_type: mealType, logged_for_date: today,
      logged_at: new Date().toISOString(), source: 'plan',
    }).select('id').single();
    if (!mealLog?.id) return;
    await supabase.from('meal_log_items').insert({
      meal_log_id: mealLog.id, name: option.name, portion: option.description,
      calories: option.calories, protein_g: option.protein_g,
      carbs_g: option.carbs_g, fat_g: option.fat_g,
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
          <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>Diyet Planı</Text>
        </View>

        {/* Current Plan */}
        {currentPlan ? (
          <>
            {/* Focus message */}
            {currentPlan.focus_message && (
              <View style={{
                backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg,
                marginBottom: SPACING.md, borderWidth: 0.5, borderColor: colors.border,
                borderLeftWidth: 3, borderLeftColor: colors.primary,
              }}>
                <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>{currentPlan.focus_message}</Text>
              </View>
            )}

            {/* Macro targets */}
            <View style={{
              backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg,
              marginBottom: SPACING.md, borderWidth: 0.5, borderColor: colors.border,
            }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.md }}>
                Günlük hedefler
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                {[
                  { label: 'Kalori', value: `${currentPlan.calorie_target_min}-${currentPlan.calorie_target_max}`, unit: 'kcal', color: METRIC_COLORS.calories },
                  { label: 'Protein', value: `${currentPlan.protein_target_g}`, unit: 'g', color: METRIC_COLORS.protein },
                  { label: 'Karb', value: `${currentPlan.carbs_target_g}`, unit: 'g', color: METRIC_COLORS.carbs },
                  { label: 'Yag', value: `${currentPlan.fat_target_g}`, unit: 'g', color: METRIC_COLORS.fat },
                ].map((m, i) => (
                  <View key={i} style={{ alignItems: 'center' }}>
                    <Text style={{ color: m.color, fontSize: 16, fontWeight: '700' }}>{m.value}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 11 }}>{m.unit} {m.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Meal suggestions */}
            {currentPlan.meal_suggestions?.map((meal, idx) => (
              <View key={idx} style={{ marginBottom: SPACING.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: MEAL_COLORS[meal.meal_type] ?? colors.primary }} />
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>
                    {MEAL_LABELS[meal.meal_type] ?? meal.meal_type}
                  </Text>
                </View>
                {meal.options?.map((opt, oidx) => (
                  <MealOptionCard key={oidx} option={opt} onSelect={() => handleMealSelect(meal.meal_type, opt)} />
                ))}
              </View>
            ))}

            {/* Snack strategy */}
            {currentPlan.snack_strategy && (
              <View style={{
                backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg,
                marginBottom: SPACING.md, borderWidth: 0.5, borderColor: colors.border,
              }}>
                <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.sm }}>
                  Atıştırma stratejisi
                </Text>
                <Text style={{ color: colors.text, fontSize: 13, lineHeight: 20 }}>{currentPlan.snack_strategy}</Text>
              </View>
            )}

            {/* Status */}
            {currentPlan.status === 'approved' && (
              <View style={{ backgroundColor: colors.primary + '18', borderRadius: RADIUS.pill, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.xl, alignSelf: 'center', marginBottom: SPACING.md }}>
                <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '500' }}>Plan onaylandı</Text>
              </View>
            )}
          </>
        ) : (
          <View style={{
            backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.xxl,
            alignItems: 'center', borderWidth: 0.5, borderColor: colors.border, marginBottom: SPACING.md,
          }}>
            <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: SPACING.md }}>Henüz plan oluşturulmamış</Text>
            <Button
              title="Plan oluştur"
              variant="outline"
              onPress={() => router.push({ pathname: '/(tabs)/chat', params: { prefill: 'Bugünkü diyet planını oluştur' } })}
            />
          </View>
        )}

        {/* Past Plans */}
        <TouchableOpacity
          onPress={() => setShowHistory(!showHistory)}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.md }}
        >
          <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Geçmiş planlar ({pastPlans.length})
          </Text>
          <Ionicons name={showHistory ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
        </TouchableOpacity>

        {showHistory && pastPlans.map((p, idx) => (
          <View key={idx} style={{
            backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg,
            marginBottom: SPACING.sm, borderWidth: 0.5, borderColor: colors.border,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '500' }}>{p.date}</Text>
              <Text style={{ color: p.status === 'approved' ? colors.primary : colors.textMuted, fontSize: 11 }}>
                {p.status === 'approved' ? 'Onaylandı' : p.status === 'rejected' ? 'Reddedildi' : 'Taslak'}
              </Text>
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
              {p.calorie_target_min}-{p.calorie_target_max} kcal
              {p.meal_suggestions ? ` \u00b7 ${p.meal_suggestions.length} öğün` : ''}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

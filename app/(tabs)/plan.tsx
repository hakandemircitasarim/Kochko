/**
 * Plan Screen - displays today's AI-generated plan.
 * Uses MealOptionCard, WorkoutCard, DayTargets components.
 * Spec 7.1: Günlük beslenme + antrenman planı
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MealOptionCard } from '@/components/plan/MealOptionCard';
import { WorkoutCard } from '@/components/plan/WorkoutCard';
import { DayTargets } from '@/components/plan/DayTargets';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Kahvalti', lunch: 'Ogle', dinner: 'Aksam', snack: 'Atistirmalik',
};

interface MealOption {
  name: string;
  description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  prep_time_min?: number;
}

interface PlanData {
  plan_type: string;
  calorie_target_min: number;
  calorie_target_max: number;
  protein_target_g: number;
  carbs_target_g: number;
  fat_target_g: number;
  water_target_liters: number;
  focus_message: string;
  meal_suggestions: { meal_type: string; options: MealOption[] }[];
  snack_strategy: string | null;
  workout_plan: {
    type: string; warmup: string; main: string[]; cooldown: string;
    duration_min: number; rpe: number; heart_rate_zone?: string;
    strength_targets?: { exercise: string; sets: number; reps: number; weight_kg: number }[];
  };
  weekly_budget_remaining: number | null;
  status: string;
}

export default function PlanScreen() {
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const { totalCalories, totalProtein, totalCarbs, totalFat, waterLiters } = useDashboardStore();
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('daily_plans').select('*')
      .eq('user_id', user.id).eq('date', today)
      .order('version', { ascending: false }).limit(1).single()
      .then(({ data }) => { if (data) setPlan(data as unknown as PlanData); setLoading(false); });
  }, [user?.id, today]);

  const handleGenerate = async (rejectionContext?: string) => {
    setGenerating(true);
    const { data } = await supabase.functions.invoke('ai-plan', {
      body: rejectionContext ? { rejection_context: rejectionContext } : {},
    });
    if (data) setPlan(data as PlanData);
    setGenerating(false);
  };

  const handleReject = () => {
    Alert.alert(
      'Neden begenmedin?',
      'Yeni plan olusturmak icin bir sebep sec:',
      [
        { text: 'Ogunler', onPress: () => handleRejectWithReason('Ogun secimleri begenilmedi, farkli yemek onerileri isteniyor') },
        { text: 'Porsiyonlar', onPress: () => handleRejectWithReason('Porsiyon miktarlari uygun degil, farkli miktarlar isteniyor') },
        { text: 'Genel yaklasim', onPress: () => handleRejectWithReason('Genel plan yaklasimi begenilmedi, tamamen farkli bir yaklasim isteniyor') },
        { text: 'Vazgec', style: 'cancel' },
      ]
    );
  };

  const handleRejectWithReason = async (reason: string) => {
    if (!user?.id) return;
    // Update current plan status to rejected
    await supabase.from('daily_plans')
      .update({ status: 'rejected' })
      .eq('user_id', user.id).eq('date', today)
      .order('version', { ascending: false }).limit(1);
    setPlan(prev => prev ? { ...prev, status: 'rejected' } : null);
    // Generate new plan with rejection context
    handleGenerate(reason);
  };

  const handleMealSelect = async (mealType: string, option: MealOption) => {
    if (!user?.id) return;
    // Insert into meal_logs
    const { data: mealLog } = await supabase.from('meal_logs').insert({
      user_id: user.id,
      raw_input: `${option.name} (plan secimi)`,
      meal_type: mealType,
      logged_for_date: today,
      logged_at: new Date().toISOString(),
      source: 'plan',
    }).select('id').single();

    if (!mealLog?.id) return;

    // Insert into meal_log_items
    await supabase.from('meal_log_items').insert({
      meal_log_id: mealLog.id,
      name: option.name,
      portion: option.description,
      calories: option.calories,
      protein_g: option.protein_g,
      carbs_g: option.carbs_g,
      fat_g: option.fat_g,
    });
  };

  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>;
  }

  if (!plan) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md }}>
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Gunun Plani</Text>
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: SPACING.lg, lineHeight: 20 }}>
            Henuz plan olusturulmamis. Kocundan plan istemek icin butona bas veya sohbette "bugunku planımı olustur" yaz.
          </Text>
          <Button title="Plan Olustur" onPress={() => handleGenerate()} loading={generating} size="lg" />
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Gunun Plani</Text>

      {/* Focus message */}
      <Card>
        <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '600', lineHeight: 26 }}>{plan.focus_message}</Text>
      </Card>

      {/* Day targets with live progress */}
      <View style={{ marginBottom: SPACING.md }}>
        <DayTargets
          calorieMin={plan.calorie_target_min}
          calorieMax={plan.calorie_target_max}
          calorieConsumed={totalCalories}
          proteinTarget={plan.protein_target_g}
          proteinConsumed={totalProtein}
          carbsTarget={plan.carbs_target_g}
          carbsConsumed={totalCarbs}
          fatTarget={plan.fat_target_g}
          fatConsumed={totalFat}
          waterTarget={plan.water_target_liters ?? 2.5}
          waterConsumed={waterLiters}
          isTrainingDay={plan.plan_type === 'training'}
        />
      </View>

      {/* Weekly budget context */}
      {plan.weekly_budget_remaining != null && (
        <View style={{ backgroundColor: COLORS.surfaceLight, borderRadius: 8, padding: SPACING.sm, marginBottom: SPACING.md }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, textAlign: 'center' }}>
            Haftalik butceden kalan: {plan.weekly_budget_remaining} kcal
          </Text>
        </View>
      )}

      {/* Meal suggestions with MealOptionCard */}
      {plan.meal_suggestions?.map((meal, idx) => (
        <View key={idx} style={{ marginBottom: SPACING.md }}>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '700', marginBottom: SPACING.sm }}>
            {MEAL_LABELS[meal.meal_type] ?? meal.meal_type}
          </Text>
          {meal.options?.map((opt, oidx) => (
            <MealOptionCard key={oidx} option={opt} onSelect={() => handleMealSelect(meal.meal_type, opt)} />
          ))}
        </View>
      ))}

      {/* Snack strategy */}
      {plan.snack_strategy && (
        <Card title="Atistirma Stratejisi">
          <Text style={{ color: COLORS.text, fontSize: FONT.md, lineHeight: 22 }}>{plan.snack_strategy}</Text>
        </Card>
      )}

      {/* Workout with WorkoutCard */}
      <View style={{ marginBottom: SPACING.md }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '700', marginBottom: SPACING.sm }}>Antrenman</Text>
        <WorkoutCard plan={plan.workout_plan} />
      </View>

      {/* Plan approval (Spec 7.2) */}
      {plan.status === 'draft' && (
        <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
          <View style={{ flex: 1 }}>
            <Button title="Plani Onayla" onPress={async () => {
              if (!user?.id) return;
              await supabase.from('daily_plans')
                .update({ status: 'approved', approved_at: new Date().toISOString() })
                .eq('user_id', user.id).eq('date', today).order('version', { ascending: false }).limit(1);
              setPlan({ ...plan, status: 'approved' });
            }} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Begenmem" variant="outline" onPress={handleReject} loading={generating} />
          </View>
        </View>
      )}
      {plan.status === 'rejected' && (
        <View style={{ backgroundColor: COLORS.warning + '20', borderRadius: 8, padding: SPACING.sm, marginBottom: SPACING.md }}>
          <Text style={{ color: COLORS.warning, fontSize: FONT.sm, textAlign: 'center', fontWeight: '600' }}>Plan reddedildi, yeni plan olusturuluyor...</Text>
        </View>
      )}
      {plan.status === 'approved' && (
        <View style={{ backgroundColor: COLORS.success + '20', borderRadius: 8, padding: SPACING.sm, marginBottom: SPACING.md }}>
          <Text style={{ color: COLORS.success, fontSize: FONT.sm, textAlign: 'center', fontWeight: '600' }}>Plan onaylandi</Text>
        </View>
      )}

      <Button title="Plani Yeniden Olustur" variant="outline" onPress={() => handleGenerate()} loading={generating} />
    </ScrollView>
  );
}

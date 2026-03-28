import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Kahvalti', lunch: 'Ogle', dinner: 'Aksam', snack: 'Atistirmalik',
};

interface PlanData {
  plan_type: string;
  calorie_target_min: number;
  calorie_target_max: number;
  protein_target_g: number;
  focus_message: string;
  meal_suggestions: { meal_type: string; options: { name: string; description: string; calories: number; protein_g: number; prep_time_min?: number }[] }[];
  snack_strategy: string | null;
  workout_plan: { type: string; warmup: string; main: string[]; cooldown: string; duration_min: number; rpe: number; strength_targets?: { exercise: string; sets: number; reps: number; weight_kg: number }[] };
  weekly_budget_remaining: number | null;
  status: string;
}

export default function PlanScreen() {
  const user = useAuthStore(s => s.user);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    async function load() {
      if (!user?.id) return;
      const { data } = await supabase.from('daily_plans').select('*')
        .eq('user_id', user.id).eq('date', today).order('version', { ascending: false }).limit(1).single();
      if (data) setPlan(data as unknown as PlanData);
      setLoading(false);
    }
    load();
  }, [user?.id, today]);

  const handleGenerate = async () => {
    setGenerating(true);
    const { data, error } = await supabase.functions.invoke('ai-plan', {});
    if (data) setPlan(data as PlanData);
    setGenerating(false);
  };

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  if (!plan) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md }}>
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Gunun Plani</Text>
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: SPACING.lg, lineHeight: 20 }}>Henuz plan olusturulmamis. Kocundan plan istemek icin butona bas veya sohbette "bugunku planımı olustur" yaz.</Text>
          <Button title="Plan Olustur" onPress={handleGenerate} loading={generating} size="lg" />
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Gunun Plani</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>
        {plan.plan_type === 'training' ? 'Antrenman Gunu' : 'Dinlenme Gunu'}
      </Text>

      {/* Focus */}
      <Card title="Bugunku Odak">
        <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '600', lineHeight: 26 }}>{plan.focus_message}</Text>
      </Card>

      {/* Targets */}
      <Card title="Hedefler">
        <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: COLORS.primary, fontSize: FONT.xl, fontWeight: '700' }}>{plan.calorie_target_min}-{plan.calorie_target_max}</Text>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>kcal</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: COLORS.primary, fontSize: FONT.xl, fontWeight: '700' }}>{plan.protein_target_g}g+</Text>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>protein</Text>
          </View>
        </View>
        {plan.weekly_budget_remaining != null && (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, textAlign: 'center', marginTop: SPACING.sm }}>Haftalik butceden kalan: {plan.weekly_budget_remaining} kcal</Text>
        )}
      </Card>

      {/* Meals */}
      {plan.meal_suggestions?.map((meal, idx) => (
        <Card key={idx} title={MEAL_LABELS[meal.meal_type] ?? meal.meal_type}>
          {meal.options?.map((opt, oidx) => (
            <View key={oidx} style={{ paddingVertical: SPACING.sm, borderBottomWidth: oidx < meal.options.length - 1 ? 1 : 0, borderBottomColor: COLORS.border }}>
              <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{opt.name}</Text>
              <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: 2 }}>{opt.description}</Text>
              <View style={{ flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.xs }}>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{opt.calories} kcal</Text>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>P:{opt.protein_g}g</Text>
                {opt.prep_time_min && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{opt.prep_time_min} dk</Text>}
              </View>
            </View>
          ))}
        </Card>
      ))}

      {/* Snack Strategy */}
      {plan.snack_strategy && (
        <Card title="Atistirma Stratejisi">
          <Text style={{ color: COLORS.text, fontSize: FONT.md, lineHeight: 22 }}>{plan.snack_strategy}</Text>
        </Card>
      )}

      {/* Workout */}
      {plan.workout_plan && plan.workout_plan.type !== 'rest' && (
        <Card title="Antrenman">
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.xs }}>Isinma: {plan.workout_plan.warmup}</Text>
          {plan.workout_plan.main?.map((ex, i) => (
            <Text key={i} style={{ color: COLORS.text, fontSize: FONT.md, paddingVertical: 2, paddingLeft: SPACING.sm }}>{i + 1}. {ex}</Text>
          ))}
          {plan.workout_plan.strength_targets?.map((st, i) => (
            <Text key={`st-${i}`} style={{ color: COLORS.primary, fontSize: FONT.sm, paddingLeft: SPACING.sm }}>
              {st.exercise}: {st.sets}x{st.reps} @ {st.weight_kg}kg
            </Text>
          ))}
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xs }}>Soguma: {plan.workout_plan.cooldown}</Text>
          <View style={{ flexDirection: 'row', gap: SPACING.lg, marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border }}>
            <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '500' }}>{plan.workout_plan.duration_min} dk</Text>
            <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '500' }}>RPE: {plan.workout_plan.rpe}/10</Text>
          </View>
        </Card>
      )}

      <Button title="Plani Yeniden Olustur" variant="outline" onPress={handleGenerate} loading={generating} />
    </ScrollView>
  );
}

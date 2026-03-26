import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { generateDailyPlan, type GeneratedPlan } from '@/services/ai.service';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

export default function PlanScreen() {
  const user = useAuthStore((s) => s.user);
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  // Load existing plan for today
  useEffect(() => {
    async function loadPlan() {
      if (!user?.id) return;
      const { data } = await supabase
        .from('daily_plans')
        .select('*')
        .eq('user_id', user.id)
        .eq('date', today)
        .single();

      if (data) {
        setPlan({
          calorie_target_min: data.calorie_target_min,
          calorie_target_max: data.calorie_target_max,
          protein_target_g: data.protein_target_g,
          focus_message: data.focus_message,
          meal_suggestions: data.meal_suggestions as GeneratedPlan['meal_suggestions'],
          snack_strategy: data.snack_strategy ?? '',
          workout_plan: data.workout_plan as GeneratedPlan['workout_plan'],
        });
      }
      setLoading(false);
    }
    loadPlan();
  }, [user?.id, today]);

  const handleGenerate = async () => {
    setGenerating(true);
    const { data, error } = await generateDailyPlan();
    if (data) {
      setPlan(data);
    }
    setGenerating(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const mealTypeLabels: Record<string, string> = {
    breakfast: 'Kahvaltı',
    lunch: 'Öğle',
    dinner: 'Akşam',
    snack: 'Atıştırma',
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Günün Planı</Text>

      {!plan ? (
        <Card>
          <Text style={styles.emptyText}>
            Henüz bugün için plan üretilmemiş.
          </Text>
          <Button
            title="Plan Üret"
            onPress={handleGenerate}
            loading={generating}
            size="lg"
          />
        </Card>
      ) : (
        <>
          {/* Focus message */}
          <Card title="Bugünün Odağı">
            <Text style={styles.focusMessage}>{plan.focus_message}</Text>
          </Card>

          {/* Targets */}
          <Card title="Hedefler">
            <View style={styles.targetRow}>
              <View style={styles.targetItem}>
                <Text style={styles.targetValue}>
                  {plan.calorie_target_min}-{plan.calorie_target_max}
                </Text>
                <Text style={styles.targetLabel}>kcal</Text>
              </View>
              <View style={styles.targetItem}>
                <Text style={styles.targetValue}>{plan.protein_target_g}g+</Text>
                <Text style={styles.targetLabel}>protein</Text>
              </View>
            </View>
          </Card>

          {/* Meal suggestions */}
          {plan.meal_suggestions.map((meal, idx) => (
            <Card key={idx} title={mealTypeLabels[meal.meal_type] ?? meal.meal_type}>
              {meal.options.map((opt, oidx) => (
                <View key={oidx} style={styles.mealOption}>
                  <Text style={styles.mealName}>{opt.name}</Text>
                  <Text style={styles.mealDesc}>{opt.description}</Text>
                  <View style={styles.macroRow}>
                    <Text style={styles.macro}>{opt.calories} kcal</Text>
                    <Text style={styles.macro}>P:{opt.protein_g}g</Text>
                    <Text style={styles.macro}>K:{opt.carbs_g}g</Text>
                    <Text style={styles.macro}>Y:{opt.fat_g}g</Text>
                  </View>
                </View>
              ))}
            </Card>
          ))}

          {/* Snack strategy */}
          {plan.snack_strategy && (
            <Card title="Atıştırma Stratejisi">
              <Text style={styles.strategyText}>{plan.snack_strategy}</Text>
            </Card>
          )}

          {/* Workout plan */}
          <Card title="Antrenman">
            <Text style={styles.workoutSection}>Isınma: {plan.workout_plan.warmup}</Text>
            {plan.workout_plan.main.map((exercise, i) => (
              <Text key={i} style={styles.workoutExercise}>
                {i + 1}. {exercise}
              </Text>
            ))}
            <Text style={styles.workoutSection}>Soğuma: {plan.workout_plan.cooldown}</Text>
            <View style={styles.workoutMeta}>
              <Text style={styles.workoutMetaText}>
                {plan.workout_plan.duration_min} dk
              </Text>
              <Text style={styles.workoutMetaText}>
                RPE: {plan.workout_plan.rpe}/10
              </Text>
              <Text style={styles.workoutMetaText}>
                Nabız: {plan.workout_plan.heart_rate_zone}
              </Text>
            </View>
          </Card>

          {/* Regenerate */}
          <Button
            title="Planı Yeniden Üret"
            variant="outline"
            onPress={handleGenerate}
            loading={generating}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  title: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.lg,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    marginBottom: SPACING.lg,
    lineHeight: 22,
  },
  focusMessage: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
    lineHeight: 26,
  },
  targetRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  targetItem: {
    alignItems: 'center',
  },
  targetValue: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
  },
  targetLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
  },
  mealOption: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  mealName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  mealDesc: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
  },
  macroRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.xs,
  },
  macro: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },
  strategyText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    lineHeight: 22,
  },
  workoutSection: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    marginVertical: SPACING.xs,
  },
  workoutExercise: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    paddingVertical: 2,
    paddingLeft: SPACING.sm,
  },
  workoutMeta: {
    flexDirection: 'row',
    gap: SPACING.lg,
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  workoutMetaText: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.sm,
    fontWeight: '500',
  },
});

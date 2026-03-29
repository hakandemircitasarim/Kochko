/**
 * Today Dashboard — the main screen
 * Spec 17 item 2: Bugün dashboard'u
 *
 * Shows: daily stats, calorie progress, water, mood, sleep,
 * meals, workouts, weekly budget, step counter, quick actions.
 */
import { useEffect, useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { useStreak } from '@/hooks/useStreak';
import { usePremium } from '@/hooks/usePremium';
import { Card } from '@/components/ui/Card';
import { WaterTracker } from '@/components/tracking/WaterTracker';
import { StreakBadge } from '@/components/tracking/StreakBadge';
import { CalorieProgress } from '@/components/tracking/CalorieProgress';
import { MoodTracker } from '@/components/tracking/MoodTracker';
import { SleepInput } from '@/components/tracking/SleepInput';
import { StepCounter } from '@/components/tracking/StepCounter';
import { WeeklyBudgetWidget } from '@/components/tracking/WeeklyBudgetWidget';
import { SupplementQuickAdd } from '@/components/tracking/SupplementQuickAdd';
import { supabase } from '@/lib/supabase';
import { getStepGoal } from '@/services/step-counter.service';
import { calculateWeeklyBudget } from '@/lib/weekly-budget';
import { COLORS, SPACING, FONT, WATER_INCREMENT } from '@/lib/constants';

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Kahvalti', lunch: 'Ogle', dinner: 'Aksam', snack: 'Ara',
};

export default function TodayScreen() {
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const {
    meals, workouts, weightKg, waterLiters, sleepHours, steps, moodScore,
    totalCalories, totalProtein, loading, fetchToday, addWater, deleteMeal, deleteWorkout,
  } = useDashboardStore();
  const { streak, checkForMilestones, newAchievement } = useStreak();
  const { isPremium } = usePremium();

  // Weekly budget state
  const [weeklyBudget, setWeeklyBudget] = useState<{
    consumed: number; total: number; remaining: number; daysLeft: number; rebalanceMessage: string | null;
  } | null>(null);

  const refresh = useCallback(() => {
    if (user?.id) {
      fetchToday(user.id);
      checkForMilestones();
    }
  }, [user?.id, fetchToday, checkForMilestones]);

  useEffect(() => { refresh(); }, [refresh]);

  // Calculate weekly budget
  useEffect(() => {
    if (!profile?.calorie_range_training_min) return;
    const p = profile as Record<string, unknown>;
    const tMin = (p.calorie_range_training_min as number) ?? 1800;
    const tMax = (p.calorie_range_training_max as number) ?? 2000;
    const rMin = (p.calorie_range_rest_min as number) ?? 1600;
    const rMax = (p.calorie_range_rest_max as number) ?? 1800;
    const trainingAvg = Math.round((tMin + tMax) / 2);
    const restAvg = Math.round((rMin + rMax) / 2);
    const total = calculateWeeklyBudget(trainingAvg, restAvg, 4);
    const dayOfWeek = (new Date().getDay() + 6) % 7; // 0=Mon
    const daysLeft = 6 - dayOfWeek;
    const consumed = totalCalories; // simplified — should sum entire week
    const remaining = total - consumed;

    setWeeklyBudget({ consumed, total, remaining: Math.max(0, remaining), daysLeft, rebalanceMessage: null });
  }, [profile, totalCalories]);

  const today = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const waterTarget = (profile as Record<string, unknown>)?.water_target_liters as number ?? 2.5;
  const stepGoal = getStepGoal(profile?.activity_level ?? 'moderate');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={COLORS.primary} />}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text }}>Bugun</Text>
        <StreakBadge days={streak} />
      </View>
      <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginBottom: SPACING.md }}>{today}</Text>

      {/* Achievement toast */}
      {newAchievement && (
        <View style={{ backgroundColor: COLORS.success, borderRadius: 12, padding: SPACING.sm, marginBottom: SPACING.md }}>
          <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600', textAlign: 'center' }}>
            {newAchievement}
          </Text>
        </View>
      )}

      {/* Stats Row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md }}>
        <StatBox value={`${totalCalories}`} label="kcal" />
        <StatBox value={`${totalProtein}g`} label="protein" />
        <StatBox value={weightKg ? `${weightKg}` : '-'} label="kg" />
        <StatBox value={sleepHours ? `${sleepHours}sa` : '-'} label="uyku" />
      </View>

      {/* Calorie Progress */}
      {profile?.calorie_range_training_min && (
        <View style={{ marginBottom: SPACING.md }}>
          <CalorieProgress
            consumed={totalCalories}
            targetMin={profile.calorie_range_training_min as number}
            targetMax={(profile as Record<string, unknown>).calorie_range_training_max as number}
            protein={totalProtein}
            proteinTarget={
              (profile as Record<string, unknown>).protein_per_kg && profile.weight_kg
                ? Math.round(Number((profile as Record<string, unknown>).protein_per_kg) * Number(profile.weight_kg))
                : 100
            }
          />
        </View>
      )}

      {/* Weekly Budget Widget */}
      {isPremium && weeklyBudget && (
        <View style={{ marginBottom: SPACING.md }}>
          <WeeklyBudgetWidget
            consumed={weeklyBudget.consumed}
            total={weeklyBudget.total}
            daysLeft={weeklyBudget.daysLeft}
            rebalanceMessage={weeklyBudget.rebalanceMessage}
          />
        </View>
      )}

      {/* Water + Mood side by side */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <View style={{ flex: 1 }}>
          <WaterTracker current={waterLiters} target={waterTarget} onAdd={() => user?.id && addWater(user.id, WATER_INCREMENT)} />
        </View>
        <View style={{ flex: 1 }}>
          <MoodTracker
            currentScore={moodScore}
            onSelect={async (score) => {
              if (!user?.id) return;
              const date = new Date().toISOString().split('T')[0];
              await supabase.from('daily_metrics').upsert(
                { user_id: user.id, date, mood_score: score, water_liters: waterLiters, synced: true },
                { onConflict: 'user_id,date' }
              );
              refresh();
            }}
          />
        </View>
      </View>

      {/* Sleep */}
      <View style={{ marginBottom: SPACING.md }}>
        <SleepInput
          currentHours={sleepHours}
          onSave={async (hours, quality) => {
            if (!user?.id) return;
            const date = new Date().toISOString().split('T')[0];
            await supabase.from('daily_metrics').upsert(
              { user_id: user.id, date, sleep_hours: hours, sleep_quality: quality, water_liters: waterLiters, synced: true },
              { onConflict: 'user_id,date' }
            );
            refresh();
          }}
        />
      </View>

      {/* Steps */}
      <View style={{ marginBottom: SPACING.md }}>
        <StepCounter steps={steps ?? 0} target={stepGoal} source="phone" />
      </View>

      {/* Quick Input — sends to chat */}
      <TouchableOpacity
        style={{ backgroundColor: COLORS.inputBg, borderRadius: 16, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}
        onPress={() => router.push('/(tabs)/chat')}
      >
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.md }}>Kocuna yaz... ne yedin, ne yaptin, nasil hissediyorsun</Text>
      </TouchableOpacity>

      {/* Quick Actions */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: SPACING.lg }}>
        {[
          { label: 'Ogun', route: '/log' },
          { label: 'Spor', route: '/log' },
          { label: 'Tarti', route: '/log' },
          { label: 'Foto', route: '/(tabs)/chat' },
        ].map((item, i) => (
          <TouchableOpacity key={i} onPress={() => router.push(item.route as never)} style={{ alignItems: 'center', padding: SPACING.sm }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}>
              <Text style={{ fontSize: 20, color: COLORS.primary, fontWeight: '700' }}>+</Text>
            </View>
            <Text style={{ fontSize: FONT.xs, color: COLORS.textSecondary, marginTop: 4 }}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Supplement Quick Add */}
      <View style={{ marginBottom: SPACING.md }}>
        <SupplementQuickAdd onLogged={refresh} />
      </View>

      {/* Meals */}
      <Card title={`Ogunler (${meals.length})`}>
        {meals.length === 0 ? (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>
            Kocuna ne yedigini yaz veya + butonuna bas.
          </Text>
        ) : (
          meals.map(meal => (
            <TouchableOpacity
              key={meal.id}
              onLongPress={() => {
                Alert.alert('Kaydi Sil', `"${meal.raw_input}" silinsin mi?`, [
                  { text: 'Iptal' },
                  { text: 'Sil', style: 'destructive', onPress: () => deleteMeal(meal.id) },
                ]);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '600', textTransform: 'uppercase' }}>
                  {MEAL_LABELS[meal.meal_type] ?? meal.meal_type}
                </Text>
                <Text style={{ color: COLORS.text, fontSize: FONT.md, marginTop: 2 }}>{meal.raw_input}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '600' }}>{meal.calories} kcal</Text>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>{Math.round(meal.protein_g)}g pro</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </Card>

      {/* Workouts */}
      <Card title={`Antrenmanlar (${workouts.length})`}>
        {workouts.length === 0 ? (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>
            Henuz antrenman yok. Kocuna veya + Spor'a bas.
          </Text>
        ) : (
          workouts.map(w => (
            <TouchableOpacity
              key={w.id}
              onLongPress={() => {
                Alert.alert('Kaydi Sil', 'Antrenman silinsin mi?', [
                  { text: 'Iptal' },
                  { text: 'Sil', style: 'destructive', onPress: () => deleteWorkout(w.id) },
                ]);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}
            >
              <Text style={{ color: COLORS.text, fontSize: FONT.md, flex: 1 }}>{w.raw_input}</Text>
              {w.duration_min > 0 && <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{w.duration_min} dk</Text>}
            </TouchableOpacity>
          ))
        )}
      </Card>

      {/* Report Links */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        {[
          ['Gun Sonu Raporu', '/reports/daily'],
          ['Haftalik Rapor', '/reports/weekly'],
          ['Takvim', '/reports/calendar'],
        ].map(([label, href], i) => (
          <TouchableOpacity
            key={i}
            style={{ flex: 1, backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}
            onPress={() => router.push(href as never)}
          >
            <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center', marginTop: SPACING.md }}>
        Uzun bas: kaydi sil
      </Text>
    </ScrollView>
  );
}

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <View style={{
      backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, alignItems: 'center',
      flex: 1, marginHorizontal: 3, borderWidth: 1, borderColor: COLORS.border,
    }}>
      <Text style={{ fontSize: FONT.xl, fontWeight: '700', color: COLORS.primary }}>{value}</Text>
      <Text style={{ fontSize: FONT.xs, color: COLORS.textSecondary, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

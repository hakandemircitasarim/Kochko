import { useEffect, useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { useStreak } from '@/hooks/useStreak';
import { Card } from '@/components/ui/Card';
import { WaterTracker } from '@/components/tracking/WaterTracker';
import { StreakBadge } from '@/components/tracking/StreakBadge';
import { CalorieProgress } from '@/components/tracking/CalorieProgress';
import { MoodTracker } from '@/components/tracking/MoodTracker';
import { SleepInput } from '@/components/tracking/SleepInput';
import { supabase } from '@/lib/supabase';
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
  const { streak, checkForMilestones } = useStreak();

  const refresh = useCallback(() => {
    if (user?.id) {
      fetchToday(user.id);
      checkForMilestones();
    }
  }, [user?.id, fetchToday, checkForMilestones]);

  useEffect(() => { refresh(); }, [refresh]);

  const today = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const waterTarget = profile?.water_target_liters ?? 2.5;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={COLORS.primary} />}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text }}>Bugun</Text>
        <StreakBadge days={streak} />
      </View>
      <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginBottom: SPACING.md }}>{today}</Text>

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
            targetMax={profile.calorie_range_training_max as number}
            protein={totalProtein}
            proteinTarget={profile.protein_per_kg && profile.weight_kg
              ? Math.round(Number(profile.protein_per_kg) * Number(profile.weight_kg))
              : 100}
          />
        </View>
      )}

      {/* Water Tracker */}
      <View style={{ marginBottom: SPACING.md }}>
        <WaterTracker current={waterLiters} target={waterTarget} onAdd={() => user?.id && addWater(user.id, WATER_INCREMENT)} />
      </View>

      {/* Mood + Sleep (side by side) */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
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

      {/* Quick Input */}
      <TouchableOpacity
        style={{ backgroundColor: COLORS.inputBg, borderRadius: 16, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}
        onPress={() => router.push('/(tabs)/chat')}
      >
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.md }}>Kocuna yaz... ne yedin, ne yaptin, nasil hissediyorsun</Text>
      </TouchableOpacity>

      {/* Quick Actions */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: SPACING.lg }}>
        {['Ogun', 'Spor', 'Tarti', 'Foto'].map((label, i) => (
          <TouchableOpacity key={i} onPress={() => router.push('/(tabs)/chat')} style={{ alignItems: 'center', padding: SPACING.sm }}>
            <Text style={{ fontSize: 24, color: COLORS.primary, fontWeight: '700' }}>+</Text>
            <Text style={{ fontSize: FONT.xs, color: COLORS.textSecondary }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Extra Metrics Row */}
      {(sleepHours || steps || moodScore) && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: SPACING.md }}>
          {sleepHours && <MiniStat label="Uyku" value={`${sleepHours}sa`} />}
          {steps && <MiniStat label="Adim" value={`${steps}`} />}
          {moodScore && <MiniStat label="Mood" value={`${moodScore}/5`} />}
        </View>
      )}

      {/* Meals */}
      <Card title={`Ogunler (${meals.length})`}>
        {meals.length === 0 ? (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>Kocuna ne yedigini yaz.</Text>
        ) : (
          meals.map(meal => (
            <TouchableOpacity key={meal.id} onLongPress={() => deleteMeal(meal.id)}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '600', textTransform: 'uppercase' }}>{MEAL_LABELS[meal.meal_type] ?? meal.meal_type}</Text>
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
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.md }}>Henuz antrenman yok.</Text>
        ) : (
          workouts.map(w => (
            <TouchableOpacity key={w.id} onLongPress={() => deleteWorkout(w.id)}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
              <Text style={{ color: COLORS.text, fontSize: FONT.md, flex: 1 }}>{w.raw_input}</Text>
              {w.duration_min > 0 && <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>{w.duration_min} dk</Text>}
            </TouchableOpacity>
          ))
        )}
      </Card>

      {/* Report Links */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        {[['Gun Sonu Raporu', '/reports/daily'], ['Haftalik Rapor', '/reports/weekly']].map(([label, href], i) => (
          <TouchableOpacity key={i} style={{ flex: 1, backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}
            onPress={() => router.push(href as never)}>
            <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={{ color: COLORS.textMuted, fontSize: 10, textAlign: 'center', marginTop: SPACING.md }}>Uzun bas: kaydi sil</Text>
    </ScrollView>
  );
}

function StatBox({ value, label, onPress }: { value: string; label: string; onPress?: () => void }) {
  return (
    <TouchableOpacity
      style={{ backgroundColor: COLORS.card, borderRadius: 12, padding: SPACING.md, alignItems: 'center', flex: 1, marginHorizontal: 3, borderWidth: 1, borderColor: COLORS.border }}
      onPress={onPress} disabled={!onPress}
    >
      <Text style={{ fontSize: FONT.xl, fontWeight: '700', color: COLORS.primary }}>{value}</Text>
      <Text style={{ fontSize: FONT.xs, color: COLORS.textSecondary, marginTop: 2 }}>{label}</Text>
    </TouchableOpacity>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{value}</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{label}</Text>
    </View>
  );
}

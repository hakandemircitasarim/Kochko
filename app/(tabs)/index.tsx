import { useEffect, useCallback, useState, useRef } from 'react';
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
import { StepCounter } from '@/components/tracking/StepCounter';
import { WeeklyBudgetWidget } from '@/components/tracking/WeeklyBudgetWidget';
import { SupplementQuickAdd } from '@/components/tracking/SupplementQuickAdd';
import { RecoveryInput } from '@/components/tracking/RecoveryInput';
import { IFTimerWidget } from '@/components/tracking/IFTimerWidget';
import { ChallengeWidget } from '@/components/tracking/ChallengeWidget';
import { GoalProgressWidget } from '@/components/tracking/GoalProgress';
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { checkSuspiciousInput } from '@/lib/guardrails-client';
import { getWeeklyStatus } from '@/lib/weekly-budget';
import { Alert } from 'react-native';
import { COLORS, SPACING, FONT, WATER_INCREMENT } from '@/lib/constants';
import NetInfo from '@react-native-community/netinfo';
import { setupAutoSync } from '@/services/offline-queue.service';

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Kahvalti', lunch: 'Ogle', dinner: 'Aksam', snack: 'Ara',
};

export default function TodayScreen() {
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const {
    meals, workouts, weightKg, waterLiters, sleepHours, sleepTime, wakeTime, steps, moodScore,
    totalCalories, totalProtein, focusMessage, weeklyBudgetRemaining,
    goalProgress, activeGoal,
    loading, fetchToday, addWater, deleteMeal, deleteWorkout,
  } = useDashboardStore();
  const { streak, checkForMilestones } = useStreak();
  const [activeChallenges, setActiveChallenges] = useState<{ id: string; challenge_name: string; target_days: number; completed_days: number }[]>([]);
  const [isOffline, setIsOffline] = useState(false);
  const [weeklyRebalanceMessage, setWeeklyRebalanceMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (user?.id) {
      fetchToday(user.id);
      checkForMilestones();
      // Fetch active challenges for widget
      supabase.from('challenges').select('id, challenge_name, target_days, completed_days')
        .eq('user_id', user.id).eq('status', 'active').limit(2)
        .then(({ data }) => setActiveChallenges((data ?? []) as typeof activeChallenges));
    }
  }, [user?.id, fetchToday, checkForMilestones]);

  useEffect(() => { refresh(); }, [refresh]);

  // Offline detection banner + auto-sync on reconnect
  useEffect(() => {
    const unsubscribeNetInfo = NetInfo.addEventListener(state => {
      setIsOffline(!state.isConnected);
    });
    const unsubscribeAutoSync = setupAutoSync();
    return () => {
      unsubscribeNetInfo();
      unsubscribeAutoSync();
    };
  }, []);

  const dayBoundaryHour = (profile as Record<string, unknown>)?.day_boundary_hour as number ?? 4;
  const today = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const waterTarget = profile?.water_target_liters ?? 2.5;
  const ifActive = !!(profile as Record<string, unknown>)?.if_active;
  const ifEatingStart = (profile as Record<string, unknown>)?.if_eating_start as string | null;
  const ifEatingEnd = (profile as Record<string, unknown>)?.if_eating_end as string | null;
  const weeklyCalorieTarget = (profile as Record<string, unknown>)?.weekly_calorie_budget as number | null;
  const stepTarget = (profile as Record<string, unknown>)?.step_target as number ?? 10000;

  // GAP 3: Compute weekly rebalance message from today's meals
  useEffect(() => {
    if (!weeklyCalorieTarget || weeklyCalorieTarget <= 0) return;
    const todayDow = new Date().getDay(); // 0=Sun, 1=Mon,...
    const todayIndex = todayDow === 0 ? 6 : todayDow - 1; // convert to Mon=0..Sun=6
    const dailyTarget = Math.round(weeklyCalorieTarget / 7);
    const todayData = { date: new Date().toISOString().split('T')[0], consumed: totalCalories, target: dailyTarget, isTrainingDay: false };
    const status = getWeeklyStatus(weeklyCalorieTarget, [todayData], 0);
    setWeeklyRebalanceMessage(status.rebalanceMessage);
  }, [totalCalories, weeklyCalorieTarget]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={COLORS.primary} />}
    >
      {isOffline && (
        <View style={{ backgroundColor: '#f59e0b', borderRadius: 10, padding: SPACING.sm, marginBottom: SPACING.sm, flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '600', flex: 1 }}>
            Cevrimdisi moddasin. Kayitlarin internet geldiginde senkronize edilecek.
          </Text>
        </View>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text }}>Bugun</Text>
        <StreakBadge days={streak} />
      </View>
      <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginBottom: SPACING.md }}>{today}</Text>

      {/* Focus Message (Spec 5.5) */}
      {focusMessage && (
        <View style={{ backgroundColor: COLORS.primary + '18', borderRadius: 12, padding: SPACING.md, marginBottom: SPACING.md, borderLeftWidth: 3, borderLeftColor: COLORS.primary }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: 4 }}>Bugunun Odagi</Text>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '500' }}>{focusMessage}</Text>
        </View>
      )}

      {/* IF Timer Widget (Spec 2.1, T2.18) */}
      {ifActive && ifEatingStart && ifEatingEnd && (
        <View style={{ marginBottom: SPACING.md }}>
          <IFTimerWidget eatingStart={ifEatingStart} eatingEnd={ifEatingEnd} />
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
            targetMax={profile.calorie_range_training_max as number}
            protein={totalProtein}
            proteinTarget={profile.protein_per_kg && profile.weight_kg
              ? Math.round(Number(profile.protein_per_kg) * Number(profile.weight_kg))
              : 100}
          />
        </View>
      )}

      {/* Goal Progress */}
      {goalProgress && activeGoal && (
        <View style={{ marginBottom: SPACING.md }}>
          <GoalProgressWidget
            progress={goalProgress}
            goalType={activeGoal.goal_type}
            targetWeight={activeGoal.target_weight_kg}
            currentWeight={weightKg ?? (profile?.weight_kg as number | null)}
          />
        </View>
      )}

      {/* Water Tracker */}
      <View style={{ marginBottom: SPACING.md }}>
        <WaterTracker current={waterLiters} target={waterTarget} onAdd={() => {
          if (!user?.id) return;
          const newTotal = waterLiters + WATER_INCREMENT;
          const warning = checkSuspiciousInput('water', newTotal);
          if (warning) {
            Alert.alert('Dogrulama', warning, [
              { text: 'Iptal', style: 'cancel' },
              { text: 'Evet', onPress: () => addWater(user.id, WATER_INCREMENT, dayBoundaryHour) },
            ]);
          } else {
            addWater(user.id, WATER_INCREMENT, dayBoundaryHour);
          }
        }} />
      </View>

      {/* Mood + Sleep (side by side) */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <View style={{ flex: 1 }}>
          <MoodTracker
            currentScore={moodScore}
            onSelect={async (score, stressNote) => {
              if (!user?.id) return;
              const date = getEffectiveDate(new Date(), dayBoundaryHour);
              await supabase.from('daily_metrics').upsert(
                { user_id: user.id, date, mood_score: score, mood_note: stressNote ?? null, stress_note: stressNote ?? null, water_liters: waterLiters, synced: true },
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
          currentSleepTime={sleepTime}
          currentWakeTime={wakeTime}
          onSave={async (hours, quality, savedSleepTime, savedWakeTime) => {
            if (!user?.id) return;
            const warning = checkSuspiciousInput('sleep', hours);
            const doSave = async () => {
              const date = getEffectiveDate(new Date(), dayBoundaryHour);
              await supabase.from('daily_metrics').upsert(
                { user_id: user.id, date, sleep_hours: hours, sleep_quality: quality, sleep_time: savedSleepTime ?? null, wake_time: savedWakeTime ?? null, water_liters: waterLiters, synced: true },
                { onConflict: 'user_id,date' }
              );
              refresh();
            };
            if (warning) {
              Alert.alert('Dogrulama', warning, [
                { text: 'Iptal', style: 'cancel' },
                { text: 'Evet', onPress: doSave },
              ]);
            } else {
              await doSave();
            }
          }}
        />
      </View>

      {/* Supplement Quick Add (Spec 3.1) */}
      <View style={{ marginBottom: SPACING.md }}>
        <SupplementQuickAdd onLogged={refresh} />
      </View>

      {/* Recovery Input - only for strength/mixed training (Spec 3.1) */}
      {((profile as Record<string, unknown>)?.training_style === 'strength' || (profile as Record<string, unknown>)?.training_style === 'mixed') && (
        <View style={{ marginBottom: SPACING.md }}>
          <RecoveryInput
            muscleSoreness={null}
            recoveryScore={null}
            onSave={async (soreness, recovery) => {
              if (!user?.id) return;
              const date = getEffectiveDate(new Date(), dayBoundaryHour);
              await supabase.from('daily_metrics').upsert(
                { user_id: user.id, date, muscle_soreness: soreness, recovery_score: recovery, water_liters: waterLiters, synced: true },
                { onConflict: 'user_id,date' }
              );
              refresh();
            }}
          />
        </View>
      )}

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

      {/* Active Challenges Widget (Spec 13.5, T3.37) */}
      {activeChallenges.length > 0 && (
        <View style={{ marginBottom: SPACING.md }}>
          <ChallengeWidget challenges={activeChallenges} />
        </View>
      )}

      {/* Step Counter (Spec 14.2) */}
      {steps !== null && (
        <View style={{ marginBottom: SPACING.md }}>
          <StepCounter steps={steps} target={stepTarget} source="manual" />
        </View>
      )}

      {/* Weekly Budget Widget (Spec 2.6) */}
      {weeklyCalorieTarget && weeklyCalorieTarget > 0 && (
        <View style={{ marginBottom: SPACING.md }}>
          <WeeklyBudgetWidget
            consumed={weeklyCalorieTarget - (weeklyBudgetRemaining ?? weeklyCalorieTarget)}
            total={weeklyCalorieTarget}
            daysLeft={7 - new Date().getDay() || 7}
            rebalanceMessage={weeklyRebalanceMessage ?? null}
          />
        </View>
      )}

      {/* Report Links */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
        {[['Gunluk', '/reports/daily'], ['Haftalik', '/reports/weekly'], ['Aylik', '/reports/monthly'], ['Tum Zamanlar', '/reports/all-time']].map(([label, href], i) => (
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

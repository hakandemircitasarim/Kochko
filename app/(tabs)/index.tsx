import { useEffect, useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Alert, Platform, TextInput, Modal } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { useStreak } from '@/hooks/useStreak';
import { MoodTracker } from '@/components/tracking/MoodTracker';
import { SleepInput } from '@/components/tracking/SleepInput';
import { GoalProgressWidget } from '@/components/tracking/GoalProgress';
import { HeroSection } from '@/components/dashboard/HeroSection';
import { StatStrip } from '@/components/dashboard/StatStrip';
import { ActivityTimeline } from '@/components/dashboard/ActivityTimeline';
import { SmartActions } from '@/components/dashboard/SmartActions';
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { checkSuspiciousInput } from '@/lib/guardrails-client';
import { useTheme, GRADIENTS } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW, WATER_INCREMENT } from '@/lib/constants';
import NetInfo from '@react-native-community/netinfo';
import { setupAutoSync } from '@/services/offline-queue.service';

export default function TodayScreen() {
  const { colors, isDark } = useTheme();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const {
    meals, workouts, weightKg, waterLiters, sleepHours, sleepTime, wakeTime, steps, moodScore,
    totalCalories, totalProtein, totalCarbs, totalFat, focusMessage,
    goalProgress, activeGoal,
    loading, fetchToday, addWater, deleteMeal, deleteWorkout,
  } = useDashboardStore();
  const { streak, checkForMilestones } = useStreak();
  const [isOffline, setIsOffline] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [showWeightInput, setShowWeightInput] = useState(false);
  const [weightInput, setWeightInput] = useState('');

  useEffect(() => {
    if (!user?.id || hasFetched) return;
    setHasFetched(true);
    fetchToday(user.id).catch(() => {});
    checkForMilestones();
  }, [user?.id]);

  const refresh = useCallback(() => {
    if (user?.id) { fetchToday(user.id).catch(() => {}); checkForMilestones(); }
  }, [user?.id]);

  useEffect(() => {
    const unsub1 = NetInfo.addEventListener(s => setIsOffline(!s.isConnected));
    const unsub2 = setupAutoSync();
    return () => { unsub1(); unsub2(); };
  }, []);

  const dayBoundaryHour = profile?.day_boundary_hour as number ?? 4;
  const today = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const waterTarget = (profile?.water_target_liters ?? 2.5) as number;
  const ifActive = !!profile?.if_active;
  const ifEatingStart = profile?.if_eating_start as string | null;
  const ifEatingEnd = profile?.if_eating_end as string | null;
  const calorieTargetMin = (profile?.calorie_range_rest_min as number) ?? 0;
  const calorieTargetMax = (profile?.calorie_range_rest_max as number) ?? 0;
  const proteinTarget = profile?.protein_per_kg && profile?.weight_kg
    ? Math.round(Number(profile.protein_per_kg) * Number(profile.weight_kg)) : 120;

  const getMealPrefill = () => {
    const h = new Date().getHours();
    if (h >= 6 && h < 10) return 'Kahvaltıda yediklerim: ';
    if (h >= 10 && h < 14) return 'Öğle yemeğim: ';
    if (h >= 14 && h < 18) return 'Ara öğünüm: ';
    if (h >= 18 && h < 22) return 'Akşam yemeğim: ';
    return 'Yediklerim: ';
  };

  const handleAddWater = () => {
    if (!user?.id) return;
    const newTotal = waterLiters + WATER_INCREMENT;
    const warning = checkSuspiciousInput('water', newTotal);
    if (warning) {
      Alert.alert('Doğrulama', warning, [
        { text: 'İptal', style: 'cancel' },
        { text: 'Evet', onPress: () => addWater(user.id, WATER_INCREMENT, dayBoundaryHour) },
      ]);
    } else {
      addWater(user.id, WATER_INCREMENT, dayBoundaryHour);
    }
  };

  const handleWeightSave = async () => {
    const w = parseFloat(weightInput.replace(',', '.'));
    if (!w || w < 20 || w > 300 || !user?.id) return;
    const date = getEffectiveDate(new Date(), dayBoundaryHour);
    await supabase.from('daily_metrics').upsert(
      { user_id: user.id, date, weight_kg: w, synced: true },
      { onConflict: 'user_id,date' }
    );
    await supabase.from('weight_logs').insert({ user_id: user.id, weight_kg: w, logged_at: new Date().toISOString() });
    setShowWeightInput(false);
    setWeightInput('');
    refresh();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="light" />

      {/* Weight Input Modal */}
      <Modal visible={showWeightInput} transparent animationType="fade" onRequestClose={() => setShowWeightInput(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}
          activeOpacity={1} onPress={() => setShowWeightInput(false)}
        >
          <View style={{
            backgroundColor: colors.card, borderRadius: RADIUS.xxl, padding: SPACING.lg,
            width: '80%', alignItems: 'center',
            ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
          }}>
            <View style={{
              width: 56, height: 56, borderRadius: 18,
              backgroundColor: GRADIENTS.weight[0] + '20',
              alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md,
            }}>
              <Ionicons name="scale" size={28} color={GRADIENTS.weight[0]} />
            </View>
            <Text style={{ fontSize: FONT.lg, fontWeight: '700', color: colors.text, marginBottom: SPACING.md }}>Tartı Kaydı</Text>
            <TextInput
              style={{
                backgroundColor: colors.inputBg, borderRadius: RADIUS.md,
                paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 2,
                color: colors.text, fontSize: FONT.xxl, fontWeight: '800',
                textAlign: 'center', width: '100%', borderWidth: 1, borderColor: colors.border,
              }}
              placeholder="73.5"
              placeholderTextColor={colors.textMuted}
              value={weightInput}
              onChangeText={setWeightInput}
              keyboardType="decimal-pad"
              autoFocus
            />
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: SPACING.xs }}>kg</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md, width: '100%' }}>
              <TouchableOpacity
                onPress={() => setShowWeightInput(false)}
                style={{ flex: 1, paddingVertical: SPACING.sm + 2, borderRadius: RADIUS.md, backgroundColor: colors.surfaceLight, alignItems: 'center' }}
              >
                <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleWeightSave}
                style={{ flex: 1, paddingVertical: SPACING.sm + 2, borderRadius: RADIUS.md, backgroundColor: GRADIENTS.weight[0], alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: FONT.sm, fontWeight: '700' }}>Kaydet</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#fff" />}
      >
        {/* ======= HERO SECTION (full-width gradient) ======= */}
        <HeroSection
          today={today}
          streak={streak}
          isOffline={isOffline}
          focusMessage={focusMessage}
          consumed={totalCalories}
          targetMin={calorieTargetMin}
          targetMax={calorieTargetMax}
          protein={totalProtein}
          proteinTarget={proteinTarget}
          carbs={totalCarbs}
          fat={totalFat}
          ifActive={ifActive}
          ifEatingStart={ifEatingStart}
          ifEatingEnd={ifEatingEnd}
        />

        {/* ======= STAT STRIP (overlapping hero bottom) ======= */}
        <View style={{ marginTop: -16, zIndex: 10, elevation: 10 }}>
          <StatStrip
            waterLiters={waterLiters}
            waterTarget={waterTarget}
            steps={steps}
            sleepHours={sleepHours}
            weightKg={weightKg}
            onAddWater={handleAddWater}
          />
        </View>

        {/* ======= CONTENT AREA (padded) ======= */}
        <View style={{ paddingHorizontal: SPACING.md, marginTop: SPACING.md }}>

          {/* Smart Actions - Context-aware suggestions */}
          <View style={{ marginBottom: SPACING.md }}>
            <SmartActions
              userState={{
                mealsLogged: meals.length,
                waterLiters,
                waterTarget,
                weightLogged: !!weightKg,
                moodLogged: !!moodScore,
                sleepLogged: !!sleepHours,
                stepsLogged: !!steps,
                hasActiveGoal: !!activeGoal,
                hasPlan: !!focusMessage, // focusMessage exists when plan is generated
                workoutsLogged: workouts.length,
              }}
              onMealLog={() => router.push({ pathname: '/(tabs)/chat', params: { prefill: getMealPrefill() } })}
              onWorkoutLog={() => router.push({ pathname: '/(tabs)/chat', params: { prefill: 'Antrenman yaptım: ' } })}
              onWeightLog={() => setShowWeightInput(true)}
              onWaterAdd={handleAddWater}
              onSleepLog={() => {/* sleep input is below, user can scroll */}}
              onMoodLog={() => {/* mood input is below, user can scroll */}}
              onChat={() => router.push('/(tabs)/chat')}
              onViewPlan={() => router.push('/(tabs)/plan')}
              onViewWorkout={() => router.push('/(tabs)/plan')}
              onBarcodeScan={() => router.push({ pathname: '/(tabs)/chat', params: { prefill: '[BARKOD]' } })}
              onSimulation={() => router.push({ pathname: '/(tabs)/chat', params: { prefill: 'Şunu yesem ne olur: ' } })}
              onQuickLog={() => router.push('/log')}
            />
          </View>

          {/* Goal Progress (slim) */}
          {goalProgress && activeGoal && (
            <View style={{ marginBottom: SPACING.md }}>
              <GoalProgressWidget
                slim
                progress={goalProgress}
                goalType={activeGoal.goal_type}
                targetWeight={activeGoal.target_weight_kg}
                currentWeight={weightKg ?? (profile?.weight_kg as number | null)}
              />
            </View>
          )}

          {/* Mood + Sleep side by side */}
          <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
            <MoodTracker
              compact
              currentScore={moodScore}
              onSelect={async (score, stressNote) => {
                if (!user?.id) return;
                const date = getEffectiveDate(new Date(), dayBoundaryHour);
                await supabase.from('daily_metrics').upsert(
                  { user_id: user.id, date, mood_score: score, mood_note: stressNote ?? null, synced: true },
                  { onConflict: 'user_id,date' }
                );
                refresh();
              }}
            />
            <SleepInput
              compact
              currentHours={sleepHours}
              currentSleepTime={sleepTime}
              currentWakeTime={wakeTime}
              onSave={async (hours, quality, savedSleepTime, savedWakeTime) => {
                if (!user?.id) return;
                const date = getEffectiveDate(new Date(), dayBoundaryHour);
                await supabase.from('daily_metrics').upsert(
                  { user_id: user.id, date, sleep_hours: hours, sleep_quality: quality, sleep_time: savedSleepTime ?? null, wake_time: savedWakeTime ?? null, synced: true },
                  { onConflict: 'user_id,date' }
                );
                refresh();
              }}
            />
          </View>

          {/* Activity Timeline (meals + workouts) */}
          <View style={{ marginBottom: SPACING.md }}>
            <ActivityTimeline
              meals={meals}
              workouts={workouts}
              onDeleteMeal={deleteMeal}
              onDeleteWorkout={deleteWorkout}
            />
          </View>

          {/* Report Links */}
          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            {[
              { label: 'Günlük', icon: 'today-outline', href: '/reports/daily', gradient: GRADIENTS.primary },
              { label: 'Haftalık', icon: 'calendar-outline', href: '/reports/weekly', gradient: GRADIENTS.water },
              { label: 'Aylık', icon: 'stats-chart-outline', href: '/reports/monthly', gradient: GRADIENTS.steps },
            ].map((r, i) => (
              <TouchableOpacity
                key={i}
                style={{
                  flex: 1,
                  backgroundColor: colors.card, borderRadius: RADIUS.xl,
                  padding: SPACING.sm + 2, alignItems: 'center', gap: SPACING.xs,
                  ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW),
                }}
                onPress={() => router.push(r.href as never)}
                activeOpacity={0.7}
              >
                <View style={{
                  width: 32, height: 32, borderRadius: 8,
                  backgroundColor: r.gradient[0] + '18',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Ionicons name={r.icon as any} size={16} color={r.gradient[0]} />
                </View>
                <Text style={{ fontSize: FONT.xs, color: colors.textSecondary, fontWeight: '600' }}>{r.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

        </View>
      </ScrollView>
    </View>
  );
}


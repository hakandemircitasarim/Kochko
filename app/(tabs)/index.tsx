import { useEffect, useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { useStreak } from '@/hooks/useStreak';
import { WaterTracker } from '@/components/tracking/WaterTracker';
import { CalorieProgress } from '@/components/tracking/CalorieProgress';
import { MoodTracker } from '@/components/tracking/MoodTracker';
import { SleepInput } from '@/components/tracking/SleepInput';
import { IFTimerWidget } from '@/components/tracking/IFTimerWidget';
import { GoalProgressWidget } from '@/components/tracking/GoalProgress';
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { checkSuspiciousInput } from '@/lib/guardrails-client';
import { Alert } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS, WATER_INCREMENT } from '@/lib/constants';
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
    totalCalories, totalProtein, totalCarbs, totalFat, focusMessage, weeklyBudgetRemaining,
    goalProgress, activeGoal,
    loading, fetchToday, addWater, deleteMeal, deleteWorkout,
  } = useDashboardStore();
  const { streak, checkForMilestones } = useStreak();
  const [isOffline, setIsOffline] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

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
  const waterTarget = profile?.water_target_liters ?? 2.5;
  const ifActive = !!profile?.if_active;
  const ifEatingStart = profile?.if_eating_start as string | null;
  const ifEatingEnd = profile?.if_eating_end as string | null;
  const calorieTarget = (profile?.calorie_range_rest_max as number) ?? 0;
  const proteinTarget = profile?.protein_per_kg && profile?.weight_kg
    ? Math.round(Number(profile.protein_per_kg) * Number(profile.weight_kg)) : 120;

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.scrollContent}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={COLORS.primary} />}
    >
      {/* Offline Banner */}
      {isOffline && (
        <View style={s.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color="#fff" />
          <Text style={s.offlineText}>Cevrimdisi - kayitlarin senkronize edilecek</Text>
        </View>
      )}

      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>Bugun</Text>
          <Text style={s.headerDate}>{today}</Text>
        </View>
        {streak > 0 && (
          <View style={s.streakPill}>
            <Ionicons name="flame" size={16} color={COLORS.secondary} />
            <Text style={s.streakText}>{streak}</Text>
          </View>
        )}
      </View>

      {/* Focus Message */}
      {focusMessage && (
        <View style={s.focusCard}>
          <Ionicons name="bulb-outline" size={18} color={COLORS.primary} />
          <Text style={s.focusText}>{focusMessage}</Text>
        </View>
      )}

      {/* IF Timer */}
      {ifActive && ifEatingStart && ifEatingEnd && (
        <View style={{ marginBottom: SPACING.md }}>
          <IFTimerWidget eatingStart={ifEatingStart} eatingEnd={ifEatingEnd} />
        </View>
      )}

      {/* Main Stats Grid */}
      <View style={s.statsGrid}>
        <View style={[s.statCard, s.statCardLarge]}>
          <View style={s.statIconWrap}>
            <Ionicons name="flame" size={20} color={COLORS.secondary} />
          </View>
          <Text style={s.statValue}>{totalCalories}</Text>
          <Text style={s.statLabel}>kcal</Text>
          {calorieTarget > 0 && (
            <View style={s.statProgress}>
              <View style={[s.statProgressFill, { width: `${Math.min(100, (totalCalories / calorieTarget) * 100)}%`, backgroundColor: COLORS.secondary }]} />
            </View>
          )}
        </View>
        <View style={[s.statCard, s.statCardLarge]}>
          <View style={[s.statIconWrap, { backgroundColor: COLORS.primary + '15' }]}>
            <Ionicons name="barbell" size={20} color={COLORS.primary} />
          </View>
          <Text style={s.statValue}>{totalProtein}g</Text>
          <Text style={s.statLabel}>protein</Text>
          <View style={s.statProgress}>
            <View style={[s.statProgressFill, { width: `${Math.min(100, (totalProtein / proteinTarget) * 100)}%`, backgroundColor: COLORS.primary }]} />
          </View>
        </View>
      </View>

      <View style={s.statsGrid}>
        <View style={s.statCard}>
          <Ionicons name="scale-outline" size={18} color={COLORS.textSecondary} />
          <Text style={s.statValueSm}>{weightKg ? `${weightKg}` : '-'}</Text>
          <Text style={s.statLabel}>kg</Text>
        </View>
        <View style={s.statCard}>
          <Ionicons name="moon-outline" size={18} color="#A855F7" />
          <Text style={s.statValueSm}>{sleepHours ? `${sleepHours}` : '-'}</Text>
          <Text style={s.statLabel}>saat uyku</Text>
        </View>
        <View style={s.statCard}>
          <Ionicons name="happy-outline" size={18} color={COLORS.secondary} />
          <Text style={s.statValueSm}>{moodScore ? `${moodScore}/5` : '-'}</Text>
          <Text style={s.statLabel}>ruh hali</Text>
        </View>
        <View style={s.statCard}>
          <Ionicons name="footsteps-outline" size={18} color={COLORS.primary} />
          <Text style={s.statValueSm}>{steps ? `${Math.round(steps / 1000)}k` : '-'}</Text>
          <Text style={s.statLabel}>adim</Text>
        </View>
      </View>

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
        <WaterTracker current={waterLiters} target={waterTarget as number} onAdd={() => {
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

      {/* Quick Chat Input */}
      <TouchableOpacity style={s.quickInput} onPress={() => router.push('/(tabs)/chat')} activeOpacity={0.7}>
        <Ionicons name="chatbubble-outline" size={18} color={COLORS.textMuted} />
        <Text style={s.quickInputText}>Kocuna yaz... ne yedin, ne yaptin?</Text>
      </TouchableOpacity>

      {/* Quick Actions */}
      <View style={s.quickActions}>
        {[
          { icon: 'restaurant-outline', label: 'Ogun', color: COLORS.secondary },
          { icon: 'barbell-outline', label: 'Spor', color: COLORS.primary },
          { icon: 'scale-outline', label: 'Tarti', color: COLORS.accent },
          { icon: 'camera-outline', label: 'Foto', color: COLORS.success },
        ].map((item, i) => (
          <TouchableOpacity key={i} style={s.quickAction} onPress={() => router.push('/(tabs)/chat')} activeOpacity={0.7}>
            <View style={[s.quickActionIcon, { backgroundColor: item.color + '15' }]}>
              <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={22} color={item.color} />
            </View>
            <Text style={s.quickActionLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Mood */}
      <View style={{ marginBottom: SPACING.md }}>
        <MoodTracker
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
      </View>

      {/* Sleep */}
      <View style={{ marginBottom: SPACING.md }}>
        <SleepInput
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

      {/* Meals */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Ogunler</Text>
          <Text style={s.sectionBadge}>{meals.length}</Text>
        </View>
        {meals.length === 0 ? (
          <View style={s.emptyState}>
            <Ionicons name="restaurant-outline" size={32} color={COLORS.textMuted} />
            <Text style={s.emptyText}>Kocuna ne yedigini yaz</Text>
          </View>
        ) : (
          meals.map((meal, idx) => (
            <TouchableOpacity key={meal.id} onLongPress={() => deleteMeal(meal.id)} activeOpacity={0.7}
              style={[s.mealRow, idx < meals.length - 1 && s.mealRowBorder]}>
              <View style={s.mealDot}>
                <View style={[s.dot, { backgroundColor: COLORS.secondary }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.mealType}>{MEAL_LABELS[meal.meal_type] ?? meal.meal_type}</Text>
                <Text style={s.mealInput} numberOfLines={1}>{meal.raw_input}</Text>
              </View>
              <View style={s.mealStats}>
                <Text style={s.mealCal}>{meal.calories}</Text>
                <Text style={s.mealCalUnit}>kcal</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* Workouts */}
      {workouts.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Antrenmanlar</Text>
            <Text style={s.sectionBadge}>{workouts.length}</Text>
          </View>
          {workouts.map((w, idx) => (
            <TouchableOpacity key={w.id} onLongPress={() => deleteWorkout(w.id)} activeOpacity={0.7}
              style={[s.mealRow, idx < workouts.length - 1 && s.mealRowBorder]}>
              <View style={s.mealDot}>
                <View style={[s.dot, { backgroundColor: COLORS.primary }]} />
              </View>
              <Text style={[s.mealInput, { flex: 1 }]}>{w.raw_input}</Text>
              {w.duration_min > 0 && <Text style={s.workoutDur}>{w.duration_min} dk</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Report Links */}
      <View style={s.reportRow}>
        {[
          { label: 'Gunluk', icon: 'today-outline', href: '/reports/daily' },
          { label: 'Haftalik', icon: 'calendar-outline', href: '/reports/weekly' },
          { label: 'Aylik', icon: 'stats-chart-outline', href: '/reports/monthly' },
        ].map((r, i) => (
          <TouchableOpacity key={i} style={s.reportCard} onPress={() => router.push(r.href as never)} activeOpacity={0.7}>
            <Ionicons name={r.icon as keyof typeof Ionicons.glyphMap} size={20} color={COLORS.primary} />
            <Text style={s.reportLabel}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: SPACING.md, paddingBottom: 100 },

  offlineBanner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.warning, borderRadius: RADIUS.md, padding: SPACING.sm + 2, marginBottom: SPACING.md },
  offlineText: { color: '#fff', fontSize: FONT.sm, fontWeight: '600' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg },
  headerTitle: { fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, letterSpacing: -0.5 },
  headerDate: { fontSize: FONT.sm, color: COLORS.textMuted, marginTop: 2 },
  streakPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.secondary + '18', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.full },
  streakText: { fontSize: FONT.md, fontWeight: '800', color: COLORS.secondary },

  focusCard: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, backgroundColor: COLORS.primary + '10', borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md },
  focusText: { flex: 1, color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 },

  statsGrid: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm },
  statCard: { flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, alignItems: 'center', gap: 4 },
  statCardLarge: { paddingVertical: SPACING.lg },
  statIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.secondary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: FONT.xl, fontWeight: '800', color: COLORS.text, letterSpacing: -0.5 },
  statValueSm: { fontSize: FONT.lg, fontWeight: '700', color: COLORS.text },
  statLabel: { fontSize: FONT.xs, color: COLORS.textMuted, fontWeight: '500' },
  statProgress: { width: '100%', height: 3, backgroundColor: COLORS.surfaceLight, borderRadius: 2, marginTop: SPACING.sm },
  statProgressFill: { height: '100%', borderRadius: 2 },

  quickInput: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.md, marginTop: SPACING.sm },
  quickInputText: { color: COLORS.textMuted, fontSize: FONT.md },

  quickActions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.lg, paddingHorizontal: SPACING.sm },
  quickAction: { alignItems: 'center', gap: SPACING.sm },
  quickActionIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  quickActionLabel: { fontSize: FONT.xs, color: COLORS.textSecondary, fontWeight: '600' },

  section: { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, marginBottom: SPACING.md, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SPACING.md, paddingBottom: SPACING.sm },
  sectionTitle: { fontSize: FONT.md, fontWeight: '700', color: COLORS.text },
  sectionBadge: { backgroundColor: COLORS.primary + '18', color: COLORS.primary, fontSize: FONT.xs, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full, overflow: 'hidden' },

  emptyState: { alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.sm },
  emptyText: { color: COLORS.textMuted, fontSize: FONT.sm },

  mealRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 2 },
  mealRowBorder: { borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  mealDot: { width: 24, marginRight: SPACING.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  mealType: { fontSize: FONT.xs, color: COLORS.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  mealInput: { fontSize: FONT.md, color: COLORS.text, marginTop: 1 },
  mealStats: { alignItems: 'flex-end' },
  mealCal: { fontSize: FONT.md, fontWeight: '700', color: COLORS.text },
  mealCalUnit: { fontSize: FONT.xs, color: COLORS.textMuted },
  workoutDur: { fontSize: FONT.sm, color: COLORS.textSecondary, fontWeight: '600' },

  reportRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  reportCard: { flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', gap: SPACING.xs },
  reportLabel: { fontSize: FONT.xs, color: COLORS.textSecondary, fontWeight: '600' },
});

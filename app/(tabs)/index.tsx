/**
 * Ana Sayfa (Dashboard) — Bilgi odakli, flat dark design
 * Kalori halkasi, hizli istatistikler, haftalik butce, diyet/spor planlari
 */
import { useEffect, useCallback, useState, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Alert, TextInput, Modal } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { useStreak } from '@/hooks/useStreak';
import { HeroSection } from '@/components/dashboard/HeroSection';
import { StatStrip } from '@/components/dashboard/StatStrip';
import { ActivityTimeline } from '@/components/dashboard/ActivityTimeline';
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { checkSuspiciousInput } from '@/lib/guardrails-client';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, FONT, RADIUS, WATER_INCREMENT } from '@/lib/constants';
import NetInfo from '@react-native-community/netinfo';
import { setupAutoSync } from '@/services/offline-queue.service';
import { getUnreadCoachingMessages, markMessageRead, type CoachingMessage } from '@/services/coaching-messages.service';
import { detectReturnLevel, type ReturnStatus } from '@/services/return-flow.service';
import { syncStepsToDailyMetrics } from '@/services/health-connect.service';
import { CoachingNudge } from '@/components/dashboard/CoachingNudge';

interface PlanData {
  plan_type: string;
  focus_message: string;
  meal_suggestions: { meal_type: string; options: { name: string; calories: number }[] }[];
  workout_plan: { type: string; duration_min: number; main: string[] } | null;
  weekly_budget_remaining: number | null;
  status: string;
}

const MEAL_COLORS: Record<string, string> = {
  breakfast: '#1D9E75', lunch: '#EF9F27', dinner: '#D85A30', snack: '#7F77DD',
};
const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Kahvaltı', lunch: 'Öğle', dinner: 'Akşam', snack: 'Ara öğün',
};

export default function TodayScreen() {
  const { colors } = useTheme();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const {
    meals, workouts, weightKg, waterLiters, sleepHours, steps,
    totalCalories, totalProtein, totalCarbs, totalFat, focusMessage,
    weeklyBudgetRemaining,
    loading, fetchToday, addWater, deleteMeal, deleteWorkout,
  } = useDashboardStore();
  const { streak, checkForMilestones } = useStreak();
  const [isOffline, setIsOffline] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [showWeightInput, setShowWeightInput] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [activeTab, setActiveTab] = useState<'diet' | 'workout'>('diet');
  const [coachingMessages, setCoachingMessages] = useState<CoachingMessage[]>([]);
  const [returnStatus, setReturnStatus] = useState<ReturnStatus | null>(null);

  const dayBoundaryHour = profile?.day_boundary_hour as number ?? 4;
  const waterTarget = (profile?.water_target_liters ?? 2.5) as number;
  const ifActive = !!profile?.if_active;
  const ifEatingStart = profile?.if_eating_start as string | null;
  const ifEatingEnd = profile?.if_eating_end as string | null;
  const calorieTargetMin = (profile?.calorie_range_rest_min as number) ?? 0;
  const calorieTargetMax = (profile?.calorie_range_rest_max as number) ?? 0;
  const proteinTarget = profile?.protein_per_kg && profile?.weight_kg
    ? Math.round(Number(profile.protein_per_kg) * Number(profile.weight_kg)) : 120;
  const carbsTarget = (profile?.carbs_target_g as number) ?? 200;
  const fatTarget = (profile?.fat_target_g as number) ?? 65;
  const userName = profile?.display_name as string | undefined;

  useEffect(() => {
    if (!user?.id || hasFetched) return;
    let cancelled = false;
    setHasFetched(true);
    fetchToday(user.id).catch((err) => console.warn('fetchToday failed:', err));
    checkForMilestones();
    // Fetch today's plan
    const today = getEffectiveDate(new Date(), dayBoundaryHour);
    supabase.from('daily_plans').select('*')
      .eq('user_id', user.id).eq('date', today)
      .order('version', { ascending: false }).limit(1).single()
      .then(({ data }) => { if (!cancelled && data) setPlan(data as unknown as PlanData); });
    // Fetch coaching nudges
    getUnreadCoachingMessages(user.id).then((msgs) => { if (!cancelled) setCoachingMessages(msgs); });
    // Return-flow: detect long break → show re-onboarding banner if 180+ days (Spec 10.6)
    detectReturnLevel(user.id).then((status) => { if (!cancelled) setReturnStatus(status); }).catch(() => {});
    // Step counter sync (Spec 19.0 free-tier feature; expo-sensors if installed)
    syncStepsToDailyMetrics(user.id, dayBoundaryHour).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);

  const refresh = useCallback(() => {
    if (!user?.id) return;
    fetchToday(user.id).catch((err) => console.warn('refresh fetchToday failed:', err));
    checkForMilestones();
    const today = getEffectiveDate(new Date(), dayBoundaryHour);
    supabase.from('daily_plans').select('*')
      .eq('user_id', user.id).eq('date', today)
      .order('version', { ascending: false }).limit(1).single()
      .then(({ data }) => { if (data) setPlan(data as unknown as PlanData); });
    getUnreadCoachingMessages(user.id).then(setCoachingMessages);
  }, [user?.id, dayBoundaryHour]);

  // Refresh dashboard when tab gets focus (e.g., returning from chat after logging a meal)
  const hasMounted = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!hasMounted.current) { hasMounted.current = true; return; }
    if (user?.id) refresh();
  }, [user?.id, refresh]));

  useEffect(() => {
    const unsub1 = NetInfo.addEventListener(s => setIsOffline(!s.isConnected));
    const unsub2 = setupAutoSync();
    return () => { unsub1(); unsub2(); };
  }, []);

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

  // Weekly budget calculation — guard against NaN / null / undefined
  const weeklyBudgetTotal = calorieTargetMax > 0 ? calorieTargetMax * 7 : 0;
  const rawConsumed = weeklyBudgetTotal - (weeklyBudgetRemaining ?? 0);
  const weeklyConsumed = Math.max(0, isNaN(rawConsumed) ? 0 : rawConsumed);
  const rawRemaining = weeklyBudgetRemaining ?? 0;
  const weeklyRemaining = isNaN(rawRemaining) ? 0 : rawRemaining;
  const weeklyPct = weeklyBudgetTotal > 0 ? Math.min(1, weeklyConsumed / weeklyBudgetTotal) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="light" />

      {/* Weight Modal */}
      <Modal visible={showWeightInput} transparent animationType="fade" onRequestClose={() => setShowWeightInput(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}
          activeOpacity={1} onPress={() => setShowWeightInput(false)}
        >
          <View style={{
            backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.xxl,
            width: '80%', alignItems: 'center', borderWidth: 0.5, borderColor: colors.border,
          }}>
            <View style={{
              width: 48, height: 48, borderRadius: RADIUS.sm,
              backgroundColor: METRIC_COLORS.weight + '18',
              alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md,
            }}>
              <Ionicons name="scale" size={24} color={METRIC_COLORS.weight} />
            </View>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: SPACING.md }}>Tartı Kaydı</Text>
            <TextInput
              style={{
                backgroundColor: colors.inputBg, borderRadius: RADIUS.md,
                paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md,
                color: colors.text, fontSize: 24, fontWeight: '700',
                textAlign: 'center', width: '100%', borderWidth: 0.5, borderColor: colors.border,
              }}
              placeholder="73.5"
              placeholderTextColor={colors.textMuted}
              value={weightInput}
              onChangeText={setWeightInput}
              keyboardType="decimal-pad"
              autoFocus
            />
            <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: SPACING.xs }}>kg</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md, width: '100%' }}>
              <TouchableOpacity
                onPress={() => setShowWeightInput(false)}
                style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight, alignItems: 'center' }}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '500' }}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleWeightSave}
                style={{ flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500' }}>Kaydet</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />}
      >
        {/* Welcome back / re-onboarding banner (Spec 10.6) */}
        {returnStatus && returnStatus.level !== 'active' && (
          <View style={{
            backgroundColor: colors.card, borderRadius: RADIUS.md,
            padding: SPACING.md, marginBottom: SPACING.md,
            borderLeftWidth: 3, borderLeftColor: colors.primary,
          }}>
            <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '600', marginBottom: 4 }}>
              {returnStatus.level === 'very_long_break' ? 'TEKRAR HOS GELDIN' : 'HOS GELDIN'}
            </Text>
            <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18 }}>
              {returnStatus.welcomeMessage}
            </Text>
            {returnStatus.needsReOnboarding && (
              <TouchableOpacity
                onPress={() => router.push('/onboarding?mode=re_onboarding')}
                style={{
                  marginTop: SPACING.sm, paddingVertical: SPACING.sm,
                  borderRadius: RADIUS.sm, backgroundColor: colors.primary, alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500' }}>Guncelleme yap</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setReturnStatus(null)} style={{ position: 'absolute', top: 8, right: 8, padding: 4 }}>
              <Ionicons name="close" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* 1. Hero: Greeting + Calorie Ring + Macros */}
        <HeroSection
          today={new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}
          streak={streak}
          isOffline={isOffline}
          focusMessage={focusMessage}
          consumed={totalCalories}
          targetMin={calorieTargetMin}
          targetMax={calorieTargetMax}
          protein={totalProtein}
          proteinTarget={proteinTarget}
          carbs={totalCarbs}
          carbsTarget={carbsTarget}
          fat={totalFat}
          fatTarget={fatTarget}
          ifActive={ifActive}
          ifEatingStart={ifEatingStart}
          ifEatingEnd={ifEatingEnd}
          userName={userName}
        />

        {/* 1.5 Coaching Nudges */}
        {coachingMessages.length > 0 && (
          <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.md }}>
            <CoachingNudge
              messages={coachingMessages}
              onDismiss={(id) => {
                markMessageRead(id);
                setCoachingMessages(prev => prev.filter(m => m.id !== id));
              }}
              onTap={(msg) => {
                markMessageRead(msg.id);
                setCoachingMessages(prev => prev.filter(m => m.id !== msg.id));
                router.push({ pathname: '/(tabs)/chat', params: { prefill: msg.message } });
              }}
            />
          </View>
        )}

        {/* 2. Quick Stats: Su + Adim */}
        <View style={{ marginTop: SPACING.md }}>
          <StatStrip
            waterLiters={waterLiters}
            waterTarget={waterTarget}
            steps={steps}
            sleepHours={sleepHours}
            weightKg={weightKg}
            onAddWater={handleAddWater}
          />
        </View>

        {/* 3. Weekly Budget Bar */}
        {weeklyBudgetTotal > 0 && (
          <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.md }}>
            <View style={{
              backgroundColor: colors.card, borderRadius: RADIUS.md,
              padding: SPACING.lg, borderWidth: 0.5, borderColor: colors.border,
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
                <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Haftalık bütçe
                </Text>
                <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>
                  {weeklyRemaining.toLocaleString('tr-TR')} kaldı
                </Text>
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: SPACING.sm }}>
                {weeklyConsumed.toLocaleString('tr-TR')} / {weeklyBudgetTotal.toLocaleString('tr-TR')} kcal
              </Text>
              <View style={{ height: 8, backgroundColor: colors.progressTrack, borderRadius: 4, overflow: 'hidden' }}>
                <View style={{
                  height: '100%', width: `${weeklyPct * 100}%`,
                  backgroundColor: colors.primary, borderRadius: 4,
                }} />
              </View>
            </View>
          </View>
        )}

        {/* 4. Diyet / Spor Plan Tablari */}
        <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.xxl }}>
          {/* Tab selector */}
          <View style={{
            flexDirection: 'row',
            backgroundColor: colors.cardElevated,
            borderRadius: RADIUS.sm,
            padding: 3,
            marginBottom: SPACING.md,
          }}>
            {(['diet', 'workout'] as const).map(tab => {
              const isActive = activeTab === tab;
              return (
                <TouchableOpacity
                  key={tab}
                  onPress={() => setActiveTab(tab)}
                  style={{
                    flex: 1,
                    paddingVertical: SPACING.sm,
                    borderRadius: RADIUS.sm - 2,
                    backgroundColor: isActive ? colors.text : 'transparent',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{
                    color: isActive ? colors.background : colors.textSecondary,
                    fontSize: 13, fontWeight: '500',
                  }}>
                    {tab === 'diet' ? 'Diyet Planı' : 'Spor Programı'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Diet Tab Content */}
          {activeTab === 'diet' && (
            <View style={{
              backgroundColor: colors.card, borderRadius: RADIUS.md,
              borderWidth: 0.5, borderColor: colors.border,
            }}>
              {plan?.meal_suggestions && plan.meal_suggestions.length > 0 ? (
                <>
                  {plan.meal_suggestions.map((meal, idx) => {
                    const mainOption = meal.options?.[0];
                    const dotColor = MEAL_COLORS[meal.meal_type] ?? colors.primary;
                    return (
                      <View key={`${meal.meal_type}-${idx}`} style={{
                        flexDirection: 'row', alignItems: 'center',
                        padding: SPACING.lg,
                        borderBottomWidth: idx < plan.meal_suggestions.length - 1 ? 0.5 : 0,
                        borderBottomColor: colors.border,
                      }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor, marginRight: SPACING.md }} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                            {MEAL_LABELS[meal.meal_type] ?? meal.meal_type}
                          </Text>
                          {mainOption && (
                            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2, paddingLeft: SPACING.xl }}>
                              {mainOption.name}
                            </Text>
                          )}
                        </View>
                        {mainOption && (
                          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{mainOption.calories} kcal</Text>
                        )}
                      </View>
                    );
                  })}
                  {/* Detail link */}
                  <TouchableOpacity
                    onPress={() => router.push('/diet-plan')}
                    style={{ padding: SPACING.lg, alignItems: 'center', borderTopWidth: 0.5, borderTopColor: colors.border }}
                  >
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '500' }}>Detaylı göster</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={{ padding: SPACING.xxl, alignItems: 'center' }}>
                  <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: SPACING.md }}>
                    Henüz plan oluşturulmamış
                  </Text>
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/(tabs)/chat', params: { prefill: 'Bugünkü diyet planımı oluştur' } })}
                    style={{
                      borderWidth: 0.5, borderColor: colors.primary, borderRadius: RADIUS.sm,
                      paddingVertical: SPACING.sm, paddingHorizontal: SPACING.xl,
                    }}
                  >
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '500' }}>Plan oluştur</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* Weekly Menu Link — always visible under diet tab */}
          {activeTab === 'diet' && (
            <TouchableOpacity
              onPress={() => router.push('/weekly-menu')}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: colors.card, borderRadius: RADIUS.md,
                padding: SPACING.lg, marginTop: SPACING.sm,
                borderWidth: 0.5, borderColor: colors.border,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '500' }}>Haftalık Menü & Alışveriş Listesi</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}

          {/* Workout Tab Content */}
          {activeTab === 'workout' && (
            <View style={{
              backgroundColor: colors.card, borderRadius: RADIUS.md,
              borderWidth: 0.5, borderColor: colors.border,
            }}>
              {plan?.workout_plan ? (
                <>
                  <TouchableOpacity
                    onPress={() => router.push('/workout-plan')}
                    style={{ flexDirection: 'row', alignItems: 'center', padding: SPACING.lg, gap: SPACING.md }}
                  >
                    <View style={{
                      width: 40, height: 40, borderRadius: RADIUS.sm,
                      backgroundColor: METRIC_COLORS.workout + '18',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Ionicons name="barbell" size={20} color={METRIC_COLORS.workout} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                        {plan.workout_plan.type}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                        {plan.workout_plan.duration_min} dk
                        {plan.workout_plan.main?.length > 0 ? ` \u00b7 ${plan.workout_plan.main.length} egzersiz` : ''}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => router.push('/workout-plan')}
                    style={{ padding: SPACING.lg, alignItems: 'center', borderTopWidth: 0.5, borderTopColor: colors.border }}
                  >
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '500' }}>Detaylı göster</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={{ padding: SPACING.xxl, alignItems: 'center' }}>
                  <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: SPACING.md }}>
                    {plan?.plan_type === 'rest' ? 'Bugün dinlenme günü' : 'Antrenman planlanmamış'}
                  </Text>
                  {plan?.plan_type !== 'rest' && (
                    <TouchableOpacity
                      onPress={() => router.push({ pathname: '/(tabs)/chat', params: { prefill: 'Bugünkü antrenman planımı oluştur' } })}
                      style={{
                        borderWidth: 0.5, borderColor: colors.primary, borderRadius: RADIUS.sm,
                        paddingVertical: SPACING.sm, paddingHorizontal: SPACING.xl,
                      }}
                    >
                      <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '500' }}>Plan oluştur</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          )}
        </View>

        {/* 5. Activity Timeline (meals + workouts logged today) */}
        <View style={{ paddingHorizontal: SPACING.xl, marginTop: SPACING.xxl }}>
          <ActivityTimeline
            meals={meals}
            workouts={workouts}
            onDeleteMeal={deleteMeal}
            onDeleteWorkout={deleteWorkout}
          />
        </View>

      </ScrollView>
    </View>
  );
}

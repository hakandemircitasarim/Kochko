/**
 * Plan tab — TRANSITIONAL BRIDGE (MASTER_PLAN Phase 2/3).
 * Surfaces two cards that route to the two dedicated plan screens
 * (/plan/diet and /plan/workout). Phase 4 removes this tab entirely;
 * the cards become first-class on the home screen.
 *
 * Previous implementation (daily_plans table, ai-plan edge function) is
 * superseded by the new weekly_plans draft→active flow. That data is
 * still in the DB and can be read from the active plan screen if needed.
 */
import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { getActive, type PlanRow, type DietPlanData, type WorkoutPlanData } from '@/services/plan.service';
import { isPlanReady } from '@/lib/plan-readiness';

export default function PlanTab() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const [dietActive, setDietActive] = useState<PlanRow | null>(null);
  const [workoutActive, setWorkoutActive] = useState<PlanRow | null>(null);
  const [goal, setGoal] = useState<{ goal_type?: string; target_weight_kg?: number } | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const [diet, workout, goalRes] = await Promise.all([
      getActive(user.id, 'diet'),
      getActive(user.id, 'workout'),
      supabase.from('goals').select('goal_type, target_weight_kg').eq('user_id', user.id).eq('is_active', true).limit(1),
    ]);
    setDietActive(diet);
    setWorkoutActive(workout);
    setGoal((goalRes.data as { goal_type?: string; target_weight_kg?: number }[] | null)?.[0] ?? null);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const dietReady = isPlanReady(profile, goal, 'diet');
  const workoutReady = isPlanReady(profile, goal, 'workout');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: SPACING.md,
        paddingTop: Math.max(insets.top, SPACING.md),
        paddingBottom: Math.max(insets.bottom, SPACING.xxl) + SPACING.lg,
      }}
    >
      <Text style={{ fontSize: FONT.hero, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
        Planlarım
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: FONT.sm, marginBottom: SPACING.lg }}>
        Diyet ve antrenman programlarını burada yönet.
      </Text>

      <PlanHubCard
        title="Diyet planı"
        subtitle={dietActive ? 'Aktif plan var — açmak için dokun' : dietReady.ready ? 'Henüz plan yok — oluşturmaya hazır' : 'Önce profili tamamla'}
        icon="restaurant-outline"
        color="#22C55E"
        plan={dietActive}
        missingCount={dietReady.missingCore.length}
        onPress={() => router.push('/plan/diet' as never)}
      />

      <View style={{ height: SPACING.md }} />

      <PlanHubCard
        title="Antrenman planı"
        subtitle={workoutActive ? 'Aktif plan var — açmak için dokun' : workoutReady.ready ? 'Henüz plan yok — oluşturmaya hazır' : 'Önce profili tamamla'}
        icon="barbell-outline"
        color="#6366F1"
        plan={workoutActive}
        missingCount={workoutReady.missingCore.length}
        onPress={() => router.push('/plan/workout' as never)}
      />
    </ScrollView>
  );
}

function PlanHubCard({
  title,
  subtitle,
  icon,
  color,
  plan,
  missingCount,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  plan: PlanRow | null;
  missingCount: number;
  onPress: () => void;
}) {
  const { colors, isDark } = useTheme();

  const summary = (() => {
    if (!plan) return null;
    if (plan.plan_type === 'diet') {
      const d = plan.plan_data as DietPlanData;
      const avg = Math.round(d.days.reduce((s, x) => s + x.total_kcal, 0) / Math.max(1, d.days.length));
      return `${avg} kcal/gün · P ${d.targets.protein}g`;
    }
    const w = plan.plan_data as WorkoutPlanData;
    const active = w.days.filter(x => !x.rest_day).length;
    const ex = w.days.reduce((s, x) => s + x.exercises.length, 0);
    return `${active} aktif gün · ${ex} egzersiz`;
  })();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.xl,
        padding: SPACING.md,
        borderWidth: 1,
        borderColor: colors.border,
        ...(isDark ? {} : { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 }),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            backgroundColor: color + '18',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={28} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: FONT.lg, fontWeight: '800' }}>
            {title}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 2 }}>
            {subtitle}
          </Text>
          {summary ? (
            <Text style={{ color: color, fontSize: FONT.xs, fontWeight: '700', marginTop: 4 }}>
              {summary}
            </Text>
          ) : null}
          {missingCount > 0 ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                marginTop: 6,
                alignSelf: 'flex-start',
                backgroundColor: '#F59E0B18',
                borderRadius: RADIUS.full,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Ionicons name="alert-circle-outline" size={11} color="#F59E0B" />
              <Text style={{ color: '#F59E0B', fontSize: 10, fontWeight: '700' }}>
                {missingCount} eksik bilgi
              </Text>
            </View>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

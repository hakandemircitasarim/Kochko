/**
 * Two large plan cards for the home hero (MASTER_PLAN §5 Phase 4).
 * "Bu haftaki diyetin" + "Bu haftaki sporun". Empty state if no active plan,
 * with subtle CTA copy. Tap → respective plan screen.
 *
 * Shows today's highlight when active (today's meals count / today's
 * workout name or rest day label) so the home surface is useful without
 * drilling in.
 */
import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { getActive, type PlanRow, type DietPlanData, type WorkoutPlanData } from '@/services/plan.service';

interface Props {
  userId: string | undefined;
}

function todayIndex(): number {
  // 0 = Monday in our convention
  const raw = new Date().getDay();
  return raw === 0 ? 6 : raw - 1;
}

export function PlanOverviewCards({ userId }: Props) {
  const [diet, setDiet] = useState<PlanRow | null>(null);
  const [workout, setWorkout] = useState<PlanRow | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const [d, w] = await Promise.all([
      getActive(userId, 'diet'),
      getActive(userId, 'workout'),
    ]);
    setDiet(d);
    setWorkout(w);
  }, [userId]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ gap: SPACING.sm }}>
      <PlanCard
        title="Bu haftaki diyetin"
        icon="restaurant-outline"
        color="#22C55E"
        plan={diet}
        planType="diet"
        onPress={() => router.push('/plan/diet' as never)}
      />
      <PlanCard
        title="Bu haftaki sporun"
        icon="barbell-outline"
        color="#6366F1"
        plan={workout}
        planType="workout"
        onPress={() => router.push('/plan/workout' as never)}
      />
    </View>
  );
}

function PlanCard({
  title,
  icon,
  color,
  plan,
  planType,
  onPress,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  plan: PlanRow | null;
  planType: 'diet' | 'workout';
  onPress: () => void;
}) {
  const { colors, isDark } = useTheme();
  const idx = todayIndex();

  const { primary, secondary, chip } = (() => {
    if (!plan) {
      return {
        primary: planType === 'diet' ? 'Diyet planın yok' : 'Antrenman planın yok',
        secondary: 'Oluşturmak için dokun',
        chip: null,
      };
    }
    if (planType === 'diet') {
      const d = plan.plan_data as DietPlanData;
      const today = d.days.find(x => x.day_index === idx);
      const mealCount = today?.meals.length ?? 0;
      const kcal = today?.total_kcal ?? 0;
      return {
        primary: `Bugün ${mealCount} öğün`,
        secondary: `${kcal} kcal · ${d.targets.protein}g protein`,
        chip: today?.meals[0]?.name ?? null,
      };
    }
    const w = plan.plan_data as WorkoutPlanData;
    const today = w.days.find(x => x.day_index === idx);
    if (!today) return { primary: 'Bugün kayıt yok', secondary: '', chip: null };
    if (today.rest_day) {
      return {
        primary: 'Bugün dinlenme günü',
        secondary: 'Hafif yürüyüş yeterli',
        chip: null,
      };
    }
    return {
      primary: today.focus ?? `${today.exercises.length} egzersiz`,
      secondary: `${today.estimated_duration_min ?? today.exercises.length * 3} dk`,
      chip: today.exercises[0]?.name ?? null,
    };
  })();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${primary}. ${secondary}`}
      accessibilityHint={plan ? 'Plan detayları için aç' : 'Yeni plan oluştur'}
      style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.xl,
        padding: SPACING.md,
        borderWidth: 1,
        borderColor: colors.border,
        ...(isDark
          ? {}
          : { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 }),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            backgroundColor: color + '18',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={26} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>
            {title.toUpperCase()}
          </Text>
          <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '800', marginTop: 2 }}>
            {primary}
          </Text>
          {secondary ? (
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: 1 }}>
              {secondary}
            </Text>
          ) : null}
          {chip ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                marginTop: 6,
                alignSelf: 'flex-start',
                backgroundColor: color + '12',
                borderRadius: RADIUS.full,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Text style={{ color, fontSize: 10, fontWeight: '700' }} numberOfLines={1}>
                {chip}
              </Text>
            </View>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

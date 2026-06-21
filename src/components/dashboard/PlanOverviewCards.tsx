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
  const { colors } = useTheme();
  const [diet, setDiet] = useState<PlanRow | null>(null);
  const [workout, setWorkout] = useState<PlanRow | null>(null);
  // FIX (audit UI-STA-02): track first-fetch completion so we don't flash the
  // 'planın yok' empty state before getActive() resolves on initial mount.
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const [d, w] = await Promise.all([
      getActive(userId, 'diet'),
      getActive(userId, 'workout'),
    ]);
    setDiet(d);
    setWorkout(w);
    setLoaded(true);
  }, [userId]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ gap: SPACING.sm }}>
      <PlanCard
        title="Bu haftaki diyetin"
        icon="restaurant-outline"
        color={colors.primary}
        plan={diet}
        planType="diet"
        loaded={loaded}
        onPress={() => router.push('/plan/diet' as never)}
      />
      <PlanCard
        title="Bu haftaki sporun"
        icon="barbell-outline"
        color={colors.purple}
        plan={workout}
        planType="workout"
        loaded={loaded}
        onPress={() => router.push('/plan/workout' as never)}
      />
      <TouchableOpacity
        onPress={() => router.push('/plan/history' as never)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Geçmiş planlar"
        accessibilityHint="Önceki diyet ve antrenman planlarını gör"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: SPACING.sm,
        }}
      >
        <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '600' }}>
          Geçmiş planlar
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function PlanCard({
  title,
  icon,
  color,
  plan,
  planType,
  loaded,
  onPress,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  plan: PlanRow | null;
  planType: 'diet' | 'workout';
  loaded: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const idx = todayIndex();

  const { primary, secondary, chip } = (() => {
    if (!plan) {
      // FIX (audit UI-STA-02): until the first fetch resolves we can't tell an
      // empty plan from a not-yet-loaded one, so show a neutral placeholder
      // instead of flashing the 'planın yok' empty state on initial mount.
      if (!loaded) {
        return { primary: 'Yükleniyor…', secondary: '', chip: null };
      }
      return {
        primary: planType === 'diet' ? 'Diyet planın yok' : 'Antrenman planın yok',
        secondary: 'Oluşturmak için dokun',
        chip: null,
      };
    }
    if (planType === 'diet') {
      // Defensive: plan_data is raw LLM-authored JSON (a structurally-incomplete but
      // valid snapshot can slip past the server gate). Guard days/targets/meals so a
      // malformed plan degrades to a soft empty state instead of crashing the dashboard.
      const d = plan.plan_data as DietPlanData;
      const today = (d?.days ?? []).find(x => x.day_index === idx);
      const mealCount = today?.meals?.length ?? 0;
      const kcal = today?.total_kcal ?? 0;
      return {
        primary: `Bugün ${mealCount} öğün`,
        secondary: `${kcal} kcal · ${d?.targets?.protein ?? 0}g protein`,
        chip: today?.meals?.[0]?.name ?? null,
      };
    }
    const w = plan.plan_data as WorkoutPlanData;
    const today = (w?.days ?? []).find(x => x.day_index === idx);
    if (!today) return { primary: 'Bugün kayıt yok', secondary: '', chip: null };
    if (today.rest_day) {
      return {
        primary: 'Bugün dinlenme günü',
        secondary: 'Hafif yürüyüş yeterli',
        chip: null,
      };
    }
    return {
      primary: today.focus ?? `${today.exercises?.length ?? 0} egzersiz`,
      secondary: `${today.estimated_duration_min ?? (today.exercises?.length ?? 0) * 3} dk`,
      chip: today.exercises?.[0]?.name ?? null,
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
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: RADIUS.lg,
            backgroundColor: color + '18',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={26} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '700', letterSpacing: 1 }}>
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
              <Text style={{ color, fontSize: FONT.xs, fontWeight: '700' }} numberOfLines={1}>
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

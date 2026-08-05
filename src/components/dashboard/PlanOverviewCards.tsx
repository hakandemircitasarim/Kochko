/**
 * Two large plan cards for the home hero (MASTER_PLAN §5 Phase 4).
 * "Bu haftaki diyetin" + "Bu haftaki sporun". Empty state if no active plan,
 * with subtle CTA copy. Tap → respective plan screen.
 *
 * Shows today's highlight when active (today's meals count / today's
 * workout name or rest day label) so the home surface is useful without
 * drilling in.
 */
import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE, MOTION } from '@/lib/design';
import { getActive, getDraft, isoDateMondayOfWeek, type PlanRow, type DietPlanData, type WorkoutPlanData } from '@/services/plan.service';
import { getEffectiveDate } from '@/lib/day-boundary';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { PressableCard } from '@/components/ui/PressableCard';

interface Props {
  userId: string | undefined;
  dayBoundaryHour?: number;
}

export function PlanOverviewCards({ userId, dayBoundaryHour = 4 }: Props) {
  const { colors } = useTheme();
  const [diet, setDiet] = useState<PlanRow | null>(null);
  const [workout, setWorkout] = useState<PlanRow | null>(null);
  // A generated-but-unapproved draft used to be invisible here: the card showed
  // 'planın yok' while a draft sat waiting on the plan screen. Track draft presence
  // so the empty state can say 'Taslak hazır · gözden geçir' instead.
  const [dietHasDraft, setDietHasDraft] = useState(false);
  const [workoutHasDraft, setWorkoutHasDraft] = useState(false);
  // FIX (audit UI-STA-02): track first-fetch completion so we don't flash the
  // 'planın yok' empty state before getActive() resolves on initial mount.
  const [loaded, setLoaded] = useState(false);
  // FIX (ux-pass5): ilk yükleme hata verirse loaded=false kalıyor ve kartlar sonsuza dek
  // 'Yükleniyor…' gösteriyordu (pull-to-refresh bu bileşeni yeniden yüklemez). Önceki veri
  // yokken hata durumunu işaretle — render kompakt hata kartı + tekrar dene gösterir.
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    // getActive THROWS on fetch error now (error ≠ empty, ux-pass2 W#7) — keep the
    // last-known cards instead of falsely claiming "planın yok" on a network blip.
    try {
      const [d, w, dDraft, wDraft] = await Promise.all([
        getActive(userId, 'diet'),
        getActive(userId, 'workout'),
        getDraft(userId, 'diet'),
        getDraft(userId, 'workout'),
      ]);
      setDiet(d);
      setWorkout(w);
      setDietHasDraft(!!dDraft);
      setWorkoutHasDraft(!!wDraft);
      setLoaded(true);
      setLoadError(false);
    } catch (err) {
      console.warn('PlanOverviewCards load failed:', err);
      // FIX (ux-pass5): yalnız işaretle — loaded=true (önceki veri var) ise render son
      // bilinen kartları korumaya devam eder, hata kartı yalnız ilk yükleme boşken çıkar.
      setLoadError(true);
    }
  }, [userId]);

  // FIX (ux-pass2 #11a): useEffect(load) + useFocusEffect(load) ilk açılışta çift fetch
  // yapıyordu — useFocusEffect ilk focus'ta da çalıştığından tek başına yeterli.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // FIX (ux-pass2 #11d): ham getDay() gece 00:00-04:00 arasında yarına atlarken günlük
  // hâlâ bugünü sayıyordu — plan kartı da veriyle aynı efektif-gün mantığını kullanır.
  const effNoon = new Date(`${getEffectiveDate(new Date(), dayBoundaryHour)}T12:00:00`);
  const rawDow = effNoon.getDay(); // 0 = Pazar
  const todayIdx = rawDow === 0 ? 6 : rawDow - 1; // 0 = Pazartesi (bizim konvansiyon)
  const currentWeekStart = isoDateMondayOfWeek(effNoon);

  return (
    <View style={{ gap: SPACING.sm }}>
      {!loaded && loadError ? (
        /* FIX (ux-pass5): ilk yükleme başarısız + elde veri yok — 'Yükleniyor…'da takılı
           kalmak yerine kompakt hata kartı + tekrar dene (shared LoadErrorState, compact). */
        <LoadErrorState
          compact
          title="Planlar yüklenemedi"
          subtitle="Tekrar denemek için dokun"
          onRetry={() => load()}
        />
      ) : (
        <>
      <PlanCard
        title="Bu haftaki diyetin"
        icon="restaurant-outline"
        color={colors.primary}
        plan={diet}
        planType="diet"
        hasDraft={dietHasDraft}
        loaded={loaded}
        todayIdx={todayIdx}
        currentWeekStart={currentWeekStart}
        onPress={() => router.push('/plan/diet' as never)}
      />
      <PlanCard
        title="Bu haftaki sporun"
        icon="barbell-outline"
        color={colors.purple}
        plan={workout}
        planType="workout"
        hasDraft={workoutHasDraft}
        loaded={loaded}
        todayIdx={todayIdx}
        currentWeekStart={currentWeekStart}
        onPress={() => router.push('/plan/workout' as never)}
      />
        </>
      )}
      <TouchableOpacity
        onPress={() => router.push('/plan/history' as never)}
        activeOpacity={MOTION.pressOpacity}
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
        <Text style={{ ...TYPE.bodyStrong, color: colors.textSecondary }}>
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
  hasDraft,
  loaded,
  todayIdx,
  currentWeekStart,
  onPress,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  plan: PlanRow | null;
  planType: 'diet' | 'workout';
  hasDraft: boolean;
  loaded: boolean;
  todayIdx: number;
  currentWeekStart: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const idx = todayIdx;

  const { primary, secondary, chip } = (() => {
    if (!plan) {
      // FIX (audit UI-STA-02): until the first fetch resolves we can't tell an
      // empty plan from a not-yet-loaded one, so show a neutral placeholder
      // instead of flashing the 'planın yok' empty state on initial mount.
      if (!loaded) {
        return { primary: 'Yükleniyor…', secondary: '', chip: null };
      }
      // A draft exists but nothing is active yet — don't claim 'planın yok'; point
      // the user at the review screen the tap already opens.
      if (hasDraft) {
        return {
          primary: 'Taslağın hazır',
          secondary: 'Gözden geçir ve onayla',
          chip: null,
        };
      }
      return {
        primary: planType === 'diet' ? 'Diyet planın yok' : 'Antrenman planın yok',
        secondary: 'Oluşturmak için dokun',
        chip: null,
      };
    }
    // FIX (ux-pass2 #11f): 4 haftalık plandan gururla "Bugün 3 öğün" yansıtmak yerine
    // geçen haftadan kalmış aktif planı açıkça bayat ilan et (plan ekranı CTA'sı ayrı ajanda).
    if (plan.week_start && plan.week_start < currentWeekStart) {
      return {
        primary: 'Planın geçen haftadan kaldı — yenile',
        secondary: 'Koçundan güncel bir plan iste',
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
      // FIX (ux-pass2 #11b): plan gününde kayıt yoksa 'Bugün 0 öğün — 0 kcal' saçmalığı
      // yerine dürüst boş durum.
      if (!today || mealCount === 0) {
        return { primary: 'Bugün kayıt yok', secondary: '', chip: null };
      }
      // FIX (ux-pass2 #11c): LLM kaynaklı ondalıklı kcal/protein değerleri yuvarlanır.
      const kcal = Math.round(Number(today.total_kcal ?? 0));
      const protein = Math.round(Number(d?.targets?.protein ?? 0));
      return {
        primary: `Bugün ${mealCount} öğün`,
        secondary: `${kcal} kcal · ${protein}g protein`,
        chip: today.meals?.[0]?.name ?? null,
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
    <PressableCard
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${primary}. ${secondary}`}
      accessibilityHint={plan ? 'Plan detayları için aç' : hasDraft ? 'Taslağı gözden geçir' : 'Yeni plan oluştur'}
      style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        // FIX (ux-pass5): kardeş dashboard kartları (StatStrip, HeroSection, CoachingNudge,
        // ui/Card) 0.5 hairline — 1'lik kenarlık aynı ekranda 2x kalın görünüyordu.
        borderWidth: 0.5,
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
          {/* Same eyebrow pattern as GoalProgressCard's "HEDEF", previously re-tuned by hand with a
              slightly different tracking (1 vs 0.5). Two hand-tuned copies of one idea is how a UI
              stops looking designed — TYPE.overline is the single definition. */}
          <Text style={{ ...TYPE.overline, color: colors.textMuted }}>
            {/* FIX (ux-pass2 #11e): .toUpperCase() Türkçe i→I bozuyordu ('BU HAFTAKI DIYETIN');
                tr-TR locale ile i→İ doğru büyür ('BU HAFTAKİ DİYETİN'). */}
            {title.toLocaleUpperCase('tr-TR')}
          </Text>
          {/* The card's headline ("Diyet planın yok" / the plan's name). At FONT.md it sat between
              two muted lines at almost the same size, so the row read as three equal greys. */}
          <Text style={{ ...TYPE.headline, color: colors.text, marginTop: 2 }}>
            {primary}
          </Text>
          {secondary ? (
            <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 2 }}>
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
              <Text style={{ ...TYPE.caption, color, fontWeight: '700' }} numberOfLines={1}>
                {chip}
              </Text>
            </View>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </PressableCard>
  );
}

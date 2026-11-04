/**
 * Day-by-day plan accordion — the single renderer for a 7-day plan body.
 * Extracted from FullPlanModal (fix-pass 07-12, item 2b) so the draft screens
 * can show the actual plan INLINE instead of hiding it behind the small
 * "Detayı görmek için dokun" preview card. Used by:
 *   - FullPlanModal (full-screen review)
 *   - app/plan/diet.tsx + workout.tsx draft view (inline review body)
 *
 * DUOLINGO DİLİ (2026-11-04): gün başlıkları GÖVDELİ tuşlar (`PlanDayHeader`, burada dışa
 * verilir; PlanActiveView de aynısını kullanır). Solda gün kısaltmalı yastık rozet, açık gün
 * marka tonunda (açık yüz + renkli çerçeve + koyu raf), "bugün" dolu marka tuşu. Taslak
 * incelemesinde açılmış günler tik alır ve üstte "kaç gün kaldı" ProgressBar'ı durur —
 * onay kapısı (onAllDaysViewed) artık görünmez bir koşul değil, dolan bir çubuk.
 */
import { useState, useEffect, useRef } from 'react';
import { View, Text, LayoutAnimation } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE, mix, alpha } from '@/lib/design';
import { getContrastColor } from '@/lib/accessibility';
import { ShelfPressable } from '@/components/ui/ShelfPressable';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { MealCard } from './MealCard';
import { ExerciseCard } from './ExerciseCard';
import { dayLabelTR, DAY_SHORT_TR, type DietPlanData, type WorkoutPlanData, type PlanData } from '@/services/plan.service';

/* ───────────── Gövdeli gün başlığı (paylaşılan) ───────────── */

export interface PlanDayHeaderProps {
  label: string;
  /** Rozetteki kısaltma ("Pzt"). */
  shortLabel: string;
  /** Sağdaki ikincil satır ("1610 kcal · 99g P", "Üst vücut · 3 egzersiz"). */
  summary: string;
  isOpen: boolean;
  isToday?: boolean;
  isRest?: boolean;
  /** Taslak incelemesinde bu gün en az bir kez açıldı → tik. */
  viewed?: boolean;
  /** Bugünün tamamlanma çubuğu (yalnız aktif planın bugünü). */
  progress?: { done: number; total: number } | null;
  onPress: () => void;
  accessibilityLabel: string;
}

export function PlanDayHeader({
  label, shortLabel, summary, isOpen, isToday, isRest, viewed, progress, onPress, accessibilityLabel,
}: PlanDayHeaderProps) {
  const { colors, isDark } = useTheme();
  const accent = colors.primary;
  const grey = isDark ? colors.border : colors.progressTrack;

  // Üç hâl, üç ağırlık: bugün = dolu marka tuşu (ekranın odağı), açık gün = Duolingo seçili
  // kutucuğu (açık yüz + marka çerçeve/raf), kapalı = gri gövdeli kart. Yüz HER ZAMAN opak.
  const face = isToday ? accent : isOpen ? mix(accent, colors.card, isDark ? 0.2 : 0.08) : colors.card;
  const edge = isToday || isOpen ? colors.primaryDark : grey;
  const border = isToday ? accent : isOpen ? accent : grey;
  const onFace = isToday ? getContrastColor(accent) : colors.text;
  const subFace = isToday ? alpha(onFace === 'white' ? '#FFFFFF' : '#000000', 0.8) : colors.textSecondary;

  // Rozet: bugün ters renk (yüz üstünde açık daire), açık gün dolu marka, kapalı soluk ton.
  const badgeBg = isToday
    ? (onFace === 'white' ? '#FFFFFF' : '#1A1A24')
    : isOpen ? accent
    : isRest ? (isDark ? colors.surfaceLight : colors.background)
    : mix(accent, colors.card, isDark ? 0.24 : 0.12);
  const badgeFg = isToday ? accent : isOpen ? getContrastColor(accent) : isRest ? colors.textMuted : accent;

  return (
    <ShelfPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ expanded: isOpen }}
      radius={RADIUS.md}
      shelfColor={edge}
      faceStyle={{
        backgroundColor: face,
        borderWidth: 2,
        borderColor: border,
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.sm + 2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        <View
          accessible={false}
          style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: badgeBg, alignItems: 'center', justifyContent: 'center',
          }}
        >
          {isRest && !isToday ? (
            <Ionicons name="moon" size={16} color={badgeFg} />
          ) : (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.caption, fontWeight: '800', color: badgeFg }}>
              {shortLabel}
            </Text>
          )}
        </View>
        {/* The day name ("Pazartesi") is the header of a whole collapsible section — it must
            outrank the meal rows it contains, not match them.
            08-04, cihazda: etiket flex:1 idi ve sagdaki ozet satiri (numberOfLines=1 olmasina
            ragmen) tam genisligini talep ettigi icin "Pazartesi" UC satira bolunuyordu
            ("Paz/arte/si"). Simdi ad + ozet ALT ALTA: ikisi ayni genisligi paylasmiyor, ad
            asla bolunmez, ozet kendi satirinda kirpilir. */}
        <View style={{ flex: 1 }}>
          {isToday ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.overline, color: subFace }}>BUGÜN</Text>
          ) : null}
          <Text style={{ ...TYPE.headline, fontWeight: '700', color: onFace }} numberOfLines={1}>
            {label}
          </Text>
          <Text style={{ ...TYPE.caption, color: subFace }} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        {viewed && !isOpen && !isToday ? (
          <Ionicons name="checkmark-circle" size={20} color={colors.success} accessible={false} />
        ) : null}
        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={isToday ? onFace : colors.textMuted} />
      </View>
      {progress && progress.total > 0 ? (
        <View style={{ marginTop: SPACING.sm, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          {/* İz yüze göre seçildi (§0-A tuzağı): dolu marka yüz üstünde ön plan rengin alfası. */}
          <ProgressBar
            progress={progress.done / progress.total}
            color={onFace === 'white' ? '#FFFFFF' : '#1A1A24'}
            trackColor={alpha(onFace === 'white' ? '#FFFFFF' : '#000000', 0.25)}
            height={10}
            style={{ flex: 1 }}
          />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.caption, fontWeight: '800', color: onFace }}>
            {progress.done}/{progress.total}
          </Text>
        </View>
      ) : null}
    </ShelfPressable>
  );
}

/* ───────────── Akordeon ───────────── */

interface Props {
  plan: PlanData;
  /** Bump (e.g. plan version) to reset expand-state when a new snapshot arrives. */
  resetKey?: number | string;
  highlightedCells?: Array<{ dayIndex: number; mealType?: string }>;
  onMealEdit?: (dayIndex: number, mealType: string) => void;
  /** SEMANTIC review gate (review fix ux-pass2): fires once when every day with
   *  content has been expanded at least once (rest/empty days auto-count).
   *  Geometry heuristics ("content fits viewport") called the plan reviewed while
   *  6 of 7 days were still collapsed. */
  onAllDaysViewed?: () => void;
}

export function PlanDayAccordion({ plan, resetKey, highlightedCells, onMealEdit, onAllDaysViewed }: Props) {
  const { colors } = useTheme();
  const [expandedDay, setExpandedDay] = useState(0);
  const [expandedMeal, setExpandedMeal] = useState<string | null>(null);

  const isDiet = plan.plan_type === 'diet';
  const days = Array.isArray(plan.days) ? plan.days : [];

  // Which array positions actually need opening to be "reviewed": rest days and
  // empty diet days have nothing to reveal.
  const contentDayIdxs = days
    .map((day, i) => ({ day, i }))
    .filter(({ day }) => isDiet
      ? ((day as DietPlanData['days'][number]).meals ?? []).length > 0
      : !(day as WorkoutPlanData['days'][number]).rest_day
        && ((day as WorkoutPlanData['days'][number]).exercises ?? []).length > 0)
    .map(({ i }) => i);
  const viewedRef = useRef<Set<number>>(new Set([0]));
  const firedRef = useRef(false);
  // Görsel ayna: kapı mantığı ref'te kalır (aynı anda iki setState yarışmasın); bu state
  // yalnız tikleri ve inceleme çubuğunu yeniden çizdirmek için.
  const [viewedSnap, setViewedSnap] = useState<Set<number>>(() => new Set([0]));
  const checkAllViewed = () => {
    if (firedRef.current || !onAllDaysViewed) return;
    if (contentDayIdxs.every(i => viewedRef.current.has(i))) {
      firedRef.current = true;
      onAllDaysViewed();
    }
  };

  // Reset when a new snapshot version arrives.
  useEffect(() => {
    setExpandedDay(0);
    setExpandedMeal(null);
    viewedRef.current = new Set([0]);
    setViewedSnap(new Set([0]));
    firedRef.current = false;
    // Single-content-day plans are fully reviewed from the start.
    checkAllViewed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // İnceleme çubuğu yalnız kapının bağlı olduğu yerde (taslak / tam ekran) anlamlı.
  const reviewTotal = contentDayIdxs.length;
  const reviewDone = contentDayIdxs.filter(i => viewedSnap.has(i)).length;
  const reviewLeft = reviewTotal - reviewDone;

  return (
    <View>
      {onAllDaysViewed && reviewTotal > 1 ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`Gözden geçirilen gün: ${reviewDone} / ${reviewTotal}`}
          accessibilityValue={{ min: 0, max: reviewTotal, now: reviewDone }}
          style={{ marginBottom: SPACING.md }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ ...TYPE.bodyStrong, color: colors.text }}>
              {reviewLeft === 0 ? 'Hepsine baktın — onaya hazır!' : reviewLeft === 1 ? 'Son bir gün kaldı' : 'Günlere tek tek göz at'}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.caption, color: colors.textMuted, fontWeight: '700' }}>
              {reviewDone}/{reviewTotal}
            </Text>
          </View>
          <ProgressBar progress={reviewTotal ? reviewDone / reviewTotal : 0} color={reviewLeft === 0 ? colors.success : colors.primary} height={10} />
        </View>
      ) : null}

      {days.map((day, dayIdx) => {
        // FIX (audit UI-PLN-06): key + expand-state by array position, not the
        // untrusted LLM-authored day.day_index (duplicate indices would collide).
        const isOpen = expandedDay === dayIdx;
        // FIX (fix-pass 07-12, item 3): 'Sali'/'Carsamba' seen live — canonicalize.
        const label = dayLabelTR(day.day_index, day.day_label);
        const wd = day as WorkoutPlanData['days'][number];
        const isRest = !isDiet && !!wd.rest_day;
        const summary = isDiet
          // FIX (audit UI-PLN-02): round day total (raw LLM JSON may carry decimals);
          // ux-round4 review: ?? 0 guard so a legacy day missing total_kcal isn't "NaN kcal".
          // FIX (ux-round4 #7): show protein alongside kcal in the collapsed row.
          ? `${Math.round((day as DietPlanData['days'][number]).total_kcal ?? 0)} kcal${(day as DietPlanData['days'][number]).total_protein
            ? ` · ${Math.round((day as DietPlanData['days'][number]).total_protein)}g protein` : ''}`
          // FIX (ux-round3 #10/#11): surface the workout's focus (Push/Pull/Legs) and estimated
          // duration in the header — both are AI-authored but were never rendered.
          : isRest ? 'Dinlenme günü'
          : [wd.focus, `${wd.exercises?.length ?? 0} egzersiz`, wd.estimated_duration_min ? `~${wd.estimated_duration_min} dk` : null].filter(Boolean).join(' · ');
        const viewed = !!onAllDaysViewed && contentDayIdxs.includes(dayIdx) && viewedSnap.has(dayIdx);
        return (
          <View key={`${day.day_index}-${dayIdx}`} style={{ marginBottom: SPACING.sm }}>
            <PlanDayHeader
              label={label}
              shortLabel={DAY_SHORT_TR[day.day_index] ?? label.slice(0, 3)}
              summary={summary}
              isOpen={isOpen}
              isRest={isRest}
              viewed={viewed}
              // Keep at least one day expanded: re-tapping the open day is a no-op
              // so the user can't collapse into a blank screen with nothing to re-open.
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setExpandedDay(dayIdx);
                viewedRef.current.add(dayIdx);
                setViewedSnap(new Set(viewedRef.current));
                checkAllViewed();
              }}
              accessibilityLabel={`${label}, ${isOpen ? 'açık' : 'aç'}${viewed ? ', incelendi' : ''}`}
            />

            {isOpen ? (
              <View style={{ marginTop: SPACING.sm }}>
                {/* FIX (ux-round3 #9): the AI-authored day note (e.g. "yüksek karbonhidrat günü",
                    "form odaklı hafif gün") was silently dropped — it carries WHY the day looks the
                    way it does. Surface it at the top of the open body. */}
                {day.notes ? (
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: SPACING.sm, paddingHorizontal: SPACING.xs }}>
                    <Ionicons name="chatbubble-ellipses" size={14} color={colors.primary} style={{ marginTop: 3 }} />
                    <Text style={{ ...TYPE.callout, color: colors.textSecondary, fontStyle: 'italic', flex: 1 }}>
                      {day.notes}
                    </Text>
                  </View>
                ) : null}
                {isDiet ? (
                  ((day as DietPlanData['days'][number]).meals ?? []).length === 0 ? (
                    <Text
                      style={{
                        ...TYPE.callout,
                        color: colors.textMuted,
                        fontStyle: 'italic',
                        textAlign: 'center',
                        paddingVertical: SPACING.md,
                      }}
                    >
                      Bu gün için öğün yok.
                    </Text>
                  ) : (
                    ((day as DietPlanData['days'][number]).meals ?? []).map((meal, mi) => {
                      // FIX (audit UI-PLN-06 + ux-round4 review): scope meal key by ARRAY POSITION
                      // (dayIdx-mi), not meal_type — a day with two 'snack' (ara öğün) meals shared
                      // one '${dayIdx}-snack' key, so expanding one expanded BOTH. Mirrors the twin
                      // fix in PlanActiveView.tsx.
                      const key = `${dayIdx}-${mi}`;
                      const isHl = !!highlightedCells?.find(
                        c => c.dayIndex === day.day_index && c.mealType === meal.meal_type,
                      );
                      return (
                        <MealCard
                          key={key}
                          meal={meal}
                          highlighted={isHl}
                          expanded={expandedMeal === key}
                          onToggle={() => setExpandedMeal(expandedMeal === key ? null : key)}
                          onEditPress={onMealEdit ? () => onMealEdit(day.day_index, meal.meal_type) : undefined}
                        />
                      );
                    })
                  )
                ) : isRest ? (
                  <Text
                    style={{
                      ...TYPE.callout,
                      color: colors.textMuted,
                      fontStyle: 'italic',
                      textAlign: 'center',
                      paddingVertical: SPACING.md,
                    }}
                  >
                    Dinlenme günü — hafif yürüyüş ve esneme yeterli.
                  </Text>
                ) : (
                  (wd.exercises ?? []).map((ex, i) => (
                    <ExerciseCard key={i} exercise={ex} index={i} />
                  ))
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

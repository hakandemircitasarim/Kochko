/**
 * Day-by-day plan accordion — the single renderer for a 7-day plan body.
 * Extracted from FullPlanModal (fix-pass 07-12, item 2b) so the draft screens
 * can show the actual plan INLINE instead of hiding it behind the small
 * "Detayı görmek için dokun" preview card. Used by:
 *   - FullPlanModal (full-screen review)
 *   - app/plan/diet.tsx + workout.tsx draft view (inline review body)
 */
import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, LayoutAnimation } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { MealCard } from './MealCard';
import { ExerciseCard } from './ExerciseCard';
import { dayLabelTR, type DietPlanData, type WorkoutPlanData, type PlanData } from '@/services/plan.service';

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
    firedRef.current = false;
    // Single-content-day plans are fully reviewed from the start.
    checkAllViewed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  return (
    <View>
      {days.map((day, dayIdx) => {
        // FIX (audit UI-PLN-06): key + expand-state by array position, not the
        // untrusted LLM-authored day.day_index (duplicate indices would collide).
        const isOpen = expandedDay === dayIdx;
        // FIX (fix-pass 07-12, item 3): 'Sali'/'Carsamba' seen live — canonicalize.
        const label = dayLabelTR(day.day_index, day.day_label);
        return (
          <View key={`${day.day_index}-${dayIdx}`} style={{ marginBottom: SPACING.md }}>
            <TouchableOpacity
              // Keep at least one day expanded: re-tapping the open day is a no-op
              // so the user can't collapse into a blank screen with nothing to re-open.
              onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setExpandedDay(dayIdx); viewedRef.current.add(dayIdx); checkAllViewed(); }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${isOpen ? 'açık' : 'aç'}`}
              accessibilityState={{ expanded: isOpen }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.surfaceLight,
                borderRadius: RADIUS.md,
                paddingHorizontal: SPACING.md,
                paddingVertical: SPACING.sm,
                gap: SPACING.sm,
              }}
            >
              {/* The day name ("Pazartesi") is the header of a whole collapsible section — it must
                  outrank the meal rows it contains, not match them. */}
              <Text style={{ ...TYPE.headline, color: colors.text, flex: 1 }}>
                {label}
              </Text>
              {isDiet ? (
                <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
                  {/* FIX (audit UI-PLN-02): round day total (raw LLM JSON may carry decimals);
                      ux-round4 review: ?? 0 guard so a legacy day missing total_kcal isn't "NaN kcal". */}
                  {Math.round((day as DietPlanData['days'][number]).total_kcal ?? 0)} kcal
                  {/* FIX (ux-round4 #7): show protein alongside kcal in the collapsed row. */}
                  {(day as DietPlanData['days'][number]).total_protein
                    ? ` · ${Math.round((day as DietPlanData['days'][number]).total_protein)}g P`
                    : ''}
                </Text>
              ) : (() => {
                // FIX (ux-round3 #10/#11): surface the workout's focus (Push/Pull/Legs) and estimated
                // duration in the header — both are AI-authored but were never rendered, so the
                // review surface showed only "5 egzersiz" (says nothing about what/how long).
                const wd = day as WorkoutPlanData['days'][number];
                if (wd.rest_day) return <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>Dinlenme</Text>;
                const n = wd.exercises?.length ?? 0;
                const parts = [wd.focus, `${n} egzersiz`, wd.estimated_duration_min ? `~${wd.estimated_duration_min} dk` : null].filter(Boolean);
                return <Text style={{ color: colors.textMuted, fontSize: FONT.xs }} numberOfLines={1}>{parts.join(' · ')}</Text>;
              })()}
              <Ionicons
                name={isOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            </TouchableOpacity>

            {isOpen ? (
              <View style={{ marginTop: SPACING.sm }}>
                {/* FIX (ux-round3 #9): the AI-authored day note (e.g. "yüksek karbonhidrat günü",
                    "form odaklı hafif gün") was silently dropped — it carries WHY the day looks the
                    way it does. Surface it at the top of the open body. */}
                {day.notes ? (
                  <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, fontStyle: 'italic', marginBottom: SPACING.sm }}>
                    {day.notes}
                  </Text>
                ) : null}
                {isDiet ? (
                  ((day as DietPlanData['days'][number]).meals ?? []).length === 0 ? (
                    <Text
                      style={{
                        color: colors.textMuted,
                        fontSize: FONT.xs,
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
                ) : (day as WorkoutPlanData['days'][number]).rest_day ? (
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: FONT.xs,
                      fontStyle: 'italic',
                      textAlign: 'center',
                      paddingVertical: SPACING.md,
                    }}
                  >
                    Dinlenme günü — hafif yürüyüş ve esneme yeterli.
                  </Text>
                ) : (
                  ((day as WorkoutPlanData['days'][number]).exercises ?? []).map((ex, i) => (
                    <ExerciseCard key={i} exercise={ex} />
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

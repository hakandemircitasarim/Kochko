/**
 * Full-screen scrollable 7-day plan view. Tracks scroll position to set
 * `hasViewedFullPlan` once the user reaches the last day — gates the
 * Onayla button (MASTER_PLAN §4.2).
 *
 * Resets the tracking when a new snapshot arrives (parent controls via
 * the `planVersion` prop — changing it re-runs the useEffect).
 */
import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Platform,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { MealCard } from './MealCard';
import { ExerciseCard } from './ExerciseCard';
import type { DietPlanData, WorkoutPlanData, PlanData } from '@/services/plan.service';

interface Props {
  visible: boolean;
  onClose: () => void;
  plan: PlanData;
  planVersion: number; // used to reset scroll tracking when snapshot changes
  highlightedCells?: Array<{ dayIndex: number; mealType?: string }>;
  onMealEdit?: (dayIndex: number, mealType: string) => void;
  onFullyViewed?: () => void;
}

const { height: SCREEN_H } = Dimensions.get('window');

export function FullPlanModal({
  visible,
  onClose,
  plan,
  planVersion,
  highlightedCells,
  onMealEdit,
  onFullyViewed,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [expandedDay, setExpandedDay] = useState(0);
  const [expandedMeal, setExpandedMeal] = useState<string | null>(null);
  const [fullyViewed, setFullyViewed] = useState(false);

  // Reset when snapshot version changes (new plan_snapshot arrived).
  useEffect(() => {
    setFullyViewed(false);
    setExpandedDay(0);
    setExpandedMeal(null);
  }, [planVersion]);

  // Reset scroll when modal becomes visible on a new version.
  useEffect(() => {
    if (visible) scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [visible, planVersion]);

  const handleScroll = ({ nativeEvent }: { nativeEvent: { layoutMeasurement: { height: number }; contentOffset: { y: number }; contentSize: { height: number } } }) => {
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    const reachedEnd = layoutMeasurement.height + contentOffset.y >= contentSize.height - 80;
    if (reachedEnd && !fullyViewed) {
      setFullyViewed(true);
      onFullyViewed?.();
    }
  };

  const isDiet = plan.plan_type === 'diet';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View
          style={{
            paddingTop: Platform.OS === 'web' ? 12 : Math.max(insets.top, 12),
            paddingHorizontal: SPACING.xl,
            paddingBottom: SPACING.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACING.md,
            borderBottomWidth: 0.5,
            borderBottomColor: colors.divider,
          }}
        >
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>
              {isDiet ? 'Haftalık Diyet' : 'Haftalık Spor'}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
              {plan.week_start} · v{plan.version ?? 1}
            </Text>
          </View>
          {fullyViewed ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                backgroundColor: '#22C55E18',
                borderRadius: RADIUS.full,
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}
            >
              <Ionicons name="checkmark-circle" size={12} color="#22C55E" />
              <Text style={{ color: '#22C55E', fontSize: 10, fontWeight: '700' }}>Okundu</Text>
            </View>
          ) : null}
        </View>

        {/* Scrollable content */}
        <ScrollView
          ref={scrollRef}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          contentContainerStyle={{
            padding: SPACING.md,
            paddingBottom: Math.max(insets.bottom, SPACING.lg) + SPACING.lg,
          }}
        >
          {plan.days.map(day => {
            const isOpen = expandedDay === day.day_index;
            return (
              <View key={day.day_index} style={{ marginBottom: SPACING.md }}>
                <TouchableOpacity
                  onPress={() => setExpandedDay(isOpen ? -1 : day.day_index)}
                  activeOpacity={0.8}
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
                  <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700', flex: 1 }}>
                    {day.day_label}
                  </Text>
                  {isDiet ? (
                    <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
                      {(day as DietPlanData['days'][number]).total_kcal} kcal
                    </Text>
                  ) : (
                    <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>
                      {(day as WorkoutPlanData['days'][number]).rest_day
                        ? 'Dinlenme'
                        : `${(day as WorkoutPlanData['days'][number]).exercises.length} egzersiz`}
                    </Text>
                  )}
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>

                {isOpen ? (
                  <View style={{ marginTop: SPACING.sm }}>
                    {isDiet ? (
                      (day as DietPlanData['days'][number]).meals.length === 0 ? (
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
                        (day as DietPlanData['days'][number]).meals.map(meal => {
                          const key = `${day.day_index}-${meal.meal_type}`;
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
                      (day as WorkoutPlanData['days'][number]).exercises.map((ex, i) => (
                        <ExerciseCard key={i} exercise={ex} />
                      ))
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}

          {!fullyViewed ? (
            <View
              style={{
                padding: SPACING.md,
                borderRadius: RADIUS.md,
                backgroundColor: colors.surfaceLight,
                alignItems: 'center',
                marginTop: SPACING.lg,
              }}
            >
              <Ionicons name="arrow-down-circle-outline" size={20} color={colors.textMuted} />
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: FONT.xs,
                  marginTop: 4,
                  textAlign: 'center',
                }}
              >
                Tüm günleri gözden geçirdiğinde onay butonu aktifleşir.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

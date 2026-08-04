/**
 * Full-screen scrollable 7-day plan view. Tracks scroll position to set
 * `hasViewedFullPlan` once the user reaches the last day — gates the
 * Onayla button (MASTER_PLAN §4.2).
 *
 * Resets the tracking when a new snapshot arrives (parent controls via
 * the `planVersion` prop — changing it re-runs the useEffect).
 *
 * FIX (fix-pass 07-12, item 2a): fullyViewed used to fire ONLY from onScroll —
 * when the content fits the viewport no scroll event ever fires on Android, so
 * the approve gate stayed locked forever. We now also measure the viewport
 * (onLayout) and content (onContentSizeChange) and auto-satisfy when the whole
 * plan is visible without scrolling.
 */
import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { PlanDayAccordion } from './PlanDayAccordion';
import { formatWeekStartTR, type PlanData } from '@/services/plan.service';

interface Props {
  visible: boolean;
  onClose: () => void;
  plan: PlanData;
  planVersion: number; // used to reset scroll tracking when snapshot changes
  /** Stored weekly_plans.week_start (source of truth). Falls back to the
   *  LLM-authored plan_data.week_start when the row value isn't passed. */
  weekStart?: string;
  highlightedCells?: Array<{ dayIndex: number; mealType?: string }>;
  onMealEdit?: (dayIndex: number, mealType: string) => void;
  onFullyViewed?: () => void;
}

export function FullPlanModal({
  visible,
  onClose,
  plan,
  planVersion,
  weekStart,
  highlightedCells,
  onMealEdit,
  onFullyViewed,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [fullyViewed, setFullyViewed] = useState(false);

  // Ref mirrors the viewed flag so callbacks never act on a stale closure.
  const fullyViewedRef = useRef(false);

  const markFullyViewed = () => {
    if (fullyViewedRef.current) return;
    fullyViewedRef.current = true;
    setFullyViewed(true);
    onFullyViewed?.();
  };

  // Review fix (ux-pass2): geometry unlocks REMOVED. The body is an accordion that
  // renders one expanded day at a time, so "content fits the viewport" ≠ "plan
  // reviewed" — the fit-check unlocked with 6 of 7 days never opened. The gate is
  // now SEMANTIC: PlanDayAccordion fires onAllDaysViewed when every content day
  // has been expanded at least once; scroll-to-end stays as a secondary path.
  useEffect(() => {
    fullyViewedRef.current = false;
    setFullyViewed(false);
  }, [planVersion]);

  // Reset scroll when modal becomes visible on a new version.
  useEffect(() => {
    if (visible) scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [visible, planVersion]);

  const handleScroll = ({ nativeEvent }: { nativeEvent: { layoutMeasurement: { height: number }; contentOffset: { y: number }; contentSize: { height: number } } }) => {
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    const reachedEnd = layoutMeasurement.height + contentOffset.y >= contentSize.height - 80;
    if (reachedEnd) markFullyViewed();
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
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Kapat"
            // FIX (ux-pass5): the modal's only visible exit was a 32px corner target —
            // hitSlop 12 (same as AlternativeComparisonModal's close) reaches ~56px effective.
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ padding: 4 }}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ ...TYPE.title3, color: colors.text }}>
              {isDiet ? 'Haftalık diyet' : 'Haftalık spor'}
            </Text>
            <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
              {/* FIX (fix-pass 07-12, item 4b): '2026-06-15' ham ISO yerine '15 Haziran haftası' */}
              {formatWeekStartTR(weekStart ?? plan.week_start)} · v{plan.version ?? 1}
            </Text>
          </View>
          {fullyViewed ? (
            <View
              accessibilityRole="text"
              accessibilityLabel="Plan tümüyle okundu"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                backgroundColor: colors.successLight,
                borderRadius: RADIUS.full,
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}
            >
              <Ionicons name="checkmark-circle" size={14} color={colors.success} />
              <Text style={{ ...TYPE.caption, color: colors.success, fontWeight: '700' }}>Okundu</Text>
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
          {/* Day-by-day body — extracted to PlanDayAccordion (fix-pass 07-12, item 2b)
              so the draft screens can render the same list inline. */}
          <PlanDayAccordion
            plan={plan}
            resetKey={planVersion}
            highlightedCells={highlightedCells}
            onMealEdit={onMealEdit}
            onAllDaysViewed={markFullyViewed}
          />

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
                  ...TYPE.caption,
                  color: colors.textMuted,
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

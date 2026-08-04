/**
 * Single meal card for the diet plan full view. Shows meal name, time,
 * items list (collapsible), totals. Optional highlighted state (500ms
 * green glow when the meal just changed in a new snapshot).
 */
import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, ActivityIndicator, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { MEAL_TYPE_LABELS_TR } from '@/lib/labels';
import { type DietMeal } from '@/services/plan.service';

// FIX (ux-round2 #13): enable LayoutAnimation on Android (iOS is on by default) so the meal
// accordion expand/collapse eases instead of snapping — a core daily surface tapped many times.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  meal: DietMeal;
  highlighted?: boolean;      // just-changed flag — triggers green glow
  expanded: boolean;
  onToggle: () => void;
  onEditPress?: () => void;   // opens chat with prefill "X'i değiştir"
  // 'Bunu yedim' — one-tap plan→diary (fix-pass 07-12, item 9). Only the ACTIVE
  // plan's TODAY section passes these; drafts/history render without the button.
  onLogPress?: () => void;
  logStatus?: 'saving' | 'done';
}

const MEAL_ICONS: Record<DietMeal['meal_type'], string> = {
  breakfast: 'sunny-outline',
  lunch: 'restaurant-outline',
  dinner: 'moon-outline',
  snack: 'cafe-outline',
};

export function MealCard({ meal, highlighted, expanded, onToggle, onEditPress, onLogPress, logStatus }: Props) {
  const { colors } = useTheme();
  const glow = useRef(new Animated.Value(0)).current;

  // Plan-domain palette mapped onto brand theme tokens (no off-brand hexes):
  // breakfast → warning (amber), lunch → primary (diet teal),
  // dinner → purple (workout accent), snack → pink.
  const MEAL_COLORS: Record<DietMeal['meal_type'], string> = {
    breakfast: colors.warning,
    lunch: colors.primary,
    dinner: colors.purple,
    snack: colors.pink,
  };

  useEffect(() => {
    if (highlighted) {
      glow.setValue(1);
      Animated.timing(glow, { toValue: 0, duration: 600, useNativeDriver: false }).start();
    }
  }, [highlighted, glow]);

  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.success],
  });

  const color = MEAL_COLORS[meal.meal_type];

  return (
    <Animated.View
      style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor,
        padding: SPACING.md,
        marginBottom: SPACING.sm,
      }}
    >
      {/* Header */}
      {/* FIX (ux-pass5): expandable header announced as a button with expanded state
          (matches PlanDayAccordion) — was a text blob to TalkBack, hiding the actions inside. */}
      {/* FIX (ux-ideas #2): the 'Bunu yedim' one-tap log now also lives on the COLLAPSED
          header (compact + button), so the day's most-repeated action no longer requires
          expanding each meal first. The full labelled chip still renders in the expanded body.
          Split into a toggle + a sibling button (not nested) so the log tap and the expand tap
          never contend for the same touch responder. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
        <TouchableOpacity
          onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); onToggle(); }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${MEAL_TYPE_LABELS_TR[meal.meal_type]}, ${meal.name}, ${Math.round(meal.total_kcal)} kalori, ${expanded ? 'açık' : 'aç'}`}
          accessibilityState={{ expanded }}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: color + '18',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={MEAL_ICONS[meal.meal_type] as any} size={18} color={color} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ ...TYPE.overline, color: colors.textMuted }}>
                {MEAL_TYPE_LABELS_TR[meal.meal_type]}
              </Text>
              {meal.time ? (
                <Text style={{ ...TYPE.footnote, color: colors.textMuted }}>· {meal.time}</Text>
              ) : null}
            </View>
            {/* The meal's name is what this card IS. At 13px it was smaller than the app's reading
                size, so a plan read as a wall of small bold text with no entry point per card. */}
            {/* Two lines when collapsed, not one. Raising the name to the reading step made it
                truncate in the ACTIVE plan view — those rows carry an extra "+" control, so the
                name has less room there than in the draft view where the same names fit. Driven on
                a device: "Peynirli tost ve yo…", "Kıymalı kuru fasu…". Giving the name a second
                line is the honest fix; shrinking it back would trade legibility for a layout
                constraint that only exists on one of the two surfaces. */}
            <Text style={{ ...TYPE.headline, color: colors.text, marginTop: 2 }} numberOfLines={expanded ? 0 : 2}>
              {meal.name}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            {/* FIX (audit UI-PLN-02): round raw LLM-authored macros so decimals (487.3, 32.5) don't leak into the UI */}
            <Text style={{ ...TYPE.bodyStrong, color: colors.text, fontWeight: '700' }}>
              {Math.round(meal.total_kcal)} kcal
            </Text>
            {/* Dar sag sutun: makro satiri kabin genisligini belirliyor — 13'e cikarmak
                ogun adini ikinci satirda kirpiyordu, bu yuzden en kucuk okunur adimda kaliyor. */}
            <Text style={{ ...TYPE.footnote, color: colors.textSecondary }}>
              P{Math.round(meal.total_protein)} · K{Math.round(meal.total_carbs)} · Y{Math.round(meal.total_fat)}
            </Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>

        {/* Compact one-tap log — only on the active plan's TODAY (onLogPress present) and while
            collapsed; expanding reveals the full labelled chip below. Icon-only to fit the dense
            header, with a full-intent a11y label. Reflects saving / done state at a glance. */}
        {onLogPress && !expanded ? (
          <TouchableOpacity
            onPress={onLogPress}
            disabled={!!logStatus}
            accessibilityRole="button"
            accessibilityLabel={logStatus === 'done' ? `${meal.name} günlüğe eklendi` : logStatus === 'saving' ? 'Ekleniyor' : `${meal.name}, bunu yedim, günlüğe ekle`}
            accessibilityState={{ disabled: !!logStatus, busy: logStatus === 'saving' }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: logStatus === 'done' ? colors.successLight : colors.primary + '18',
            }}
          >
            {logStatus === 'saving' ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.7 }] }} />
            ) : (
              <Ionicons
                name={logStatus === 'done' ? 'checkmark-circle' : 'add-circle-outline'}
                size={18}
                color={logStatus === 'done' ? colors.success : colors.primary}
              />
            )}
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Expanded: items + notes + edit */}
      {expanded && (
        <View style={{ marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 0.5, borderTopColor: colors.divider }}>
          {(Array.isArray(meal.items) ? meal.items : []).map((it, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingVertical: 4,
              }}
            >
              {/* Ingredient list — 11px for the actual food a person is meant to shop for and eat. */}
              <Text style={{ ...TYPE.caption, color: colors.text, flex: 1 }} numberOfLines={1}>
                {it.name}{' '}
                <Text style={{ color: colors.textMuted }}>
                  ({it.grams ? `${it.grams}g` : it.portion ?? '-'})
                </Text>
              </Text>
              {/* FIX (audit UI-PLN-02): round per-item kcal (raw LLM JSON may carry decimals) */}
              <Text style={{ ...TYPE.caption, color: colors.textMuted }}>{Math.round(it.kcal)} kcal</Text>
            </View>
          ))}

          {/* Same step as ExerciseCard's note line — one spec for "the coach's aside about this item". */}
          {meal.notes ? (
            <Text
              style={{
                ...TYPE.caption,
                color: colors.textSecondary,
                fontStyle: 'italic',
                marginTop: SPACING.xs,
              }}
            >
              {meal.notes}
            </Text>
          ) : null}

          {(onEditPress || onLogPress) ? (
            <View style={{ marginTop: SPACING.sm, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
              {onLogPress ? (
                <TouchableOpacity
                  onPress={onLogPress}
                  disabled={!!logStatus}
                  accessibilityRole="button"
                  accessibilityLabel={logStatus === 'done' ? 'Günlüğe eklendi' : 'Bunu yedim, günlüğe ekle'}
                  accessibilityState={{ disabled: !!logStatus, busy: logStatus === 'saving' }}
                  // FIX (ux-pass5): chip was ~23px tall with no hitSlop — flagship one-tap
                  // logging kept missing. paddingVertical 8 (~32px visual) + hitSlop → ≥44px effective.
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    backgroundColor: logStatus === 'done' ? colors.successLight : colors.primary + '18',
                    borderRadius: RADIUS.full,
                    paddingHorizontal: SPACING.sm,
                    paddingVertical: 8,
                  }}
                >
                  {logStatus === 'saving' ? (
                    <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.7 }] }} />
                  ) : (
                    <Ionicons
                      name={logStatus === 'done' ? 'checkmark-circle' : 'add-circle-outline'}
                      size={12}
                      color={logStatus === 'done' ? colors.success : colors.primary}
                    />
                  )}
                  {/* Kept in lockstep with ExerciseCard's chip — same control, same spec. 11px is
                      the scale's "never for anything you must read to act" step, and this is the
                      flagship one-tap action on both plan cards. */}
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    style={{
                      ...TYPE.caption,
                      fontWeight: '700',
                      color: logStatus === 'done' ? colors.success : colors.primary,
                    }}
                  >
                    {logStatus === 'done' ? 'Günlüğe eklendi' : logStatus === 'saving' ? 'Ekleniyor...' : 'Bunu yedim'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {onEditPress ? (
                <TouchableOpacity
                  onPress={onEditPress}
                  // FIX (ux-pass5): same undersized target as the log chip + TalkBack read it
                  // as plain text — add role/label and grow to ≥44px effective.
                  accessibilityRole="button"
                  accessibilityLabel={`${meal.name} öğününü değiştir`}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    backgroundColor: colors.surfaceLight,
                    borderRadius: RADIUS.full,
                    paddingHorizontal: SPACING.sm,
                    paddingVertical: 8,
                  }}
                >
                  <Ionicons name="create-outline" size={13} color={colors.textSecondary} />
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    style={{ ...TYPE.caption, fontWeight: '600', color: colors.textSecondary }}
                  >
                    Bu öğünü değiştir
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>
      )}
    </Animated.View>
  );
}

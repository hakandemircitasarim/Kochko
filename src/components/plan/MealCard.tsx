/**
 * Single meal card for the diet plan full view. Shows meal name, time,
 * items list (collapsible), totals. Optional highlighted state (500ms
 * green glow when the meal just changed in a new snapshot).
 */
import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { MEAL_LABELS_TR, type DietMeal } from '@/services/plan.service';

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
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}
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
            <Text style={{ color: colors.textMuted, fontSize: FONT.xs, fontWeight: '600' }}>
              {MEAL_LABELS_TR[meal.meal_type]}
            </Text>
            {meal.time ? (
              <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>· {meal.time}</Text>
            ) : null}
          </View>
          <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700', marginTop: 1 }} numberOfLines={expanded ? 0 : 1}>
            {meal.name}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {/* FIX (audit UI-PLN-02): round raw LLM-authored macros so decimals (487.3, 32.5) don't leak into the UI */}
          <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700' }}>
            {Math.round(meal.total_kcal)} kcal
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>
            P{Math.round(meal.total_protein)} · K{Math.round(meal.total_carbs)} · Y{Math.round(meal.total_fat)}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textMuted}
        />
      </TouchableOpacity>

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
              <Text style={{ color: colors.text, fontSize: FONT.xs, flex: 1 }} numberOfLines={1}>
                {it.name}{' '}
                <Text style={{ color: colors.textMuted }}>
                  ({it.grams ? `${it.grams}g` : it.portion ?? '-'})
                </Text>
              </Text>
              {/* FIX (audit UI-PLN-02): round per-item kcal (raw LLM JSON may carry decimals) */}
              <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>{Math.round(it.kcal)} kcal</Text>
            </View>
          ))}

          {meal.notes ? (
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: FONT.xs,
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
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    backgroundColor: logStatus === 'done' ? colors.successLight : colors.primary + '18',
                    borderRadius: RADIUS.full,
                    paddingHorizontal: SPACING.sm,
                    paddingVertical: 4,
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
                  <Text
                    style={{
                      color: logStatus === 'done' ? colors.success : colors.primary,
                      fontSize: 11,
                      fontWeight: '700',
                    }}
                  >
                    {logStatus === 'done' ? 'Günlüğe eklendi' : logStatus === 'saving' ? 'Ekleniyor...' : 'Bunu yedim'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {onEditPress ? (
                <TouchableOpacity
                  onPress={onEditPress}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    backgroundColor: colors.surfaceLight,
                    borderRadius: RADIUS.full,
                    paddingHorizontal: SPACING.sm,
                    paddingVertical: 4,
                  }}
                >
                  <Ionicons name="create-outline" size={12} color={colors.textSecondary} />
                  <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600' }}>
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

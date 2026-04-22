/**
 * Single meal card for the diet plan full view. Shows meal name, time,
 * items list (collapsible), totals. Optional highlighted state (500ms
 * green glow when the meal just changed in a new snapshot).
 */
import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
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
}

const MEAL_ICONS: Record<DietMeal['meal_type'], string> = {
  breakfast: 'sunny-outline',
  lunch: 'restaurant-outline',
  dinner: 'moon-outline',
  snack: 'cafe-outline',
};

const MEAL_COLORS: Record<DietMeal['meal_type'], string> = {
  breakfast: '#F59E0B',
  lunch: '#22C55E',
  dinner: '#6366F1',
  snack: '#EC4899',
};

export function MealCard({ meal, highlighted, expanded, onToggle, onEditPress }: Props) {
  const { colors, isDark } = useTheme();
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (highlighted) {
      glow.setValue(1);
      Animated.timing(glow, { toValue: 0, duration: 600, useNativeDriver: false }).start();
    }
  }, [highlighted, glow]);

  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, '#22C55E'],
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
          <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700' }}>
            {meal.total_kcal} kcal
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 10 }}>
            P{meal.total_protein} · K{meal.total_carbs} · Y{meal.total_fat}
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
          {meal.items.map((it, i) => (
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
              <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>{it.kcal} kcal</Text>
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

          {onEditPress ? (
            <TouchableOpacity
              onPress={onEditPress}
              style={{
                marginTop: SPACING.sm,
                alignSelf: 'flex-start',
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
      )}
    </Animated.View>
  );
}

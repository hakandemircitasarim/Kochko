/**
 * Activity Timeline - Meals and workouts in a unified timeline view.
 */
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, FONT, RADIUS, HERO, CARD_SHADOW } from '@/lib/constants';

interface MealEntry {
  id: string;
  meal_type: string;
  raw_input: string;
  calories: number;
  logged_at?: string;
}

interface WorkoutEntry {
  id: string;
  raw_input: string;
  duration_min: number;
  logged_at?: string;
}

interface Props {
  meals: MealEntry[];
  workouts: WorkoutEntry[];
  onDeleteMeal: (id: string) => void;
  onDeleteWorkout: (id: string) => void;
}

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Kahvaltı', lunch: 'Öğle', dinner: 'Akşam', snack: 'Ara',
};

const MEAL_ICONS: Record<string, string> = {
  breakfast: 'sunny-outline', lunch: 'restaurant-outline',
  dinner: 'moon-outline', snack: 'cafe-outline',
};

type Activity = {
  type: 'meal';
  id: string;
  label: string;
  icon: string;
  text: string;
  detail: string;
  color: string;
} | {
  type: 'workout';
  id: string;
  label: string;
  icon: string;
  text: string;
  detail: string;
  color: string;
};

export function ActivityTimeline({ meals, workouts, onDeleteMeal, onDeleteWorkout }: Props) {
  const { colors, isDark } = useTheme();

  const activities: Activity[] = [
    ...meals.map(m => ({
      type: 'meal' as const,
      id: m.id,
      label: MEAL_LABELS[m.meal_type] ?? m.meal_type,
      icon: MEAL_ICONS[m.meal_type] ?? 'restaurant-outline',
      text: m.raw_input,
      detail: `${m.calories} kcal`,
      color: METRIC_COLORS.calories,
    })),
    ...workouts.map(w => ({
      type: 'workout' as const,
      id: w.id,
      label: 'Antrenman',
      icon: 'barbell-outline',
      text: w.raw_input,
      detail: w.duration_min > 0 ? `${w.duration_min} dk` : '',
      color: METRIC_COLORS.workout,
    })),
  ];

  const totalActivities = activities.length;

  return (
    <View>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
        <Text style={{ fontSize: FONT.md, fontWeight: '700', color: colors.text }}>Aktiviteler</Text>
        {totalActivities > 0 && (
          <View style={{ backgroundColor: colors.primary + '18', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ color: colors.primary, fontSize: FONT.xs, fontWeight: '700' }}>{totalActivities}</Text>
          </View>
        )}
      </View>

      {/* Empty state */}
      {totalActivities === 0 && (
        <View style={{ alignItems: 'center', paddingVertical: SPACING.xl }}>
          <View style={{
            width: 56, height: 56, borderRadius: 18,
            backgroundColor: colors.surfaceLight,
            alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm,
          }}>
            <Ionicons name="restaurant-outline" size={28} color={colors.textMuted} />
          </View>
          <Text style={{ color: colors.textMuted, fontSize: FONT.sm }}>Koçuna ne yediğini yaz</Text>
        </View>
      )}

      {/* Timeline */}
      {totalActivities > 0 && (
        <View style={{ paddingLeft: 24 }}>
          {/* Vertical line */}
          <View style={{
            position: 'absolute', left: 8, top: 8, bottom: 8,
            width: HERO.TIMELINE_LINE_WIDTH,
            backgroundColor: colors.border,
            borderRadius: 1,
          }} />

          {activities.map((activity, idx) => (
            <TouchableOpacity
              key={activity.id}
              activeOpacity={0.7}
              onLongPress={() => activity.type === 'meal' ? onDeleteMeal(activity.id) : onDeleteWorkout(activity.id)}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingVertical: SPACING.sm,
                ...(idx < totalActivities - 1 ? { borderBottomWidth: 0.5, borderBottomColor: colors.divider } : {}),
              }}
            >
              {/* Dot */}
              <View style={{
                position: 'absolute', left: -20,
                width: HERO.TIMELINE_DOT_SIZE, height: HERO.TIMELINE_DOT_SIZE,
                borderRadius: HERO.TIMELINE_DOT_SIZE / 2,
                backgroundColor: activity.color,
                borderWidth: 2, borderColor: colors.background,
              }} />

              {/* Icon */}
              <View style={{
                width: 32, height: 32, borderRadius: 8,
                backgroundColor: activity.color + '12',
                alignItems: 'center', justifyContent: 'center',
                marginRight: SPACING.sm,
              }}>
                <Ionicons name={activity.icon as any} size={16} color={activity.color} />
              </View>

              {/* Content */}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: FONT.xs, color: colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {activity.label}
                </Text>
                <Text style={{ fontSize: FONT.sm, color: colors.text, marginTop: 1 }} numberOfLines={1}>{activity.text}</Text>
              </View>

              {/* Detail */}
              {activity.detail ? (
                <View style={{ backgroundColor: activity.color + '12', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ fontSize: FONT.xs, color: activity.color, fontWeight: '700' }}>{activity.detail}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

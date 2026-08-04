/**
 * Single exercise entry for workout plan full view.
 */
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import type { WorkoutExercise } from '@/services/plan.service';

interface Props {
  exercise: WorkoutExercise;
  // FIX (ux-ideas #19): one-tap "Bunu yaptım" — only the ACTIVE plan's TODAY passes these.
  onLogPress?: () => void;
  logStatus?: 'saving' | 'done';
}

export function ExerciseCard({ exercise, onLogPress, logStatus }: Props) {
  const { colors } = useTheme();
  const loadText = exercise.weight_kg
    ? `${exercise.sets} × ${exercise.reps} · ${exercise.weight_kg} kg`
    : exercise.rpe
      ? `${exercise.sets} × ${exercise.reps} · RPE ${exercise.rpe}`
      : `${exercise.sets} × ${exercise.reps}`;

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: colors.border,
        padding: SPACING.md,
        marginBottom: SPACING.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
        {/* FIX (ux-polish): match MealCard's badge spec (36/10/18) so the two plan-item cards
            read on-register across the diet/workout tabs. */}
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: colors.purple + '18',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="barbell-outline" size={18} color={colors.purple} />
        </View>
        <View style={{ flex: 1 }}>
          {/* Measured on device against MealCard: there the meal name is `headline` and the kcal
              figure sits a step below it, so the name reads as what the card IS. Here name and
              load were both `bodyStrong`, so "3 × 10" competed with the exercise for first glance.
              Name up one step; load stays at 15 (a workout's load matters more than a meal's kcal,
              and the right column measured only ~73dp, so this does not squeeze it). */}
          <Text style={{ ...TYPE.headline, color: colors.text }}>
            {exercise.name}
          </Text>
          {exercise.muscle_groups && exercise.muscle_groups.length > 0 ? (
            <Text style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 1 }}>
              {exercise.muscle_groups.join(' · ')}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ ...TYPE.bodyStrong, color: colors.text }}>
            {loadText}
          </Text>
          {exercise.rest_sec ? (
            <Text style={{ ...TYPE.caption, color: colors.textMuted }}>
              {exercise.rest_sec}s dinlenme
            </Text>
          ) : null}
        </View>
      </View>

      {/* Form cues ("Dizler ayak yönünde, kontrollü in.") are read-to-act content, and the scale
          reserves 11px for things that are never that. Measured on device it also started at the
          card's left edge, under the badge, so it read as a stray caption rather than as part of
          the exercise — indent it to the name column. */}
      {exercise.notes ? (
        <Text
          style={{
            ...TYPE.caption,
            color: colors.textSecondary,
            fontStyle: 'italic',
            marginTop: SPACING.xs,
            marginLeft: 36 + SPACING.sm,
          }}
        >
          {exercise.notes}
        </Text>
      ) : null}

      {/* FIX (ux-ideas #19): "Bunu yaptım" — closes the track→mark loop on the workout side. */}
      {onLogPress ? (
        <TouchableOpacity
          onPress={onLogPress}
          disabled={!!logStatus}
          accessibilityRole="button"
          accessibilityLabel={logStatus === 'done' ? 'Yapıldı olarak işaretlendi' : 'Bunu yaptım, günlüğe ekle'}
          accessibilityState={{ disabled: !!logStatus, busy: logStatus === 'saving' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            alignSelf: 'flex-start',
            marginTop: SPACING.sm,
            backgroundColor: logStatus === 'done' ? colors.successLight : colors.purple + '18',
            borderRadius: RADIUS.full,
            paddingHorizontal: SPACING.sm,
            paddingVertical: 8,
          }}
        >
          {logStatus === 'saving' ? (
            <ActivityIndicator size="small" color={colors.purple} style={{ transform: [{ scale: 0.7 }] }} />
          ) : (
            <Ionicons
              name={logStatus === 'done' ? 'checkmark-circle' : 'add-circle-outline'}
              size={12}
              color={logStatus === 'done' ? colors.success : colors.purple}
            />
          )}
          {/* 11px was below the scale's floor for anything you must read to act — and this chip
              IS the action. Reading-adjacent step; maxFontSizeMultiplier keeps a 150% OS text
              size from bursting the pill. */}
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{ ...TYPE.caption, fontWeight: '700', color: logStatus === 'done' ? colors.success : colors.purple }}
          >
            {logStatus === 'done' ? 'Yapıldı' : logStatus === 'saving' ? 'Ekleniyor...' : 'Bunu yaptım'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

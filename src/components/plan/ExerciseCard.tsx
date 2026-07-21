/**
 * Single exercise entry for workout plan full view.
 */
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
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
          <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700' }}>
            {exercise.name}
          </Text>
          {exercise.muscle_groups && exercise.muscle_groups.length > 0 ? (
            <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 1 }}>
              {exercise.muscle_groups.join(' · ')}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700' }}>
            {loadText}
          </Text>
          {exercise.rest_sec ? (
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>
              {exercise.rest_sec}s dinlenme
            </Text>
          ) : null}
        </View>
      </View>

      {exercise.notes ? (
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: FONT.xs,
            fontStyle: 'italic',
            marginTop: SPACING.xs,
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
          <Text style={{ color: logStatus === 'done' ? colors.success : colors.purple, fontSize: 11, fontWeight: '700' }}>
            {logStatus === 'done' ? 'Yapıldı' : logStatus === 'saving' ? 'Ekleniyor...' : 'Bunu yaptım'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/**
 * Single exercise entry for workout plan full view.
 */
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import type { WorkoutExercise } from '@/services/plan.service';

interface Props {
  exercise: WorkoutExercise;
}

export function ExerciseCard({ exercise }: Props) {
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
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: '#6366F118',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="barbell-outline" size={14} color="#6366F1" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700' }}>
            {exercise.name}
          </Text>
          {exercise.muscle_groups && exercise.muscle_groups.length > 0 ? (
            <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 1 }}>
              {exercise.muscle_groups.join(' · ')}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '700' }}>
            {loadText}
          </Text>
          {exercise.rest_sec ? (
            <Text style={{ color: colors.textMuted, fontSize: 10 }}>
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
    </View>
  );
}

/**
 * Single exercise entry for workout plan full view.
 *
 * DUOLINGO DİLİ (2026-11-04): kart dokunulamaz (yalnız içindeki "Bunu yaptım" çipi), o
 * yüzden RAF YOK — raf "bas beni" demek. Canlılığı renkten alır: egzersizin gün içindeki
 * SIRASI dolu bir yastık rozette numara olarak durur (1, 2, 3…) ve her sıra kendi tonunu
 * taşır (menekşe/mavi/kehribar/gül döngüsü — metrik paleti, yeni hue yok). Sıra numarası
 * gerçek bilgi: antrenman sırayla yapılır. Pastel opak yüz + aynı tonun 2px çerçevesi
 * MealCard ile aynı spec.
 */
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { PlanTileBadge, PlanActionChip, PLATE_INK, pastel } from './MealCard';
import type { WorkoutExercise } from '@/services/plan.service';

interface Props {
  exercise: WorkoutExercise;
  /** Gün içindeki sıra (0'dan). Verilirse rozet numara + sıranın tonu; yoksa menekşe halter. */
  index?: number;
  // FIX (ux-ideas #19): one-tap "Bunu yaptım" — only the ACTIVE plan's TODAY passes these.
  onLogPress?: () => void;
  logStatus?: 'saving' | 'done';
}

// Sıra tonları + dolu rozet üstündeki ön plan (kehribar/gül mürekkep, mavi/menekşe beyaz).
const ORDER_TONES: Array<{ tone: string; fg: string }> = [
  { tone: METRIC_COLORS.workout, fg: '#FFFFFF' },
  { tone: METRIC_COLORS.water, fg: '#FFFFFF' },
  { tone: METRIC_COLORS.steps, fg: PLATE_INK },
  { tone: METRIC_COLORS.weight, fg: PLATE_INK },
];

export function ExerciseCard({ exercise, index, onLogPress, logStatus }: Props) {
  const { colors, isDark } = useTheme();
  const t = ORDER_TONES[(index ?? 0) % ORDER_TONES.length];
  const { face, edge } = pastel(t.tone, colors.card, isDark);
  const loadText = exercise.weight_kg
    ? `${exercise.sets} × ${exercise.reps} · ${exercise.weight_kg} kg`
    : exercise.rpe
      ? `${exercise.sets} × ${exercise.reps} · RPE ${exercise.rpe}`
      : `${exercise.sets} × ${exercise.reps}`;
  const done = logStatus === 'done';

  return (
    <View
      style={{
        backgroundColor: face,
        borderRadius: RADIUS.lg,
        borderWidth: 2,
        borderColor: edge,
        padding: SPACING.md,
        marginBottom: SPACING.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        {/* FIX (ux-polish): same badge spec as MealCard so the two plan-item cards
            read on-register across the diet/workout tabs. */}
        <PlanTileBadge tone={t.tone}>
          {index != null ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.headline, fontWeight: '800', color: t.fg }}>
              {index + 1}
            </Text>
          ) : (
            <Ionicons name="barbell" size={20} color={t.fg} />
          )}
        </PlanTileBadge>
        <View style={{ flex: 1 }}>
          {/* Measured on device against MealCard: there the meal name is `headline` and the kcal
              figure sits a step below it, so the name reads as what the card IS. Name at headline;
              load is the workout's key figure, so it keeps bodyStrong — but under the name now,
              not in a competing right column. */}
          <Text style={{ ...TYPE.headline, color: colors.text }}>
            {exercise.name}
          </Text>
          <Text style={{ ...TYPE.bodyStrong, color: colors.text, marginTop: 2 }}>
            {loadText}
            {exercise.rest_sec ? (
              <Text style={{ ...TYPE.caption, color: colors.textSecondary, fontWeight: '500' }}>
                {`  ·  ${exercise.rest_sec}s dinlenme`}
              </Text>
            ) : null}
          </Text>
          {exercise.muscle_groups && exercise.muscle_groups.length > 0 ? (
            <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 1 }}>
              {exercise.muscle_groups.join(' · ')}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Form cues ("Dizler ayak yönünde, kontrollü in.") are read-to-act content, and the scale
          reserves 11px for things that are never that. Indented to the name column so it reads
          as part of the exercise, not a stray caption under the badge. */}
      {exercise.notes ? (
        <Text
          style={{
            ...TYPE.caption,
            color: colors.textSecondary,
            fontStyle: 'italic',
            marginTop: SPACING.xs,
            marginLeft: 40 + SPACING.md,
          }}
        >
          {exercise.notes}
        </Text>
      ) : null}

      {/* FIX (ux-ideas #19): "Bunu yaptım" — closes the track→mark loop on the workout side. */}
      {onLogPress ? (
        <View style={{ marginTop: SPACING.sm, marginLeft: 40 + SPACING.md }}>
          <PlanActionChip
            label={done ? 'Yapıldı' : logStatus === 'saving' ? 'Ekleniyor...' : 'Bunu yaptım'}
            icon="add-circle"
            filled
            done={done}
            saving={logStatus === 'saving'}
            onPress={onLogPress}
            accessibilityLabel={done ? 'Yapıldı olarak işaretlendi' : 'Bunu yaptım, günlüğe ekle'}
            accessibilityState={{ disabled: !!logStatus, busy: logStatus === 'saving' }}
          />
        </View>
      ) : null}
    </View>
  );
}

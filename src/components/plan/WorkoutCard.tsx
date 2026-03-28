/**
 * Workout Plan Card - displays the day's workout plan.
 * Shows warmup, main exercises (with set/rep/weight for strength),
 * cooldown, duration, RPE.
 */
import { View, Text } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface StrengthTarget {
  exercise: string;
  sets: number;
  reps: number;
  weight_kg: number;
}

interface WorkoutPlan {
  type: string;
  warmup: string;
  main: string[];
  cooldown: string;
  duration_min: number;
  rpe: number;
  heart_rate_zone?: string;
  strength_targets?: StrengthTarget[];
}

interface Props {
  plan: WorkoutPlan;
}

const TYPE_LABELS: Record<string, string> = {
  cardio: 'Kardiyo', strength: 'Guc', flexibility: 'Esneklik',
  mixed: 'Karma', sports: 'Spor', rest: 'Dinlenme',
};

export function WorkoutCard({ plan }: Props) {
  if (plan.type === 'rest') {
    return (
      <View style={{ backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
        <Text style={{ color: COLORS.success, fontSize: FONT.lg, fontWeight: '600' }}>Dinlenme Gunu</Text>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xs }}>
          Bugun aktif dinlenme gunu. Hafif yuruyus, esneme veya mobilite calismasi yapabilirsin.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
        <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '700' }}>
          {TYPE_LABELS[plan.type] ?? plan.type} Antrenman
        </Text>
        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
          <View style={{ backgroundColor: COLORS.surfaceLight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '600' }}>{plan.duration_min} dk</Text>
          </View>
          <View style={{ backgroundColor: COLORS.surfaceLight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ color: COLORS.warning, fontSize: FONT.xs, fontWeight: '600' }}>RPE {plan.rpe}/10</Text>
          </View>
        </View>
      </View>

      {/* Warmup */}
      <Section title="Isinma" color={COLORS.success}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{plan.warmup}</Text>
      </Section>

      {/* Main */}
      <Section title="Ana Bolum" color={COLORS.primary}>
        {plan.main.map((exercise, i) => (
          <View key={i} style={{ flexDirection: 'row', paddingVertical: 3 }}>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, width: 24 }}>{i + 1}.</Text>
            <Text style={{ color: COLORS.text, fontSize: FONT.sm, flex: 1, lineHeight: 20 }}>{exercise}</Text>
          </View>
        ))}
      </Section>

      {/* Strength targets */}
      {plan.strength_targets && plan.strength_targets.length > 0 && (
        <Section title="Guc Hedefleri" color={COLORS.warning}>
          {plan.strength_targets.map((st, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: i < plan.strength_targets!.length - 1 ? 1 : 0, borderBottomColor: COLORS.border }}>
              <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '500' }}>{st.exercise}</Text>
              <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600' }}>
                {st.sets}x{st.reps} @ {st.weight_kg}kg
              </Text>
            </View>
          ))}
        </Section>
      )}

      {/* Cooldown */}
      <Section title="Soguma" color={COLORS.success}>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{plan.cooldown}</Text>
      </Section>

      {/* Heart rate zone */}
      {plan.heart_rate_zone && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>Nabiz bolgesi: </Text>
          <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '600' }}>{plan.heart_rate_zone}</Text>
        </View>
      )}
    </View>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: SPACING.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.xs }}>
        <View style={{ width: 3, height: 14, backgroundColor: color, borderRadius: 2 }} />
        <Text style={{ color, fontSize: FONT.xs, fontWeight: '700', textTransform: 'uppercase' }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

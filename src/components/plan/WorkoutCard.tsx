/**
 * Workout Plan Card - Theme-aware modern design
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS, CARD_SHADOW } from '@/lib/constants';

interface StrengthTarget { exercise: string; sets: number; reps: number; weight_kg: number; }
interface WorkoutPlan { type: string; warmup: string; main: string[]; cooldown: string; duration_min: number; rpe: number; heart_rate_zone?: string; strength_targets?: StrengthTarget[]; }
interface Props { plan: WorkoutPlan; }

const TYPE_LABELS: Record<string, string> = { cardio: 'Kardiyo', strength: 'Güç', flexibility: 'Esneklik', mixed: 'Karma', sports: 'Spor', rest: 'Dinlenme' };
const TYPE_ICONS: Record<string, string> = { cardio: 'heart', strength: 'barbell', flexibility: 'body', mixed: 'fitness', sports: 'football', rest: 'bed' };

export function WorkoutCard({ plan }: Props) {
  const { colors, isDark } = useTheme();
  const cardStyle = { backgroundColor: colors.card, borderRadius: RADIUS.xxl, padding: SPACING.md, ...(isDark ? { borderWidth: 1, borderColor: colors.border } : CARD_SHADOW) };

  if (plan.type === 'rest') {
    return (
      <View style={cardStyle}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.success + '18', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="bed" size={22} color={colors.success} />
          </View>
          <View>
            <Text style={{ color: colors.success, fontSize: FONT.lg, fontWeight: '700' }}>Dinlenme Günü</Text>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 2 }}>Hafif yürüyüş veya esneme yapabilirsin.</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={cardStyle}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primary + '18', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={(TYPE_ICONS[plan.type] ?? 'fitness') as any} size={22} color={colors.primary} />
          </View>
          <Text style={{ color: colors.text, fontSize: FONT.lg, fontWeight: '700' }}>{TYPE_LABELS[plan.type] ?? plan.type}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
          <View style={{ backgroundColor: colors.primary + '15', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: colors.primary, fontSize: FONT.xs, fontWeight: '700' }}>{plan.duration_min} dk</Text>
          </View>
          <View style={{ backgroundColor: '#F59E0B18', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: '#F59E0B', fontSize: FONT.xs, fontWeight: '700' }}>RPE {plan.rpe}</Text>
          </View>
        </View>
      </View>

      <Section title="Isınma" color={colors.success} colors={colors}>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{plan.warmup}</Text>
      </Section>
      <Section title="Ana Bölüm" color={colors.primary} colors={colors}>
        {plan.main.map((ex, i) => (
          <View key={i} style={{ flexDirection: 'row', paddingVertical: 3 }}>
            <Text style={{ color: colors.textMuted, fontSize: FONT.sm, width: 24 }}>{i + 1}.</Text>
            <Text style={{ color: colors.text, fontSize: FONT.sm, flex: 1, lineHeight: 20 }}>{ex}</Text>
          </View>
        ))}
      </Section>
      {plan.strength_targets && plan.strength_targets.length > 0 && (
        <Section title="Güç Hedefleri" color="#F59E0B" colors={colors}>
          {plan.strength_targets.map((st, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: i < plan.strength_targets!.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.text, fontSize: FONT.sm, fontWeight: '500' }}>{st.exercise}</Text>
              <Text style={{ color: colors.primary, fontSize: FONT.sm, fontWeight: '700' }}>{st.sets}x{st.reps} @ {st.weight_kg}kg</Text>
            </View>
          ))}
        </Section>
      )}
      <Section title="Soğuma" color={colors.success} colors={colors}>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{plan.cooldown}</Text>
      </Section>
      {plan.heart_rate_zone && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.xs, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Ionicons name="heart" size={14} color={colors.error} />
          <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginLeft: 4 }}>Nabız: </Text>
          <Text style={{ color: colors.primary, fontSize: FONT.xs, fontWeight: '700' }}>{plan.heart_rate_zone}</Text>
        </View>
      )}
    </View>
  );
}

function Section({ title, color, colors, children }: { title: string; color: string; colors: any; children: React.ReactNode }) {
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

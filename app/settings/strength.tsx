/**
 * Strength Progression Screen — Spec 7.5, 23
 * Core exercise tracking with 1RM estimates, history, deload warnings,
 * progression suggestions, and personal records.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { getExerciseHistory, estimate1RM, shouldDeload, suggestProgression, type ExerciseHistory } from '@/services/strength.service';
import { Card, EmptyState } from '@/components/ui/Card';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';

const CORE_EXERCISES = ['squat', 'bench_press', 'deadlift', 'overhead_press', 'barbell_row'];
const EXERCISE_LABELS: Record<string, string> = {
  squat: 'Squat', bench_press: 'Bench Press', deadlift: 'Deadlift',
  overhead_press: 'Overhead Press', barbell_row: 'Barbell Row',
};

export default function StrengthScreen() {
  const user = useAuthStore(s => s.user);
  const [exercises, setExercises] = useState<(ExerciseHistory | null)[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!user?.id) return;
    setLoading(true);
    Promise.all(CORE_EXERCISES.map(e => getExerciseHistory(user.id, e)))
      .then(results => { setExercises(results); setLoading(false); });
  };

  useEffect(() => { load(); }, [user?.id]);

  const validExercises = exercises.filter((e): e is ExerciseHistory => e !== null && e.history.length > 0);

  // Calculate overall stats
  const totalPRs = validExercises.length; // Each exercise with data has a "current max"
  const bestExercise = validExercises.length > 0
    ? validExercises.reduce((best, ex) => ex.estimated1RM > (best?.estimated1RM ?? 0) ? ex : best)
    : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={COLORS.primary} />}
    >
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Guc Progresyon</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>
        Temel hareketlerin takibi, 1RM tahminleri ve progresyon onerileri.
      </Text>

      {/* Summary stats */}
      {validExercises.length > 0 && (
        <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg }}>
          <StatCard label="Takip Edilen" value={`${validExercises.length}`} />
          <StatCard label="En Guclu" value={bestExercise ? `${EXERCISE_LABELS[bestExercise.exercise] ?? bestExercise.exercise}` : '-'} small />
          <StatCard label="En Yuksek 1RM" value={bestExercise ? `${bestExercise.estimated1RM}kg` : '-'} />
        </View>
      )}

      {validExercises.length === 0 ? (
        <Card>
          <EmptyState message='Henuz guc antrenman kaydi yok. Kocuna "squat 3x8 80kg yaptim" yaz veya Plan ekraninda set kaydet.' />
        </Card>
      ) : (
        validExercises.map(ex => {
          const deload = shouldDeload(ex.weeksSinceDeload);
          const progression = ex.history.length >= 2
            ? suggestProgression(ex.lastWeight, ex.lastReps, ex.lastReps, ex.history.length >= 2 ? 2 : 0)
            : null;

          return (
            <Card key={ex.exercise} title={EXERCISE_LABELS[ex.exercise] ?? ex.exercise}>
              {/* Stats row */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: SPACING.md }}>
                <StatPill label="1RM" value={`${ex.estimated1RM}kg`} color={COLORS.primary} />
                <StatPill label="Son" value={`${ex.lastWeight}kg`} color={COLORS.text} />
                <StatPill label="Rep" value={`${ex.lastReps}`} color={COLORS.text} />
                <StatPill label="Seans" value={`${ex.history.length}`} color={COLORS.textSecondary} />
              </View>

              {/* Progression suggestion */}
              {progression && (
                <View style={{
                  backgroundColor: COLORS.success + '15', borderRadius: RADIUS.sm,
                  padding: SPACING.sm, marginBottom: SPACING.sm,
                  borderLeftWidth: 3, borderLeftColor: COLORS.success,
                }}>
                  <Text style={{ color: COLORS.success, fontSize: FONT.sm, fontWeight: '600' }}>
                    Progresyon onerisi: {progression.weight}kg x {progression.reps} rep
                  </Text>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginTop: 2 }}>
                    {progression.note}
                  </Text>
                </View>
              )}

              {/* History (last 8 sessions) */}
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.xs, textTransform: 'uppercase' }}>
                Gecmis
              </Text>
              {ex.history.slice(0, 8).map((h, i) => {
                const rm = estimate1RM(h.weight_kg, h.reps);
                const prevRM = i < ex.history.length - 1 ? estimate1RM(ex.history[i + 1].weight_kg, ex.history[i + 1].reps) : rm;
                const trend = rm > prevRM ? '↑' : rm < prevRM ? '↓' : '=';
                const trendColor = rm > prevRM ? COLORS.success : rm < prevRM ? COLORS.error : COLORS.textMuted;

                return (
                  <View key={i} style={{
                    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                    paddingVertical: SPACING.xs, borderBottomWidth: i < Math.min(7, ex.history.length - 1) ? 1 : 0,
                    borderBottomColor: COLORS.border,
                  }}>
                    <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, width: 60 }}>
                      {new Date(h.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                    </Text>
                    <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: '500', flex: 1 }}>
                      {h.weight_kg}kg x {h.reps} ({h.sets} set)
                    </Text>
                    <Text style={{ color: trendColor, fontSize: FONT.sm, width: 70, textAlign: 'right' }}>
                      {trend} {rm}kg
                    </Text>
                  </View>
                );
              })}

              {/* Deload warning */}
              {deload.needed && (
                <View style={{
                  marginTop: SPACING.sm, padding: SPACING.sm, backgroundColor: COLORS.warning + '15',
                  borderRadius: RADIUS.sm, borderLeftWidth: 3, borderLeftColor: COLORS.warning,
                }}>
                  <Text style={{ color: COLORS.warning, fontSize: FONT.sm, fontWeight: '600' }}>Deload Onerisi</Text>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, marginTop: 2 }}>{deload.message}</Text>
                </View>
              )}
            </Card>
          );
        })
      )}

      <Card>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, lineHeight: 18, textAlign: 'center' }}>
          1RM tahminleri Epley formulu ile hesaplanir. Gercek 1RM denemenizi once kocunuzla konusun.
          Progresyon: 2 ardisik seansta hedef tutturulursa +2.5kg onerisi gelir.
        </Text>
      </Card>
    </ScrollView>
  );
}

function StatCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.sm, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}>
      <Text style={{ color: COLORS.primary, fontSize: small ? FONT.sm : FONT.lg, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color, fontSize: FONT.lg, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>{label}</Text>
    </View>
  );
}

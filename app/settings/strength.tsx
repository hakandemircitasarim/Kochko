import { useState, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useAuthStore } from '@/stores/auth.store';
import { getExerciseHistory, estimate1RM, shouldDeload, suggestProgression, detectPlateauByExercise, type ExerciseHistory } from '@/services/strength.service';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const CORE_EXERCISES = ['squat', 'bench_press', 'deadlift', 'overhead_press', 'barbell_row'];
const EXERCISE_LABELS: Record<string, string> = {
  squat: 'Squat', bench_press: 'Bench Press', deadlift: 'Deadlift',
  overhead_press: 'Overhead Press', barbell_row: 'Barbell Row',
};

export default function StrengthScreen() {
  const user = useAuthStore(s => s.user);
  const [exercises, setExercises] = useState<(ExerciseHistory | null)[]>([]);
  const [plateaus, setPlateaus] = useState<Record<string, { plateau: boolean; weeks: number; maxWeight: number; message: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    Promise.all(CORE_EXERCISES.map(e => getExerciseHistory(user.id, e)))
      .then(results => { setExercises(results); setLoading(false); });
    // Load plateau detection for each exercise
    Promise.all(CORE_EXERCISES.map(async e => {
      const result = await detectPlateauByExercise(user.id, e);
      return { exercise: e, result };
    })).then(results => {
      const map: Record<string, typeof results[0]['result']> = {};
      for (const r of results) map[r.exercise] = r.result;
      setPlateaus(map);
    });
  }, [user?.id]);

  const validExercises = exercises.filter((e): e is ExerciseHistory => e !== null);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Guc Progresyon</Text>
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>Temel hareketlerin takibi ve 1RM tahminleri.</Text>

      {validExercises.length === 0 ? (
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.xl }}>
            Henuz guc antrenman kaydi yok. Kocuna "squat 3x8 80kg yaptim" gibi yazarak kayit girebilirsin.
          </Text>
        </Card>
      ) : (
        validExercises.map(ex => {
          const deload = shouldDeload(ex.weeksSinceDeload);
          const progression = suggestProgression(ex.lastWeight, ex.lastReps, 8, ex.history.length >= 2 && ex.history[ex.history.length - 1].reps >= 8 && ex.history[ex.history.length - 2].reps >= 8 ? 2 : 1);
          const plateau = plateaus[ex.exercise];
          return (
            <Card key={ex.exercise} title={EXERCISE_LABELS[ex.exercise] ?? ex.exercise}>
              {/* 1RM and current */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: SPACING.md }}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: COLORS.primary, fontSize: FONT.xl, fontWeight: '700' }}>{ex.estimated1RM}kg</Text>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>Tahmini 1RM</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.xl, fontWeight: '700' }}>{ex.lastWeight}kg</Text>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>Son agirlik</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.xl, fontWeight: '700' }}>{ex.lastReps}</Text>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>Son rep</Text>
                </View>
              </View>

              {/* Progression suggestion */}
              <View style={{ marginBottom: SPACING.md, padding: SPACING.sm, backgroundColor: COLORS.primary + '10', borderRadius: 8, borderLeftWidth: 3, borderLeftColor: COLORS.primary }}>
                <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600', marginBottom: 2 }}>Sonraki hedef: {progression.weight}kg x {progression.reps}</Text>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>{progression.note}</Text>
              </View>

              {/* History */}
              {ex.history.map((h, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>
                    {new Date(h.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                  </Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.sm }}>{h.weight_kg}kg x {h.reps} ({h.sets} set)</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>1RM: {estimate1RM(h.weight_kg, h.reps)}kg</Text>
                </View>
              ))}

              {/* Plateau warning */}
              {plateau?.plateau && (
                <View style={{ marginTop: SPACING.sm, padding: SPACING.sm, backgroundColor: COLORS.error + '10', borderRadius: 8, borderLeftWidth: 3, borderLeftColor: COLORS.error }}>
                  <Text style={{ color: COLORS.error, fontSize: FONT.sm }}>{plateau.message}</Text>
                </View>
              )}

              {/* Deload warning */}
              {deload.message ? (
                <View style={{ marginTop: SPACING.sm, padding: SPACING.sm, backgroundColor: COLORS.surfaceLight, borderRadius: 8, borderLeftWidth: 3, borderLeftColor: deload.needed ? COLORS.warning : COLORS.textMuted }}>
                  <Text style={{ color: deload.needed ? COLORS.warning : COLORS.textMuted, fontSize: FONT.sm }}>{deload.message}</Text>
                </View>
              ) : null}
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

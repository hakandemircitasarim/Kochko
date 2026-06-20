import { useState, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { getExerciseHistory, estimate1RM, shouldDeload, suggestProgression, detectPlateauByExercise, type ExerciseHistory } from '@/services/strength.service';
import { Card } from '@/components/ui/Card';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { COLORS, SPACING, FONT } from '@/lib/constants';

const CORE_EXERCISES = ['squat', 'bench_press', 'deadlift', 'overhead_press', 'barbell_row'];
const EXERCISE_LABELS: Record<string, string> = {
  squat: 'Squat', bench_press: 'Bench Press', deadlift: 'Deadlift',
  overhead_press: 'Overhead Press', barbell_row: 'Barbell Row',
};

export default function StrengthScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const [exercises, setExercises] = useState<(ExerciseHistory | null)[]>([]);
  const [plateaus, setPlateaus] = useState<Record<string, { plateau: boolean; weeks: number; maxWeight: number; message: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    // FIX (audit strength-screen): .catch yoktu — ağ hatasında setLoading(false)
    // hiç çağrılmıyor ve loading hiç okunmadığından yanlış 'kayıt yok' boş-durumu
    // flaşlanıyordu. Hatada da loading'i kapat.
    Promise.all(CORE_EXERCISES.map(e => getExerciseHistory(user.id, e)))
      .then(results => { setExercises(results); setLoading(false); })
      .catch(() => setLoading(false));
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
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit duplicate-title): native header (settings/_layout.tsx) zaten "Güç Progresyon"
          başlığını gösteriyor; gövdedeki H1 çift başlıktı, kaldırıldı. */}
      <Text style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>Temel hareketlerin takibi ve 1RM tahminleri.</Text>

      {/* FIX (audit strength-screen): veri gelmeden / hata anında 'kayıt yok' flaşını önle. */}
      {loading ? (
        <SkeletonCard lines={4} />
      ) : validExercises.length === 0 ? (
        <Card>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', paddingVertical: SPACING.xl }}>
            Henüz güç antrenman kaydı yok. Koçuna "squat 3x8 80kg yaptım" gibi yazarak kayıt girebilirsin.
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
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs }}>Son ağırlık</Text>
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

import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { useState, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { getExerciseHistory, estimate1RM, shouldDeload, suggestProgression, detectPlateauByExercise, type ExerciseHistory } from '@/services/strength.service';
import { Card } from '@/components/ui/Card';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { SPACING, FONT } from '@/lib/constants';
import { useTheme } from '@/lib/theme';
import { usePremium } from '@/hooks/usePremium';
import { useProfileStore } from '@/stores/profile.store';

const CORE_EXERCISES = ['squat', 'bench_press', 'deadlift', 'overhead_press', 'barbell_row'];
const EXERCISE_LABELS: Record<string, string> = {
  squat: 'Squat', bench_press: 'Bench Press', deadlift: 'Deadlift',
  overhead_press: 'Overhead Press', barbell_row: 'Barbell Row',
};

export default function StrengthScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  // FIX (audit UX-PRM-06): ekranın kendisi premium-koruması yapsın — menü ternary'sine güvenme
  // (deep link / chat navigate / deneme bitişi free kullanıcıyı içeride bırakıyordu).
  const { isPremium } = usePremium();
  const profileLoading = useProfileStore(s => s.loading);
  const profile = useProfileStore(s => s.profile);
  const [exercises, setExercises] = useState<(ExerciseHistory | null)[]>([]);
  const [plateaus, setPlateaus] = useState<Record<string, { plateau: boolean; weeks: number; maxWeight: number; message: string }>>({});
  const [loading, setLoading] = useState(true);

  // FIX (audit UX-PRM-06): profil çözüldükten sonra premium değilse paywall'a yönlendir
  // (profil null/yükleniyorken yönlendirme yok — geçici null premium kullanıcıyı atmasın).
  useEffect(() => {
    if (!profileLoading && profile !== null && !isPremium) {
      router.replace('/settings/premium');
    }
  }, [profileLoading, profile, isPremium, router]);

  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!user?.id) return;
    // FIX (audit strength-screen): .catch yoktu — ağ hatasında setLoading(false)
    // hiç çağrılmıyor ve loading hiç okunmadığından yanlış 'kayıt yok' boş-durumu
    // flaşlanıyordu. Hatada da loading'i kapat.
    setLoadError(false);
    Promise.all(CORE_EXERCISES.map(e => getExerciseHistory(user.id, e)))
      .then(results => { setExercises(results); setLoading(false); })
      // ux-sweep (ST-01): sessiz kapatma 'kayıt yok' yalanına düşürüyordu — dürüst hata + retry.
      .catch(() => { setLoadError(true); setLoading(false); });
    // Load plateau detection for each exercise
    Promise.all(CORE_EXERCISES.map(async e => {
      const result = await detectPlateauByExercise(user.id, e);
      return { exercise: e, result };
    })).then(results => {
      const map: Record<string, typeof results[0]['result']> = {};
      for (const r of results) map[r.exercise] = r.result;
      setPlateaus(map);
    });
  }, [user?.id, reloadKey]);

  const validExercises = exercises.filter((e): e is ExerciseHistory => e !== null);

  // FIX (audit UX-PRM-06): premium olmayan kullanıcıya içerik gösterme — yönlendirme efekti devredeyken boş ekran.
  if (!isPremium && profile !== null && !profileLoading) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  if (loadError) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md }}>
        <Card><LoadErrorState embedded title="Güç kayıtları yüklenemedi" onRetry={() => { setLoading(true); setReloadKey(k => k + 1); }} /></Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }}>
      {/* FIX (audit duplicate-title): native header (settings/_layout.tsx) zaten "Güç Progresyon"
          başlığını gösteriyor; gövdedeki H1 çift başlıktı, kaldırıldı. */}
      <Text style={{ fontSize: FONT.sm, color: colors.textSecondary, marginBottom: SPACING.lg }}>Temel hareketlerin takibi ve 1RM tahminleri.</Text>

      {/* FIX (audit strength-screen): veri gelmeden / hata anında 'kayıt yok' flaşını önle. */}
      {loading ? (
        <SkeletonCard lines={4} />
      ) : validExercises.length === 0 ? (
        <Card>
          {/* FIX (ux-polish): iconed empty state to match the app's empty-state pattern. */}
          <View style={{ alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.sm }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceLight, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="barbell-outline" size={26} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700', textAlign: 'center' }}>Henüz güç kaydın yok</Text>
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, textAlign: 'center' }}>Koçuna "squat 3x8 80kg yaptım" gibi yazarak kayıt girebilirsin.</Text>
          </View>
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
                  <Text style={{ color: colors.primary, fontSize: FONT.xl, fontWeight: '700' }}>{ex.estimated1RM}kg</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>Tahmini 1RM</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontSize: FONT.xl, fontWeight: '700' }}>{ex.lastWeight}kg</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>Son ağırlık</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontSize: FONT.xl, fontWeight: '700' }}>{ex.lastReps}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>Son rep</Text>
                </View>
              </View>

              {/* Progression suggestion */}
              <View style={{ marginBottom: SPACING.md, padding: SPACING.sm, backgroundColor: colors.primary + '10', borderRadius: 8, borderLeftWidth: 3, borderLeftColor: colors.primary }}>
                <Text style={{ color: colors.primary, fontSize: FONT.sm, fontWeight: '600', marginBottom: 2 }}>Sonraki hedef: {progression.weight}kg x {progression.reps}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: FONT.xs }}>{progression.note}</Text>
              </View>

              {/* History */}
              {ex.history.map((h, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.textSecondary, fontSize: FONT.sm }}>
                    {new Date(h.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                  </Text>
                  <Text style={{ color: colors.text, fontSize: FONT.sm }}>{h.weight_kg}kg x {h.reps} ({h.sets} set)</Text>
                  <Text style={{ color: colors.textMuted, fontSize: FONT.xs }}>1RM: {estimate1RM(h.weight_kg, h.reps)}kg</Text>
                </View>
              ))}

              {/* Plateau warning */}
              {plateau?.plateau && (
                <View style={{ marginTop: SPACING.sm, padding: SPACING.sm, backgroundColor: colors.error + '10', borderRadius: 8, borderLeftWidth: 3, borderLeftColor: colors.error }}>
                  <Text style={{ color: colors.error, fontSize: FONT.sm }}>{plateau.message}</Text>
                </View>
              )}

              {/* Deload warning */}
              {deload.message ? (
                <View style={{ marginTop: SPACING.sm, padding: SPACING.sm, backgroundColor: colors.surfaceLight, borderRadius: 8, borderLeftWidth: 3, borderLeftColor: deload.needed ? colors.warning : colors.textMuted }}>
                  <Text style={{ color: deload.needed ? colors.warning : colors.textMuted, fontSize: FONT.sm }}>{deload.message}</Text>
                </View>
              ) : null}
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

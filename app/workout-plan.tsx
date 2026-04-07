/**
 * Workout Plan Detail — current workout + past programs
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { getEffectiveDate } from '@/lib/day-boundary';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { SPACING, RADIUS } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import { getExerciseHistory, suggestProgression, shouldDeload } from '@/services/strength.service';

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

interface PlanData {
  date: string;
  plan_type: string;
  workout_plan: WorkoutPlan | null;
  status: string;
}

export default function WorkoutPlanScreen() {
  const { colors } = useTheme();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const dayBoundaryHour = profile?.day_boundary_hour as number ?? 4;
  const today = getEffectiveDate(new Date(), dayBoundaryHour);

  const [currentPlan, setCurrentPlan] = useState<PlanData | null>(null);
  const [pastPlans, setPastPlans] = useState<PlanData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [completedSets, setCompletedSets] = useState<Set<string>>(new Set());
  const [progressionMap, setProgressionMap] = useState<Record<string, { weight: number; reps: number; note: string }>>({});
  const [deloadWarning, setDeloadWarning] = useState<{ needed: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    loadPlans();
  }, [user?.id]);

  const loadPlans = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data: current } = await supabase.from('daily_plans').select('date, plan_type, workout_plan, status')
      .eq('user_id', user.id).eq('date', today)
      .order('version', { ascending: false }).limit(1).single();
    if (current) setCurrentPlan(current as unknown as PlanData);

    const { data: past } = await supabase.from('daily_plans').select('date, plan_type, workout_plan, status')
      .eq('user_id', user.id).neq('date', today).not('workout_plan', 'is', null)
      .order('date', { ascending: false }).limit(14);
    if (past) setPastPlans(past as unknown as PlanData[]);
    setLoading(false);
  };

  // Load strength progression suggestions for each exercise in the plan
  useEffect(() => {
    if (!user?.id || !currentPlan?.workout_plan?.strength_targets?.length) return;
    const targets = currentPlan.workout_plan.strength_targets;
    Promise.all(targets.map(async (st) => {
      const history = await getExerciseHistory(user.id, st.exercise, 8);
      if (!history) return null;
      const consecutiveSuccesses = history.history.length >= 2
        && history.history[history.history.length - 1].reps >= st.reps
        && history.history[history.history.length - 2].reps >= st.reps ? 2 : 1;
      const prog = suggestProgression(history.lastWeight, history.lastReps, st.reps, consecutiveSuccesses);
      const deload = shouldDeload(history.weeksSinceDeload);
      return { exercise: st.exercise, progression: prog, deload };
    })).then(results => {
      const map: Record<string, { weight: number; reps: number; note: string }> = {};
      let worstDeload: { needed: boolean; message: string } | null = null;
      for (const r of results) {
        if (!r) continue;
        map[r.exercise] = r.progression;
        if (r.deload.needed || (r.deload.message && !worstDeload)) {
          worstDeload = r.deload;
        }
      }
      setProgressionMap(map);
      if (worstDeload) setDeloadWarning(worstDeload);
    });
  }, [user?.id, currentPlan]);

  const toggleSet = (key: string) => {
    setCompletedSets(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const wp = currentPlan?.workout_plan;

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: SPACING.xl, paddingBottom: 100 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.xxl }}>
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: SPACING.md }}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>Spor Programı</Text>
        </View>

        {wp ? (
          <>
            {/* Workout summary card */}
            <View style={{
              backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg,
              marginBottom: SPACING.md, borderWidth: 0.5, borderColor: colors.border,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.md }}>
                <View style={{
                  width: 44, height: 44, borderRadius: RADIUS.sm,
                  backgroundColor: METRIC_COLORS.workout + '18',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Ionicons name="barbell" size={22} color={METRIC_COLORS.workout} />
                </View>
                <View>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{wp.type}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                    {wp.duration_min} dk \u00b7 RPE {wp.rpe}
                    {wp.heart_rate_zone ? ` \u00b7 ${wp.heart_rate_zone}` : ''}
                  </Text>
                </View>
              </View>
            </View>

            {/* Warmup */}
            {wp.warmup && (
              <SectionCard title="Isınma" colors={colors}>
                <Text style={{ color: colors.text, fontSize: 13, lineHeight: 20 }}>{wp.warmup}</Text>
              </SectionCard>
            )}

            {/* Main exercises */}
            <SectionCard title="Ana bölüm" colors={colors}>
              {wp.main?.map((exercise, idx) => (
                <View key={idx} style={{
                  flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
                  paddingVertical: SPACING.sm,
                  borderBottomWidth: idx < wp.main.length - 1 ? 0.5 : 0,
                  borderBottomColor: colors.border,
                }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, width: 20 }}>{idx + 1}.</Text>
                  <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>{exercise}</Text>
                </View>
              ))}
            </SectionCard>

            {/* Deload warning */}
            {deloadWarning?.message && (
              <View style={{
                backgroundColor: deloadWarning.needed ? (METRIC_COLORS.workout + '18') : (colors.card),
                borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md,
                borderWidth: 0.5, borderColor: deloadWarning.needed ? METRIC_COLORS.workout : colors.border,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                  <Ionicons name={deloadWarning.needed ? 'warning' : 'information-circle'} size={18} color={deloadWarning.needed ? METRIC_COLORS.workout : colors.textMuted} />
                  <Text style={{ color: deloadWarning.needed ? METRIC_COLORS.workout : colors.textSecondary, fontSize: 12, flex: 1 }}>{deloadWarning.message}</Text>
                </View>
              </View>
            )}

            {/* Strength targets */}
            {wp.strength_targets && wp.strength_targets.length > 0 && (
              <SectionCard title="Guc hedefleri" colors={colors}>
                {/* Table header */}
                <View style={{ flexDirection: 'row', paddingBottom: SPACING.sm, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
                  <Text style={{ flex: 2, color: colors.textMuted, fontSize: 11 }}>Egzersiz</Text>
                  <Text style={{ flex: 1, color: colors.textMuted, fontSize: 11, textAlign: 'center' }}>Set</Text>
                  <Text style={{ flex: 1, color: colors.textMuted, fontSize: 11, textAlign: 'center' }}>Tekrar</Text>
                  <Text style={{ flex: 1, color: colors.textMuted, fontSize: 11, textAlign: 'center' }}>Kg</Text>
                  <View style={{ width: 28 }} />
                </View>
                {wp.strength_targets.map((st, idx) => {
                  const key = `${st.exercise}-${idx}`;
                  const done = completedSets.has(key);
                  const prog = progressionMap[st.exercise];
                  return (
                    <View key={idx}>
                      <TouchableOpacity
                        onPress={() => toggleSet(key)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm,
                          borderBottomWidth: (!prog && idx < (wp.strength_targets?.length ?? 0) - 1) ? 0.5 : 0,
                          borderBottomColor: colors.border,
                          opacity: done ? 0.5 : 1,
                        }}
                      >
                        <Text style={{ flex: 2, color: colors.text, fontSize: 13, textDecorationLine: done ? 'line-through' : 'none' }}>{st.exercise}</Text>
                        <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{st.sets}</Text>
                        <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{st.reps}</Text>
                        <Text style={{ flex: 1, color: METRIC_COLORS.workout, fontSize: 13, textAlign: 'center', fontWeight: '600' }}>{st.weight_kg}</Text>
                        <View style={{ width: 28, alignItems: 'center' }}>
                          <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={done ? colors.primary : colors.textMuted} />
                        </View>
                      </TouchableOpacity>
                      {prog && (
                        <View style={{
                          paddingHorizontal: SPACING.sm, paddingVertical: 4, marginBottom: SPACING.xs,
                          borderBottomWidth: idx < (wp.strength_targets?.length ?? 0) - 1 ? 0.5 : 0,
                          borderBottomColor: colors.border,
                        }}>
                          <Text style={{ color: colors.primary, fontSize: 11 }}>
                            Sonraki: {prog.weight}kg x {prog.reps} - {prog.note}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </SectionCard>
            )}

            {/* Cooldown */}
            {wp.cooldown && (
              <SectionCard title="Soğuma" colors={colors}>
                <Text style={{ color: colors.text, fontSize: 13, lineHeight: 20 }}>{wp.cooldown}</Text>
              </SectionCard>
            )}

            {/* Complete button */}
            <Button
              title="Antrenmanı tamamla"
              onPress={() => router.push({ pathname: '/(tabs)/chat', params: { prefill: 'Antrenmanı tamamladım' } })}
              style={{ marginTop: SPACING.md }}
              size="lg"
            />
          </>
        ) : (
          <View style={{
            backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.xxl,
            alignItems: 'center', borderWidth: 0.5, borderColor: colors.border, marginBottom: SPACING.md,
          }}>
            <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: SPACING.md }}>
              {currentPlan?.plan_type === 'rest' ? 'Bugün dinlenme günü' : 'Antrenman planlanmamış'}
            </Text>
            {currentPlan?.plan_type !== 'rest' && (
              <Button
                title="Plan oluştur"
                variant="outline"
                onPress={() => router.push({ pathname: '/(tabs)/chat', params: { prefill: 'Bugünkü antrenman planını oluştur' } })}
              />
            )}
          </View>
        )}

        {/* Past workouts */}
        <TouchableOpacity
          onPress={() => setShowHistory(!showHistory)}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.md, marginTop: SPACING.md }}
        >
          <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Geçmiş antrenmanlar ({pastPlans.length})
          </Text>
          <Ionicons name={showHistory ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
        </TouchableOpacity>

        {showHistory && pastPlans.map((p, idx) => (
          <View key={idx} style={{
            backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg,
            marginBottom: SPACING.sm, borderWidth: 0.5, borderColor: colors.border,
          }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '500' }}>{p.date}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
              {p.workout_plan?.type ?? 'Antrenman'}
              {p.workout_plan?.duration_min ? ` \u00b7 ${p.workout_plan.duration_min} dk` : ''}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function SectionCard({ title, colors, children }: { title: string; colors: any; children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.lg,
      marginBottom: SPACING.md, borderWidth: 0.5, borderColor: colors.border,
    }}>
      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.md }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

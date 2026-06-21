import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { validateWeeklyRate } from '@/lib/tdee';
import { calculateGoalProgress, getGoalSummaryText, validateGoalSafety } from '@/lib/goal-progress';
import {
  getGoalPhases, addPhase, getAIGoalSuggestions, checkGoalCompatibility,
  calculatePhaseTransition, checkAggressiveGoal,
  type GoalSuggestion, type GoalPhase,
} from '@/services/goals.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { TempoChart } from '@/components/plan/TempoChart';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import type { Goal } from '@/types/database';

type GoalType = 'lose_weight' | 'gain_weight' | 'gain_muscle' | 'health' | 'maintain' | 'conditioning';
const GOAL_LABELS: Record<GoalType, string> = {
  lose_weight: 'Kilo Ver', gain_weight: 'Kilo Al', gain_muscle: 'Kas Kazan',
  health: 'Sağlık', maintain: 'Koru', conditioning: 'Kondisyon',
};

export default function GoalsScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const [goalType, setGoalType] = useState<GoalType>('lose_weight');
  const [targetWeight, setTargetWeight] = useState('');
  const [targetWeeks, setTargetWeeks] = useState('12');
  const [saving, setSaving] = useState(false);
  const [existingGoal, setExistingGoal] = useState<Goal | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<GoalSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [compatWarning, setCompatWarning] = useState<string | null>(null);
  const [phaseTransitionInfo, setPhaseTransitionInfo] = useState<string | null>(null);
  const [allPhases, setAllPhases] = useState<GoalPhase[]>([]);
  const [aggressiveWarning, setAggressiveWarning] = useState<string | null>(null);
  const [tempoData, setTempoData] = useState<{ points: { date: string; kg: number }[]; startWeight: number; goalStartDate: string } | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    getGoalPhases(user.id).then(async phases => {
      setAllPhases(phases);
      const active = phases.find(p => p.is_active);
      if (active) {
        setExistingGoal(active as unknown as Goal);
        setGoalType(active.goal_type as GoalType);
        setTargetWeight(String(active.target_weight_kg ?? ''));
        setTargetWeeks(String(active.target_weeks ?? 12));

        // Load tempo data: weight points since goal creation
        const goalStartDate = (active as unknown as { created_at: string; start_weight_kg: number | null }).created_at.split('T')[0];
        const { data: weights } = await supabase
          .from('daily_metrics')
          .select('date, weight_kg')
          .eq('user_id', user.id)
          .not('weight_kg', 'is', null)
          .gte('date', goalStartDate)
          .order('date');
        const startWeight = (active as unknown as { start_weight_kg: number | null }).start_weight_kg ?? (weights?.[0]?.weight_kg as number) ?? (profile?.weight_kg ?? 70);
        const points = (weights ?? []).map((w: { date: string; weight_kg: number }) => ({ date: w.date, kg: w.weight_kg }));
        setTempoData({ points, startWeight, goalStartDate });
      }
    });
  }, [user?.id]);

  // D19: Check goal compatibility when type changes
  useEffect(() => {
    if (existingGoal && goalType !== existingGoal.goal_type) {
      const compat = checkGoalCompatibility(goalType, existingGoal.goal_type as string);
      if (!compat.compatible || compat.level === 'warning') {
        setCompatWarning(compat.message_tr);
      } else {
        setCompatWarning(null);
      }

      // D5: Calculate phase transition if switching goal type
      if (profile?.calorie_range_rest_min && profile?.calorie_range_rest_max) {
        const currentCal = {
          min: profile.calorie_range_rest_min as number,
          max: profile.calorie_range_rest_max as number,
        };
        // Estimate next phase calories based on goal type
        const tdee = (profile.tdee_calculated as number) ?? 2000;
        const nextCal = goalType === 'lose_weight'
          ? { min: Math.round(tdee * 0.8), max: Math.round(tdee * 0.9) }
          : goalType === 'gain_weight' || goalType === 'gain_muscle'
            ? { min: Math.round(tdee * 1.05), max: Math.round(tdee * 1.15) }
            : { min: Math.round(tdee * 0.95), max: Math.round(tdee * 1.05) };

        const transition = calculatePhaseTransition(currentCal, nextCal, 1, 7);
        setPhaseTransitionInfo(
          `Faz geçişi: 7 gün içinde kademeli olarak ${currentCal.min}-${currentCal.max} kcal'den ${nextCal.min}-${nextCal.max} kcal'e geçilecek.`
        );
      }
    } else {
      setCompatWarning(null);
      setPhaseTransitionInfo(null);
    }
  }, [goalType, existingGoal, profile]);

  // D18: Fetch AI goal suggestions
  const handleFetchAISuggestions = async () => {
    if (!user?.id) return;
    setLoadingSuggestions(true);
    const suggestions = await getAIGoalSuggestions(
      user.id,
      (profile?.weight_kg as number) ?? null,
      existingGoal?.target_weight_kg ?? null,
    );
    setAiSuggestions(suggestions);
    setLoadingSuggestions(false);
  };

  // FIX (audit UX-FRM-02): decimal-pad tr-TR Android'de virgül üretir ('70,5'); çıplak
  // parseFloat virgülde kesip 70 döndürür. Tek noktada normalize + makul aralık (30-300 kg)
  // koruması; aynı değer tempo gösterimi, agresif kontrol ve handleSave'de tekrar kullanılır.
  const parsedTargetWeight = (() => {
    const n = parseFloat(targetWeight.replace(',', '.'));
    return Number.isFinite(n) && n >= 30 && n <= 300 ? n : null;
  })();

  // Safety check for weekly rate
  const weeklyRate = parsedTargetWeight && profile?.weight_kg
    ? Math.abs((profile.weight_kg as number) - parsedTargetWeight) / (parseInt(targetWeeks) || 12)
    : 0;
  const safety = validateGoalSafety(goalType, weeklyRate, profile?.weight_kg as number ?? 70, profile?.height_cm as number | null);

  // Progress for existing goal
  const progress = existingGoal && profile?.weight_kg
    ? calculateGoalProgress(existingGoal, profile.weight_kg as number, existingGoal.start_weight_kg ?? (profile.weight_kg as number))
    : null;
  const summaryText = progress ? getGoalSummaryText(progress, goalType) : null;

  // Check aggressive goal rate when target weight or weeks change
  useEffect(() => {
    // FIX (audit UX-FRM-02): virgül-normalize edilmiş tek değeri kullan (çıplak parseFloat değil).
    const tw = parsedTargetWeight;
    const weeks = parseInt(targetWeeks) || 12;
    if (tw && profile?.weight_kg && (goalType === 'lose_weight' || goalType === 'gain_weight')) {
      const rate = Math.abs((profile.weight_kg as number) - tw) / weeks;
      const aggressive = checkAggressiveGoal(rate, profile.weight_kg as number, profile?.gender as string ?? null);
      setAggressiveWarning(aggressive.warning);
    } else {
      setAggressiveWarning(null);
    }
  }, [parsedTargetWeight, targetWeeks, goalType, profile]);

  const handleSave = async () => {
    if (!user?.id) return;
    // FIX (audit UX-FRM-02): virgül-normalize + aralık-korumalı tek değer; validateWeeklyRate
    // ve addPhase artık bozuk sayı yerine doğru kiloyu (ya da geçersizse null) alır.
    const tw = parsedTargetWeight;
    const weeks = parseInt(targetWeeks) || 12;

    if (tw && profile?.weight_kg && (goalType === 'lose_weight' || goalType === 'gain_weight')) {
      const check = validateWeeklyRate(profile.weight_kg, tw, weeks);
      if (!check.valid) { Alert.alert('Dikkat', check.message); return; }
    }

    // Check compatibility with existing active goals
    if (existingGoal && goalType !== existingGoal.goal_type) {
      const compat = checkGoalCompatibility(goalType, existingGoal.goal_type as string);
      if (!compat.compatible) {
        Alert.alert('Hedef Çelişkisi', compat.message_tr);
        return;
      }
    }

    setSaving(true);
    // FIX (audit settings-save-guards): iki ardışık await try/catch'siz çalışıyordu —
    // biri throw ederse setSaving(false) hiç çalışmaz, Button kalıcı spinner'da kilitlenir
    // ve kullanıcıya hata gösterilmezdi. finally + Türkçe hata Alert ekle.
    try {
      // Deactivate existing active goals before creating new phase
      await supabase.from('goals').update({ is_active: false }).eq('user_id', user.id).eq('is_active', true);
      const phaseLabel = goalType === 'lose_weight' ? 'Yağ Yakım'
        : goalType === 'gain_weight' ? 'Kilo Alma'
        : goalType === 'gain_muscle' ? 'Kas Geliştirme'
        : goalType === 'maintain' ? 'Koruma'
        : goalType === 'conditioning' ? 'Kondisyon'
        : 'Sağlık';
      // Single-goal "replace" intent: the deactivate above cleared the old active
      // goal, so this new one must be active (else the user is left with ZERO active
      // goals and the dashboard / plan-gen / streak / progress all read nothing).
      await addPhase(user.id, goalType, tw || null, weeks, phaseLabel, true);
      haptics.success();
      Alert.alert('Başarılı', 'Hedef kaydedildi.', [{ text: 'Tamam', onPress: () => router.back() }]);
    } catch (e) {
      haptics.error();
      Alert.alert('Kaydedilemedi', 'Hedef kaydedilemedi, lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
        {/* FIX (audit duplicate-title): native header (settings/_layout.tsx) zaten "Hedef Ayarları"
            başlığını gösteriyor; gövdedeki H1 çift başlıktı, kaldırıldı. */}

        {profile?.weight_kg && (
          <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '600', marginBottom: SPACING.md }}>Mevcut: {profile.weight_kg} kg</Text>
        )}

        {/* Existing goal progress */}
        {existingGoal && progress && (
          <Card style={{ marginBottom: SPACING.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
              <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>Mevcut Hedef</Text>
              <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '700' }}>%{progress.percentComplete}</Text>
            </View>
            <View style={{ height: 8, backgroundColor: COLORS.surfaceLight, borderRadius: RADIUS.full, overflow: 'hidden', marginBottom: SPACING.sm }}>
              <View style={{ height: '100%', width: `${progress.percentComplete}%`, backgroundColor: COLORS.primary, borderRadius: RADIUS.full }} />
            </View>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{summaryText}</Text>
            {progress.estimatedCompletionDate && (
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.xs }}>
                Tahmini tamamlanma: {progress.estimatedCompletionDate}
              </Text>
            )}
          </Card>
        )}

        {/* Tempo chart — planned vs actual weight trajectory (Spec 6.3) */}
        {existingGoal?.target_weight_kg && tempoData && tempoData.points.length >= 1 && (
          <View style={{ marginBottom: SPACING.md }}>
            <TempoChart
              startWeight={tempoData.startWeight}
              targetWeight={existingGoal.target_weight_kg}
              targetWeeks={existingGoal.target_weeks ?? 12}
              actualPoints={tempoData.points}
              goalStartDate={tempoData.goalStartDate}
            />
          </View>
        )}

        {/* Phase timeline */}
        {allPhases.length > 1 && (
          <Card style={{ marginBottom: SPACING.md }}>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm }}>FAZ PLANI</Text>
            {allPhases.map((phase, i) => (
              <View key={phase.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: i < allPhases.length - 1 ? SPACING.sm : 0 }}>
                <View style={{
                  width: 24, height: 24, borderRadius: 12, marginRight: SPACING.sm,
                  backgroundColor: phase.is_active ? COLORS.primary : COLORS.surfaceLight,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ color: phase.is_active ? getContrastColor(COLORS.primary) : COLORS.textMuted, fontSize: FONT.xs, fontWeight: '700' }}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: phase.is_active ? COLORS.text : COLORS.textMuted, fontSize: FONT.sm, fontWeight: phase.is_active ? '600' : '400' }}>
                    {phase.phase_label ?? phase.goal_type}
                  </Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{phase.target_weeks ?? '?'} hafta{phase.target_weight_kg ? ` - ${phase.target_weight_kg}kg` : ''}</Text>
                </View>
                {phase.is_active && <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '700' }}>AKTİF</Text>}
              </View>
            ))}
          </Card>
        )}

        {/* Goal type selector */}
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>Hedef Türü</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.lg }}>
          {(Object.keys(GOAL_LABELS) as GoalType[]).map(g => (
            <Button key={g} title={GOAL_LABELS[g]} variant={goalType === g ? 'primary' : 'outline'} size="sm" onPress={() => setGoalType(g)} />
          ))}
        </View>

        <Input label="Hedef Kilo (kg)" placeholder="70" value={targetWeight} onChangeText={setTargetWeight} keyboardType="decimal-pad" />
        <Input label="Hedef Süre (hafta)" placeholder="12" value={targetWeeks} onChangeText={setTargetWeeks} keyboardType="numeric" />

        {/* D19: Goal compatibility warning */}
        {compatWarning && (
          <View style={{ backgroundColor: COLORS.warning + '15', borderRadius: RADIUS.sm, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.warning }}>
            <Text style={{ color: COLORS.warning, fontSize: FONT.sm, fontWeight: '600', marginBottom: 4 }}>Hedef Uyumsuzluğu</Text>
            <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>{compatWarning}</Text>
          </View>
        )}

        {/* D5: Phase transition info */}
        {phaseTransitionInfo && (
          <View style={{ backgroundColor: COLORS.primary + '10', borderRadius: RADIUS.sm, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.primary + '40' }}>
            <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600', marginBottom: 4 }}>Kademeli Geçiş</Text>
            <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>{phaseTransitionInfo}</Text>
          </View>
        )}

        {/* Aggressive rate warning from goals service */}
        {aggressiveWarning && (
          <View style={{ backgroundColor: COLORS.warning + '15', borderRadius: RADIUS.sm, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.warning }}>
            <Text style={{ color: COLORS.warning, fontSize: FONT.sm, fontWeight: '600', marginBottom: 4 }}>Agresif Tempo</Text>
            <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>{aggressiveWarning}</Text>
          </View>
        )}

        {/* Safety warnings */}
        {!safety.safe && (
          <View style={{ marginBottom: SPACING.md }}>
            {safety.warnings.map((w, i) => (
              <Text key={i} style={{ color: COLORS.error, fontSize: FONT.sm, marginBottom: SPACING.xs }}>{w}</Text>
            ))}
          </View>
        )}

        {/* Weekly rate display */}
        {weeklyRate > 0 && (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.md }}>
            Haftalık tempo: {weeklyRate.toFixed(2)} kg/hafta
          </Text>
        )}

        <Button title="Kaydet" onPress={handleSave} loading={saving} size="lg" />

        {/* D18: AI Goal Suggestions */}
        <Button
          title={loadingSuggestions ? 'Yükleniyor...' : 'AI Hedef Önerisi Al'}
          variant="outline"
          onPress={handleFetchAISuggestions}
          style={{ marginTop: SPACING.md }}
          disabled={loadingSuggestions}
        />

        {/* AI Suggestion results */}
        {aiSuggestions.length > 0 && (
          <View style={{ marginTop: SPACING.md }}>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm }}>AI ÖNERİLERİ</Text>
            {aiSuggestions.map((s, i) => (
              <TouchableOpacity key={i}
                onPress={() => {
                  setGoalType(s.goalType as GoalType);
                  setAiSuggestions([]);
                }}
                style={{
                  backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm,
                  borderWidth: 1, borderColor: s.priority === 'high' ? COLORS.primary : COLORS.border,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>
                    {GOAL_LABELS[s.goalType as GoalType] ?? s.goalType}
                  </Text>
                  <View style={{
                    paddingVertical: 2, paddingHorizontal: 8, borderRadius: RADIUS.sm,
                    backgroundColor: s.priority === 'high' ? COLORS.primary + '20' : s.priority === 'medium' ? COLORS.warning + '20' : COLORS.surfaceLight,
                  }}>
                    <Text style={{
                      color: s.priority === 'high' ? COLORS.primary : s.priority === 'medium' ? COLORS.warning : COLORS.textMuted,
                      fontSize: FONT.xs, fontWeight: '600',
                    }}>
                      {s.priority === 'high' ? 'Yüksek' : s.priority === 'medium' ? 'Orta' : 'Düşük'}
                    </Text>
                  </View>
                </View>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{s.reasoning}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

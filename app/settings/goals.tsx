import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
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
import { COLORS, SPACING, FONT } from '@/lib/constants';
import type { Goal } from '@/types/database';

type GoalType = 'lose_weight' | 'gain_weight' | 'gain_muscle' | 'health' | 'maintain' | 'conditioning';
const GOAL_LABELS: Record<GoalType, string> = {
  lose_weight: 'Kilo Ver', gain_weight: 'Kilo Al', gain_muscle: 'Kas Kazan',
  health: 'Saglik', maintain: 'Koru', conditioning: 'Kondisyon',
};

export default function GoalsScreen() {
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

  useEffect(() => {
    if (!user?.id) return;
    getGoalPhases(user.id).then(phases => {
      setAllPhases(phases);
      const active = phases.find(p => p.is_active);
      if (active) {
        setExistingGoal(active as unknown as Goal);
        setGoalType(active.goal_type as GoalType);
        setTargetWeight(String(active.target_weight_kg ?? ''));
        setTargetWeeks(String(active.target_weeks ?? 12));
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
          `Faz gecisi: 7 gun icinde kademeli olarak ${currentCal.min}-${currentCal.max} kcal'den ${nextCal.min}-${nextCal.max} kcal'e gecilecek.`
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

  // Safety check for weekly rate
  const weeklyRate = targetWeight && profile?.weight_kg
    ? Math.abs((profile.weight_kg as number) - parseFloat(targetWeight)) / (parseInt(targetWeeks) || 12)
    : 0;
  const safety = validateGoalSafety(goalType, weeklyRate, profile?.weight_kg as number ?? 70, profile?.height_cm as number | null);

  // Progress for existing goal
  const progress = existingGoal && profile?.weight_kg
    ? calculateGoalProgress(existingGoal, profile.weight_kg as number, existingGoal.start_weight_kg ?? (profile.weight_kg as number))
    : null;
  const summaryText = progress ? getGoalSummaryText(progress, goalType) : null;

  // Check aggressive goal rate when target weight or weeks change
  useEffect(() => {
    const tw = parseFloat(targetWeight);
    const weeks = parseInt(targetWeeks) || 12;
    if (tw && profile?.weight_kg && (goalType === 'lose_weight' || goalType === 'gain_weight')) {
      const rate = Math.abs((profile.weight_kg as number) - tw) / weeks;
      const aggressive = checkAggressiveGoal(rate, profile.weight_kg as number, profile?.gender as string ?? null);
      setAggressiveWarning(aggressive.warning);
    } else {
      setAggressiveWarning(null);
    }
  }, [targetWeight, targetWeeks, goalType, profile]);

  const handleSave = async () => {
    if (!user?.id) return;
    const tw = parseFloat(targetWeight);
    const weeks = parseInt(targetWeeks) || 12;

    if (tw && profile?.weight_kg && (goalType === 'lose_weight' || goalType === 'gain_weight')) {
      const check = validateWeeklyRate(profile.weight_kg, tw, weeks);
      if (!check.valid) { Alert.alert('Dikkat', check.message); return; }
    }

    // Check compatibility with existing active goals
    if (existingGoal && goalType !== existingGoal.goal_type) {
      const compat = checkGoalCompatibility(goalType, existingGoal.goal_type as string);
      if (!compat.compatible) {
        Alert.alert('Hedef Celiskisi', compat.message_tr);
        return;
      }
    }

    setSaving(true);
    // Deactivate existing active goals before creating new phase
    await supabase.from('goals').update({ is_active: false }).eq('user_id', user.id).eq('is_active', true);
    const phaseLabel = goalType === 'lose_weight' ? 'Yag Yakim'
      : goalType === 'gain_weight' ? 'Kilo Alma'
      : goalType === 'gain_muscle' ? 'Kas Gelistirme'
      : goalType === 'maintain' ? 'Koruma'
      : goalType === 'conditioning' ? 'Kondisyon'
      : 'Saglik';
    await addPhase(user.id, goalType, tw || null, weeks, phaseLabel);
    setSaving(false);
    Alert.alert('Basarili', 'Hedef kaydedildi.', [{ text: 'Tamam', onPress: () => router.back() }]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Hedef Ayarlari</Text>

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
            <View style={{ height: 8, backgroundColor: COLORS.surfaceLight, borderRadius: 4, overflow: 'hidden', marginBottom: SPACING.sm }}>
              <View style={{ height: '100%', width: `${progress.percentComplete}%`, backgroundColor: COLORS.primary, borderRadius: 4 }} />
            </View>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, lineHeight: 20 }}>{summaryText}</Text>
            {progress.estimatedCompletionDate && (
              <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginTop: SPACING.xs }}>
                Tahmini tamamlanma: {progress.estimatedCompletionDate}
              </Text>
            )}
          </Card>
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
                  <Text style={{ color: phase.is_active ? '#fff' : COLORS.textMuted, fontSize: FONT.xs, fontWeight: '700' }}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: phase.is_active ? COLORS.text : COLORS.textMuted, fontSize: FONT.sm, fontWeight: phase.is_active ? '600' : '400' }}>
                    {phase.phase_label ?? phase.goal_type}
                  </Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{phase.target_weeks ?? '?'} hafta{phase.target_weight_kg ? ` - ${phase.target_weight_kg}kg` : ''}</Text>
                </View>
                {phase.is_active && <Text style={{ color: COLORS.primary, fontSize: FONT.xs, fontWeight: '700' }}>AKTIF</Text>}
              </View>
            ))}
          </Card>
        )}

        {/* Goal type selector */}
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>Hedef Turu</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.lg }}>
          {(Object.keys(GOAL_LABELS) as GoalType[]).map(g => (
            <Button key={g} title={GOAL_LABELS[g]} variant={goalType === g ? 'primary' : 'outline'} size="sm" onPress={() => setGoalType(g)} />
          ))}
        </View>

        <Input label="Hedef Kilo (kg)" placeholder="70" value={targetWeight} onChangeText={setTargetWeight} keyboardType="decimal-pad" />
        <Input label="Hedef Sure (hafta)" placeholder="12" value={targetWeeks} onChangeText={setTargetWeeks} keyboardType="numeric" />

        {/* D19: Goal compatibility warning */}
        {compatWarning && (
          <View style={{ backgroundColor: COLORS.warning + '15', borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.warning }}>
            <Text style={{ color: COLORS.warning, fontSize: FONT.sm, fontWeight: '600', marginBottom: 4 }}>Hedef Uyumsuzlugu</Text>
            <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>{compatWarning}</Text>
          </View>
        )}

        {/* D5: Phase transition info */}
        {phaseTransitionInfo && (
          <View style={{ backgroundColor: COLORS.primary + '10', borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.primary + '40' }}>
            <Text style={{ color: COLORS.primary, fontSize: FONT.sm, fontWeight: '600', marginBottom: 4 }}>Kademeli Gecis</Text>
            <Text style={{ color: COLORS.text, fontSize: FONT.sm, lineHeight: 20 }}>{phaseTransitionInfo}</Text>
          </View>
        )}

        {/* Aggressive rate warning from goals service */}
        {aggressiveWarning && (
          <View style={{ backgroundColor: COLORS.warning + '15', borderRadius: 8, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.warning }}>
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
            Haftalik tempo: {weeklyRate.toFixed(2)} kg/hafta
          </Text>
        )}

        <Button title="Kaydet" onPress={handleSave} loading={saving} size="lg" />

        {/* D18: AI Goal Suggestions */}
        <Button
          title={loadingSuggestions ? 'Yukleniyor...' : 'AI Hedef Onerisi Al'}
          variant="outline"
          onPress={handleFetchAISuggestions}
          style={{ marginTop: SPACING.md }}
          disabled={loadingSuggestions}
        />

        {/* AI Suggestion results */}
        {aiSuggestions.length > 0 && (
          <View style={{ marginTop: SPACING.md }}>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.xs, fontWeight: '600', marginBottom: SPACING.sm }}>AI ONERILERI</Text>
            {aiSuggestions.map((s, i) => (
              <TouchableOpacity key={i}
                onPress={() => {
                  setGoalType(s.goalType as GoalType);
                  setAiSuggestions([]);
                }}
                style={{
                  backgroundColor: COLORS.card, borderRadius: 10, padding: SPACING.md, marginBottom: SPACING.sm,
                  borderWidth: 1, borderColor: s.priority === 'high' ? COLORS.primary : COLORS.border,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>
                    {GOAL_LABELS[s.goalType as GoalType] ?? s.goalType}
                  </Text>
                  <View style={{
                    paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10,
                    backgroundColor: s.priority === 'high' ? COLORS.primary + '20' : s.priority === 'medium' ? COLORS.warning + '20' : COLORS.surfaceLight,
                  }}>
                    <Text style={{
                      color: s.priority === 'high' ? COLORS.primary : s.priority === 'medium' ? COLORS.warning : COLORS.textMuted,
                      fontSize: FONT.xs, fontWeight: '600',
                    }}>
                      {s.priority === 'high' ? 'Yuksek' : s.priority === 'medium' ? 'Orta' : 'Dusuk'}
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

/**
 * Goals Screen — Spec 6.1-6.4
 * Set primary goal, target weight, timeline.
 * Shows weekly rate calculation, safety validation, current progress.
 * Restriction mode: sustainable vs aggressive.
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { validateWeeklyRate } from '@/lib/tdee';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT, RADIUS, GOAL_LABELS } from '@/lib/constants';

type GoalType = 'lose_weight' | 'gain_weight' | 'gain_muscle' | 'health' | 'maintain' | 'conditioning';
type RestrictionMode = 'sustainable' | 'aggressive';

const RESTRICTION_MODES: { value: RestrictionMode; label: string; desc: string }[] = [
  { value: 'sustainable', label: 'Surdurulebilir', desc: 'Haftalik 0.3-0.5 kg. Uzun vadede basarili, kas koruyucu.' },
  { value: 'aggressive', label: 'Agresif', desc: 'Haftalik 0.7-1.0 kg. Hizli sonuc ama daha zor surdurulebilir.' },
];

export default function GoalsScreen() {
  const user = useAuthStore(s => s.user);
  const profile = useProfileStore(s => s.profile);
  const [goalType, setGoalType] = useState<GoalType>('lose_weight');
  const [targetWeight, setTargetWeight] = useState('');
  const [targetWeeks, setTargetWeeks] = useState('12');
  const [restrictionMode, setRestrictionMode] = useState<RestrictionMode>('sustainable');
  const [saving, setSaving] = useState(false);
  const [existingGoal, setExistingGoal] = useState<{ goal_type: string; target_weight_kg: number | null } | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('goals').select('goal_type, target_weight_kg, target_weeks, restriction_mode')
      .eq('user_id', user.id).eq('is_active', true).single()
      .then(({ data }) => {
        if (data) {
          const d = data as { goal_type: string; target_weight_kg: number | null; target_weeks: number | null; restriction_mode: string | null };
          setGoalType(d.goal_type as GoalType);
          if (d.target_weight_kg) setTargetWeight(String(d.target_weight_kg));
          if (d.target_weeks) setTargetWeeks(String(d.target_weeks));
          if (d.restriction_mode) setRestrictionMode(d.restriction_mode as RestrictionMode);
          setExistingGoal({ goal_type: d.goal_type, target_weight_kg: d.target_weight_kg });
        }
      });
  }, [user?.id]);

  // Calculate weekly rate preview
  const tw = parseFloat(targetWeight) || 0;
  const weeks = parseInt(targetWeeks) || 12;
  const currentW = (profile?.weight_kg as number) ?? 0;
  const weeklyRate = tw && currentW ? Math.abs(currentW - tw) / weeks : 0;
  const isUnsafeRate = weeklyRate > 1.0;

  const handleSave = async () => {
    if (!user?.id) return;

    // Validation
    if (!tw && (goalType === 'lose_weight' || goalType === 'gain_weight')) {
      Alert.alert('Hata', 'Hedef kilo gir.');
      return;
    }

    if (tw && currentW && (goalType === 'lose_weight' || goalType === 'gain_weight')) {
      const check = validateWeeklyRate(currentW, tw, weeks);
      if (!check.valid) { Alert.alert('Dikkat', check.message); return; }
    }

    setSaving(true);
    // Deactivate old goals
    await supabase.from('goals').update({ is_active: false }).eq('user_id', user.id).eq('is_active', true);
    // Create new goal
    await supabase.from('goals').insert({
      user_id: user.id,
      goal_type: goalType,
      target_weight_kg: tw || null,
      target_weeks: weeks,
      priority: restrictionMode === 'aggressive' ? 'fast' : 'sustainable',
      restriction_mode: restrictionMode,
      weekly_rate: weeklyRate || null,
      is_active: true,
      phase_order: 1,
      phase_label: GOAL_LABELS[goalType] ?? goalType,
    });
    setSaving(false);
    Alert.alert('Basarili', 'Hedef kaydedildi. Kocun planlarini buna gore ayarlayacak.', [
      { text: 'Tamam', onPress: () => router.back() },
    ]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Hedef Ayarlari</Text>

        {/* Current weight display */}
        {currentW > 0 && (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Mevcut kilo</Text>
                <Text style={{ color: COLORS.primary, fontSize: FONT.xl, fontWeight: '700' }}>{currentW} kg</Text>
              </View>
              {existingGoal?.target_weight_kg && (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Mevcut hedef</Text>
                  <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '600' }}>{existingGoal.target_weight_kg} kg</Text>
                </View>
              )}
            </View>
          </Card>
        )}

        {/* Goal type selection */}
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.sm }}>Hedef Turu</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.lg }}>
          {(Object.entries(GOAL_LABELS) as [string, string][]).map(([key, label]) => (
            <TouchableOpacity key={key} onPress={() => setGoalType(key as GoalType)}
              style={{
                paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: RADIUS.sm,
                borderWidth: 1, borderColor: goalType === key ? COLORS.primary : COLORS.border,
                backgroundColor: goalType === key ? COLORS.primary : 'transparent',
              }}>
              <Text style={{ color: goalType === key ? '#fff' : COLORS.textSecondary, fontSize: FONT.sm }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Target weight & timeline */}
        {(goalType === 'lose_weight' || goalType === 'gain_weight' || goalType === 'gain_muscle') && (
          <>
            <Input
              label="Hedef Kilo (kg)"
              placeholder={goalType === 'lose_weight' ? `${currentW - 10}` : `${currentW + 5}`}
              value={targetWeight}
              onChangeText={setTargetWeight}
              keyboardType="decimal-pad"
              suffix="kg"
            />
            <Input
              label="Hedef Sure (hafta)"
              placeholder="12"
              value={targetWeeks}
              onChangeText={setTargetWeeks}
              keyboardType="numeric"
              suffix="hafta"
              hint={`${weeks} hafta = yaklaşık ${Math.round(weeks / 4.3)} ay`}
            />

            {/* Weekly rate preview */}
            {weeklyRate > 0 && (
              <Card accentColor={isUnsafeRate ? COLORS.error : COLORS.success}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>Haftalik tempo</Text>
                  <Text style={{ color: isUnsafeRate ? COLORS.error : COLORS.success, fontSize: FONT.lg, fontWeight: '700' }}>
                    {weeklyRate.toFixed(2)} kg/hafta
                  </Text>
                </View>
                {isUnsafeRate && (
                  <Text style={{ color: COLORS.error, fontSize: FONT.xs, marginTop: SPACING.xs }}>
                    Haftalik 1 kg'dan fazla kilo kaybi onerilmez. Sureyi uzat veya hedefi yakinlastir.
                  </Text>
                )}
              </Card>
            )}

            {/* Restriction mode */}
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginTop: SPACING.sm, marginBottom: SPACING.sm }}>Yaklasim</Text>
            {RESTRICTION_MODES.map(mode => (
              <TouchableOpacity key={mode.value} onPress={() => setRestrictionMode(mode.value)}
                style={{
                  backgroundColor: restrictionMode === mode.value ? COLORS.primary + '15' : COLORS.card,
                  borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm,
                  borderWidth: 1, borderColor: restrictionMode === mode.value ? COLORS.primary : COLORS.border,
                }}>
                <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600' }}>{mode.label}</Text>
                <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginTop: SPACING.xxs, lineHeight: 20 }}>{mode.desc}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        <Button title="Kaydet" onPress={handleSave} loading={saving} size="lg" style={{ marginTop: SPACING.md }} />

        {/* Multi-phase goals link */}
        <Button title="Cok Fazli Hedefler (Cut/Bulk)" variant="ghost" onPress={() => router.push('/settings/multi-phase-goals')} style={{ marginTop: SPACING.sm }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

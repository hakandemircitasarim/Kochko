import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { validateWeeklyRate } from '@/lib/tdee';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';

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

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('goals').select('*').eq('user_id', user.id).eq('is_active', true).single()
      .then(({ data }) => {
        if (data) {
          setGoalType((data as { goal_type: GoalType }).goal_type);
          setTargetWeight(String((data as { target_weight_kg: number }).target_weight_kg));
          setTargetWeeks(String((data as { target_weeks: number }).target_weeks));
        }
      });
  }, [user?.id]);

  const handleSave = async () => {
    if (!user?.id) return;
    const tw = parseFloat(targetWeight);
    const weeks = parseInt(targetWeeks) || 12;

    if (tw && profile?.weight_kg && (goalType === 'lose_weight' || goalType === 'gain_weight')) {
      const check = validateWeeklyRate(profile.weight_kg, tw, weeks);
      if (!check.valid) { Alert.alert('Dikkat', check.message); return; }
    }

    setSaving(true);
    // Deactivate old goals
    await supabase.from('goals').update({ is_active: false }).eq('user_id', user.id).eq('is_active', true);
    // Create new
    await supabase.from('goals').insert({
      user_id: user.id, goal_type: goalType,
      target_weight_kg: tw || null, target_weeks: weeks,
      priority: 'sustainable', restriction_mode: 'sustainable',
      weekly_rate: tw && profile?.weight_kg ? Math.abs(profile.weight_kg - tw) / weeks : null,
      is_active: true,
    });
    setSaving(false);
    Alert.alert('Basarili', 'Hedef kaydedildi.', [{ text: 'Tamam', onPress: () => router.back() }]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Hedef Ayarlari</Text>

        {profile?.weight_kg && (
          <Text style={{ color: COLORS.primary, fontSize: FONT.lg, fontWeight: '600', marginBottom: SPACING.lg }}>Mevcut: {profile.weight_kg} kg</Text>
        )}

        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm }}>Hedef Turu</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.lg }}>
          {(Object.keys(GOAL_LABELS) as GoalType[]).map(g => (
            <Button key={g} title={GOAL_LABELS[g]} variant={goalType === g ? 'primary' : 'outline'} size="sm" onPress={() => setGoalType(g)} />
          ))}
        </View>

        <Input label="Hedef Kilo (kg)" placeholder="70" value={targetWeight} onChangeText={setTargetWeight} keyboardType="decimal-pad" />
        <Input label="Hedef Sure (hafta)" placeholder="12" value={targetWeeks} onChangeText={setTargetWeeks} keyboardType="numeric" />

        <Button title="Kaydet" onPress={handleSave} loading={saving} size="lg" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';
import type { Goal, GoalPriority } from '@/types/database';

const priorityOptions: { label: string; value: GoalPriority }[] = [
  { label: 'Hızlı Kayıp', value: 'fast_loss' },
  { label: 'Sürdürülebilir', value: 'sustainable' },
  { label: 'Güç', value: 'strength' },
  { label: 'Kas', value: 'muscle' },
  { label: 'Sağlık', value: 'health' },
];

export default function GoalSettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);

  const [goal, setGoal] = useState<Goal | null>(null);
  const [targetWeight, setTargetWeight] = useState('');
  const [targetWeeks, setTargetWeeks] = useState('');
  const [priority, setPriority] = useState<GoalPriority>('sustainable');
  const [calorieMin, setCalorieMin] = useState('');
  const [calorieMax, setCalorieMax] = useState('');
  const [proteinMin, setProteinMin] = useState('');
  const [stepsTarget, setStepsTarget] = useState('');
  const [waterTarget, setWaterTarget] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadGoal() {
      if (!user?.id) return;
      const { data } = await supabase
        .from('goals')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single();

      if (data) {
        const g = data as Goal;
        setGoal(g);
        setTargetWeight(g.target_weight_kg.toString());
        setTargetWeeks(g.target_weeks.toString());
        setPriority(g.priority);
        setCalorieMin(g.daily_calorie_min.toString());
        setCalorieMax(g.daily_calorie_max.toString());
        setProteinMin(g.daily_protein_min.toString());
        setStepsTarget(g.daily_steps_target.toString());
        setWaterTarget(g.daily_water_target.toString());
      }
      setLoading(false);
    }
    loadGoal();
  }, [user?.id]);

  const handleSave = async () => {
    if (!user?.id) return;

    const tw = parseFloat(targetWeight);
    if (!tw || tw < 30 || tw > 250) {
      Alert.alert('Hata', 'Geçerli hedef kilo girin (30-250 kg).');
      return;
    }

    // Validate weekly loss rate
    const currentWeight = profile?.weight_kg ?? 0;
    const weeks = parseInt(targetWeeks) || 12;
    const totalLoss = currentWeight - tw;
    const weeklyRate = totalLoss > 0 ? totalLoss / weeks : 0;

    if (weeklyRate > 1.0) {
      Alert.alert(
        'Dikkat',
        `Haftalık ${weeklyRate.toFixed(1)} kg kayıp çok agresif. Maksimum haftalık 1 kg önerilir. Süreyi artırmayı dene.`
      );
      return;
    }

    setSaving(true);

    const goalData = {
      user_id: user.id,
      target_weight_kg: tw,
      target_weeks: weeks,
      priority,
      weekly_loss_rate: Math.round(weeklyRate * 100) / 100,
      daily_calorie_min: parseInt(calorieMin) || 1400,
      daily_calorie_max: parseInt(calorieMax) || 1800,
      daily_protein_min: parseInt(proteinMin) || 100,
      daily_steps_target: parseInt(stepsTarget) || 8000,
      daily_water_target: parseFloat(waterTarget) || 2.0,
      is_active: true,
    };

    if (goal) {
      // Deactivate old goal, create new
      await supabase.from('goals').update({ is_active: false }).eq('id', goal.id);
    }

    const { error } = await supabase.from('goals').insert(goalData);
    setSaving(false);

    if (error) {
      Alert.alert('Hata', error.message);
    } else {
      Alert.alert('Başarılı', 'Hedef kaydedildi.', [
        { text: 'Tamam', onPress: () => router.back() },
      ]);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Hedef Ayarları</Text>

        {profile?.weight_kg && (
          <Card>
            <Text style={styles.currentWeight}>
              Mevcut kilo: {profile.weight_kg} kg
            </Text>
          </Card>
        )}

        <Input
          label="Hedef Kilo (kg)"
          placeholder="70"
          value={targetWeight}
          onChangeText={setTargetWeight}
          keyboardType="decimal-pad"
        />
        <Input
          label="Hedef Süre (hafta)"
          placeholder="12"
          value={targetWeeks}
          onChangeText={setTargetWeeks}
          keyboardType="numeric"
        />

        <Text style={styles.sectionLabel}>Öncelik</Text>
        <View style={styles.chipRow}>
          {priorityOptions.map((p) => (
            <Button
              key={p.value}
              title={p.label}
              variant={priority === p.value ? 'primary' : 'outline'}
              size="sm"
              onPress={() => setPriority(p.value)}
            />
          ))}
        </View>

        <Text style={styles.sectionLabel}>Günlük Hedefler</Text>
        <View style={styles.row}>
          <View style={styles.halfInput}>
            <Input
              label="Min Kalori"
              placeholder="1400"
              value={calorieMin}
              onChangeText={setCalorieMin}
              keyboardType="numeric"
            />
          </View>
          <View style={styles.halfInput}>
            <Input
              label="Max Kalori"
              placeholder="1800"
              value={calorieMax}
              onChangeText={setCalorieMax}
              keyboardType="numeric"
            />
          </View>
        </View>

        <Input
          label="Minimum Protein (g)"
          placeholder="100"
          value={proteinMin}
          onChangeText={setProteinMin}
          keyboardType="numeric"
        />
        <Input
          label="Adım Hedefi"
          placeholder="8000"
          value={stepsTarget}
          onChangeText={setStepsTarget}
          keyboardType="numeric"
        />
        <Input
          label="Su Hedefi (L)"
          placeholder="2.0"
          value={waterTarget}
          onChangeText={setWaterTarget}
          keyboardType="decimal-pad"
        />

        <Button title="Kaydet" onPress={handleSave} loading={saving} size="lg" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  title: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg },
  currentWeight: { color: COLORS.primary, fontSize: FONT_SIZE.lg, fontWeight: '600' },
  sectionLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm, fontWeight: '500', marginBottom: SPACING.sm, marginTop: SPACING.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.md },
  row: { flexDirection: 'row', gap: SPACING.md },
  halfInput: { flex: 1 },
});

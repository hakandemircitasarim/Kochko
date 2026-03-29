import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import type { MealType } from '@/types/database';

type LogType = 'meal' | 'workout' | 'weight' | 'supplement';

const LOG_TYPES: { label: string; value: LogType }[] = [
  { label: 'Ogun', value: 'meal' },
  { label: 'Spor', value: 'workout' },
  { label: 'Tarti', value: 'weight' },
  { label: 'Takviye', value: 'supplement' },
];

const MEAL_TYPES: { label: string; value: MealType }[] = [
  { label: 'Kahvalti', value: 'breakfast' },
  { label: 'Ogle', value: 'lunch' },
  { label: 'Aksam', value: 'dinner' },
  { label: 'Ara ogun', value: 'snack' },
];

export default function LogScreen() {
  const user = useAuthStore(s => s.user);
  const { fetchToday } = useDashboardStore();
  const [logType, setLogType] = useState<LogType>('meal');
  const [saving, setSaving] = useState(false);

  // Meal state
  const [mealType, setMealType] = useState<MealType>('lunch');
  const [mealInput, setMealInput] = useState('');

  // Workout state
  const [workoutInput, setWorkoutInput] = useState('');

  // Weight state
  const [weightInput, setWeightInput] = useState('');

  // Supplement state
  const [supplementInput, setSupplementInput] = useState('');

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    const date = new Date().toISOString().split('T')[0];

    try {
      if (logType === 'meal' && mealInput.trim()) {
        // Quick manual entry — AI chat is preferred for parsing, this is a fallback
        const { error } = await supabase.from('meal_logs').insert({
          user_id: user.id,
          date,
          meal_type: mealType,
          raw_input: mealInput.trim(),
          input_method: 'text',
          confidence: 'low',
        });
        if (error) throw error;
      } else if (logType === 'workout' && workoutInput.trim()) {
        const { error } = await supabase.from('workout_logs').insert({
          user_id: user.id,
          date,
          raw_input: workoutInput.trim(),
        });
        if (error) throw error;
      } else if (logType === 'weight' && weightInput.trim()) {
        const w = parseFloat(weightInput);
        if (isNaN(w) || w < 30 || w > 300) {
          Alert.alert('Hata', 'Gecerli bir kilo girin (30-300 kg)');
          setSaving(false);
          return;
        }
        const { error } = await supabase.from('daily_metrics').upsert(
          { user_id: user.id, date, weight_kg: w, synced: true },
          { onConflict: 'user_id,date' }
        );
        if (error) throw error;
        // Also update weight history
        await supabase.from('weight_history').insert({ user_id: user.id, weight_kg: w });
      } else if (logType === 'supplement' && supplementInput.trim()) {
        const { error } = await supabase.from('supplement_logs').insert({
          user_id: user.id,
          date,
          supplement_name: supplementInput.trim(),
        });
        if (error) throw error;
      } else {
        Alert.alert('Hata', 'Bir sey gir.');
        setSaving(false);
        return;
      }

      fetchToday(user.id);
      router.back();
    } catch {
      Alert.alert('Hata', 'Kayit yapilamadi, tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingTop: SPACING.xl }} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg }}>
          <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: COLORS.text }}>Hizli Kayit</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Kapat</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: SPACING.md }}>
          Detayli kayit icin kocunla sohbet et — AI kalori ve makrolari otomatik hesaplar.
        </Text>

        {/* Log Type Selector */}
        <View style={{ flexDirection: 'row', gap: SPACING.xs, marginBottom: SPACING.lg }}>
          {LOG_TYPES.map(t => (
            <TouchableOpacity
              key={t.value}
              onPress={() => setLogType(t.value)}
              style={{
                flex: 1, paddingVertical: SPACING.sm, borderRadius: 10, alignItems: 'center',
                backgroundColor: logType === t.value ? COLORS.primary : COLORS.inputBg,
                borderWidth: 1, borderColor: logType === t.value ? COLORS.primary : COLORS.border,
              }}
            >
              <Text style={{ color: COLORS.text, fontSize: FONT.sm, fontWeight: logType === t.value ? '700' : '400' }}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Meal Form */}
        {logType === 'meal' && (
          <>
            <View style={{ flexDirection: 'row', gap: SPACING.xs, marginBottom: SPACING.md }}>
              {MEAL_TYPES.map(mt => (
                <TouchableOpacity
                  key={mt.value}
                  onPress={() => setMealType(mt.value)}
                  style={{
                    flex: 1, paddingVertical: SPACING.sm, borderRadius: 8, alignItems: 'center',
                    backgroundColor: mealType === mt.value ? COLORS.surfaceLight : COLORS.inputBg,
                    borderWidth: 1, borderColor: mealType === mt.value ? COLORS.primary : COLORS.border,
                  }}
                >
                  <Text style={{ color: COLORS.text, fontSize: FONT.xs, fontWeight: mealType === mt.value ? '600' : '400' }}>{mt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Input
              label="Ne yedin?"
              value={mealInput}
              onChangeText={setMealInput}
              placeholder="ornek: 2 yumurta, 1 dilim ekmek, peynir"
              multiline
              numberOfLines={3}
              style={{ minHeight: 80, textAlignVertical: 'top' }}
            />
          </>
        )}

        {/* Workout Form */}
        {logType === 'workout' && (
          <Input
            label="Ne yaptin?"
            value={workoutInput}
            onChangeText={setWorkoutInput}
            placeholder="ornek: 30 dk yuruyus, orta tempo"
            multiline
            numberOfLines={3}
            style={{ minHeight: 80, textAlignVertical: 'top' }}
          />
        )}

        {/* Weight Form */}
        {logType === 'weight' && (
          <Input
            label="Kilonuz (kg)"
            value={weightInput}
            onChangeText={setWeightInput}
            keyboardType="decimal-pad"
            placeholder="ornek: 82.5"
          />
        )}

        {/* Supplement Form */}
        {logType === 'supplement' && (
          <Input
            label="Takviye"
            value={supplementInput}
            onChangeText={setSupplementInput}
            placeholder="ornek: kreatin 5g, D vitamini"
          />
        )}

        <Button title="Kaydet" onPress={handleSave} loading={saving} style={{ marginTop: SPACING.md }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

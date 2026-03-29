/**
 * Quick Log Modal
 * Spec 3.1: Kayıt türleri — öğün, spor, tartı, takviye
 * Spec 3.5: Her kayıt max 1 dakikada girilebilmeli
 *
 * Meals and workouts are sent to AI for parsing (calories/macros/duration).
 * Weight and supplements are saved directly.
 */
import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useDashboardStore } from '@/stores/dashboard.store';
import { sendMessage } from '@/services/chat.service';
import { logSupplement } from '@/services/supplements.service';
import { BarcodeScanner } from '@/components/tracking/BarcodeScanner';
import { checkSuspiciousInput } from '@/lib/guardrails-client';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
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
  { label: 'Ara', value: 'snack' },
];

const SUPPLEMENT_PRESETS = [
  { label: 'Protein', cmd: 'protein tozu 1 olcu' },
  { label: 'Kreatin', cmd: 'kreatin 5g' },
  { label: 'Omega-3', cmd: 'omega-3 1 kapsul' },
  { label: 'D Vit', cmd: 'D vitamini 1 tablet' },
  { label: 'Multi', cmd: 'multivitamin 1 tablet' },
];

export default function LogScreen() {
  const user = useAuthStore(s => s.user);
  const { fetchToday } = useDashboardStore();
  const [logType, setLogType] = useState<LogType>('meal');
  const [saving, setSaving] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);

  // Meal state
  const [mealType, setMealType] = useState<MealType>('lunch');
  const [mealInput, setMealInput] = useState('');

  // Workout state
  const [workoutInput, setWorkoutInput] = useState('');

  // Weight state
  const [weightInput, setWeightInput] = useState('');

  // Supplement state
  const [supplementInput, setSupplementInput] = useState('');

  // Barcode scanner (Spec 3.1)
  const [showBarcode, setShowBarcode] = useState(false);

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    setAiResult(null);

    try {
      if (logType === 'meal' && mealInput.trim()) {
        // Send to AI for parsing — AI will extract calories, macros, create meal_log + items
        const prefix = `yedim ${mealType === 'breakfast' ? 'kahvaltida' : mealType === 'lunch' ? 'ogle' : mealType === 'dinner' ? 'aksam' : 'ara ogunde'}: `;
        const { data, error } = await sendMessage(prefix + mealInput.trim());

        if (error) {
          Alert.alert('Hata', 'AI baglantisi kurulamadi. Tekrar dene.');
          setSaving(false);
          return;
        }

        if (data) {
          setAiResult(data.message);
          // AI edge function already creates meal_log + meal_log_items via action execution
          if (user.id) fetchToday(user.id);
          setTimeout(() => router.back(), 2000);
          setSaving(false);
          return;
        }
      } else if (logType === 'workout' && workoutInput.trim()) {
        // Send to AI for parsing — duration, type, intensity
        const { data, error } = await sendMessage('yaptim: ' + workoutInput.trim());

        if (error) {
          Alert.alert('Hata', 'AI baglantisi kurulamadi.');
          setSaving(false);
          return;
        }

        if (data) {
          setAiResult(data.message);
          if (user.id) fetchToday(user.id);
          setTimeout(() => router.back(), 2000);
          setSaving(false);
          return;
        }
      } else if (logType === 'weight' && weightInput.trim()) {
        const w = parseFloat(weightInput);
        if (isNaN(w) || w < 30 || w > 300) {
          Alert.alert('Hata', 'Gecerli bir kilo girin (30-300 kg)');
          setSaving(false);
          return;
        }

        // Suspicious weight check (Spec 12.6)
        const { data: lastMetric } = await supabase
          .from('daily_metrics')
          .select('weight_kg')
          .eq('user_id', user.id)
          .not('weight_kg', 'is', null)
          .order('date', { ascending: false })
          .limit(1)
          .single();

        if (lastMetric?.weight_kg) {
          const check = checkSuspiciousInput('weight', w, lastMetric.weight_kg as number);
          if (check) {
            const confirmed = await new Promise<boolean>(resolve => {
              Alert.alert('Dogrulama', check, [
                { text: 'Iptal', onPress: () => resolve(false) },
                { text: 'Evet dogru', onPress: () => resolve(true) },
              ]);
            });
            if (!confirmed) { setSaving(false); return; }
          }
        }

        const date = new Date().toISOString().split('T')[0];
        await supabase.from('daily_metrics').upsert(
          { user_id: user.id, date, weight_kg: w, synced: true },
          { onConflict: 'user_id,date' },
        );
        await supabase.from('weight_history').insert({ user_id: user.id, weight_kg: w });

        // Also update profile weight
        await supabase.from('profiles').update({ weight_kg: w, updated_at: new Date().toISOString() }).eq('id', user.id);

        setAiResult(`Tarti kaydedildi: ${w} kg`);
        if (user.id) fetchToday(user.id);
        setTimeout(() => router.back(), 1500);
      } else if (logType === 'supplement' && supplementInput.trim()) {
        const parts = supplementInput.trim().split(' ');
        const name = parts.slice(0, -1).join(' ') || parts[0];
        const amount = parts.length > 1 ? parts[parts.length - 1] : '1 adet';
        await logSupplement(name, amount);
        setAiResult(`Takviye kaydedildi: ${supplementInput.trim()}`);
        if (user.id) fetchToday(user.id);
        setTimeout(() => router.back(), 1500);
      } else {
        Alert.alert('Hata', 'Bir sey gir.');
      }
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
          <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: COLORS.text }}>Hizli Kayit</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.md }}>Kapat</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: SPACING.md }}>
          Ogun ve spor kayitlari AI tarafindan otomatik analiz edilir.
        </Text>

        {/* Log Type Selector */}
        <View style={{ flexDirection: 'row', gap: SPACING.xs, marginBottom: SPACING.lg }}>
          {LOG_TYPES.map(t => (
            <TouchableOpacity
              key={t.value}
              onPress={() => { setLogType(t.value); setAiResult(null); }}
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

        {/* AI Result */}
        {aiResult && (
          <Card>
            <Text style={{ color: COLORS.success, fontSize: FONT.sm, fontWeight: '600', marginBottom: 4 }}>Kaydedildi</Text>
            <Text style={{ color: COLORS.text, fontSize: FONT.md, lineHeight: 22 }}>{aiResult}</Text>
          </Card>
        )}

        {/* Meal Form */}
        {logType === 'meal' && !aiResult && (
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
              placeholder="2 yumurta, 1 dilim ekmek, peynir"
              multiline
              numberOfLines={3}
              style={{ minHeight: 80, textAlignVertical: 'top' }}
            />
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
              AI kalori ve makrolari otomatik hesaplar. Pisirme yontemi de yaz (haslama, kizartma vb.)
            </Text>
            <Button title="Barkod Tara" variant="outline" size="sm" onPress={() => setShowBarcode(true)} style={{ marginBottom: SPACING.sm }} />
          </>
        )}

        {/* Workout Form */}
        {logType === 'workout' && !aiResult && (
          <>
            <Input
              label="Ne yaptin?"
              value={workoutInput}
              onChangeText={setWorkoutInput}
              placeholder="30 dk yuruyus, orta tempo"
              multiline
              numberOfLines={3}
              style={{ minHeight: 80, textAlignVertical: 'top' }}
            />
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs, marginBottom: SPACING.sm }}>
              Sure, yogunluk ve tip otomatik parse edilir. Guc antrenmani icin: "squat 3x8 70kg"
            </Text>
          </>
        )}

        {/* Weight Form */}
        {logType === 'weight' && !aiResult && (
          <Input
            label="Kilonuz (kg)"
            value={weightInput}
            onChangeText={setWeightInput}
            keyboardType="decimal-pad"
            placeholder="82.5"
          />
        )}

        {/* Supplement Form */}
        {logType === 'supplement' && !aiResult && (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md }}>
              {SUPPLEMENT_PRESETS.map(s => (
                <TouchableOpacity
                  key={s.label}
                  onPress={() => setSupplementInput(s.cmd)}
                  style={{
                    paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: 8,
                    backgroundColor: supplementInput === s.cmd ? COLORS.primary : COLORS.inputBg,
                    borderWidth: 1, borderColor: COLORS.border,
                  }}
                >
                  <Text style={{ color: supplementInput === s.cmd ? '#fff' : COLORS.textSecondary, fontSize: FONT.xs }}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Input
              label="Takviye"
              value={supplementInput}
              onChangeText={setSupplementInput}
              placeholder="kreatin 5g"
            />
          </>
        )}

        {!aiResult && (
          <Button
            title={saving ? '' : 'Kaydet'}
            onPress={handleSave}
            loading={saving}
            disabled={saving}
            style={{ marginTop: SPACING.md }}
          />
        )}

        {saving && logType === 'meal' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: SPACING.md, gap: SPACING.sm }}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm }}>AI analiz ediyor...</Text>
          </View>
        )}
      </ScrollView>

      {/* Barcode Scanner Modal */}
      <BarcodeScanner
        visible={showBarcode}
        onClose={() => setShowBarcode(false)}
        onResult={(result) => {
          // Pre-fill meal input with scanned product
          setMealInput(`${result.name} (${result.servingG}g) — ${result.calories} kcal, ${result.protein_g}g pro`);
          setShowBarcode(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

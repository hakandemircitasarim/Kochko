import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { calculateBMR, calculateTDEE, calculateTargets, calculateWaterTarget } from '@/lib/tdee';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import type { Gender, ActivityLevel, GoalType } from '@/types/database';

const STEPS = ['Temel', 'Fiziksel', 'Hedef'] as const;

const GENDER_OPTIONS: { label: string; value: Gender }[] = [
  { label: 'Erkek', value: 'male' },
  { label: 'Kadin', value: 'female' },
  { label: 'Diger', value: 'other' },
];

const ACTIVITY_OPTIONS: { label: string; value: ActivityLevel }[] = [
  { label: 'Sedanter (masa basi)', value: 'sedentary' },
  { label: 'Hafif aktif (1-3 gun)', value: 'light' },
  { label: 'Orta aktif (3-5 gun)', value: 'moderate' },
  { label: 'Aktif (6-7 gun)', value: 'active' },
  { label: 'Cok aktif (fiziksel is)', value: 'very_active' },
];

const GOAL_OPTIONS: { label: string; value: GoalType }[] = [
  { label: 'Kilo vermek', value: 'lose_weight' },
  { label: 'Kas kazanmak', value: 'gain_muscle' },
  { label: 'Saglikli yasamak', value: 'health' },
  { label: 'Kondisyon', value: 'conditioning' },
  { label: 'Kilo almak', value: 'gain_weight' },
];

export default function OnboardingScreen() {
  const user = useAuthStore(s => s.user);
  const { update } = useProfileStore();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Form state
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | null>(null);
  const [goalType, setGoalType] = useState<GoalType | null>(null);

  const currentYear = new Date().getFullYear();

  const canProceed = () => {
    if (step === 0) return gender !== null && birthYear.length === 4;
    if (step === 1) return heightCm.length > 0 && weightKg.length > 0 && activityLevel !== null;
    if (step === 2) return goalType !== null;
    return false;
  };

  const handleNext = () => {
    if (step === 0) {
      const year = parseInt(birthYear, 10);
      if (isNaN(year) || currentYear - year < 18) {
        Alert.alert('Yas siniri', 'Bu uygulama 18 yas ve uzeri icindir.');
        return;
      }
    }
    if (step === 1) {
      const h = parseFloat(heightCm);
      const w = parseFloat(weightKg);
      if (isNaN(h) || h < 100 || h > 250) {
        Alert.alert('Hata', 'Gecerli bir boy girin (100-250 cm)');
        return;
      }
      if (isNaN(w) || w < 30 || w > 300) {
        Alert.alert('Hata', 'Gecerli bir kilo girin (30-300 kg)');
        return;
      }
    }
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      handleFinish();
    }
  };

  const handleFinish = async () => {
    if (!user?.id || !gender || !activityLevel || !goalType) return;
    setSaving(true);
    try {
      const w = parseFloat(weightKg);
      const h = parseFloat(heightCm);
      const by = parseInt(birthYear, 10);
      const age = new Date().getFullYear() - by;

      // Calculate TDEE and calorie targets (Spec 2.4)
      const bmr = calculateBMR(w, h, age, gender as 'male' | 'female');
      const tdee = calculateTDEE(bmr, activityLevel);
      const macros = { protein: 30, carb: 40, fat: 30 }; // Standard default (Spec 2.1)
      const targets = calculateTargets({
        tdee, goalType, restrictionMode: 'sustainable',
        weeksSinceStart: 0, complianceAvg: 50, weightKg: w, macroPct: macros,
      });
      const waterTarget = calculateWaterTarget(w, false, false);

      // Save profile with calculated targets
      await update(user.id, {
        birth_year: by, gender, height_cm: h, weight_kg: w,
        activity_level: activityLevel,
        tdee_calculated: tdee,
        tdee_calculated_at: new Date().toISOString(),
        calorie_range_training_min: targets.trainingDay.min,
        calorie_range_training_max: targets.trainingDay.max,
        calorie_range_rest_min: targets.restDay.min,
        calorie_range_rest_max: targets.restDay.max,
        protein_per_kg: Math.round(targets.proteinG / w * 10) / 10,
        macro_protein_pct: macros.protein,
        macro_carb_pct: macros.carb,
        macro_fat_pct: macros.fat,
        water_target_liters: waterTarget,
        profile_completion_pct: 35, // minimum fields filled
        onboarding_completed: true,
      } as never);

      // Create initial goal (Spec 6.1)
      await supabase.from('goals').insert({
        user_id: user.id,
        goal_type: goalType,
        restriction_mode: 'sustainable',
        is_active: true,
        phase_order: 1,
        phase_label: goalType === 'lose_weight' ? 'Kilo verme' : goalType === 'gain_muscle' ? 'Kas kazanma' : 'Saglik',
      });

      // Record initial weight (Spec 3.1)
      await supabase.from('weight_history').insert({ user_id: user.id, weight_kg: w });
      const date = new Date().toISOString().split('T')[0];
      await supabase.from('daily_metrics').upsert(
        { user_id: user.id, date, weight_kg: w, synced: true },
        { onConflict: 'user_id,date' },
      );

      // Navigate to chat for AI conversational onboarding (Spec 15.2)
      router.replace('/(tabs)/chat');
    } catch {
      Alert.alert('Hata', 'Profil kaydedilemedi, tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.lg, paddingTop: SPACING.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Progress */}
      <View style={{ flexDirection: 'row', gap: SPACING.xs, marginBottom: SPACING.xl }}>
        {STEPS.map((s, i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? COLORS.primary : COLORS.border }} />
        ))}
      </View>

      <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.xs }}>
        {step === 0 ? 'Seni taniyalim' : step === 1 ? 'Fiziksel bilgilerin' : 'Hedefin ne?'}
      </Text>
      <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginBottom: SPACING.xl }}>
        {step === 0
          ? 'Ne kadar cok bilgi verirsen onerilerim o kadar isabetli olur.'
          : step === 1
          ? 'Kisisel planini olusturmak icin bunlara ihtiyacim var.'
          : 'Ana hedefini sec, detaylari sonra konusuruz.'}
      </Text>

      {/* Step 0: Gender + Birth Year */}
      {step === 0 && (
        <>
          <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600', marginBottom: SPACING.sm }}>Cinsiyet</Text>
          <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg }}>
            {GENDER_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                onPress={() => setGender(opt.value)}
                style={{
                  flex: 1, paddingVertical: SPACING.md, borderRadius: 12, alignItems: 'center',
                  backgroundColor: gender === opt.value ? COLORS.primary : COLORS.inputBg,
                  borderWidth: 1, borderColor: gender === opt.value ? COLORS.primary : COLORS.border,
                }}
              >
                <Text style={{ color: COLORS.text, fontWeight: gender === opt.value ? '700' : '400' }}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input
            label="Dogum yili"
            value={birthYear}
            onChangeText={setBirthYear}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="ornek: 1995"
          />
        </>
      )}

      {/* Step 1: Height, Weight, Activity */}
      {step === 1 && (
        <>
          <Input label="Boy (cm)" value={heightCm} onChangeText={setHeightCm} keyboardType="decimal-pad" placeholder="ornek: 175" />
          <Input label="Kilo (kg)" value={weightKg} onChangeText={setWeightKg} keyboardType="decimal-pad" placeholder="ornek: 82" />
          <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: '600', marginBottom: SPACING.sm }}>Aktivite seviyesi</Text>
          {ACTIVITY_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              onPress={() => setActivityLevel(opt.value)}
              style={{
                paddingVertical: SPACING.md, paddingHorizontal: SPACING.md, borderRadius: 12, marginBottom: SPACING.xs,
                backgroundColor: activityLevel === opt.value ? COLORS.primary : COLORS.inputBg,
                borderWidth: 1, borderColor: activityLevel === opt.value ? COLORS.primary : COLORS.border,
              }}
            >
              <Text style={{ color: COLORS.text, fontWeight: activityLevel === opt.value ? '700' : '400' }}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {/* Step 2: Goal */}
      {step === 2 && (
        <>
          {GOAL_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              onPress={() => setGoalType(opt.value)}
              style={{
                paddingVertical: SPACING.lg, paddingHorizontal: SPACING.md, borderRadius: 12, marginBottom: SPACING.sm,
                backgroundColor: goalType === opt.value ? COLORS.primary : COLORS.inputBg,
                borderWidth: 1, borderColor: goalType === opt.value ? COLORS.primary : COLORS.border,
              }}
            >
              <Text style={{ color: COLORS.text, fontSize: FONT.md, fontWeight: goalType === opt.value ? '700' : '400' }}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {/* Navigation */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xl }}>
        {step > 0 && (
          <Button title="Geri" variant="outline" onPress={() => setStep(s => s - 1)} style={{ flex: 1 }} />
        )}
        <Button
          title={step === STEPS.length - 1 ? 'Basla' : 'Devam'}
          onPress={handleNext}
          disabled={!canProceed()}
          loading={saving}
          style={{ flex: 1 }}
        />
      </View>
    </ScrollView>
  );
}

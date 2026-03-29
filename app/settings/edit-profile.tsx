/**
 * Edit Profile Screen — FULL implementation
 * Spec 2.1: Tüm profil verileri düzenlenebilir
 * Spec 2.2: Profil tamamlanma yüzdesi
 * Spec 2.4: TDEE auto-recalculation on save
 */
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { supabase } from '@/lib/supabase';
import { calculateBMR, calculateTDEE, calculateTargets, calculateWaterTarget } from '@/lib/tdee';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

const OPTS = {
  activity: [
    { value: 'sedentary', label: 'Hareketsiz (masa basi)' },
    { value: 'light', label: 'Hafif aktif (1-3 gun)' },
    { value: 'moderate', label: 'Orta aktif (3-5 gun)' },
    { value: 'active', label: 'Aktif (6-7 gun)' },
    { value: 'very_active', label: 'Cok aktif (fiziksel is + spor)' },
  ],
  equipment: [
    { value: 'home', label: 'Ev' }, { value: 'gym', label: 'Salon' }, { value: 'both', label: 'Ikisi de' },
  ],
  cooking: [
    { value: 'none', label: 'Hic yapmam' }, { value: 'basic', label: 'Basit' }, { value: 'good', label: 'Iyi pisiririm' },
  ],
  budget: [
    { value: 'low', label: 'Dusuk' }, { value: 'medium', label: 'Orta' }, { value: 'high', label: 'Yuksek' },
  ],
  training: [
    { value: 'cardio', label: 'Kardiyo' }, { value: 'strength', label: 'Agirlik/guc' }, { value: 'mixed', label: 'Karma' },
  ],
  diet: [
    { value: 'standard', label: 'Standart (30/40/30)' }, { value: 'low_carb', label: 'Dusuk karb' },
    { value: 'keto', label: 'Ketojenik' }, { value: 'high_protein', label: 'Yuksek protein' },
  ],
  alcohol: [
    { value: 'never', label: 'Hic' }, { value: 'rare', label: 'Nadiren' },
    { value: 'weekly', label: 'Haftalik' }, { value: 'frequent', label: 'Sik' },
  ],
  portion: [
    { value: 'grams', label: 'Gram cinsinden' }, { value: 'household', label: 'Bardak, kasik, avuc' },
  ],
  units: [
    { value: 'metric', label: 'Metrik (kg, cm)' }, { value: 'imperial', label: 'Imperial (lb, ft)' },
  ],
  gender: [
    { value: 'male', label: 'Erkek' }, { value: 'female', label: 'Kadin' }, { value: 'other', label: 'Diger' },
  ],
};

const DIET_MACROS: Record<string, { protein: number; carb: number; fat: number }> = {
  standard: { protein: 30, carb: 40, fat: 30 },
  low_carb: { protein: 35, carb: 25, fat: 40 },
  keto: { protein: 25, carb: 5, fat: 70 },
  high_protein: { protein: 40, carb: 35, fat: 25 },
};

export default function EditProfileScreen() {
  const user = useAuthStore(s => s.user);
  const { profile, update } = useProfileStore();
  const [saving, setSaving] = useState(false);

  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState('');
  const [bodyFat, setBodyFat] = useState('');
  const [waistCm, setWaistCm] = useState('');
  const [hipCm, setHipCm] = useState('');
  const [activity, setActivity] = useState('moderate');
  const [equipment, setEquipment] = useState('home');
  const [cookingSkill, setCookingSkill] = useState('basic');
  const [budget, setBudget] = useState('medium');
  const [trainingStyle, setTrainingStyle] = useState('mixed');
  const [dietMode, setDietMode] = useState('standard');
  const [alcoholFreq, setAlcoholFreq] = useState('never');
  const [portionLang, setPortionLang] = useState('grams');
  const [unitSystem, setUnitSystem] = useState('metric');
  const [sleepTime, setSleepTime] = useState('');
  const [wakeTime, setWakeTime] = useState('');
  const [occupation, setOccupation] = useState('');
  const [mealCount, setMealCount] = useState('3');

  useEffect(() => {
    if (!profile) return;
    const p = profile as Record<string, unknown>;
    if (p.height_cm) setHeightCm(String(p.height_cm));
    if (p.weight_kg) setWeightKg(String(p.weight_kg));
    if (p.birth_year) setBirthYear(String(p.birth_year));
    if (p.gender) setGender(String(p.gender));
    if (p.body_fat_pct) setBodyFat(String(p.body_fat_pct));
    if (p.waist_cm) setWaistCm(String(p.waist_cm));
    if (p.hip_cm) setHipCm(String(p.hip_cm));
    if (p.activity_level) setActivity(p.activity_level as string);
    if (p.equipment_access) setEquipment(p.equipment_access as string);
    if (p.cooking_skill) setCookingSkill(p.cooking_skill as string);
    if (p.budget_level) setBudget(p.budget_level as string);
    if (p.training_style) setTrainingStyle(p.training_style as string);
    if (p.diet_mode) setDietMode(p.diet_mode as string);
    if (p.alcohol_frequency) setAlcoholFreq(p.alcohol_frequency as string);
    if (p.portion_language) setPortionLang(p.portion_language as string);
    if (p.unit_system) setUnitSystem(p.unit_system as string);
    if (p.sleep_time) setSleepTime(p.sleep_time as string);
    if (p.wake_time) setWakeTime(p.wake_time as string);
    if (p.occupation) setOccupation(p.occupation as string);
    if (p.meal_count_preference) setMealCount(String(p.meal_count_preference));
  }, [profile]);

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);

    const h = parseFloat(heightCm) || null;
    const w = parseFloat(weightKg) || null;
    const by = parseInt(birthYear) || null;
    const g = gender || null;

    if (h && (h < 100 || h > 250)) { Alert.alert('Hata', 'Boy 100-250 cm arasi olmali.'); setSaving(false); return; }
    if (w && (w < 30 || w > 300)) { Alert.alert('Hata', 'Kilo 30-300 kg arasi olmali.'); setSaving(false); return; }
    if (by && (new Date().getFullYear() - by < 18)) { Alert.alert('Hata', '18 yas alti kullanilamaz.'); setSaving(false); return; }

    // Auto-calculate TDEE if we have enough data (Spec 2.4)
    let tdeeFields: Record<string, unknown> = {};
    if (h && w && by && g) {
      const age = new Date().getFullYear() - by;
      const bmr = calculateBMR(w, h, age, g as 'male' | 'female');
      const tdee = calculateTDEE(bmr, activity as ActivityLevel);
      const macros = DIET_MACROS[dietMode] ?? DIET_MACROS.standard;
      const targets = calculateTargets({
        tdee, goalType: 'lose_weight', restrictionMode: 'sustainable',
        weeksSinceStart: 4, complianceAvg: 70, weightKg: w, macroPct: macros,
      });
      const waterTarget = calculateWaterTarget(w, false, false);

      tdeeFields = {
        tdee_calculated: tdee,
        tdee_calculated_at: new Date().toISOString(),
        calorie_range_training_min: targets.trainingDay.min,
        calorie_range_training_max: targets.trainingDay.max,
        calorie_range_rest_min: targets.restDay.min,
        calorie_range_rest_max: targets.restDay.max,
        protein_per_kg: Math.round(targets.proteinG / w * 10) / 10,
        water_target_liters: waterTarget,
        macro_protein_pct: macros.protein,
        macro_carb_pct: macros.carb,
        macro_fat_pct: macros.fat,
      };
    }

    // Profile completeness (Spec 2.2)
    const checks = [h, w, by, g, activity, equipment, cookingSkill, dietMode, sleepTime, wakeTime, occupation, trainingStyle, alcoholFreq, bodyFat, waistCm];
    const completionPct = Math.round((checks.filter(Boolean).length / checks.length) * 100);

    await update(user.id, {
      height_cm: h, weight_kg: w, birth_year: by, gender: g,
      activity_level: activity, equipment_access: equipment,
      cooking_skill: cookingSkill, budget_level: budget,
      training_style: trainingStyle, diet_mode: dietMode,
      alcohol_frequency: alcoholFreq, portion_language: portionLang,
      unit_system: unitSystem, sleep_time: sleepTime || null,
      wake_time: wakeTime || null, occupation: occupation || null,
      meal_count_preference: parseInt(mealCount) || 3,
      body_fat_pct: parseFloat(bodyFat) || null,
      waist_cm: parseFloat(waistCm) || null,
      hip_cm: parseFloat(hipCm) || null,
      profile_completion_pct: completionPct,
      onboarding_completed: true,
      ...tdeeFields,
    } as never);

    // Track weight change
    if (w && profile?.weight_kg !== w) {
      await supabase.from('weight_history').insert({ user_id: user.id, weight_kg: w });
    }

    setSaving(false);
    Alert.alert('Kaydedildi', `Profil guncellendi (%${completionPct}).`, [{ text: 'Tamam', onPress: () => router.back() }]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm }}>Profil Duzenle</Text>
        <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.lg }}>
          Ne kadar cok doldurursan oneriler o kadar isabetli olur.
        </Text>

        <Card title="Fiziksel Bilgiler">
          <Input label="Boy (cm)" value={heightCm} onChangeText={setHeightCm} keyboardType="numeric" placeholder="175" />
          <Input label="Kilo (kg)" value={weightKg} onChangeText={setWeightKg} keyboardType="decimal-pad" placeholder="80" />
          <Input label="Dogum Yili" value={birthYear} onChangeText={setBirthYear} keyboardType="numeric" placeholder="1990" />
          <ChipSelect label="Cinsiyet" options={OPTS.gender} selected={gender} onChange={setGender} />
          <Input label="Yag Orani % (opsiyonel)" value={bodyFat} onChangeText={setBodyFat} keyboardType="decimal-pad" placeholder="22" />
          <Input label="Bel Cevresi cm (opsiyonel)" value={waistCm} onChangeText={setWaistCm} keyboardType="decimal-pad" placeholder="88" />
          <Input label="Kalca Cevresi cm (opsiyonel)" value={hipCm} onChangeText={setHipCm} keyboardType="decimal-pad" placeholder="98" />
        </Card>

        <Card title="Yasam Tarzi">
          <ChipSelect label="Aktivite Seviyesi" options={OPTS.activity} selected={activity} onChange={setActivity} />
          <Input label="Uyku Saati" value={sleepTime} onChangeText={setSleepTime} placeholder="23:30" />
          <Input label="Kalkis Saati" value={wakeTime} onChangeText={setWakeTime} placeholder="07:00" />
          <Input label="Meslek (opsiyonel)" value={occupation} onChangeText={setOccupation} placeholder="ofis calisan, ogrenci..." />
          <Input label="Gunluk Ogun Sayisi" value={mealCount} onChangeText={setMealCount} keyboardType="numeric" placeholder="3" />
        </Card>

        <Card title="Beslenme Tercihleri">
          <ChipSelect label="Diyet Modu" options={OPTS.diet} selected={dietMode} onChange={setDietMode} />
          <ChipSelect label="Yemek Becerisi" options={OPTS.cooking} selected={cookingSkill} onChange={setCookingSkill} />
          <ChipSelect label="Butce" options={OPTS.budget} selected={budget} onChange={setBudget} />
          <ChipSelect label="Alkol Tercihi" options={OPTS.alcohol} selected={alcoholFreq} onChange={setAlcoholFreq} />
          <ChipSelect label="Porsiyon Dili" options={OPTS.portion} selected={portionLang} onChange={setPortionLang} />
        </Card>

        <Card title="Antrenman">
          <ChipSelect label="Antrenman Stili" options={OPTS.training} selected={trainingStyle} onChange={setTrainingStyle} />
          <ChipSelect label="Ekipman" options={OPTS.equipment} selected={equipment} onChange={setEquipment} />
        </Card>

        <Card title="Genel">
          <ChipSelect label="Olcu Birimi" options={OPTS.units} selected={unitSystem} onChange={setUnitSystem} />
        </Card>

        <Button title="Kaydet" onPress={handleSave} loading={saving} size="lg" style={{ marginTop: SPACING.md }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ChipSelect({ label, options, selected, onChange }: {
  label: string; options: { value: string; label: string }[]; selected: string; onChange: (v: string) => void;
}) {
  return (
    <View style={{ marginBottom: SPACING.md }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm, fontWeight: '500' }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
        {options.map(opt => (
          <TouchableOpacity key={opt.value} onPress={() => onChange(opt.value)}
            style={{
              paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: 8, borderWidth: 1,
              borderColor: selected === opt.value ? COLORS.primary : COLORS.border,
              backgroundColor: selected === opt.value ? COLORS.primary : 'transparent',
            }}>
            <Text style={{ color: selected === opt.value ? '#fff' : COLORS.textSecondary, fontSize: FONT.sm }}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

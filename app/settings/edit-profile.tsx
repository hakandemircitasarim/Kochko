import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import type {
  ActivityLevel, Equipment, CookingSkill, BudgetLevel,
  TrainingStyle, DietMode, AlcoholFrequency, UnitSystem, PortionLanguage,
} from '@/types/database';

// ─── Option Arrays ───

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string }[] = [
  { value: 'sedentary', label: 'Hareketsiz' }, { value: 'light', label: 'Hafif' },
  { value: 'moderate', label: 'Orta' }, { value: 'active', label: 'Aktif' }, { value: 'very_active', label: 'Çok Aktif' },
];
const EQUIP_OPTIONS: { value: Equipment; label: string }[] = [
  { value: 'home', label: 'Ev' }, { value: 'gym', label: 'Salon' }, { value: 'both', label: 'İkisi' },
];
const COOK_OPTIONS: { value: CookingSkill; label: string }[] = [
  { value: 'none', label: 'Hiç' }, { value: 'basic', label: 'Basit' }, { value: 'good', label: 'İyi' },
];
const BUDGET_OPTIONS: { value: BudgetLevel; label: string }[] = [
  { value: 'low', label: 'Düşük' }, { value: 'medium', label: 'Orta' }, { value: 'high', label: 'Yüksek' },
];
const STYLE_OPTIONS: { value: TrainingStyle; label: string }[] = [
  { value: 'cardio', label: 'Kardiyo' }, { value: 'strength', label: 'Ağırlık' }, { value: 'mixed', label: 'Karma' },
];
const DIET_OPTIONS: { value: DietMode; label: string }[] = [
  { value: 'standard', label: 'Standart' }, { value: 'low_carb', label: 'Düşük Karb' },
  { value: 'keto', label: 'Keto' }, { value: 'high_protein', label: 'Yüksek Protein' },
];
const ALCOHOL_OPTIONS: { value: AlcoholFrequency; label: string }[] = [
  { value: 'never', label: 'Hiç' }, { value: 'rare', label: 'Nadiren' },
  { value: 'weekly', label: 'Haftalık' }, { value: 'frequent', label: 'Sık' },
];
const UNIT_OPTIONS: { value: UnitSystem; label: string }[] = [
  { value: 'metric', label: 'Metrik (kg/cm)' }, { value: 'imperial', label: 'İmperial (lb/ft)' },
];
const PORTION_OPTIONS: { value: PortionLanguage; label: string }[] = [
  { value: 'grams', label: 'Gram' }, { value: 'household', label: 'Kaseyle (ev ölçüsü)' },
];
const MEAL_COUNT_OPTIONS = [
  { value: '2', label: '2' }, { value: '3', label: '3' },
  { value: '4', label: '4' }, { value: '5', label: '5' },
];
const DAY_BOUNDARY_OPTIONS = [
  { value: '3', label: '03:00' }, { value: '4', label: '04:00' },
  { value: '5', label: '05:00' }, { value: '6', label: '06:00' },
];

// ─── Screen ───

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { profile, update } = useProfileStore();
  const [saving, setSaving] = useState(false);

  // Physical
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState('');

  // Lifestyle
  const [activity, setActivity] = useState<string>('moderate');
  const [equipment, setEquipment] = useState<string>('home');
  const [cookingSkill, setCookingSkill] = useState<string>('basic');
  const [budget, setBudget] = useState<string>('medium');
  const [trainingStyle, setTrainingStyle] = useState<string>('mixed');
  const [dietMode, setDietMode] = useState<string>('standard');

  // Schedule
  const [sleepTime, setSleepTime] = useState('');
  const [wakeTime, setWakeTime] = useState('');
  const [workStart, setWorkStart] = useState('');
  const [workEnd, setWorkEnd] = useState('');
  const [occupation, setOccupation] = useState('');
  const [mealCount, setMealCount] = useState('3');

  // Preferences
  const [unitSystem, setUnitSystem] = useState<string>('metric');
  const [portionLang, setPortionLang] = useState<string>('grams');
  const [alcoholFreq, setAlcoholFreq] = useState<string>('never');
  const [dayBoundary, setDayBoundary] = useState('4');

  // Body Measurements (optional)
  const [bodyFat, setBodyFat] = useState('');
  const [muscleMass, setMuscleMass] = useState('');
  const [waist, setWaist] = useState('');
  const [hip, setHip] = useState('');
  const [chest, setChest] = useState('');
  const [thigh, setThigh] = useState('');

  // Load from profile
  useEffect(() => {
    if (!profile) return;
    if (profile.height_cm) setHeightCm(String(profile.height_cm));
    if (profile.weight_kg) setWeightKg(String(profile.weight_kg));
    if (profile.birth_year) setBirthYear(String(profile.birth_year));
    if (profile.gender) setGender(profile.gender);
    if (profile.activity_level) setActivity(profile.activity_level);
    if (profile.equipment_access) setEquipment(profile.equipment_access);
    if (profile.cooking_skill) setCookingSkill(profile.cooking_skill);
    if (profile.budget_level) setBudget(profile.budget_level);
    if (profile.training_style) setTrainingStyle(profile.training_style);
    if (profile.diet_mode) setDietMode(profile.diet_mode);
    if (profile.sleep_time) setSleepTime(profile.sleep_time);
    if (profile.wake_time) setWakeTime(profile.wake_time);
    if (profile.work_start) setWorkStart(profile.work_start);
    if (profile.work_end) setWorkEnd(profile.work_end);
    if (profile.occupation) setOccupation(profile.occupation);
    if (profile.meal_count_preference) setMealCount(String(profile.meal_count_preference));
    if (profile.unit_system) setUnitSystem(profile.unit_system);
    if (profile.portion_language) setPortionLang(profile.portion_language);
    if (profile.alcohol_frequency) setAlcoholFreq(profile.alcohol_frequency);
    if (profile.day_boundary_hour) setDayBoundary(String(profile.day_boundary_hour));
    if (profile.body_fat_pct) setBodyFat(String(profile.body_fat_pct));
    if (profile.muscle_mass_pct) setMuscleMass(String(profile.muscle_mass_pct));
    if (profile.waist_cm) setWaist(String(profile.waist_cm));
    if (profile.hip_cm) setHip(String(profile.hip_cm));
    if (profile.chest_cm) setChest(String(profile.chest_cm));
    if (profile.thigh_cm) setThigh(String(profile.thigh_cm));
  }, [profile]);

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    await update(user.id, {
      height_cm: heightCm ? parseInt(heightCm) : null,
      weight_kg: weightKg ? parseFloat(weightKg) : null,
      birth_year: birthYear ? parseInt(birthYear) : null,
      gender: gender || null,
      activity_level: activity as ActivityLevel,
      equipment_access: equipment as Equipment,
      cooking_skill: cookingSkill as CookingSkill,
      budget_level: budget as BudgetLevel,
      training_style: trainingStyle as TrainingStyle,
      diet_mode: dietMode as DietMode,
      sleep_time: sleepTime || null,
      wake_time: wakeTime || null,
      work_start: workStart || null,
      work_end: workEnd || null,
      occupation: occupation || null,
      meal_count_preference: parseInt(mealCount),
      unit_system: unitSystem as UnitSystem,
      portion_language: portionLang as PortionLanguage,
      alcohol_frequency: alcoholFreq as AlcoholFrequency,
      day_boundary_hour: parseInt(dayBoundary),
      body_fat_pct: bodyFat ? parseFloat(bodyFat) : null,
      muscle_mass_pct: muscleMass ? parseFloat(muscleMass) : null,
      waist_cm: waist ? parseFloat(waist) : null,
      hip_cm: hip ? parseFloat(hip) : null,
      chest_cm: chest ? parseFloat(chest) : null,
      thigh_cm: thigh ? parseFloat(thigh) : null,
    } as never);
    setSaving(false);
    Alert.alert('Kaydedildi', 'Profil güncellendi.', [{ text: 'Tamam', onPress: () => router.back() }]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingTop: insets.top + 12, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Profil Düzenle</Text>

        {/* Fiziksel */}
        <Card title="Fiziksel">
          <Input label="Boy (cm)" value={heightCm} onChangeText={setHeightCm} keyboardType="numeric" placeholder="175" />
          <Input label="Kilo (kg)" value={weightKg} onChangeText={setWeightKg} keyboardType="decimal-pad" placeholder="80" />
          <Input label="Doğum Yılı" value={birthYear} onChangeText={setBirthYear} keyboardType="numeric" placeholder="1990" />
          <ChipSelect label="Cinsiyet" options={[{ value: 'male', label: 'Erkek' }, { value: 'female', label: 'Kadın' }, { value: 'other', label: 'Diğer' }]} selected={gender} onChange={setGender} />
        </Card>

        {/* Yasam Tarzi */}
        <Card title="Yaşam Tarzı">
          <ChipSelect label="Aktivite Seviyesi" options={ACTIVITY_OPTIONS} selected={activity} onChange={setActivity} />
          <ChipSelect label="Ekipman" options={EQUIP_OPTIONS} selected={equipment} onChange={setEquipment} />
          <ChipSelect label="Yemek Becerisi" options={COOK_OPTIONS} selected={cookingSkill} onChange={setCookingSkill} />
          <ChipSelect label="Bütçe" options={BUDGET_OPTIONS} selected={budget} onChange={setBudget} />
        </Card>

        {/* Antrenman ve Beslenme */}
        <Card title="Antrenman ve Beslenme">
          <ChipSelect label="Antrenman Stili" options={STYLE_OPTIONS} selected={trainingStyle} onChange={setTrainingStyle} />
          <ChipSelect label="Diyet Modu" options={DIET_OPTIONS} selected={dietMode} onChange={setDietMode} />
          <ChipSelect label="Öğün Sayısı" options={MEAL_COUNT_OPTIONS} selected={mealCount} onChange={setMealCount} />
        </Card>

        {/* Program */}
        <Card title="Program">
          <Input label="Uyku Saati (örn: 23:00)" value={sleepTime} onChangeText={setSleepTime} placeholder="23:00" />
          <Input label="Uyanma Saati (örn: 07:00)" value={wakeTime} onChangeText={setWakeTime} placeholder="07:00" />
          <Input label="İş Başlangıcı (örn: 09:00)" value={workStart} onChangeText={setWorkStart} placeholder="09:00" />
          <Input label="İş Bitişi (örn: 18:00)" value={workEnd} onChangeText={setWorkEnd} placeholder="18:00" />
          <Input label="Meslek" value={occupation} onChangeText={setOccupation} placeholder="Yazılımcı, öğrenci, vb." />
        </Card>

        {/* Tercihler */}
        <Card title="Tercihler">
          <ChipSelect label="Ölçü Birimi" options={UNIT_OPTIONS} selected={unitSystem} onChange={setUnitSystem} />
          <ChipSelect label="Porsiyon Dili" options={PORTION_OPTIONS} selected={portionLang} onChange={setPortionLang} />
          <ChipSelect label="Alkol Tüketimi" options={ALCOHOL_OPTIONS} selected={alcoholFreq} onChange={setAlcoholFreq} />
          <ChipSelect label="Gün Sınırı" options={DAY_BOUNDARY_OPTIONS} selected={dayBoundary} onChange={setDayBoundary} />
        </Card>

        {/* Vucut Olculeri */}
        <Card title="Vücut Ölçüleri (Opsiyonel)">
          <Input label="Yağ Oranı (%)" value={bodyFat} onChangeText={setBodyFat} keyboardType="decimal-pad" placeholder="20" />
          <Input label="Kas Oranı (%)" value={muscleMass} onChangeText={setMuscleMass} keyboardType="decimal-pad" placeholder="35" />
          <Input label="Bel Çevresi (cm)" value={waist} onChangeText={setWaist} keyboardType="decimal-pad" placeholder="85" />
          <Input label="Kalça Çevresi (cm)" value={hip} onChangeText={setHip} keyboardType="decimal-pad" placeholder="100" />
          <Input label="Göğüs Çevresi (cm)" value={chest} onChangeText={setChest} keyboardType="decimal-pad" placeholder="95" />
          <Input label="Uyluk Çevresi (cm)" value={thigh} onChangeText={setThigh} keyboardType="decimal-pad" placeholder="55" />
        </Card>

        <Button title="Kaydet" onPress={handleSave} loading={saving} size="lg" style={{ marginTop: SPACING.md }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── ChipSelect Component ───

function ChipSelect({ label, options, selected, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ marginBottom: SPACING.md }}>
      <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.sm, fontWeight: '500' }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
        {options.map(opt => (
          <TouchableOpacity key={opt.value} onPress={() => onChange(opt.value)}
            style={{ paddingVertical: 6, paddingHorizontal: SPACING.md, borderRadius: 8, borderWidth: 1,
              borderColor: selected === opt.value ? COLORS.primary : COLORS.border,
              backgroundColor: selected === opt.value ? COLORS.primary : 'transparent' }}>
            <Text style={{ color: selected === opt.value ? '#fff' : COLORS.textSecondary, fontSize: FONT.sm }}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

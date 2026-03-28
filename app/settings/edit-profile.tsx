import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { COLORS, SPACING, FONT } from '@/lib/constants';

type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
type Equipment = 'home' | 'gym' | 'both';
type CookingSkill = 'none' | 'basic' | 'good';
type BudgetLevel = 'low' | 'medium' | 'high';
type TrainingStyle = 'cardio' | 'strength' | 'mixed';
type DietMode = 'standard' | 'low_carb' | 'keto' | 'high_protein';

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string }[] = [
  { value: 'sedentary', label: 'Hareketsiz' }, { value: 'light', label: 'Hafif' },
  { value: 'moderate', label: 'Orta' }, { value: 'active', label: 'Aktif' }, { value: 'very_active', label: 'Cok Aktif' },
];
const EQUIP_OPTIONS: { value: Equipment; label: string }[] = [
  { value: 'home', label: 'Ev' }, { value: 'gym', label: 'Salon' }, { value: 'both', label: 'Ikisi' },
];
const COOK_OPTIONS: { value: CookingSkill; label: string }[] = [
  { value: 'none', label: 'Hic' }, { value: 'basic', label: 'Basit' }, { value: 'good', label: 'Iyi' },
];
const BUDGET_OPTIONS: { value: BudgetLevel; label: string }[] = [
  { value: 'low', label: 'Dusuk' }, { value: 'medium', label: 'Orta' }, { value: 'high', label: 'Yuksek' },
];
const STYLE_OPTIONS: { value: TrainingStyle; label: string }[] = [
  { value: 'cardio', label: 'Kardiyo' }, { value: 'strength', label: 'Agirlik' }, { value: 'mixed', label: 'Karma' },
];
const DIET_OPTIONS: { value: DietMode; label: string }[] = [
  { value: 'standard', label: 'Standart' }, { value: 'low_carb', label: 'Dusuk Karb' },
  { value: 'keto', label: 'Keto' }, { value: 'high_protein', label: 'Yuksek Protein' },
];

export default function EditProfileScreen() {
  const user = useAuthStore(s => s.user);
  const { profile, fetch: fetchProfile, update } = useProfileStore();
  const [saving, setSaving] = useState(false);

  // Form state
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState<string>('');
  const [activity, setActivity] = useState<ActivityLevel>('moderate');
  const [equipment, setEquipment] = useState<Equipment>('home');
  const [cookingSkill, setCookingSkill] = useState<CookingSkill>('basic');
  const [budget, setBudget] = useState<BudgetLevel>('medium');
  const [trainingStyle, setTrainingStyle] = useState<TrainingStyle>('mixed');
  const [dietMode, setDietMode] = useState<DietMode>('standard');
  const [sleepTime, setSleepTime] = useState('');
  const [wakeTime, setWakeTime] = useState('');
  const [occupation, setOccupation] = useState('');

  useEffect(() => {
    if (!profile) return;
    if (profile.height_cm) setHeightCm(String(profile.height_cm));
    if (profile.weight_kg) setWeightKg(String(profile.weight_kg));
    if (profile.birth_year) setBirthYear(String(profile.birth_year));
    if (profile.gender) setGender(String(profile.gender));
    if (profile.activity_level) setActivity(profile.activity_level as ActivityLevel);
    if (profile.equipment_access) setEquipment(profile.equipment_access as Equipment);
    if (profile.cooking_skill) setCookingSkill(profile.cooking_skill as CookingSkill);
    if (profile.budget_level) setBudget(profile.budget_level as BudgetLevel);
    if (profile.training_style) setTrainingStyle(profile.training_style as TrainingStyle);
    if (profile.diet_mode) setDietMode(profile.diet_mode as DietMode);
  }, [profile]);

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    await update(user.id, {
      height_cm: heightCm ? parseInt(heightCm) : null,
      weight_kg: weightKg ? parseFloat(weightKg) : null,
      birth_year: birthYear ? parseInt(birthYear) : null,
      gender: gender || null,
      activity_level: activity,
      equipment_access: equipment,
      cooking_skill: cookingSkill,
      budget_level: budget,
      training_style: trainingStyle,
      diet_mode: dietMode,
      onboarding_completed: true,
    } as never);
    setSaving(false);
    Alert.alert('Kaydedildi', 'Profil guncellendi.', [{ text: 'Tamam', onPress: () => router.back() }]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg }}>Profil Duzenle</Text>

        <Card title="Fiziksel">
          <Input label="Boy (cm)" value={heightCm} onChangeText={setHeightCm} keyboardType="numeric" placeholder="175" />
          <Input label="Kilo (kg)" value={weightKg} onChangeText={setWeightKg} keyboardType="decimal-pad" placeholder="80" />
          <Input label="Dogum Yili" value={birthYear} onChangeText={setBirthYear} keyboardType="numeric" placeholder="1990" />
          <ChipSelect label="Cinsiyet" options={[{ value: 'male', label: 'Erkek' }, { value: 'female', label: 'Kadin' }, { value: 'other', label: 'Diger' }]} selected={gender} onChange={setGender} />
        </Card>

        <Card title="Yasam Tarzi">
          <ChipSelect label="Aktivite Seviyesi" options={ACTIVITY_OPTIONS} selected={activity} onChange={v => setActivity(v as ActivityLevel)} />
          <ChipSelect label="Ekipman" options={EQUIP_OPTIONS} selected={equipment} onChange={v => setEquipment(v as Equipment)} />
          <ChipSelect label="Yemek Becerisi" options={COOK_OPTIONS} selected={cookingSkill} onChange={v => setCookingSkill(v as CookingSkill)} />
          <ChipSelect label="Butce" options={BUDGET_OPTIONS} selected={budget} onChange={v => setBudget(v as BudgetLevel)} />
        </Card>

        <Card title="Antrenman ve Beslenme">
          <ChipSelect label="Antrenman Stili" options={STYLE_OPTIONS} selected={trainingStyle} onChange={v => setTrainingStyle(v as TrainingStyle)} />
          <ChipSelect label="Diyet Modu" options={DIET_OPTIONS} selected={dietMode} onChange={v => setDietMode(v as DietMode)} />
        </Card>

        <Button title="Kaydet" onPress={handleSave} loading={saving} size="lg" style={{ marginTop: SPACING.md }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

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

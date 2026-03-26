import { useState } from 'react';
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
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';
import type { Gender, ActivityLevel, EquipmentAccess, RestrictionMode } from '@/types/database';

type SelectOption<T extends string> = { label: string; value: T };

const genderOptions: SelectOption<Gender>[] = [
  { label: 'Erkek', value: 'male' },
  { label: 'Kadın', value: 'female' },
  { label: 'Diğer', value: 'other' },
];

const activityOptions: SelectOption<ActivityLevel>[] = [
  { label: 'Hareketsiz', value: 'sedentary' },
  { label: 'Hafif Aktif', value: 'light' },
  { label: 'Orta', value: 'moderate' },
  { label: 'Aktif', value: 'active' },
];

const equipmentOptions: SelectOption<EquipmentAccess>[] = [
  { label: 'Ev', value: 'home' },
  { label: 'Salon', value: 'gym' },
  { label: 'İkisi', value: 'both' },
];

const modeOptions: SelectOption<RestrictionMode>[] = [
  { label: 'Sürdürülebilir', value: 'sustainable' },
  { label: 'Agresif', value: 'aggressive' },
];

function ChipSelect<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SelectOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.chipGroup}>
      <Text style={styles.chipLabel}>{label}</Text>
      <View style={styles.chips}>
        {options.map((opt) => (
          <Button
            key={opt.value}
            title={opt.label}
            variant={value === opt.value ? 'primary' : 'outline'}
            size="sm"
            onPress={() => onChange(opt.value)}
          />
        ))}
      </View>
    </View>
  );
}

export default function QuickStartScreen() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useProfileStore((s) => s.updateProfile);

  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [targetWeight, setTargetWeight] = useState('');
  const [targetWeeks, setTargetWeeks] = useState('');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | null>(null);
  const [equipment, setEquipment] = useState<EquipmentAccess | null>(null);
  const [mode, setMode] = useState<RestrictionMode | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!user?.id) return;

    if (!heightCm || !weightKg || !birthYear || !gender || !activityLevel) {
      Alert.alert('Eksik Bilgi', 'Lütfen zorunlu alanları doldurun.');
      return;
    }

    setLoading(true);

    const { error } = await updateProfile(user.id, {
      height_cm: parseInt(heightCm),
      weight_kg: parseFloat(weightKg),
      birth_year: parseInt(birthYear),
      gender,
      activity_level: activityLevel,
      equipment_access: equipment ?? 'home',
      restriction_mode: mode ?? 'sustainable',
      onboarding_completed: true,
    });

    if (error) {
      Alert.alert('Hata', error);
      setLoading(false);
      return;
    }

    // Create initial goal if target weight provided
    if (targetWeight) {
      const { supabase } = await import('@/lib/supabase');
      await supabase.from('goals').insert({
        user_id: user.id,
        target_weight_kg: parseFloat(targetWeight),
        target_weeks: targetWeeks ? parseInt(targetWeeks) : 12,
        priority: 'sustainable',
        weekly_loss_rate: 0.5,
        daily_calorie_min: 1400,
        daily_calorie_max: 1800,
        daily_protein_min: 100,
        daily_steps_target: 8000,
        daily_water_target: 2.0,
        is_active: true,
      });
    }

    setLoading(false);
    router.replace('/(tabs)');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Hızlı Başlangıç</Text>
        <Text style={styles.subtitle}>
          Seni tanıyalım. Bu bilgilerle ilk planını oluşturacağız.
        </Text>

        <Input
          label="Boy (cm) *"
          placeholder="175"
          value={heightCm}
          onChangeText={setHeightCm}
          keyboardType="numeric"
        />
        <Input
          label="Kilo (kg) *"
          placeholder="80"
          value={weightKg}
          onChangeText={setWeightKg}
          keyboardType="decimal-pad"
        />
        <Input
          label="Doğum Yılı *"
          placeholder="1990"
          value={birthYear}
          onChangeText={setBirthYear}
          keyboardType="numeric"
        />

        <ChipSelect
          label="Cinsiyet *"
          options={genderOptions}
          value={gender}
          onChange={setGender}
        />

        <ChipSelect
          label="Aktivite Seviyesi *"
          options={activityOptions}
          value={activityLevel}
          onChange={setActivityLevel}
        />

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

        <ChipSelect
          label="Ekipman"
          options={equipmentOptions}
          value={equipment}
          onChange={setEquipment}
        />

        <ChipSelect
          label="Kısıt Modu"
          options={modeOptions}
          value={mode}
          onChange={setMode}
        />

        <View style={styles.saveBtn}>
          <Button title="Başlayalım" onPress={handleSave} loading={loading} size="lg" />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scroll: {
    padding: SPACING.lg,
    paddingTop: SPACING.xxl,
    paddingBottom: SPACING.xxl,
  },
  title: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '800',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    marginBottom: SPACING.xl,
    lineHeight: 22,
  },
  chipGroup: {
    marginBottom: SPACING.md,
  },
  chipLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    marginBottom: SPACING.sm,
    fontWeight: '500',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  saveBtn: {
    marginTop: SPACING.xl,
  },
});

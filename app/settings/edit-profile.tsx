import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, Alert, KeyboardAvoidingView, TouchableOpacity, Animated } from 'react-native';
import { router } from 'expo-router';
// FIX (ux-pass5): unsaved-changes guard — usePreventRemove intercepts header-back/swipe-back.
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { DateTimeField } from '@/components/ui/DateTimeField';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { TYPE, MOTION } from '@/lib/design';
import { useTheme } from '@/lib/theme';
import { haptics } from '@/lib/haptics';
import { getContrastColor } from '@/lib/accessibility';
import { GENDER_LABELS_TR, ACTIVITY_LEVEL_LABELS_TR, toOptions } from '@/lib/labels';
import type {
  Gender, ActivityLevel, Equipment, CookingSkill, BudgetLevel,
  TrainingStyle, DietMode, AlcoholFrequency, UnitSystem, PortionLanguage,
} from '@/types/database';

// ─── Option Arrays ───

// Review fix: türetme onboarding.tsx ile birebir kopyaydı — tek kaynaktan (toOptions).
const GENDER_OPTIONS = toOptions(GENDER_LABELS_TR);
const ACTIVITY_OPTIONS = toOptions(ACTIVITY_LEVEL_LABELS_TR);
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
  const { colors } = useTheme();
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

  // FIX (ux-pass5): unsaved-changes guard — the 30-field form silently discarded every edit
  // on header-back / swipe-back. Snapshot the form as loaded (baselineArmed flips exactly
  // once, at the end of the profile-load effect below) and only intercept while dirty.
  const [baselineArmed, setBaselineArmed] = useState(false);
  const initialSnapshot = useRef<string | null>(null);
  const currentSnapshot = JSON.stringify([
    heightCm, weightKg, birthYear, gender, activity, equipment, cookingSkill, budget,
    trainingStyle, dietMode, sleepTime, wakeTime, workStart, workEnd, occupation, mealCount,
    unitSystem, portionLang, alcoholFreq, dayBoundary, bodyFat, muscleMass, waist, hip, chest, thigh,
  ]);

  // FIX (ux-pass5): success toast state (log.tsx SavedBadge kalıbı) — replaces the blocking
  // 'Kaydedildi' Alert that cost a mandatory extra Tamam tap on the happy path.
  const [savedToast, setSavedToast] = useState(false);
  const successScale = useRef(new Animated.Value(0.6)).current;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Clear the auto-close timer if the screen unmounts first (prevents a double back()).
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

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
    // FIX (ux-pass5): arm the dirty-check baseline — captured on the NEXT render, after the
    // setters above have been applied.
    setBaselineArmed(true);
  }, [profile]);

  // FIX (ux-pass5): capture the baseline on the render where the loaded values are applied;
  // falls back to the defaults snapshot when there is no profile to load.
  useEffect(() => {
    if (baselineArmed || !profile) initialSnapshot.current = currentSnapshot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineArmed]);

  const isDirty = initialSnapshot.current !== null && currentSnapshot !== initialSnapshot.current;
  const navigation = useNavigation();
  // FIX (ux-pass5): confirm-on-leave while dirty — covers the native header back arrow, the
  // iOS swipe gesture and the Android hardware back; the clean path is untouched.
  usePreventRemove(isDirty, ({ data }) => {
    haptics.warning();
    Alert.alert('Kaydedilmemiş değişiklikler var', 'Şimdi çıkarsan yaptığın değişiklikler kaybolur.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Çık', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  // FIX (audit UX-FRM-01): single comma-normalizing parser shared by the inline
  // validator and the save mapping. tr-TR decimal-pad emits ',', so parseFloat('80,5')
  // would stop at the comma and silently drop the fraction; normalize first.
  const parseNum = (v: string): number => Number(v.replace(',', '.'));

  // Inline range validation (UX only — surfaces a friendly Turkish error under the field;
  // empty stays valid, the save mapping already coerces empty -> null).
  const rangeError = (val: string, min: number, max: number, unit: string): string | undefined => {
    if (!val.trim()) return undefined;
    const n = parseNum(val); // FIX (audit UX-FRM-01)
    if (Number.isNaN(n)) return 'Geçerli bir sayı gir';
    if (n < min || n > max) return `${min}–${max} ${unit} aralığında olmalı`;
    return undefined;
  };

  const heightErr = rangeError(heightCm, 100, 250, 'cm');
  const weightErr = rangeError(weightKg, 30, 300, 'kg');
  const birthYearErr = rangeError(birthYear, 1900, new Date().getFullYear(), '');
  const bodyFatErr = rangeError(bodyFat, 3, 60, '%');
  const muscleErr = rangeError(muscleMass, 10, 70, '%');
  const waistErr = rangeError(waist, 40, 200, 'cm');
  const hipErr = rangeError(hip, 40, 200, 'cm');
  const chestErr = rangeError(chest, 40, 200, 'cm');
  const thighErr = rangeError(thigh, 20, 120, 'cm');
  const hasErrors = !!(heightErr || weightErr || birthYearErr || bodyFatErr || muscleErr || waistErr || hipErr || chestErr || thighErr);

  const handleSave = async () => {
    if (!user?.id) return;
    if (hasErrors) {
      haptics.error();
      Alert.alert('Eksik bilgi', 'Lütfen kırmızı ile işaretlenen alanları düzelt.');
      return;
    }
    setSaving(true);
    try {
      await update(user.id, {
        height_cm: heightCm ? parseInt(heightCm) : null,
        weight_kg: weightKg ? parseNum(weightKg) : null, // FIX (audit UX-FRM-01): normalize ',' like the validator
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
        // FIX (audit UX-FRM-01): normalize ',' so tr-TR decimals don't lose their fraction
        body_fat_pct: bodyFat ? parseNum(bodyFat) : null,
        muscle_mass_pct: muscleMass ? parseNum(muscleMass) : null,
        waist_cm: waist ? parseNum(waist) : null,
        hip_cm: hip ? parseNum(hip) : null,
        chest_cm: chest ? parseNum(chest) : null,
        thigh_cm: thigh ? parseNum(thigh) : null,
      } as never);
      haptics.success();
      // FIX (ux-pass5): mark the just-saved values as the clean baseline so the
      // unsaved-changes guard doesn't fire on the way out.
      initialSnapshot.current = currentSnapshot;
      // FIX (ux-pass5): blocking 'Kaydedildi' Alert → log.tsx's auto-dismissing checkmark
      // toast (1.2s → back, tap to close immediately). Zero extra taps on the happy path.
      setSavedToast(true);
      successScale.setValue(0.6);
      Animated.spring(successScale, { toValue: 1, friction: 4, tension: 130, useNativeDriver: true }).start();
      closeTimer.current = setTimeout(() => { setSavedToast(false); router.back(); }, 1200);
    } catch {
      haptics.error();
      Alert.alert('Kaydedilemedi', 'Profil güncellenemedi. Lütfen tekrar deneyin.');
    } finally {
      setSaving(false);
    }
  };

  // FIX (ux-pass5): success toast screen (log.tsx kalıbı) — auto-returns in 1.2s, a tap
  // cancels the timer and returns immediately.
  if (savedToast) {
    return (
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => { if (closeTimer.current) clearTimeout(closeTimer.current); setSavedToast(false); router.back(); }}
        accessibilityRole="button"
        accessibilityLabel="Profil güncellendi. Kapatmak için dokun"
        style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SPACING.xxl, alignItems: 'center', borderWidth: 0.5, borderColor: colors.border }}>
          <Animated.View style={{ transform: [{ scale: successScale }] }}>
            <Ionicons name="checkmark-circle" size={48} color={colors.primary} />
          </Animated.View>
          <Text style={{ color: colors.text, ...TYPE.title3, marginTop: SPACING.md }}>Profil güncellendi</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
      {/* FIX (audit UI-SET-03): the native Stack header already owns the top safe-area inset;
          adding paddingTop: insets.top here double-counted it. Use the suite-standard plain
          padding (SPACING.md) with only the bottom inset. */}
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
        {/* Native header (settings/_layout.tsx) already renders the Turkish "Profil Düzenle" title;
            the in-body heading was a redundant duplicate and has been removed. */}

        {/* Fiziksel */}
        <Card title="Fiziksel">
          <Input label="Boy (cm)" value={heightCm} onChangeText={setHeightCm} keyboardType="numeric" placeholder="175" hint="100–250 cm" error={heightErr} />
          <Input label="Kilo (kg)" value={weightKg} onChangeText={setWeightKg} keyboardType="decimal-pad" placeholder="80" hint="30–300 kg" error={weightErr} />
          <Input label="Doğum Yılı" value={birthYear} onChangeText={setBirthYear} keyboardType="numeric" placeholder="1990" hint="örn: 1990" error={birthYearErr} />
          <ChipSelect label="Cinsiyet" options={GENDER_OPTIONS} selected={gender} onChange={setGender} />
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
          <DateTimeField label="Uyku Saati" mode="time" value={sleepTime} onChange={setSleepTime} placeholder="23:00" />
          <DateTimeField label="Uyanma Saati" mode="time" value={wakeTime} onChange={setWakeTime} placeholder="07:00" />
          <DateTimeField label="İş Başlangıcı" mode="time" value={workStart} onChange={setWorkStart} placeholder="09:00" />
          <DateTimeField label="İş Bitişi" mode="time" value={workEnd} onChange={setWorkEnd} placeholder="18:00" />
          <Input label="Meslek" value={occupation} onChangeText={setOccupation} placeholder="Yazılımcı, öğrenci, vb." />
        </Card>

        {/* Tercihler */}
        <Card title="Tercihler">
          {/* "Ölçü Birimi: Metrik / İmperial" seçici KALDIRILDI. Değer kaydediliyor ve
              "Profil güncellendi" onayı veriliyordu ama HİÇBİR yüzey onu okumuyordu:
              src/lib/units.ts (formatWeight/formatHeight/formatVolume) uygulamada tek bir
              yerden bile import edilmiyor, kg/cm/L her ekranda sabit yazılı ve giriş
              alanları yalnızca kg kabul ediyor (onboarding'de "30–300 kg" doğrulaması).
              İmperial seçen kullanıcı hiçbir değişiklik görmüyordu — sessiz bir yalan.
              Uygulama şimdilik metrik-tek; seçenek, units.ts tüm gösterim noktalarına
              (StatStrip, log, progress, raporlar, PDF çıktısı, koç bağlamı) bağlandığında
              geri gelir. profiles.unit_system kolonu ve UNIT_OPTIONS yerinde duruyor. */}
          <ChipSelect label="Porsiyon Dili" options={PORTION_OPTIONS} selected={portionLang} onChange={setPortionLang} />
          <ChipSelect label="Alkol Tüketimi" options={ALCOHOL_OPTIONS} selected={alcoholFreq} onChange={setAlcoholFreq} />
          <ChipSelect label="Gün Sınırı" options={DAY_BOUNDARY_OPTIONS} selected={dayBoundary} onChange={setDayBoundary} />
        </Card>

        {/* Vucut Olculeri */}
        <Card title="Vücut Ölçüleri (Opsiyonel)">
          <Input label="Yağ Oranı (%)" value={bodyFat} onChangeText={setBodyFat} keyboardType="decimal-pad" placeholder="20" hint="3–60 %" error={bodyFatErr} />
          <Input label="Kas Oranı (%)" value={muscleMass} onChangeText={setMuscleMass} keyboardType="decimal-pad" placeholder="35" hint="10–70 %" error={muscleErr} />
          <Input label="Bel Çevresi (cm)" value={waist} onChangeText={setWaist} keyboardType="decimal-pad" placeholder="85" hint="40–200 cm" error={waistErr} />
          <Input label="Kalça Çevresi (cm)" value={hip} onChangeText={setHip} keyboardType="decimal-pad" placeholder="100" hint="40–200 cm" error={hipErr} />
          <Input label="Göğüs Çevresi (cm)" value={chest} onChangeText={setChest} keyboardType="decimal-pad" placeholder="95" hint="40–200 cm" error={chestErr} />
          <Input label="Uyluk Çevresi (cm)" value={thigh} onChangeText={setThigh} keyboardType="decimal-pad" placeholder="55" hint="20–120 cm" error={thighErr} />
        </Card>

        {/* FIX (ux-round3 #17): visually disable Save on invalid input (hasErrors already computed)
            instead of the 'bright button → tap → error Alert' anti-pattern. Inline field errors say
            what's wrong; handleSave keeps its guard as defense. */}
        <Button title="Kaydet" onPress={handleSave} loading={saving} disabled={hasErrors} size="lg" style={{ marginTop: SPACING.md }} />
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
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: SPACING.md }}>
      <Text style={{ color: colors.textSecondary, ...TYPE.body, marginBottom: SPACING.sm, fontWeight: '500' }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
        {options.map(opt => {
          const isSelected = selected === opt.value;
          return (
            <TouchableOpacity activeOpacity={MOTION.pressOpacity}
              key={opt.value}
              onPress={() => { haptics.tap(); onChange(opt.value); }}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${label}: ${opt.label}`}
              style={{ paddingVertical: 10, paddingHorizontal: SPACING.md, borderRadius: 8, borderWidth: 1,
                borderColor: isSelected ? colors.primary : colors.border,
                backgroundColor: isSelected ? colors.primary : 'transparent' }}>
              <Text style={{ color: isSelected ? getContrastColor(colors.primary) : colors.textSecondary, ...TYPE.body }}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

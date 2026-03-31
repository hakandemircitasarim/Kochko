import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS, SPACING, FONT } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { detectTimezone } from '@/lib/timezone';
import type { GoalType, ActivityLevel, Gender } from '@/types/database';

const { width } = Dimensions.get('window');

// ─── Welcome Slides ───

const SLIDES = [
  {
    title: 'Kochko\'ya Hosgeldin',
    body: 'Kochko senin kisisel beslenme ve yasam tarzi kocun. Seni tanir, ogrenr ve planini surekli gunceller.',
    icon: '🎯',
  },
  {
    title: 'Sohbet Et, Kayit Tut',
    body: 'Sohbet ederek seni tanir, plan yapar. Yedigini yaz, fotograf cek veya sesli anlat — gerisini Kochko halletsin.',
    icon: '💬',
  },
  {
    title: 'Hemen Baslayalim',
    body: 'Baslamak icin birkac bilgi yeterli. Geri kalani zamanla ogrenecegiz.',
    icon: '🚀',
  },
];

const GOAL_OPTIONS: { value: GoalType; label: string }[] = [
  { value: 'lose_weight', label: 'Kilo Vermek' },
  { value: 'gain_muscle', label: 'Kas Kazanmak' },
  { value: 'maintain', label: 'Kilomu Korumak' },
  { value: 'health', label: 'Saglikli Yasamak' },
  { value: 'conditioning', label: 'Kondisyon' },
];

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Erkek' },
  { value: 'female', label: 'Kadin' },
  { value: 'other', label: 'Diger' },
];

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string }[] = [
  { value: 'sedentary', label: 'Hareketsiz' },
  { value: 'light', label: 'Hafif Hareketli' },
  { value: 'moderate', label: 'Orta' },
  { value: 'active', label: 'Aktif' },
  { value: 'very_active', label: 'Cok Aktif' },
];

// ─── Main Screen ───

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const totalSteps = SLIDES.length + 1; // slides + form

  if (step < SLIDES.length) {
    return (
      <WelcomeSlide
        slide={SLIDES[step]}
        stepIndex={step}
        totalSlides={SLIDES.length}
        onNext={() => setStep(s => s + 1)}
        onSkip={() => setStep(SLIDES.length)}
      />
    );
  }

  return <QuickForm />;
}

// ─── Welcome Slide ───

function WelcomeSlide({
  slide,
  stepIndex,
  totalSlides,
  onNext,
  onSkip,
}: {
  slide: typeof SLIDES[0];
  stepIndex: number;
  totalSlides: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
      <Text style={{ fontSize: 64, marginBottom: SPACING.xl }}>{slide.icon}</Text>
      <Text style={{ fontSize: FONT.xl, fontWeight: '800', color: COLORS.text, textAlign: 'center', marginBottom: SPACING.md }}>
        {slide.title}
      </Text>
      <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: SPACING.xxl }}>
        {slide.body}
      </Text>

      {/* Dot indicators */}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xl }}>
        {Array.from({ length: totalSlides }).map((_, i) => (
          <View
            key={i}
            style={{
              width: i === stepIndex ? 24 : 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: i === stepIndex ? COLORS.primary : COLORS.border,
            }}
          />
        ))}
      </View>

      <View style={{ width: '100%', gap: SPACING.sm }}>
        <Button title="Ileri" onPress={onNext} size="lg" />
        <Button title="Atla" onPress={onSkip} variant="ghost" size="sm" />
      </View>
    </View>
  );
}

// ─── Quick Form (Katman 1) ───

function QuickForm() {
  const user = useAuthStore(s => s.user);
  const { update } = useProfileStore();
  const [saving, setSaving] = useState(false);

  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [goalType, setGoalType] = useState<GoalType | ''>('');
  const [activity, setActivity] = useState<ActivityLevel | ''>('');

  const isValid = heightCm && weightKg && gender && goalType && activity;

  const handleComplete = async () => {
    if (!user?.id || !isValid) return;
    setSaving(true);

    try {
      // 1. Create goal first
      const { error: goalError } = await supabase.from('goals').insert({
        user_id: user.id,
        goal_type: goalType,
        priority: 'sustainable',
        restriction_mode: 'sustainable',
        is_active: true,
        phase_order: 1,
      });

      if (goalError) {
        Alert.alert('Hata', 'Hedef olusturulurken bir sorun olustu. Tekrar deneyin.');
        setSaving(false);
        return;
      }

      // 2. Update profile (only after goal succeeds)
      const tz = detectTimezone();
      await update(user.id, {
        height_cm: parseInt(heightCm),
        weight_kg: parseFloat(weightKg),
        gender: gender as Gender,
        activity_level: activity as ActivityLevel,
        home_timezone: tz,
        active_timezone: tz,
        onboarding_completed: true,
      } as never);

      // 3. Navigate to chat
      router.replace('/(tabs)/chat');
    } catch {
      Alert.alert('Hata', 'Bir sorun olustu. Tekrar deneyin.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.xs }}>
          Seni Taniyalim
        </Text>
        <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>
          Sadece 5 bilgi ile baslayabilirsin. Geri kalani zamanla ogrenecegiz.
        </Text>

        {/* Physical */}
        <View style={{ marginBottom: SPACING.md }}>
          <Input label="Boy (cm)" value={heightCm} onChangeText={setHeightCm} keyboardType="numeric" placeholder="175" />
          <Input label="Kilo (kg)" value={weightKg} onChangeText={setWeightKg} keyboardType="decimal-pad" placeholder="80" />
        </View>

        {/* Gender */}
        <ChipSelect label="Cinsiyet" options={GENDER_OPTIONS} selected={gender} onChange={v => setGender(v as Gender)} />

        {/* Goal */}
        <ChipSelect label="Hedefin Ne?" options={GOAL_OPTIONS} selected={goalType} onChange={v => setGoalType(v as GoalType)} />

        {/* Activity */}
        <ChipSelect label="Aktivite Seviyesi" options={ACTIVITY_OPTIONS} selected={activity} onChange={v => setActivity(v as ActivityLevel)} />

        <Button
          title="Baslayalim!"
          onPress={handleComplete}
          loading={saving}
          disabled={!isValid}
          size="lg"
          style={{ marginTop: SPACING.lg }}
        />
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
          <TouchableOpacity
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={{
              paddingVertical: 8,
              paddingHorizontal: SPACING.md,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: selected === opt.value ? COLORS.primary : COLORS.border,
              backgroundColor: selected === opt.value ? COLORS.primary : 'transparent',
            }}
          >
            <Text style={{ color: selected === opt.value ? '#fff' : COLORS.textSecondary, fontSize: FONT.sm }}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

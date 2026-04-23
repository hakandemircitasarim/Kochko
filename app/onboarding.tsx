import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { detectTimezone } from '@/lib/timezone';
import { startTrialIfEligible } from '@/services/subscription.service';
import { loadOnboardingDraft, saveOnboardingDraft, clearOnboardingDraft, type OnboardingDraft } from '@/services/onboarding-draft.service';
import type { GoalType, ActivityLevel, Gender } from '@/types/database';

const { width } = Dimensions.get('window');

// ─── Welcome Slides ───

const SLIDES = [
  {
    title: 'Kochko\'ya Hoşgeldin',
    body: 'Kochko senin kişisel beslenme ve yaşam tarzı koçun. Seni tanır, öğrenir ve planını sürekli günceller.',
    icon: 'heart-circle' as const,
  },
  {
    title: 'Sohbet Et, Kayıt Tut',
    body: 'Sohbet ederek seni tanır, plan yapar. Yediğini yaz, fotoğraf çek veya sesli anlat — gerisini Kochko halletsin.',
    icon: 'chatbubble-ellipses' as const,
  },
  {
    title: 'Hemen Başlayalım',
    body: 'Başlamak için birkaç bilgi yeterli. Geri kalanı zamanla öğreneceğiz.',
    icon: 'rocket' as const,
  },
];

const GOAL_OPTIONS: { value: GoalType; label: string }[] = [
  { value: 'lose_weight', label: 'Kilo Vermek' },
  { value: 'gain_muscle', label: 'Kas Kazanmak' },
  { value: 'maintain', label: 'Kilomu Korumak' },
  { value: 'health', label: 'Sağlıklı Yaşamak' },
  { value: 'conditioning', label: 'Kondisyon' },
];

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Erkek' },
  { value: 'female', label: 'Kadın' },
  { value: 'other', label: 'Diğer' },
];

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string }[] = [
  { value: 'sedentary', label: 'Hareketsiz' },
  { value: 'light', label: 'Hafif Hareketli' },
  { value: 'moderate', label: 'Orta' },
  { value: 'active', label: 'Aktif' },
  { value: 'very_active', label: 'Çok Aktif' },
];

// ─── Main Screen ───

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [initialDraft, setInitialDraft] = useState<OnboardingDraft | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    loadOnboardingDraft().then((draft) => {
      if (draft) {
        setStep(draft.step);
        setInitialDraft(draft);
      }
      setHydrated(true);
    });
  }, []);

  // Persist step as the user advances so the slide position survives a kill.
  useEffect(() => {
    if (!hydrated) return;
    saveOnboardingDraft({ ...(initialDraft ?? { step: 0 }), step });
  }, [step, hydrated, initialDraft]);

  if (!hydrated) {
    return <View style={{ flex: 1, backgroundColor: COLORS.background }} />;
  }

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

  return <QuickForm initialDraft={initialDraft} />;
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
      <View style={{
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: COLORS.primary + '20',
        alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xl,
      }}>
        <Ionicons name={slide.icon} size={36} color={COLORS.primary} />
      </View>
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
        <Button title="İleri" onPress={onNext} size="lg" />
        <Button title="Atla" onPress={onSkip} variant="ghost" size="sm" />
      </View>
    </View>
  );
}

// ─── Quick Form (Katman 1) ───

function QuickForm({ initialDraft }: { initialDraft: OnboardingDraft | null }) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { update } = useProfileStore();
  const [saving, setSaving] = useState(false);

  const [heightCm, setHeightCm] = useState(initialDraft?.heightCm ?? '');
  const [weightKg, setWeightKg] = useState(initialDraft?.weightKg ?? '');
  const [targetWeightKg, setTargetWeightKg] = useState(initialDraft?.targetWeightKg ?? '');
  const [gender, setGender] = useState<Gender | ''>((initialDraft?.gender as Gender) ?? '');
  const [goalType, setGoalType] = useState<GoalType | ''>((initialDraft?.goalType as GoalType) ?? '');
  const [activity, setActivity] = useState<ActivityLevel | ''>((initialDraft?.activity as ActivityLevel) ?? '');

  // Debounced save of form fields — every keystroke would be overkill, but
  // flushing at most once per 500ms survives a crash without churn.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveOnboardingDraft({
        step: (initialDraft?.step ?? SLIDES.length),
        heightCm, weightKg, targetWeightKg, gender, goalType, activity,
      });
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [heightCm, weightKg, targetWeightKg, gender, goalType, activity, initialDraft?.step]);

  const needsTargetWeight = goalType === 'lose_weight' || goalType === 'gain_muscle';
  const isValid = heightCm && weightKg && gender && goalType && activity && (!needsTargetWeight || targetWeightKg);

  const handleComplete = async () => {
    if (!user?.id || !isValid) return;
    setSaving(true);

    try {
      // 1. Create goal first
      const w = parseFloat(weightKg);
      const targetWeight = targetWeightKg ? parseFloat(targetWeightKg) : w;
      const { error: goalError } = await supabase.from('goals').insert({
        user_id: user.id,
        goal_type: goalType,
        start_weight_kg: w,
        target_weight_kg: targetWeight,
        target_weeks: 12,
        weekly_rate: 0.5,
        priority: 'sustainable',
        restriction_mode: 'sustainable',
        is_active: true,
        phase_order: 1,
      });

      if (goalError) {
        Alert.alert('Hata', 'Hedef oluşturulurken bir sorun oluştu. Tekrar deneyin.');
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

      // 3. Start 7-day free trial if eligible (Spec 19.0)
      await startTrialIfEligible(user.id).catch(() => {});

      // 4. Clear the resume draft — onboarding is done.
      await clearOnboardingDraft();

      // 5. Navigate to chat
      router.replace('/(tabs)/chat');
    } catch {
      Alert.alert('Hata', 'Bir sorun oluştu. Tekrar deneyin.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.xs }}>
          Seni Tanıyalım
        </Text>
        <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>
          Sadece 5 bilgi ile başlayabilirsin. Geri kalanı zamanla öğreneceğiz.
        </Text>

        {/* Physical */}
        <View style={{ marginBottom: SPACING.md }}>
          <Input label="Boy (cm)" value={heightCm} onChangeText={setHeightCm} keyboardType="numeric" placeholder="175" />
          <Input label="Kilo (kg)" value={weightKg} onChangeText={setWeightKg} keyboardType="decimal-pad" placeholder="80" />
        </View>

        {/* Gender */}
        <ChipSelect label="Cinsiyet" options={GENDER_OPTIONS} selected={gender} onChange={v => setGender(v as Gender)} />

        {/* Goal */}
        <ChipSelect label="Hedefin Ne?" options={GOAL_OPTIONS} selected={goalType} onChange={v => { setGoalType(v as GoalType); setTargetWeightKg(''); }} />

        {/* Target Weight — shown only for lose_weight / gain_muscle */}
        {needsTargetWeight && (
          <View style={{ marginBottom: SPACING.md }}>
            <Input
              label="Hedef Kilo (kg)"
              value={targetWeightKg}
              onChangeText={setTargetWeightKg}
              keyboardType="decimal-pad"
              placeholder={goalType === 'lose_weight' ? '70' : '85'}
            />
          </View>
        )}

        {/* Activity */}
        <ChipSelect label="Aktivite Seviyesi" options={ACTIVITY_OPTIONS} selected={activity} onChange={v => setActivity(v as ActivityLevel)} />

        <Button
          title="Başlayalım!"
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
              borderRadius: RADIUS.pill,
              borderWidth: 0.5,
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

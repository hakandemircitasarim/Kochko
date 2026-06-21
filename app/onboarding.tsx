import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, FONT, RADIUS } from '@/lib/constants';
import { getContrastColor } from '@/lib/accessibility';
import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { detectTimezone } from '@/lib/timezone';
import { startTrialIfEligible } from '@/services/subscription.service';
import { loadOnboardingDraft, saveOnboardingDraft, clearOnboardingDraft, type OnboardingDraft } from '@/services/onboarding-draft.service';
import type { GoalType, ActivityLevel, Gender } from '@/types/database';
import { calculateBMR, calculateTDEE, calculateTargets } from '@/lib/tdee';

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
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isReOnboarding = mode === 're_onboarding';
  const [step, setStep] = useState(0);
  const [initialDraft, setInitialDraft] = useState<OnboardingDraft | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // FIX (audit UX-NAV-01): non-destructive exit from OPTIONAL re-onboarding — return to the app
  // WITHOUT running the goal/profile-rewriting save flow.
  const handleExit = () => {
    haptics.tap();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

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

  const body = step < SLIDES.length
    ? (
      <WelcomeSlide
        slide={SLIDES[step]}
        stepIndex={step}
        totalSlides={SLIDES.length}
        onNext={() => setStep(s => s + 1)}
        onSkip={() => setStep(SLIDES.length)}
      />
    )
    : <QuickForm initialDraft={initialDraft} />;

  // FIX (audit UX-NAV-01/HIGH): re-onboarding (dashboard "Güncelleme yap") is OPTIONAL, but the
  // screen had no back button and swipe-back is disabled (layout gestureEnabled:false), so the
  // ONLY exit was completing the form — which destructively rewrites the user's goal + profile.
  // Overlay a non-destructive close on every step so the user can leave with their data intact.
  if (!isReOnboarding) return body;
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {body}
      <TouchableOpacity
        onPress={handleExit}
        accessibilityRole="button"
        accessibilityLabel="Kapat ve geri dön"
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={{
          position: 'absolute', top: insets.top + 8, right: SPACING.md, zIndex: 20,
          width: 40, height: 40, borderRadius: 20,
          alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary + '20',
        }}
      >
        <Ionicons name="close" size={24} color={COLORS.text} />
      </TouchableOpacity>
    </View>
  );
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
      <View
        style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xl }}
        accessibilityRole="progressbar"
        accessibilityLabel={`Tanıtım adımı ${stepIndex + 1} / ${totalSlides}`}
      >
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
        <Button title="İleri" onPress={() => { haptics.tap(); onNext(); }} size="lg" />
        <Button title="Atla" onPress={() => { haptics.tap(); onSkip(); }} variant="ghost" size="sm" />
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

  // FIX (audit onboarding-birthyear): OAuth (Google/Apple) kullanıcılarında
  // user_metadata.birth_year YOKtur (sadece e-posta kaydında toplanır). Yaş
  // olmadan TDEE age=30'a düşer, introduce_yourself görevi tamamlanmaz ve
  // plan-readiness bloklanır. Yaş eksikse doğum yılını burada koşullu olarak topla.
  const metaBirthYear = Number((user as { user_metadata?: Record<string, unknown> })?.user_metadata?.birth_year);
  const nowYear = new Date().getFullYear();
  const needsBirthYear = !(Number.isFinite(metaBirthYear) && metaBirthYear > 1900);
  // FIX (audit onboarding-birthyear): doğum yılını taslaktan rehidre et — uygulama
  // mid-onboarding kapanırsa kullanıcı yeniden girmek zorunda kalmasın.
  const [birthYear, setBirthYear] = useState(initialDraft?.birthYear ?? '');

  // Debounced save of form fields — every keystroke would be overkill, but
  // flushing at most once per 500ms survives a crash without churn.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveOnboardingDraft({
        step: (initialDraft?.step ?? SLIDES.length),
        // FIX (audit onboarding-birthyear): doğum yılını da taslağa yaz.
        heightCm, weightKg, targetWeightKg, gender, goalType, activity, birthYear,
      });
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [heightCm, weightKg, targetWeightKg, gender, goalType, activity, birthYear, initialDraft?.step]);

  const needsTargetWeight = goalType === 'lose_weight' || goalType === 'gain_muscle';
  // FIX (audit onboarding-birthyear): doğum yılı eksikse zorunlu alana dahil et.
  const isValid = heightCm && weightKg && gender && goalType && activity && (!needsTargetWeight || targetWeightKg) && (!needsBirthYear || birthYear);

  // First missing field, so the disabled button can say *what* is blocking instead of just greying out.
  const missingLabel = !heightCm ? 'boyunu'
    : !weightKg ? 'kilonu'
    : !gender ? 'cinsiyetini'
    : !goalType ? 'hedefini'
    : (needsTargetWeight && !targetWeightKg) ? 'hedef kilonu'
    : !activity ? 'aktivite seviyeni'
    : (needsBirthYear && !birthYear) ? 'doğum yılını'
    : null;

  const handleComplete = async () => {
    if (!user?.id || !isValid) return;

    // FIX (audit onboarding-birthyear): doğum yılı bu ekranda toplanıyorsa
    // signUp'taki gibi 18+ doğrulaması yap (OAuth yolunda signUp guard'ı çalışmaz).
    if (needsBirthYear) {
      const by = parseInt(birthYear);
      if (!Number.isFinite(by) || by <= 1900 || by > nowYear) {
        haptics.error();
        Alert.alert('Geçersiz doğum yılı', 'Lütfen geçerli bir doğum yılı gir.');
        return;
      }
      if (nowYear - by < 18) {
        haptics.error();
        Alert.alert('Yaş sınırı', 'Bu uygulama 18 yaş ve üzeri içindir.');
        return;
      }
    }

    setSaving(true);

    try {
      // 1. Create goal first
      const w = parseFloat(weightKg);
      const targetWeight = targetWeightKg ? parseFloat(targetWeightKg) : w;
      // Single-active-goal invariant (migration 033): deactivate any existing active
      // goal first so a retry after a partial failure doesn't violate the unique index.
      await supabase.from('goals').update({ is_active: false }).eq('user_id', user.id).eq('is_active', true);
      // Derive the weekly rate from the entered target + 12-week horizon instead of a flat
      // 0.5 (which contradicted the target weight and made GoalProgress show a wrong tempo).
      // Clamp to the 1.0 kg/wk safety guardrail.
      const weeklyRate = (needsTargetWeight && targetWeight !== w)
        ? Math.min(1.0, Math.round((Math.abs(w - targetWeight) / 12) * 100) / 100)
        : 0.5;
      const { error: goalError } = await supabase.from('goals').insert({
        user_id: user.id,
        goal_type: goalType,
        start_weight_kg: w,
        target_weight_kg: targetWeight,
        target_weeks: 12,
        weekly_rate: weeklyRate,
        priority: 'sustainable',
        restriction_mode: 'sustainable',
        is_active: true,
        phase_order: 1,
      });

      if (goalError) {
        haptics.error();
        Alert.alert('Hata', 'Hedef oluşturulurken bir sorun oluştu. Tekrar deneyin.');
        setSaving(false);
        return;
      }

      // 2. Update profile (only after goal succeeds). Compute TDEE + calorie/macro targets here
      //    so the dashboard shows real numbers on first run instead of zeros. Birth year comes
      //    from the signup metadata (register.tsx collects it; the DB trigger also copies it to
      //    profiles since migration 044) — the old hardcoded age=30 skewed TDEE ~100 kcal for
      //    older users.
      const heightNum = parseInt(heightCm);
      // FIX (audit onboarding-birthyear): doğum yılı bu ekranda toplandıysa onu,
      // yoksa signup metadata'sındaki değeri kullan (metaBirthYear/nowYear bileşen
      // kapsamında tanımlı). Hiçbiri yoksa age=30 fallback'ine düş.
      const by = needsBirthYear ? parseInt(birthYear) : metaBirthYear;
      const age = Number.isFinite(by) && by > 1900 && by <= nowYear
        ? Math.max(18, nowYear - by)
        : 30;
      const bmr = calculateBMR(w, heightNum, age, gender as Gender);
      const tdee = calculateTDEE(bmr, activity as ActivityLevel);
      const targets = calculateTargets({
        tdee, goalType: goalType as GoalType, restrictionMode: 'sustainable',
        weeksSinceStart: 0, complianceAvg: 0, weightKg: w, gender: gender as Gender,
        macroPct: { protein: 30, carb: 40, fat: 30 },
      });
      const tz = detectTimezone();
      await update(user.id, {
        height_cm: heightNum,
        weight_kg: w,
        gender: gender as Gender,
        activity_level: activity as ActivityLevel,
        home_timezone: tz,
        active_timezone: tz,
        tdee_calculated: tdee,
        calorie_range_training_min: targets.trainingDay.min,
        calorie_range_training_max: targets.trainingDay.max,
        calorie_range_rest_min: targets.restDay.min,
        calorie_range_rest_max: targets.restDay.max,
        weekly_calorie_budget: targets.weeklyBudget,
        protein_per_kg: Math.round((targets.proteinG / w) * 100) / 100,
        onboarding_completed: true,
        // FIX (audit onboarding-birthyear): OAuth kullanıcısının doğum yılını
        // profiles'a kalıcı yaz; aksi halde birth_year süresiz NULL kalırdı.
        ...(needsBirthYear && birthYear ? { birth_year: parseInt(birthYear) } : {}),
      } as never);

      // 3. Start 7-day free trial if eligible (Spec 19.0)
      await startTrialIfEligible(user.id).catch(() => {});

      // 4. Clear the resume draft — onboarding is done.
      await clearOnboardingDraft();

      // 5. Celebrate the milestone, then navigate to chat
      haptics.success();
      router.replace('/(tabs)/chat');
    } catch {
      haptics.error();
      Alert.alert('Hata', 'Bir sorun oluştu. Tekrar deneyin.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingTop: SPACING.md + insets.top, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
        {/* Son adım pill — the slide dots are gone here, so signal the form is finite. */}
        <View style={{
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: SPACING.xs,
          paddingVertical: 4,
          paddingHorizontal: SPACING.sm,
          borderRadius: RADIUS.pill,
          backgroundColor: COLORS.primary + '20',
          marginBottom: SPACING.sm,
        }}>
          <Ionicons name="flag" size={12} color={COLORS.primary} />
          <Text style={{ fontSize: FONT.xs, fontWeight: '700', color: COLORS.primary }}>
            Son adım
          </Text>
        </View>
        <Text
          style={{ fontSize: FONT.xxl, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.xs }}
          accessibilityRole="header"
        >
          Seni Tanıyalım
        </Text>
        <Text style={{ fontSize: FONT.md, color: COLORS.textSecondary, marginBottom: SPACING.lg }}>
          Sadece 5 bilgi ile başlayalım — sonra Koç seni tanımaya başlayacak.
        </Text>

        {/* Physical */}
        <View style={{ marginBottom: SPACING.md }}>
          <Input label="Boy (cm)" value={heightCm} onChangeText={setHeightCm} keyboardType="numeric" placeholder="175" />
          <Input label="Kilo (kg)" value={weightKg} onChangeText={setWeightKg} keyboardType="decimal-pad" placeholder="80" />
          {/* FIX (audit onboarding-birthyear): yaş yalnızca OAuth/metadata'sız kullanıcılarda sorulur. */}
          {needsBirthYear && (
            <Input label="Doğum Yılı" value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" placeholder="1995" />
          )}
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

        {/* AI-first promise: bridge the slide-2 "Sohbet Et" hero to the post-submit chat. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.lg, marginBottom: SPACING.sm }}>
          <Ionicons name="chatbubble-ellipses" size={14} color={COLORS.primary} />
          <Text style={{ flex: 1, fontSize: FONT.sm, color: COLORS.textSecondary }}>
            Bunlar bitince Koç ile sohbete başlıyoruz.
          </Text>
        </View>

        {/* Tell the user *what* is still missing instead of just a dead grey button. */}
        {!isValid && missingLabel && (
          <Text style={{ fontSize: FONT.sm, color: COLORS.warning, marginBottom: SPACING.xs }}>
            Devam etmek için {missingLabel} seç.
          </Text>
        )}

        <Button
          title="Başlayalım!"
          onPress={handleComplete}
          loading={saving}
          disabled={!isValid}
          size="lg"
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
        {options.map(opt => {
          const isSelected = selected === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => { haptics.tap(); onChange(opt.value); }}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${opt.label}`}
              accessibilityState={{ selected: isSelected }}
              style={{
                minHeight: 44,
                justifyContent: 'center',
                paddingVertical: 8,
                paddingHorizontal: SPACING.md,
                borderRadius: RADIUS.pill,
                borderWidth: 0.5,
                borderColor: isSelected ? COLORS.primary : COLORS.border,
                backgroundColor: isSelected ? COLORS.primary : 'transparent',
              }}
            >
              <Text style={{ color: isSelected ? getContrastColor(COLORS.primary) : COLORS.textSecondary, fontSize: FONT.sm, fontWeight: isSelected ? '600' : '400' }}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

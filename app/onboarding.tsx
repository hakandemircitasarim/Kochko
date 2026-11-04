import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Dimensions, KeyboardAvoidingView, Platform, Animated, Easing } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, RADIUS } from '@/lib/constants';
import { TYPE, MOTION, mix } from '@/lib/design';
import { useTheme } from '@/lib/theme';
import { KochkoMascot } from '@/components/mascot/KochkoMascot';
import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { detectTimezone } from '@/lib/timezone';
import { startTrialIfEligible } from '@/services/subscription.service';
import { requestNotificationPermissionIfNeeded, savePushToken, scheduleNotificationsOnStartup } from '@/services/notifications.service';
import { loadOnboardingDraft, saveOnboardingDraft, clearOnboardingDraft, type OnboardingDraft } from '@/services/onboarding-draft.service';
import type { GoalType, ActivityLevel, Gender, Goal } from '@/types/database';
import { GENDER_LABELS_TR, ACTIVITY_LEVEL_LABELS_TR, GOAL_LABELS_INFINITIVE_TR, toOptions } from '@/lib/labels';
import { calculateBMR, calculateTDEE, calculateTargets } from '@/lib/tdee';

import { FREE_LAUNCH } from '@/lib/premium-gate';
import { formatDecimal } from '@/lib/units';
import { ChipSelect } from '@/components/ui/ChoiceTile';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ConfettiBurst } from '@/components/ui/ConfettiBurst';
const { width } = Dimensions.get('window');

// FIX (audit UX-ONB-05): tek bir 18+ doğum yılı kuralı. Bu ekrandaki OAuth doğum-yılı
// yakalama eskiden yalnızca '<=1900' reddediyordu (yani 1901 kabul ediliyordu) — register.tsx
// ise '<1920' reddediyordu, aynı 18+ politikasının iki farklı alt sınırı. register.tsx ile
// AYNI kuralı burada da uygula: min 1920, max currentYear, yaş>=18. (Sahip olunan dosyalar
// arası paylaşılan modül oluşturulamadığı için mantık register.tsx'i aynalar.)
const MIN_BIRTH_YEAR = 1920;
function validateBirthYear(raw: string): { year: number | null; error: string | null } {
  const year = parseInt(raw, 10);
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(year) || year < MIN_BIRTH_YEAR || year > currentYear) {
    return { year: null, error: 'Geçerli doğum yılı gir.' };
  }
  if (currentYear - year < 18) {
    return { year: null, error: 'Bu uygulama 18 yaş ve üzeri içindir.' };
  }
  return { year, error: null };
}

// ─── Welcome Slides ───

const SLIDES = [
  {
    // FIX (audit copy): TDK — 'hoş geldin' ayrı yazılır.
    title: 'Kochko\'ya Hoş Geldin',
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

// "Hedefin Ne?" cevapları mastar kipinde okunur — etiketler kanonik mastar
// haritasından gelir; SET küratedir (gain_weight onboarding'de bilinçli yok,
// sıra da bilinçli), o yüzden düz toOptions değil açık anahtar listesi.
const GOAL_OPTIONS: { value: GoalType; label: string }[] =
  (['lose_weight', 'gain_muscle', 'maintain', 'health', 'conditioning'] as GoalType[])
    .map(value => ({ value, label: GOAL_LABELS_INFINITIVE_TR[value] }));

const GENDER_OPTIONS = toOptions(GENDER_LABELS_TR);
const ACTIVITY_OPTIONS = toOptions(ACTIVITY_LEVEL_LABELS_TR);

// ─── Main Screen ───

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isReOnboarding = mode === 're_onboarding';
  // FIX (audit re-onboarding/HIGH): "Güncelleme yap" akışı yeni-kullanıcı tanıtım
  // slaytlarından BAŞLAMAZ — mevcut kullanıcı doğrudan forma iner.
  const [step, setStep] = useState(isReOnboarding ? SLIDES.length : 0);
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
    // FIX (audit re-onboarding/HIGH): güncelleme modunda AsyncStorage taslağı OKUNMAZ —
    // o taslak ilk kayıttan kalma (muhtemelen bayat) yeni-kullanıcı verisidir. Form,
    // mevcut profil + aktif hedeften doldurulur (QuickForm içinde).
    if (isReOnboarding) { setHydrated(true); return; }
    loadOnboardingDraft().then((draft) => {
      if (draft) {
        setStep(draft.step);
        setInitialDraft(draft);
      }
      setHydrated(true);
    });
  }, [isReOnboarding]);

  // Persist step as the user advances so the slide position survives a kill.
  useEffect(() => {
    // Güncelleme modunda taslak YAZILMAZ — yeni-kullanıcı devam taslağı kirlenmesin.
    if (!hydrated || isReOnboarding) return;
    saveOnboardingDraft({ ...(initialDraft ?? { step: 0 }), step });
  }, [step, hydrated, initialDraft, isReOnboarding]);

  if (!hydrated) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  const body = step < SLIDES.length
    ? (
      <WelcomeSlide
        slide={SLIDES[step]}
        stepIndex={step}
        totalSlides={SLIDES.length}
        onNext={() => setStep(s => s + 1)}
        onSkip={() => setStep(SLIDES.length)}
        onBack={() => setStep(s => Math.max(0, s - 1))}
      />
    )
    : <QuickForm initialDraft={initialDraft} isReOnboarding={isReOnboarding} />;

  // FIX (audit UX-NAV-01/HIGH): re-onboarding (dashboard "Güncelleme yap") is OPTIONAL, but the
  // screen had no back button and swipe-back is disabled (layout gestureEnabled:false), so the
  // ONLY exit was completing the form — which destructively rewrites the user's goal + profile.
  // Overlay a non-destructive close on every step so the user can leave with their data intact.
  if (!isReOnboarding) return body;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {body}
      <TouchableOpacity activeOpacity={MOTION.pressOpacity}
        onPress={handleExit}
        accessibilityRole="button"
        accessibilityLabel="Kapat ve geri dön"
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={{
          position: 'absolute', top: insets.top + 8, right: SPACING.md, zIndex: 20,
          width: 40, height: 40, borderRadius: 20,
          alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary + '20',
        }}
      >
        <Ionicons name="close" size={24} color={colors.text} />
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
  onBack,
}: {
  slide: typeof SLIDES[0];
  stepIndex: number;
  totalSlides: number;
  onNext: () => void;
  onSkip: () => void;
  onBack?: () => void;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  // Slayt geçişi (Duolingo dili): içerik ileri giderken sağdan, geri giderken soldan kayarak
  // gelir; maskot/ikon ardından yaylanarak oturur. Yön RENDER sırasında önceki adımla
  // kıyaslanır (ref layout effect'te güncellenir) — yeni içerik ilk karede doğru taraftan
  // başlar, eski konumda bir kare "parlamaz". Reduce-motion → anında.
  const prevStep = useRef(stepIndex);
  const dir = stepIndex >= prevStep.current ? 1 : -1;
  const enter = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(1)).current;
  useLayoutEffect(() => {
    if (prevStep.current === stepIndex) return;
    prevStep.current = stepIndex;
    if (reduceMotion) { enter.setValue(1); pop.setValue(1); return; }
    enter.setValue(0);
    pop.setValue(0.6);
    const a = Animated.parallel([
      Animated.timing(enter, { toValue: 1, duration: MOTION.slow, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(80),
        Animated.spring(pop, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }),
      ]),
    ]);
    a.start();
    return () => a.stop();
  }, [stepIndex, reduceMotion, enter, pop]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
      <Animated.View
        style={{
          alignItems: 'center', width: '100%',
          opacity: enter,
          transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [40 * dir, 0] }) }],
        }}
      >
      {/* İlk slayt uygulamanın EN İLK karesi — soyut ikon değil karakter karşılasın (§0-A).
          Sonraki slaytlar konu ikonlarını koruyor (her karede maskot tekrar etmesin). */}
      <Animated.View style={{ transform: [{ scale: pop }] }}>
      {stepIndex === 0 ? (
        <View style={{ marginBottom: SPACING.xl }}>
          <KochkoMascot size={112} mood="cheer" animated />
        </View>
      ) : (
      <View style={{
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: colors.primary + '20',
        alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xl,
      }}>
        <Ionicons name={slide.icon} size={36} color={colors.primary} />
      </View>
      )}
      </Animated.View>
      {/* Intro slides are the first thing anyone sees. The heading led at FONT.xl (20) — the same
          step a card title uses elsewhere — so the app's opening statement carried card weight. */}
      <Text style={{ ...TYPE.title1, color: colors.text, textAlign: 'center', marginBottom: SPACING.md }}>
        {slide.title}
      </Text>
      <Text style={{ ...TYPE.body, color: colors.textSecondary, textAlign: 'center', marginBottom: SPACING.xxl }}>
        {slide.body}
      </Text>
      </Animated.View>

      {/* Dot indicators */}
      <View
        style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xl }}
        accessibilityRole="progressbar"
        accessibilityLabel={`Tanıtım adımı ${stepIndex + 1} / ${totalSlides}`}
      >
        {Array.from({ length: totalSlides }).map((_, i) => (
          <SlideDot key={i} active={i === stepIndex} />
        ))}
      </View>

      <View style={{ width: '100%', gap: SPACING.sm }}>
        <Button title="İleri" onPress={() => { haptics.tap(); onNext(); }} size="lg" />
        {/* FIX (ux-round4 #31): slides were forward-only (dots inert, swipe-back disabled). Add an
            explicit, discoverable "Geri" on slides 2-3 so a too-fast İleri tap is recoverable. */}
        {stepIndex > 0 && onBack ? (
          <Button title="Geri" onPress={() => { haptics.tap(); onBack(); }} variant="ghost" size="sm" />
        ) : null}
        <Button title="Atla" onPress={() => { haptics.tap(); onSkip(); }} variant="ghost" size="sm" />
      </View>
    </View>
  );
}

/** Sayfa noktası: aktif olan 8 → 24 genişler, renk aynı anda geçer (reduce-motion: anında).
 *  Genişlik native driver'da çalışmaz; üç nokta için JS sürücüsü yeterince ucuz. */
function SlideDot({ active }: { active: boolean }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const t = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { t.setValue(active ? 1 : 0); return; }
    const a = Animated.timing(t, { toValue: active ? 1 : 0, duration: MOTION.base, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    a.start();
    return () => a.stop();
  }, [active, reduceMotion, t]);
  return (
    <Animated.View
      style={{
        width: t.interpolate({ inputRange: [0, 1], outputRange: [8, 24] }),
        height: 8,
        borderRadius: 4,
        backgroundColor: t.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.primary] }),
      }}
    />
  );
}

// ─── Quick Form (Katman 1) ───

/**
 * QuickForm — Duolingo soru akışı sunumu (2026-11-04):
 *  - Üstte BÖLÜM şeridi: Beden / Cinsiyet / Hedef / Aktivite, her biri kendi ProgressBar'ı
 *    (dolduruldukça akar, bitince etiket tik alır). Bölümler `requiredFilled` ile AYNI
 *    alanlardan türetilir — sayaç ile şerit hiçbir an çelişmez (bkz. aşağıdaki pay/payda notu).
 *  - Koçko konuşma balonuyla soruyu sorar (başlık balonun içinde, header rolü korunur).
 *  - Plan önizlemesi İLK kez belirdiği an (form gerçekten geçerli + hesap tuttu) ölçülü kutlama:
 *    kartta sevinen Koçko yayla girer + tek konfeti patlaması. Taslaktan dolu dönen formda
 *    patlamaz (geçiş yok), güncelleme modunda önizleme yok → kutlama da yok. Kaydederken
 *    karttaki Koçko düşünür (`thinking`).
 *  Doğrulama/kaydetme mantığı DEĞİŞMEDİ — burada yalnız sunum var.
 */
function QuickForm({ initialDraft, isReOnboarding }: { initialDraft: OnboardingDraft | null; isReOnboarding?: boolean }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { update, fetch: fetchProfile, profile } = useProfileStore();
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
  // FIX (audit UX-ONB-05): metadata yılını da MIN_BIRTH_YEAR (1920) eşiğiyle değerlendir —
  // imkansız bir yıl (örn. 1905) metadata'da varsa kullanıcıya yeniden sorulur.
  // FIX (audit re-onboarding): profiles.birth_year da bilinen kaynak sayılır — güncelleme
  // akışında (ve migration 044 sonrası profili dolu OAuth kullanıcılarında) yıl YENİDEN sorulmaz.
  const profileBirthYear = Number(profile?.birth_year);
  const isKnownYear = (y: number) => Number.isFinite(y) && y >= MIN_BIRTH_YEAR && y <= nowYear;
  const knownBirthYear = isKnownYear(metaBirthYear) ? metaBirthYear
    : isKnownYear(profileBirthYear) ? profileBirthYear
    : null;
  const needsBirthYear = knownBirthYear === null;
  // FIX (audit onboarding-birthyear): doğum yılını taslaktan rehidre et — uygulama
  // mid-onboarding kapanırsa kullanıcı yeniden girmek zorunda kalmasın.
  const [birthYear, setBirthYear] = useState(initialDraft?.birthYear ?? '');

  // FIX (audit re-onboarding/HIGH): "Güncelleme yap" akışında form BOŞ geliyordu — yalnızca
  // (muhtemelen bayat) AsyncStorage taslağından hidre oluyordu ve kullanıcı her şeyi yeniden
  // yazmak zorundaydı. Güncelleme modunda alanları mevcut profil + aktif hedeften doldur.
  const [activeGoal, setActiveGoal] = useState<Goal | null>(null);
  const profileSeededRef = useRef(false);
  useEffect(() => {
    if (!isReOnboarding || !profile || profileSeededRef.current) return;
    profileSeededRef.current = true;
    if (profile.height_cm) setHeightCm(String(profile.height_cm));
    if (profile.weight_kg) setWeightKg(formatDecimal(profile.weight_kg as number));
    if (profile.gender) setGender(profile.gender);
    if (profile.activity_level) setActivity(profile.activity_level);
  }, [isReOnboarding, profile]);
  useEffect(() => {
    if (!isReOnboarding || !user?.id) return;
    let cancelled = false;
    // Store boşsa (ör. derin bağlantıyla gelindi) profili tazele — yukarıdaki seed efekti
    // profil gelince bir kez çalışır.
    if (!profile) void fetchProfile(user.id);
    supabase
      .from('goals')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const g = data as Goal;
        setActiveGoal(g);
        setGoalType(g.goal_type);
        if (g.target_weight_kg && (g.goal_type === 'lose_weight' || g.goal_type === 'gain_muscle')) {
          setTargetWeightKg(formatDecimal(g.target_weight_kg as number));
        }
      });
    return () => { cancelled = true; };
    // profile/fetchProfile bilinçli olarak deps dışında: bu efekt yalnızca mount-anı yoklamasıdır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReOnboarding, user?.id]);

  // Debounced save of form fields — every keystroke would be overkill, but
  // flushing at most once per 500ms survives a crash without churn.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Güncelleme modunda taslak YAZILMAZ — mevcut kullanıcının düzenlemesi, yarıda kalmış
    // yeni-kullanıcı onboarding taslağını ezmemeli.
    if (isReOnboarding) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveOnboardingDraft({
        step: (initialDraft?.step ?? SLIDES.length),
        // FIX (audit onboarding-birthyear): doğum yılını da taslağa yaz.
        heightCm, weightKg, targetWeightKg, gender, goalType, activity, birthYear,
      });
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [heightCm, weightKg, targetWeightKg, gender, goalType, activity, birthYear, initialDraft?.step, isReOnboarding]);

  const needsTargetWeight = goalType === 'lose_weight' || goalType === 'gain_muscle';
  // FIX (audit onboarding-birthyear): doğum yılı eksikse zorunlu alana dahil et.
  const isValid = heightCm && weightKg && gender && goalType && activity && (!needsTargetWeight || targetWeightKg) && (!needsBirthYear || birthYear);

  // FIX (ux-round4 #30): positive completion momentum — how many required fields are filled.
  const requiredFilled = [
    !!heightCm, !!weightKg, !!gender, !!goalType, !!activity,
    ...(needsTargetWeight ? [!!targetWeightKg] : []),
    ...(needsBirthYear ? [!!birthYear] : []),
  ];
  const filledCount = requiredFilled.filter(Boolean).length;
  // NB the denominator legitimately moves: picking a lose/gain goal adds a target weight, and the
  // birth-year field drops out once a saved profile supplies one. Driving a fresh account showed
  // 0/6 -> 5/7 -> 6/6. Both numbers come from the same array so the fraction is never internally
  // wrong — the defect was the heading claiming a fixed "5 bilgi" alongside it (fixed below).
  // Resist "stabilising" this by freezing or ratcheting the total: freezing at mount would re-ask
  // a returning user for a birth year they already gave (`profile` loads async), and ratcheting
  // would strand the meter at 6/7 once a requirement legitimately disappears.
  const totalCount = requiredFilled.length;

  // Bölüm şeridi: requiredFilled'ın AYNI alanları, ekrandaki sırayla bölümlere ayrılmış
  // (toplam payda = totalCount). Sunum için; isValid/missingLabel'a karışmaz.
  const sections = [
    { key: 'body', label: 'Beden', fields: [!!heightCm, !!weightKg, ...(needsBirthYear ? [!!birthYear] : [])] },
    { key: 'gender', label: 'Cinsiyet', fields: [!!gender] },
    { key: 'goal', label: 'Hedef', fields: [!!goalType, ...(needsTargetWeight ? [!!targetWeightKg] : [])] },
    { key: 'activity', label: 'Aktivite', fields: [!!activity] },
  ].map((sec) => {
    const done = sec.fields.filter(Boolean).length;
    return { ...sec, progress: done / sec.fields.length, complete: done === sec.fields.length };
  });
  // Gri iz tek ton (§0-B gri gövde): açıkta progressTrack, koyuda border (0.08 orada fazla sessiz).
  const grayBody = isDark ? colors.border : colors.progressTrack;

  // FIX (ux-round4 #4): inline range errors for boy/kilo (comma-aware for kilo) instead of a
  // full-screen Alert only at submit — matches the target-weight inline treatment (#19).
  const heightNum = parseInt(heightCm);
  const heightError = heightCm.trim() && (!Number.isFinite(heightNum) || heightNum < 100 || heightNum > 230) ? '100–230 cm arası olmalı' : undefined;
  const weightNum = parseFloat(weightKg.replace(',', '.'));
  const weightError = weightKg.trim() && (!Number.isFinite(weightNum) || weightNum < 30 || weightNum > 300) ? '30–300 kg arası olmalı' : undefined;

  // FIX (ux-round4 #22): first-value preview — once the form is valid, show the calorie range +
  // goal ETA the SAME helpers (calculateBMR/TDEE/Targets) will produce on submit, so "Başlayalım!"
  // isn't a blind commit. Purely presentational; nothing is written until the user submits.
  const planPreview = useMemo(() => {
    if (!isValid || isReOnboarding) return null;
    const w = parseFloat(weightKg.replace(',', '.'));
    const h = parseInt(heightCm);
    if (!Number.isFinite(w) || !Number.isFinite(h) || heightError || weightError) return null;
    // FIX (ux-round4 #22 review): mirror the submit-time guards so the preview never advertises a
    // plan submit will reject. (1) target-direction (same as the inline dirError + handleComplete),
    // (2) birth-year validity for OAuth users typing an under-18/out-of-range year.
    const tw = targetWeightKg ? parseFloat(targetWeightKg.replace(',', '.')) : w;
    if (needsTargetWeight && Number.isFinite(tw)) {
      if (goalType === 'lose_weight' && tw >= w) return null;
      if (goalType === 'gain_muscle' && tw <= w) return null;
    }
    if (needsBirthYear && validateBirthYear(birthYear).error) return null;
    const by = needsBirthYear ? parseInt(birthYear) : (knownBirthYear ?? NaN);
    const age = Number.isFinite(by) && by >= MIN_BIRTH_YEAR && by <= nowYear ? Math.max(18, nowYear - by) : 30;
    try {
      const bmr = calculateBMR(w, h, age, gender as Gender);
      const tdee = calculateTDEE(bmr, activity as ActivityLevel);
      const targets = calculateTargets({
        tdee, goalType: goalType as GoalType, restrictionMode: 'sustainable',
        weeksSinceStart: 0, complianceAvg: 0, weightKg: w, gender: gender as Gender,
        macroPct: { protein: 30, carb: 40, fat: 30 },
        targetWeightKg: (needsTargetWeight && tw !== w) ? tw : null,
        targetWeeks: 12,
      });
      const kcalMin = Math.min(targets.restDay.min, targets.trainingDay.min);
      const kcalMax = Math.max(targets.restDay.max, targets.trainingDay.max);
      if (!Number.isFinite(kcalMin) || !Number.isFinite(kcalMax)) return null;
      return { kcalMin, kcalMax, w, tw, showGoal: needsTargetWeight && tw !== w };
    } catch {
      return null;
    }
  }, [isValid, isReOnboarding, weightKg, heightCm, birthYear, gender, activity, goalType, targetWeightKg, needsTargetWeight, needsBirthYear, knownBirthYear, nowYear, heightError, weightError]);

  // Kutlama anı: önizleme null → dolu İLK geçişinde, ekran başına BİR kez (mount'ta zaten
  // doluysa patlamaz). Tek seferlik çünkü sayı alanını düzeltirken ("84" → "8" → "84") önizleme
  // bir an kaybolup geri gelir — her seferinde konfeti "ölçülü kutlama"yı gürültüye çevirirdi.
  const planReady = !!planPreview;
  const wasPlanReady = useRef(planReady);
  const celebrated = useRef(false);
  const [burstKey, setBurstKey] = useState<number | null>(null);
  useEffect(() => {
    if (planReady && !wasPlanReady.current && !celebrated.current) {
      celebrated.current = true;
      setBurstKey(Date.now());
      haptics.success();
    }
    wasPlanReady.current = planReady;
  }, [planReady]);

  // First missing field, so the disabled button can say *what* is blocking instead of just greying out.
  // FIX (audit copy): fiil alana göre — yazılan alanlar için 'gir', chip alanları için 'seç'
  // ('boyunu seç' denmez, boy yazılır).
  const missingLabel = !heightCm ? 'boyunu gir'
    : !weightKg ? 'kilonu gir'
    : !gender ? 'cinsiyetini seç'
    : !goalType ? 'hedefini seç'
    : (needsTargetWeight && !targetWeightKg) ? 'hedef kilonu gir'
    : !activity ? 'aktivite seviyeni seç'
    : (needsBirthYear && !birthYear) ? 'doğum yılını gir'
    : null;

  const handleComplete = async () => {
    if (!user?.id || !isValid) return;

    // FIX (audit onboarding-birthyear): doğum yılı bu ekranda toplanıyorsa
    // signUp'taki gibi 18+ doğrulaması yap (OAuth yolunda signUp guard'ı çalışmaz).
    // FIX (audit UX-ONB-05): register.tsx ile AYNI paylaşılan kuralı kullan (min 1920,
    // yaş>=18) — eski '<=1900' alt sınırı 1901-1919 arası imkansız yılları kabul ediyordu.
    if (needsBirthYear) {
      const { error: birthYearError } = validateBirthYear(birthYear);
      if (birthYearError !== null) {
        haptics.error();
        Alert.alert('Geçersiz doğum yılı', birthYearError);
        return;
      }
    }

    // FIX (audit UX-ONB-03): tek bir yazım hatası (boy '17', kilo '8') doğrudan
    // calculateBMR/TDEE'ye akıp profili çöp kalori aralıklarıyla bozuyordu. DB
    // sütunları çok geniş ve istemci-tarafı clamp yoktu; doğum yılındaki 18+
    // koruma kalıbını aynalayarak makul sınırlarla reddet.
    const heightVal = parseInt(heightCm);
    // FIX (ux-round4 #19 review): parse comma-aware (Turkish decimal-pad emits '70,5'). The inline
    // direction hint already does .replace(',','.'); the submit path must match or the two disagree
    // (inline says OK, submit rejects) AND a comma value would be truncated ('70,9'→70) into the DB.
    const weightVal = parseFloat(weightKg.replace(',', '.'));
    if (!Number.isFinite(heightVal) || heightVal < 100 || heightVal > 230) {
      haptics.error();
      Alert.alert('Geçersiz boy', 'Lütfen 100-230 cm arasında geçerli bir boy gir.');
      return;
    }
    if (!Number.isFinite(weightVal) || weightVal < 30 || weightVal > 300) {
      haptics.error();
      Alert.alert('Geçersiz kilo', 'Lütfen 30-300 kg arasında geçerli bir kilo gir.');
      return;
    }
    if (needsTargetWeight) {
      const targetVal = parseFloat(targetWeightKg.replace(',', '.'));
      if (!Number.isFinite(targetVal) || targetVal < 30 || targetVal > 300) {
        haptics.error();
        Alert.alert('Geçersiz hedef kilo', 'Lütfen 30-300 kg arasında geçerli bir hedef kilo gir.');
        return;
      }
      // FIX (audit UX-ONB-02): hedef yönünü doğrula. 'Kilo Vermek' seçen biri mevcuttan
      // yüksek (veya 'Kas Kazanmak' mevcuttan düşük) hedef girerse handleComplete
      // Math.abs ile tutarsız bir tempo/ETA üretiyordu. goals tablosunda yön CHECK'i
      // yok ve validateWeeklyRate onboarding'den çağrılmıyor; burada inline engelle.
      if (goalType === 'lose_weight' && targetVal >= weightVal) {
        haptics.error();
        Alert.alert('Hedef kilo tutarsız', 'Kilo vermek için hedef kilo mevcut kilonun altında olmalı.');
        return;
      }
      if (goalType === 'gain_muscle' && targetVal <= weightVal) {
        haptics.error();
        Alert.alert('Hedef kilo tutarsız', 'Kas kazanmak için hedef kilo mevcut kilonun üstünde olmalı.');
        return;
      }
    }

    // FIX (audit re-onboarding/HIGH): hedef TÜRÜ değişiyorsa mevcut hedef süreci kapatılıp
    // yeni bir 12 haftalık hedef açılır — bunu SESSİZCE yapma, kullanıcıya sor. Tür aynıysa
    // (veya aktif hedef yoksa) onay gerekmez; submitForm hedefi yerinde günceller.
    if (isReOnboarding && activeGoal && activeGoal.goal_type !== goalType) {
      Alert.alert(
        'Hedef türün değişiyor',
        'Hedef türünü değiştirmek mevcut hedef sürecini kapatır ve yeni bir 12 haftalık hedef başlatır. Devam edilsin mi?',
        [
          { text: 'Vazgeç', style: 'cancel' },
          { text: 'Evet, değiştir', onPress: () => { void submitForm(true); } },
        ],
      );
      return;
    }
    await submitForm(false);
  };

  // replaceGoal=true yalnızca kullanıcı hedef TÜRÜ değişikliğini onayladığında gelir
  // (deactivate+insert yolu). Re-onboarding'de tür aynıysa aktif hedef YERİNDE güncellenir —
  // start_weight_kg/created_at ve dolayısıyla ilerleme çizelgesi korunur.
  const submitForm = async (replaceGoal: boolean) => {
    if (!user?.id) return;
    setSaving(true);

    try {
      // 1. Goal write
      // FIX (ux-round4 #19 review): comma-aware parse so a '70,5' isn't stored as 70.
      const w = parseFloat(weightKg.replace(',', '.'));
      const targetWeight = targetWeightKg ? parseFloat(targetWeightKg.replace(',', '.')) : w;
      // Derive the weekly rate from the entered target + 12-week horizon instead of a flat
      // 0.5 (which contradicted the target weight and made GoalProgress show a wrong tempo).
      // Clamp to the 1.0 kg/wk safety guardrail.
      const weeklyRate = (needsTargetWeight && targetWeight !== w)
        ? Math.min(1.0, Math.round((Math.abs(w - targetWeight) / 12) * 100) / 100)
        : 0.5;
      const goalToUpdate = isReOnboarding && !replaceGoal ? activeGoal : null;
      let goalError: { message: string } | null = null;
      if (goalToUpdate) {
        // FIX (audit re-onboarding/HIGH): eski akış her "güncelleme"de deactivate+insert
        // yapıyordu — hedef geçmişi sıfırlanıyor, GoalProgress sessizce "1. hafta"ya dönüyordu.
        const res = await supabase.from('goals').update({
          target_weight_kg: targetWeight,
          weekly_rate: weeklyRate,
        }).eq('id', goalToUpdate.id);
        goalError = res.error;
      } else {
        // Single-active-goal invariant (migration 033): deactivate any existing active
        // goal first so a retry after a partial failure doesn't violate the unique index.
        await supabase.from('goals').update({ is_active: false }).eq('user_id', user.id).eq('is_active', true);
        const res = await supabase.from('goals').insert({
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
        goalError = res.error;
      }

      if (goalError) {
        haptics.error();
        Alert.alert('Hata', 'Hedef kaydedilirken bir sorun oluştu. Tekrar deneyin.');
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
      // FIX (audit UX-ONB-05): yaş türetiminde de aynı MIN_BIRTH_YEAR (1920) eşiğini kullan.
      const by = needsBirthYear ? parseInt(birthYear) : (knownBirthYear ?? NaN);
      const age = Number.isFinite(by) && by >= MIN_BIRTH_YEAR && by <= nowYear
        ? Math.max(18, nowYear - by)
        : 30;
      const bmr = calculateBMR(w, heightNum, age, gender as Gender);
      const tdee = calculateTDEE(bmr, activity as ActivityLevel);
      const targets = calculateTargets({
        tdee, goalType: goalType as GoalType, restrictionMode: 'sustainable',
        weeksSinceStart: 0, complianceAvg: 0, weightKg: w, gender: gender as Gender,
        macroPct: { protein: 30, carb: 40, fat: 30 },
        // #journey HIGH: size the initial deficit to the goal timeline (onboarding uses a 12-week
        // default, matching the weekly_rate math above) instead of a flat 15%.
        targetWeightKg: (needsTargetWeight && targetWeight !== w) ? targetWeight : null,
        targetWeeks: 12,
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
      // FIX (audit trial-announce): deneme SESSİZCE başlıyordu — kullanıcının denemeden ilk
      // haberi korkutucu "Denemen X gün sonra bitiyor" banner'ı oluyordu. Başladıysa tek
      // satırla burada duyur.
      // FREE LAUNCH: no trials while everything is free — starting one would only stamp
      // premium_expires_at and resurrect countdown UI after the free period ends.
      const trial = FREE_LAUNCH ? { started: false } : await startTrialIfEligible(user.id).catch(() => ({ started: false }));

      // 4. Clear the resume draft — onboarding is done.
      await clearOnboardingDraft();

      // 5. Celebrate the milestone, then navigate to chat.
      haptics.success();

      // FIX (ux-ideas #16): permission priming — explain the value BEFORE the OS prompt. Cold
      // prompts (the old app-launch behavior) crater accept rates and a denial permanently kills
      // the whole proactive-coaching / re-engagement layer. New users only; not re-onboarding.
      // WEB: react-native-web does not implement Alert.alert — it is a no-op. This block awaits a
      // Promise that only resolves from an Alert button's onPress, so on web the await NEVER
      // returned: `finally { setSaving(false) }` never ran (the submit button stayed hidden), and
      // the router.replace below never executed. The user landed on a dead form whose data had
      // already been saved. Push notifications do not exist on web anyway, so the priming prompt
      // has nothing to prime — skip it rather than block the flow.
      if (!isReOnboarding && Platform.OS !== 'web') {
        await new Promise<void>((resolve) => {
          Alert.alert(
            'Koçun sana ulaşsın mı?',
            'Gece atıştırmadan önce, ivmen düşünce veya hedefe yaklaşınca Kochko doğru anda sana yazsın ister misin? İstediğin an ayarlardan kapatabilirsin.',
            [
              { text: 'Şimdi değil', style: 'cancel', onPress: () => resolve() },
              {
                text: 'Evet, izin ver',
                onPress: () => {
                  (async () => {
                    try {
                      const token = await requestNotificationPermissionIfNeeded();
                      if (token) { await savePushToken(user.id, token); await scheduleNotificationsOnStartup(user.id); }
                    } catch { /* best-effort */ }
                    resolve();
                  })();
                },
              },
            ],
            { cancelable: false },
          );
        });
      }

      if (trial.started) {
        Alert.alert('Premium deneme', '7 günlük Premium denemen başladı — tüm özellikler açık.');
      }
      // FIX (audit first-value/HIGH): çıplak '/(tabs)/chat' yeni kullanıcıyı SESSİZ boş sohbete
      // düşürüyordu — "Bunlar bitince Koç ile sohbete başlıyoruz" sözü tutulmuyordu (tek-thread
      // dünyasında chat ekranının isOnboarding karşılaması ölü koddu). Kanonik görev
      // parametreleriyle git (bkz. app/chat/[sessionId].tsx görev açıcısı: taskModeHint+taskNonce)
      // → Koç [SYSTEM_INIT] ile İLK sözü alır ve az önce girilen hedefi konuşarak sohbeti açar.
      // FIX (ux-ideas #19): time-to-value'yu 30sn+ canlı LLM açıcısına bağlama. Az önce
      // hesaplanan sayılardan (hedef + kalori) DETERMİNİSTİK bir karşılama kur ve chat'e
      // parametreyle geçir — chat bunu anında ilk balon olarak basar (LLM kesilse bile ilk
      // deneyim boş/hata değil, kişisel bir makbuz olur). Warm LLM açıcısı ardından gelir.
      const firstName = (profile?.display_name as string | undefined)?.trim().split(' ')[0];
      const namePart = firstName ? ` ${firstName}` : '';
      const fmtKg = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',');
      const midKcal = Math.round((targets.trainingDay.min + targets.trainingDay.max) / 2);
      const goalPart = (needsTargetWeight && targetWeight !== w)
        ? `Hedefin ${fmtKg(w)} → ${fmtKg(targetWeight)} kg. `
        : '';
      const onbWelcome = `Merhaba${namePart}! ${goalPart}Antrenman günlerinde ~${midKcal} kcal ile başlıyoruz — sayıları birlikte ince ayar yaparız. Hazırsan seni biraz daha tanıyayım.`;
      router.replace({
        pathname: '/(tabs)/chat',
        params: { taskModeHint: 'onboarding_goal', taskNonce: String(Date.now()), onbWelcome },
      });
    } catch {
      haptics.error();
      Alert.alert('Hata', 'Bir sorun oluştu. Tekrar deneyin.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      // FIX (audit UI-CHT-01 kalıbı): her iki platformda da 'padding'. Expo SDK 55'in zorunlu
      // edge-to-edge'i altında Android 'height' pencereyi yanlış ölçüyor ve alanları/butonu
      // klavyenin altında bırakabiliyordu (bkz. app/chat/[sessionId].tsx'teki aynı fix notu).
      // İçerik ScrollView'da olduğundan 'padding' ile submit butonu kaydırarak erişilebilir kalır.
      behavior="padding"
    >
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingTop: SPACING.md + insets.top, paddingBottom: SPACING.xxl + insets.bottom }} keyboardShouldPersistTaps="handled">
        {/* Bölüm şeridi — eski "Son adım" hapı + tek ince çubuğun yerine (FIX ux-round4 #30'un
            "bitiş çizgisine ivme" amacı aynı). Form sonlu ve dört parçalı görünür; dolan bölüm
            tik alır. Güncelleme modunda gizli (orada "son adım" anlamsız — FIX audit re-onboarding). */}
        {!isReOnboarding && (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`${filledCount}/${totalCount} bilgi hazır`}
            accessibilityValue={{ min: 0, max: totalCount, now: filledCount }}
            style={{ flexDirection: 'row', gap: 6, marginBottom: SPACING.lg }}
          >
            {sections.map((sec) => (
              <View key={sec.key} style={{ flex: 1 }}>
                <ProgressBar progress={sec.progress} color={colors.primary} height={10} trackColor={grayBody} />
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 6 }}>
                  {sec.complete && <Ionicons name="checkmark-circle" size={13} color={colors.primary} />}
                  <Text
                    numberOfLines={1}
                    style={{ ...TYPE.caption, fontWeight: '700', color: sec.complete ? colors.primary : colors.textSecondary }}
                  >
                    {sec.label}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
        {/* Koçko soruyu sorar: maskot + konuşma balonu (Duolingo soru ekranı). Başlık balonun
            içinde; header rolü ve metinler aynı.
            FIX (audit re-onboarding): mevcut kullanıcıya yeni-kullanıcı kopyası ("Seni
            Tanıyalım") gösterme — bu bir güncelleme ekranı. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.xl }}>
          <KochkoMascot size={76} animated enter />
          <View
            style={{
              flex: 1, backgroundColor: colors.card, borderRadius: RADIUS.lg,
              borderWidth: 2, borderColor: grayBody, padding: SPACING.md,
            }}
          >
            {/* Balon kuyruğu: maskota bakan, çerçevesi balonla aynı 45° kare. */}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute', left: -8, top: '50%', marginTop: -7, width: 14, height: 14,
                backgroundColor: colors.card, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: grayBody,
                transform: [{ rotate: '45deg' }],
              }}
            />
            <Text
              style={{ ...TYPE.title2, fontWeight: '800', color: colors.text, marginBottom: SPACING.xs }}
              accessibilityRole="header"
            >
              {isReOnboarding ? 'Bilgilerini güncelle' : 'Seni tanıyalım'}
            </Text>
            <Text style={{ ...TYPE.callout, color: colors.textSecondary }}>
              {isReOnboarding
                ? 'Bilgilerin mevcut hallerinle dolu geliyor — sadece değişenleri düzelt.'
                /* Was "Sadece 5 bilgi ile başlayalım". Live-driven on a fresh account, the meter next
                   to this line read 0/6, then 5/7 after a goal was picked, then 6/6 — three different
                   totals while the copy insisted on a fourth. The count genuinely varies (a
                   lose/gain goal adds a target weight), so the honest fix is to stop naming a number
                   here and let the meter be the single source of truth. */
                : 'Birkaç bilgiyle başlayalım — sonra Koç seni tanımaya başlayacak.'}
            </Text>
          </View>
        </View>

        {/* Physical */}
        <View style={{ marginBottom: SPACING.md }}>
          <Input label="Boy (cm)" value={heightCm} onChangeText={setHeightCm} keyboardType="numeric" placeholder="175" error={heightError} />
          <Input label="Kilo (kg)" value={weightKg} onChangeText={setWeightKg} keyboardType="decimal-pad" placeholder="80" error={weightError} />
          {/* FIX (audit onboarding-birthyear): yaş yalnızca OAuth/metadata'sız kullanıcılarda sorulur. */}
          {needsBirthYear && (
            <Input label="Doğum Yılı" value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" placeholder="1995" />
          )}
        </View>

        {/* Gender */}
        <ChipSelect label="Cinsiyet" options={GENDER_OPTIONS} selected={gender} onChange={v => setGender(v as Gender)} />

        {/* Goal */}
        {/* FIX (audit chip-wipe): zaten seçili chip'e tekrar dokunmak yazılmış hedef kiloyu
            SİLİYORDU — hedef kilo yalnızca hedef türü gerçekten değişince sıfırlanır. */}
        <ChipSelect label="Hedefin Ne?" options={GOAL_OPTIONS} selected={goalType} onChange={v => { if (v === goalType) return; setGoalType(v as GoalType); setTargetWeightKg(''); }} />

        {/* Target Weight — shown only for lose_weight / gain_muscle */}
        {/* FIX (ux-round4 #19 + #4): anchor the target to the current weight with a hint, and catch
            the wrong-direction case inline (red) BEFORE submit — the old flow only rejected it at
            "Başlayalım!" with a full-screen Alert. The submit-time Alert stays as a safety net. */}
        {needsTargetWeight && (() => {
          const cur = parseFloat(weightKg.replace(',', '.'));
          const tgt = parseFloat(targetWeightKg.replace(',', '.'));
          const hasCur = Number.isFinite(cur);
          const dirHint = goalType === 'lose_weight' ? 'daha düşük bir hedef gir' : 'daha yüksek bir hedef gir';
          const hint = hasCur ? `Mevcut kilon ${weightKg} kg — ${dirHint}` : undefined;
          const dirError = (hasCur && Number.isFinite(tgt))
            ? (goalType === 'lose_weight' && tgt >= cur ? 'Hedef, mevcut kilonun altında olmalı'
              : goalType === 'gain_muscle' && tgt <= cur ? 'Hedef, mevcut kilonun üstünde olmalı'
              : undefined)
            : undefined;
          return (
            <View style={{ marginBottom: SPACING.md }}>
              <Input
                label="Hedef Kilo (kg)"
                value={targetWeightKg}
                onChangeText={setTargetWeightKg}
                keyboardType="decimal-pad"
                placeholder={goalType === 'lose_weight' ? '70' : '85'}
                hint={hint}
                error={dirError}
              />
            </View>
          );
        })()}

        {/* Activity */}
        <ChipSelect label="Aktivite Seviyesi" options={ACTIVITY_OPTIONS} selected={activity} onChange={v => setActivity(v as ActivityLevel)} />

        {/* AI-first promise: bridge the slide-2 "Sohbet Et" hero to the post-submit chat. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.lg, marginBottom: SPACING.sm }}>
          <Ionicons name="chatbubble-ellipses" size={14} color={colors.primary} />
          <Text style={{ ...TYPE.body, flex: 1, color: colors.textSecondary }}>
            {isReOnboarding
              ? 'Kaydettiğinde Koç güncel bilgilerinle devam edecek.'
              : 'Bunlar bitince Koç ile sohbete başlıyoruz.'}
          </Text>
        </View>

        {/* Tell the user *what* is still missing instead of just a dead grey button. */}
        {!isValid && missingLabel && (
          <Text style={{ ...TYPE.caption, color: colors.warning, marginBottom: SPACING.xs }}>
            Devam etmek için {missingLabel}.
          </Text>
        )}

        {/* FIX (ux-round4 #22): first-value preview above the commit button.
            Kutlama kartı: sevinen Koçko (ilk belirişte yayla) + tek konfeti patlaması (burstKey
            yalnız null→dolu geçişinde değişir). Kaydederken Koçko düşünür. Yüz opak `mix`. */}
        {planPreview && (
          <View style={{ marginBottom: SPACING.md }}>
            <View
              style={{
                flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
                backgroundColor: mix(colors.primary, colors.background, isDark ? 0.16 : 0.08),
                borderWidth: 2, borderColor: mix(colors.primary, colors.background, isDark ? 0.42 : 0.28),
                borderRadius: RADIUS.lg, padding: SPACING.md,
              }}
            >
              <KochkoMascot size={68} mood={saving ? 'thinking' : 'cheer'} enter />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Ionicons name="sparkles" size={13} color={colors.primary} />
                  <Text style={{ ...TYPE.overline, color: colors.primary }}>TAHMİNİ BAŞLANGIÇ PLANIN</Text>
                </View>
                <Text style={{ ...TYPE.title3, fontWeight: '800', color: colors.text }}>
                  ~{planPreview.kcalMin}–{planPreview.kcalMax} kcal/gün
                </Text>
                {planPreview.showGoal && (
                  <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 2 }}>
                    {String(planPreview.w).replace('.', ',')} → {String(planPreview.tw).replace('.', ',')} kg · ~12 hafta
                  </Text>
                )}
                <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: 4 }}>
                  Koç bunları seninle konuşarak inceltecek.
                </Text>
              </View>
            </View>
            <ConfettiBurst burstKey={burstKey} count={28} spread={150} />
          </View>
        )}

        <Button
          title={isReOnboarding ? 'Kaydet' : 'Başlayalım!'}
          onPress={handleComplete}
          loading={saving}
          disabled={!isValid}
          size="lg"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

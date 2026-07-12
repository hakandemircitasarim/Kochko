/**
 * Profile completion donut — home screen hero (MASTER_PLAN §5 Phase 4).
 *
 * The headline % is derived from the SAME 13-task source as the chat tab's
 * "X/13 konu" progress (onboarding-tasks.service.getOnboardingProgress:
 * completed/total) so the dashboard and chat never disagree. The donut
 * self-fetches that progress for the signed-in user and re-fetches whenever the
 * profile object changes (which is exactly when onboarding data lands).
 *
 * profile-completion.ts is still used only for the one-line gap hint (which
 * basic field / lowest category to fill next), not for the headline number.
 *
 * Renders an animated SVG donut with % in the center and the next-gap hint.
 * Tap routes to the Kochko tab's onboarding task list.
 */
import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Animated, Easing } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { useAuthStore } from '@/stores/auth.store';
import { getOnboardingProgress, getIncompleteTasks, type OnboardingTask } from '@/services/onboarding-tasks.service';
import { SkeletonCard } from '@/components/ui/Skeleton';
import {
  calculateProfileCompletion,
  CATEGORY_LABELS,
  type ProfileCategory,
} from '@/lib/profile-completion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  profile: Record<string, unknown> | null;
  size?: number;   // outer diameter
  stroke?: number; // ring thickness
}

export function ProfileCompletionDonut({ profile, size = 120, stroke = 10 }: Props) {
  const { colors } = useTheme();
  const userId = useAuthStore(s => s.user?.id);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = useRef(new Animated.Value(0)).current;

  // Headline % comes from the 13-task onboarding progress — the exact same
  // source the chat tab uses for "X/13 konu" — so the two screens always agree.
  // null = not yet loaded.
  const [taskProgress, setTaskProgress] = useState<{ completed: number; total: number } | null>(null);
  // FIX (ux-pass2 #6): "Görevlere git" CTA'sının açacağı SIRADAKİ eksik görev — chat'e
  // parametresiz düşmek yerine koç doğru konuyu açsın diye taskModeHint'iyle taşınır.
  const [nextTask, setNextTask] = useState<OnboardingTask | null>(null);

  // FIX (ux-pass2 #6a): profil kimliğine kilitli useEffect yerine her focus'ta tazele —
  // chat'te görev tamamlayıp dönünce yüzde ve sıradaki görev anında güncellenir.
  useFocusEffect(useCallback(() => {
    if (!userId) {
      setTaskProgress(null);
      return;
    }
    let cancelled = false;
    Promise.all([getOnboardingProgress(userId), getIncompleteTasks(userId, 1)])
      .then(([p, tasks]) => {
        if (cancelled) return;
        setTaskProgress(p);
        setNextTask(tasks[0] ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId]));

  // Gap-hint text (which field/category to fill next) still uses the weighted
  // profile-completion calc; only the headline number switched to task progress.
  const result = useMemo(() => {
    if (!profile) return null;
    return calculateProfileCompletion(profile);
  }, [profile]);

  const pct = taskProgress
    ? Math.round((taskProgress.completed / taskProgress.total) * 100)
    : 0;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: pct / 100,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [pct, progress]);

  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  // FIX (ux-pass2 #6b): pct<40 → colors.error yepyeni kullanıcıyı alarm kırmızısı bir
  // halkayla karşılıyordu. Onboarding ilerlemesi gerileyemez — kırmızı (regresyon) burada
  // hiç geçerli değil; halka baştan sona marka rengi.
  const ringColor = colors.primary;

  const hintLine = useMemo(() => {
    // FIX (audit: donut 13-görev vs 24-alan çelişkisi) headline pct=100 iken
    // gap-ipucu (24-alan calc) hâlâ "X tamamla" diyebiliyordu. Headline tek
    // kaynak (13-görev) olduğundan pct=100'de ipucunu olumlu metne sabitle.
    if (pct === 100) return 'Profilin tamam — Koçko seni tam tanıyor';
    if (!result) return 'Profil yükleniyor…';
    if (result.missingRequired.length > 0) {
      return `${result.missingRequired.length} temel bilgi eksik`;
    }
    if (result.lowestCategory) {
      return `${CATEGORY_LABELS[result.lowestCategory as ProfileCategory]} tamamla`;
    }
    return 'Profilin tamam — Koçko seni tam tanıyor';
  }, [result, pct]);

  // Until the 13-task progress lands, show a skeleton instead of flashing a
  // misleading 0% / red ring on every cold load.
  if (!taskProgress) {
    return <SkeletonCard lines={2} />;
  }

  // FIX (ux-pass2 #6c): profil %100 ise kart tamamen kaybolur — bitmiş bir işi
  // sonsuza dek kutlayan ölü alan bırakma.
  if (pct === 100) {
    return null;
  }

  return (
    <TouchableOpacity
      onPress={() => {
        // FIX (ux-pass2 #6): CTA eskiden chat'i parametresiz açıyordu — kullanıcı görev
        // bağlamı olmadan sohbet geçmişinin ortasına düşüyordu. Sıradaki eksik görevin
        // kanonik paramlarıyla (prefill + taskModeHint + taskNonce) aç.
        if (nextTask) {
          router.push({
            pathname: '/(tabs)/chat',
            params: {
              prefill: nextTask.prefillMessage,
              taskModeHint: nextTask.taskModeHint,
              taskNonce: String(Date.now()),
            },
          });
        } else {
          router.push('/(tabs)/chat' as never);
        }
      }}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Profil tamamlama yüzdesi ${pct}. ${hintLine}`}
      accessibilityHint="Görevleri açmak için dokun"
      style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: colors.border,
        padding: SPACING.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.md,
      }}
    >
      {/* Donut */}
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
          {/* track */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={colors.progressTrack ?? colors.surfaceLight}
            strokeWidth={stroke}
          />
          {/* progress */}
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={stroke}
            strokeDasharray={`${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </Svg>
        <View style={{ position: 'absolute', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontSize: FONT.xxl, fontWeight: '800' }}>
            {pct}%
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 1 }}>
            PROFIL
          </Text>
        </View>
      </View>

      {/* Right side: hint + CTA */}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: FONT.md, fontWeight: '700' }}>
          {pct === 100 ? 'Profilin hazır' : 'Profilini tamamla'}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: FONT.xs, marginTop: 2 }}>
          {hintLine}
        </Text>
        {pct < 100 ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              marginTop: SPACING.sm,
              alignSelf: 'flex-start',
              backgroundColor: ringColor + '18',
              borderRadius: RADIUS.full,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Ionicons name="arrow-forward-circle" size={13} color={ringColor} />
            <Text style={{ color: ringColor, fontSize: FONT.xs, fontWeight: '700' }}>
              Görevlere git
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

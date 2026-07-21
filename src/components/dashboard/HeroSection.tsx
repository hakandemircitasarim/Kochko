/**
 * Dashboard Hero Section — flat dark design
 * Full-width card with calorie ring, header, macro bars.
 */
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, METRIC_COLORS } from '@/lib/theme';
import { haptics } from '@/lib/haptics'; // FIX (ux-polish): the hero CTAs are the most-prominent buttons but had no tap feedback.
import { CircularProgress } from '@/components/ui/CircularProgress';
import { StreakBadge } from '@/components/tracking/StreakBadge';
import { SPACING, FONT, RADIUS, HERO } from '@/lib/constants';
import { a11yProgress, formatProgressForScreenReader, getContrastColor } from '@/lib/accessibility';

interface Props {
  today: string;
  streak: number;
  focusMessage: string | null;
  consumed: number;
  targetMin: number;
  targetMax: number;
  protein: number;
  proteinTarget: number;
  carbs: number;
  carbsTarget?: number;
  fat: number;
  fatTarget?: number;
  ifActive: boolean;
  ifEatingStart: string | null;
  ifEatingEnd: string | null;
  userName?: string;
}

function MacroBar({ label, value, target, color, emphasize = false }: { label: string; value: number; target: number; color: string; emphasize?: boolean }) {
  const { colors } = useTheme();
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  // FIX (ux-ideas #1): the single most-behind macro gets a "kaldı" (remaining)
  // hint in its own accent colour — a glanceable "focus this next" cue — while
  // the others keep the neutral value/target readout.
  const remaining = Math.max(0, target - value);

  return (
    <View
      style={{ flex: 1 }}
      {...a11yProgress(label, value, target)}
      accessibilityLabel={`${label}: ${formatProgressForScreenReader(value, target, 'g')}${emphasize && remaining > 0 ? `, ${remaining} gram kaldı` : ''}`}
    >
      <Text
        style={{ color: colors.textSecondary, fontSize: 11, marginBottom: 4 }}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </Text>
      <View style={{ height: 6, backgroundColor: colors.progressTrack, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
      {emphasize && remaining > 0 ? (
        <Text
          style={{ color, fontSize: 11, marginTop: 3, fontWeight: '700' }}
          maxFontSizeMultiplier={1.3}
        >
          {remaining}g kaldı
        </Text>
      ) : (
        <Text
          style={{ color: colors.textSecondary, fontSize: 11, marginTop: 3 }}
          maxFontSizeMultiplier={1.3}
        >
          {value}/{target}g
        </Text>
      )}
    </View>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'İyi geceler';
  if (hour < 12) return 'Günaydın';
  if (hour < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

export function HeroSection({
  today, streak, focusMessage,
  consumed, targetMin, targetMax, protein, proteinTarget,
  carbs, carbsTarget = 200, fat, fatTarget = 65,
  ifActive, ifEatingStart, ifEatingEnd, userName,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const hasTargets = targetMax > 0;
  const targetMid = hasTargets ? Math.round((targetMin + targetMax) / 2) : 0;
  const pct = hasTargets ? Math.min(1, consumed / targetMax) : 0;
  // FIX (ux-ideas #1): the ring answers the most actionable mid-day question —
  // "how much more can I eat?" — by showing REMAINING (to target) as the big
  // number. Past target → show the overage as "+N", amber; past the ceiling
  // (targetMax) → error red. Consumed/target stays visible as the sublabel.
  const remainingKcal = targetMid - consumed;
  const overTarget = remainingKcal < 0;
  const overMax = hasTargets && consumed > targetMax;
  const ringColor = !overTarget ? METRIC_COLORS.calories : overMax ? colors.error : colors.warning;
  const ringValue: string | number = overTarget ? `+${Math.abs(remainingKcal)}` : remainingKcal;
  const ringLabel = overTarget ? 'kcal fazla' : 'kcal kaldı';
  const ringSub = `${consumed} / ${targetMid} kcal`;
  const ringA11y = overTarget
    ? `Kalori: hedefi ${Math.abs(remainingKcal)} kilokalori aştın, ${consumed} / ${targetMid}`
    : `Kalori: ${remainingKcal} kilokalori kaldı, ${consumed} / ${targetMid}`;
  // Most-behind macro (lowest fill ratio, still under target) → "kaldı" emphasis.
  const macroBehindKey = ([
    { key: 'protein', value: protein, target: proteinTarget },
    { key: 'carbs', value: carbs, target: carbsTarget },
    { key: 'fat', value: fat, target: fatTarget },
  ] as const)
    .filter(m => m.target > 0 && m.value < m.target)
    .sort((a, b) => a.value / a.target - b.value / b.target)[0]?.key;
  // FIX (ux-pass2 #1): "İyi akşamlar, Hakan Test" — selamlama soyad/tam ad değil,
  // yalnız ilk adla hitap eder.
  const firstName = userName?.trim().split(/\s+/)[0];

  return (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: SPACING.xl }}>
      {/* Header: Greeting + Streak */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md }}>
        <View style={{ flexShrink: 1 }}>
          {/* FIX (audit: tab başlık tutarlılığı) raw 18 → FONT.xl2 token hijyeni */}
          <Text style={{ fontSize: FONT.xl2, fontWeight: '700', color: colors.text }}>
            {getGreeting()}{firstName ? `, ${firstName}` : ''}
          </Text>
          {/* FIX (audit: ölü prop) today selamlamanın altına alt-metin olarak render edilir */}
          {today ? (
            <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, marginTop: 2 }} maxFontSizeMultiplier={1.3}>
              {today}
            </Text>
          ) : null}
        </View>
        <StreakBadge days={streak} />
      </View>

      {/* FIX (audit: üç offline banner) inline offline çip kaldırıldı —
          tek kaynak: global common/OfflineBanner (app/_layout.tsx) */}

      {/* Calorie Ring Card */}
      <View style={{
        backgroundColor: colors.card,
        borderRadius: RADIUS.md,
        borderWidth: 0.5,
        borderColor: colors.border,
        padding: SPACING.lg,
        alignItems: 'center',
        marginBottom: SPACING.md,
      }}>
        {hasTargets ? (
          <>
            <View
              {...a11yProgress('Kalori', consumed, targetMid)}
              accessibilityLabel={ringA11y}
            >
              <CircularProgress
                progress={pct}
                size={HERO.RING_SIZE}
                strokeWidth={HERO.RING_STROKE}
                color={ringColor}
                value={ringValue}
                label={ringLabel}
                sublabel={ringSub}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.xl, width: '100%' }}>
              <MacroBar label="Protein" value={protein} target={proteinTarget} color={METRIC_COLORS.protein} emphasize={macroBehindKey === 'protein'} />
              <MacroBar label="Karbonhidrat" value={carbs} target={carbsTarget} color={METRIC_COLORS.carbs} emphasize={macroBehindKey === 'carbs'} />
              <MacroBar label="Yağ" value={fat} target={fatTarget} color={METRIC_COLORS.fat} emphasize={macroBehindKey === 'fat'} />
            </View>
          </>
        ) : (
          /* FIX (ux-pass2 #13): boş durum eylemsiz bir View'dı — artık hedef-belirleme
             görevini açan gerçek bir CTA (kanonik onboarding_goal task paramlarıyla). */
          <TouchableOpacity
            onPress={() => { haptics.tap(); router.push({
              pathname: '/(tabs)/chat',
              params: {
                prefill: 'Hedeflerimi konuşmak istiyorum.',
                taskModeHint: 'onboarding_goal',
                taskNonce: String(Date.now()),
              },
            }); }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Henüz hedef belirlenmedi. Koçuna hedeflerini anlatmak için dokun"
            style={{ alignItems: 'center', paddingVertical: SPACING.xxl, alignSelf: 'stretch' }}
          >
            <Ionicons name="nutrition-outline" size={36} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: SPACING.md, textAlign: 'center' }}>
              Henüz hedef belirlenmedi
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: SPACING.sm }}>
              <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>
                Koçuna hedeflerini anlat
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.primary} />
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* FIX (ux-ideas #6): the app's most-repeated action — logging a meal — had NO quick path
          from the dashboard (only water/weight did). The ring's "kcal kaldı" already invites
          "let me log what I ate"; give it a primary button. Only when targets exist (a no-target
          user gets the goal CTA inside the ring card instead). */}
      {hasTargets && (
        <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
          <TouchableOpacity
            onPress={() => { haptics.tap(); router.push('/log'); }}
            accessibilityRole="button"
            accessibilityLabel="Öğün ekle"
            style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.primary }}
          >
            <Ionicons name="add-circle-outline" size={16} color={getContrastColor(colors.primary)} />
            <Text style={{ color: getContrastColor(colors.primary), fontSize: FONT.sm, fontWeight: '700' }}>Öğün ekle</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { haptics.tap(); router.push({ pathname: '/(tabs)/chat', params: { prefill: 'Bugün antrenman yaptım: ', taskNonce: String(Date.now()) } }); }}
            accessibilityRole="button"
            accessibilityLabel="Antrenman ekle"
            style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: colors.surfaceLight }}
          >
            <Ionicons name="barbell-outline" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: FONT.sm, fontWeight: '700' }}>Antrenman</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* IF Timer */}
      {ifActive && ifEatingStart && ifEatingEnd && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
          backgroundColor: colors.card, borderRadius: RADIUS.pill,
          paddingVertical: 6, paddingHorizontal: SPACING.xl, marginBottom: SPACING.md,
          borderWidth: 0.5, borderColor: colors.border,
          alignSelf: 'center',
        }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
          <Text
            style={{ color: colors.text, fontSize: 11, fontWeight: '500' }}
            maxFontSizeMultiplier={1.3}
            accessibilityLabel={`Yeme penceresi: ${ifEatingStart} - ${ifEatingEnd}`}
          >
            {ifEatingStart} - {ifEatingEnd}
          </Text>
        </View>
      )}

      {/* Focus Message */}
      {focusMessage && (
        <View style={{
          backgroundColor: colors.card,
          borderRadius: RADIUS.md,
          padding: SPACING.lg,
          marginBottom: SPACING.md,
          borderWidth: 0.5,
          borderColor: colors.border,
          borderLeftWidth: 3,
          borderLeftColor: colors.primary,
        }}>
          <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>{focusMessage}</Text>
        </View>
      )}
    </View>
  );
}

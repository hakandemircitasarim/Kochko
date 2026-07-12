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
import { CircularProgress } from '@/components/ui/CircularProgress';
import { StreakBadge } from '@/components/tracking/StreakBadge';
import { SPACING, FONT, RADIUS, HERO } from '@/lib/constants';
import { a11yProgress, formatProgressForScreenReader } from '@/lib/accessibility';

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

function MacroBar({ label, value, target, color }: { label: string; value: number; target: number; color: string }) {
  const { colors } = useTheme();
  const pct = target > 0 ? Math.min(1, value / target) : 0;

  return (
    <View
      style={{ flex: 1 }}
      {...a11yProgress(label, value, target)}
      accessibilityLabel={`${label}: ${formatProgressForScreenReader(value, target, 'g')}`}
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
      <Text
        style={{ color: colors.textSecondary, fontSize: 11, marginTop: 3 }}
        maxFontSizeMultiplier={1.3}
      >
        {value}/{target}g
      </Text>
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
              accessibilityLabel={`Kalori: ${formatProgressForScreenReader(consumed, targetMid, 'kcal')}`}
            >
              <CircularProgress
                progress={pct}
                size={HERO.RING_SIZE}
                strokeWidth={HERO.RING_STROKE}
                color={METRIC_COLORS.calories}
                value={consumed}
                label={`/ ${targetMid} kcal`}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.xl, width: '100%' }}>
              <MacroBar label="Protein" value={protein} target={proteinTarget} color={METRIC_COLORS.protein} />
              <MacroBar label="Karbonhidrat" value={carbs} target={carbsTarget} color={METRIC_COLORS.carbs} />
              <MacroBar label="Yağ" value={fat} target={fatTarget} color={METRIC_COLORS.fat} />
            </View>
          </>
        ) : (
          /* FIX (ux-pass2 #13): boş durum eylemsiz bir View'dı — artık hedef-belirleme
             görevini açan gerçek bir CTA (kanonik onboarding_goal task paramlarıyla). */
          <TouchableOpacity
            onPress={() => router.push({
              pathname: '/(tabs)/chat',
              params: {
                prefill: 'Hedeflerimi konuşmak istiyorum.',
                taskModeHint: 'onboarding_goal',
                taskNonce: String(Date.now()),
              },
            })}
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

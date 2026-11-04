/**
 * Uyum puanı kahramanı — gün sonu, haftalık ve aylık raporların açılış figürü.
 *
 * Eskiden üç rapor ekranı aynı halkayı (CircularProgress 120/8) kendi içinde ayrı ayrı çiziyordu
 * ve altındaki tek satır "Uyum Puanı" yazıyordu: %86'lık bir hafta ile %22'lik bir hafta aynı
 * tonla, aynı kuru sözle karşılanıyordu. Duolingo dilinde (DEVIR §0-A "az sayı, çok teşvik")
 * skor bir ÖLÇÜM değil bir AN:
 *   - Halkanın altında kademeye göre kısa bir teşvik hapı ("Çok iyi gidiyorsun", "Her gün yeni
 *     bir başlangıç"). Metin mürekkep (colors.text) — gök mavisi metin açık zeminde 2,8:1 kalıyordu;
 *     renk yalnız hapın ikonunda ve opak pastel zemininde.
 *   - İyi uyumda (≥70) ölçülü kutlama: halka 0.9→1 yaylanır, köşesine kehribar yıldız rozeti
 *     yayla oturur. `confetti` verilirse (yalnız haftalık özet) bir kez konfeti patlar.
 *     Reduce-motion → hepsi son hâlinde, konfeti yok.
 *   - Skor yoksa (o dönemde kayıt yok) halka sönük, "—" ve suçlamayan bir cümle.
 * Eşikler (70/40) ve renk rampası değişmedi — takvim/grafik eşiğiyle aynı yargı.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { View, Text, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, RADIUS, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE } from '@/lib/design';
import { useTheme, METRIC_COLORS, type ThemeColors } from '@/lib/theme';
import { CircularProgress } from '@/components/ui/CircularProgress';
import { ConfettiBurst } from '@/components/ui/ConfettiBurst';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { PLATE_INK, tint } from '@/components/reports/ReportBits';

/**
 * App-wide compliance color ramp (70/40 thresholds) — matches calendar,
 * daily and weekly reports so a given score reads as one consistent judgment.
 */
export function getComplianceColor(score: number, colors: ThemeColors): string {
  return score >= 70 ? colors.success : score >= 40 ? colors.warning : colors.error;
}

/** Kademeye göre teşvik cümlesi + ikon. Yalnız skordan türer — uydurma bilgi yok. */
export function complianceCheer(score: number): { text: string; icon: keyof typeof Ionicons.glyphMap } {
  if (score >= 85) return { text: 'Muhteşem! Böyle devam', icon: 'trophy' };
  if (score >= 70) return { text: 'Çok iyi gidiyorsun', icon: 'star' };
  if (score >= 40) return { text: 'İyi yoldasın, biraz daha', icon: 'trending-up' };
  return { text: 'Her gün yeni bir başlangıç', icon: 'sunny' };
}

interface HeroProps {
  /** 0-100; null → o dönemde kayıt yok. */
  score: number | null;
  /** Halkanın altındaki etiket (ör. "Ortalama Uyum"). */
  label?: string;
  /** Skor yokken etiketin yerine geçen cümle. */
  emptyLabel?: string;
  /** Halkayı ekran okuyucuya ilerleme çubuğu olarak tanıtan etiket. */
  a11yLabel?: string;
  /** İyi uyumda bir kez konfeti (yalnız haftalık özet — her ekranı konfetiye boğma). */
  confetti?: boolean;
  /** Trend satırı vb. — teşvik hapının altına. */
  children?: ReactNode;
}

export function ComplianceHero({ score, label = 'Uyum Puanı', emptyLabel = 'Bu dönemde kayıt yok', a11yLabel, confetti, children }: HeroProps) {
  const { colors, isDark } = useTheme();
  const reduceMotion = useReduceMotion();
  const has = score != null;
  const good = has && (score as number) >= 70;
  const color = has ? getComplianceColor(score as number, colors) : colors.textMuted;
  const cheer = has ? complianceCheer(score as number) : null;

  // Kutlama yayları (native driver: yalnız transform). İyi değilse ya da reduce-motion'da
  // ikisi de 1'de başlar — hiçbir şey oynamaz.
  const animate = good && !reduceMotion;
  const ringPop = useRef(new Animated.Value(animate ? 0.9 : 1)).current;
  const badgePop = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) { ringPop.setValue(1); badgePop.setValue(1); return; }
    const anim = Animated.sequence([
      Animated.spring(ringPop, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
      Animated.spring(badgePop, { toValue: 1, friction: 4, tension: 200, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [animate, ringPop, badgePop]);

  return (
    <View style={{ alignItems: 'center', paddingVertical: SPACING.md }}>
      {confetti && good && <ConfettiBurst burstKey={`hero-${score}`} count={18} spread={130} />}
      <Animated.View style={{ transform: [{ scale: ringPop }] }}>
        <CircularProgress
          progress={has ? (score as number) / 100 : 0}
          // FIX (ux-pass5): uyum her yerde yüzde ("%15 uyum") — çıplak "72" değil "%72".
          value={has ? `%${score}` : '—'}
          size={120}
          strokeWidth={10}
          color={color}
          a11yLabel={a11yLabel}
        />
        {good && (
          <Animated.View
            accessible={false}
            pointerEvents="none"
            style={{
              position: 'absolute', top: -2, right: -6,
              width: 38, height: 38, borderRadius: 19,
              backgroundColor: METRIC_COLORS.streak,
              borderWidth: 3, borderColor: colors.card,
              alignItems: 'center', justifyContent: 'center',
              transform: [{ scale: badgePop }, { rotate: badgePop.interpolate({ inputRange: [0, 1], outputRange: ['-30deg', '0deg'] }) }],
            }}
          >
            <Ionicons name="star" size={18} color={PLATE_INK} />
          </Animated.View>
        )}
      </Animated.View>
      <Text style={{ ...TYPE.body, color: colors.textSecondary, marginTop: SPACING.sm }}>{has ? label : emptyLabel}</Text>
      {cheer && (
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
            marginTop: SPACING.sm, paddingVertical: SPACING.xs + 2, paddingHorizontal: SPACING.md,
            borderRadius: RADIUS.pill, backgroundColor: tint(color, colors, isDark, 1.1),
          }}
        >
          <Ionicons name={cheer.icon} size={16} color={color} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.bodyStrong, color: colors.text, fontWeight: '700' }}>{cheer.text}</Text>
        </View>
      )}
      {children}
    </View>
  );
}

interface Props {
  score: number;
  label?: string;
  size?: 'small' | 'large';
}

/** Geriye dönük ad: gün sonu raporu bunu kullanıyor — artık kahramanın kendisi. */
export function ComplianceScore({ score, label = 'Uyum Puanı' }: Props) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={`${label}: 100 üzerinden ${score}`}>
      <ComplianceHero score={score} label={label} />
    </View>
  );
}

/**
 * Inline compliance badge for lists/calendar.
 */
export function ComplianceBadge({ score }: { score: number }) {
  const { colors, isDark } = useTheme();
  const color = getComplianceColor(score, colors);
  return (
    <View style={{ backgroundColor: tint(color, colors, isDark, 1.2), borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
      {/* FIX (ux-pass5): rozet de yüzde formatında — büyük halka ile tutarlı.
          Metin mürekkep: gök mavisi küçük metin açık zeminde AA altında kalıyordu. */}
      <Text style={{ ...TYPE.caption, color: colors.text, fontWeight: '700' }}>%{score}</Text>
    </View>
  );
}

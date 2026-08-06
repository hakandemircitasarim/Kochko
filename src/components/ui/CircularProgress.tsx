/**
 * Circular Progress Component
 * SVG-based ring progress indicator.
 *
 * GORSEL DIL (2026-08-06): "duz, gradyansiz" ilkesi ekranin KAHRAMANINI oldurmustu.
 * Ana sayfada bu halka 170px ve gunun tek odak noktasi; duz tek renk bir yay olarak
 * cizildiginde ve ilerleme 0 iken ekranda TAMAMEN sonuk gri bir cember kaliyordu —
 * uygulama "yer tutucu" gibi okunuyordu. Uc degisiklik:
 *   1. Yay gradyanli (ayni renk, 1.0 -> 0.55 opaklik). Tek renkte "boyanmis" degil,
 *      isik alan bir yuzey gibi okunuyor.
 *   2. Iz (track) biraz daha tanimli: halka, ilerleme sifirken bile bilincli bir NESNE.
 *   3. Yayin ucunda kucuk bir nokta: gozun "buradayim" diyecegi bir isaret.
 *
 * FIX (ux-ideas #5): the ring now ANIMATES — the arc sweeps from empty to its
 * target with Easing.out(cubic) and, when `value` is numeric, the centre number
 * counts up to match. The pattern is lifted from ProfileCompletionDonut (which
 * already animated) and centralised here so every consumer (Hero calorie ring,
 * reports) gets the premium fill+count reward at once. Respects reduce-motion:
 * when the OS flag is on we snap to the final state with no animation.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, AccessibilityInfo } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '@/lib/theme';
import { a11yProgress } from '@/lib/accessibility';
import { FONT, MAX_FONT_SCALE } from '@/lib/constants';
import { TYPE } from '@/lib/design';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  progress: number; // 0-1
  size?: number;
  strokeWidth?: number;
  color: string;
  trackColor?: string;
  value: string | number;
  unit?: string;
  label?: string;
  sublabel?: string;
  variant?: 'default' | 'hero';
  /** Spoken screen-reader label, e.g. "Kalori". When set, the ring announces
   *  itself as a progressbar (e.g. "Kalori: 1450 / 1800, 81%"). Leave unset
   *  if a parent already wraps this ring in its own accessible progressbar. */
  a11yLabel?: string;
  /** Target/max for the spoken progressbar value. Defaults to 100 (percent). */
  a11yMax?: number;
}

export function CircularProgress({
  progress,
  size = 160,
  strokeWidth = 12,
  color,
  trackColor,
  value,
  unit,
  label,
  sublabel,
  variant = 'default',
  a11yLabel,
  a11yMax,
}: Props) {
  const { colors } = useTheme();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.min(1, Math.max(0, progress));
  // Iz, ilerleme 0 iken ekranda kalan TEK sey. rgba(255,255,255,0.08) bir kahraman
  // icin fazla sessizdi: 170px'lik halka "silik bir daire" gibi duruyordu. Kahramanda
  // biraz daha tanimli, kucuk halkalarda eskisi gibi sessiz.
  // Iz KART RENGINDEN bagimsiz olmali: kahraman kart cardElevated'e tasindiginda
  // `surfaceLight` ile ayni hex'e (#22222E) dustu ve iz tamamen kayboldu — cihazda
  // yalnizca yesil yay kalmisti. Beyaz-alfa her yuzeyde calisir.
  const isHero = size >= 150;
  const track = trackColor || (isHero ? 'rgba(255,255,255,0.12)' : colors.progressTrack);
  // Ayni ekranda birden fazla halka olabilir (rapor kartlari) — gradyan id'si benzersiz olmali.
  const gradId = useRef(`ring-${Math.random().toString(36).slice(2, 9)}`).current;

  // Reduce-motion: snap instead of animate. Resolved once on mount + kept in sync.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (active) setReduceMotion(v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; sub?.remove?.(); };
  }, []);

  // --- Arc sweep -----------------------------------------------------------
  const sweep = useRef(new Animated.Value(clampedProgress)).current;
  useEffect(() => {
    if (reduceMotion) { sweep.setValue(clampedProgress); return; }
    const anim = Animated.timing(sweep, {
      toValue: clampedProgress,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [clampedProgress, reduceMotion, sweep]);
  const strokeDashoffset = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  // --- Count-up (numeric values only) --------------------------------------
  const isNumeric = typeof value === 'number';
  const numericValue = isNumeric ? (value as number) : 0;
  const [displayValue, setDisplayValue] = useState<number>(numericValue);
  const countAnim = useRef(new Animated.Value(numericValue)).current;
  useEffect(() => {
    if (!isNumeric) return;
    if (reduceMotion) { setDisplayValue(numericValue); countAnim.setValue(numericValue); return; }
    const id = countAnim.addListener(({ value: v }) => setDisplayValue(Math.round(v)));
    const anim = Animated.timing(countAnim, {
      toValue: numericValue,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => { anim.stop(); countAnim.removeListener(id); };
  }, [numericValue, isNumeric, reduceMotion, countAnim]);
  const shownValue = isNumeric ? displayValue : value;

  // When a11yLabel is supplied, announce the ring as a single progressbar node
  // (otherwise stay silent so a parent's own accessible wrapper takes over).
  const a11yProps = a11yLabel
    ? a11yProgress(a11yLabel, Math.round(clampedProgress * (a11yMax ?? 100)), a11yMax ?? 100)
    : undefined;

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }} {...a11yProps}>
      {/* Decorative ring — the numbers are exposed via the Text nodes / a11yProps */}
      <Svg width={size} height={size} accessible={false}>
        <Defs>
          {/* Ayni renkten iki durak: ust-sol tam, alt-sag yariya yakin. Renk matematigi
              yok — hangi metrik rengi gelirse gelsin dogru sonucu verir. */}
          <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="1" />
            <Stop offset="1" stopColor={color} stopOpacity="0.55" />
          </LinearGradient>
        </Defs>
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={track} strokeWidth={strokeWidth} fill="none"
        />
        <AnimatedCircle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={`url(#${gradId})`} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90, ${size / 2}, ${size / 2})`}
        />
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          {/* FIX (audit ui-circularprogress): cap font scaling so large system fonts don't overflow the fixed-size ring. */}
          {/* A HERO ring carries the single most important number on its screen — the calories left
              for the day. It was rendered at FONT.xxl (24), the same size as a section heading, so
              on a real device the dashboard's headline figure had no more weight than the words
              around it. TYPE.display exists for exactly this: one figure per screen, at a size that
              says "read me first". Small rings (the macro dials inside a chat bubble) are NOT hero
              figures and keep their original step — blowing those up would flatten the hierarchy in
              the other direction.
              08-04: the boundary was `> 120`, which put the 120px compliance ring of the weekly and
              monthly reports in the SMALL branch — so "%38", the headline figure of those screens,
              sat at 20px inside a 120px ring with the middle mostly empty. Three steps, not two:
              a full-page hero ring (dashboard), a report ring, and the macro dials. */}
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={
              size > 120
                ? { ...TYPE.display, color: colors.text }
                : size >= 120
                  ? { ...TYPE.title1, color: colors.text }
                  : { ...TYPE.title3, color: colors.text, letterSpacing: -1 }
            }
          >
            {shownValue}
          </Text>
          {unit && (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.caption, color: colors.textSecondary, marginLeft: 2 }}>
              {unit}
            </Text>
          )}
        </View>
        {label && (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.body, color: colors.textSecondary, marginTop: 2 }}>
            {label}
          </Text>
        )}
        {sublabel && (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ ...TYPE.caption, color: colors.textMuted, marginTop: 1 }}>
            {sublabel}
          </Text>
        )}
      </View>
    </View>
  );
}

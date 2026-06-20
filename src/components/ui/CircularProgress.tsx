/**
 * Circular Progress Component
 * SVG-based ring progress indicator — flat design, no gradients
 */
import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '@/lib/theme';
import { a11yProgress } from '@/lib/accessibility';
import { FONT, MAX_FONT_SCALE } from '@/lib/constants';

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
  const strokeDashoffset = circumference * (1 - clampedProgress);
  const track = trackColor || colors.progressTrack;

  // When a11yLabel is supplied, announce the ring as a single progressbar node
  // (otherwise stay silent so a parent's own accessible wrapper takes over).
  const a11yProps = a11yLabel
    ? a11yProgress(a11yLabel, Math.round(clampedProgress * (a11yMax ?? 100)), a11yMax ?? 100)
    : undefined;

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }} {...a11yProps}>
      {/* Decorative ring — the numbers are exposed via the Text nodes / a11yProps */}
      <Svg width={size} height={size} accessible={false}>
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={track} strokeWidth={strokeWidth} fill="none"
        />
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90, ${size / 2}, ${size / 2})`}
        />
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          {/* FIX (audit ui-circularprogress): cap font scaling so large system fonts don't overflow the fixed-size ring. */}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: size > 120 ? 24 : FONT.xl, fontWeight: '700', color: colors.text, letterSpacing: -1 }}>
            {value}
          </Text>
          {unit && (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: FONT.sm, fontWeight: '500', color: colors.textSecondary, marginLeft: 2 }}>
              {unit}
            </Text>
          )}
        </View>
        {label && (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: FONT.sm, color: colors.textSecondary, fontWeight: '400', marginTop: 2 }}>
            {label}
          </Text>
        )}
        {sublabel && (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: FONT.xs, color: colors.textMuted, marginTop: 1 }}>
            {sublabel}
          </Text>
        )}
      </View>
    </View>
  );
}

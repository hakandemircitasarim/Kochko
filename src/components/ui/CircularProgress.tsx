/**
 * Circular Progress Component
 * SVG-based ring progress indicator for calories, water, etc.
 * variant='hero' renders white text for use on gradient backgrounds.
 */
import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '@/lib/theme';
import { FONT } from '@/lib/constants';

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
}: Props) {
  const { colors } = useTheme();
  const isHero = variant === 'hero';
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - Math.min(1, Math.max(0, progress)));
  const track = trackColor || (isHero ? 'rgba(255,255,255,0.2)' : colors.progressTrack);

  const textColor = isHero ? '#FFFFFF' : colors.text;
  const mutedColor = isHero ? 'rgba(255,255,255,0.7)' : colors.textMuted;
  const sublabelColor = isHero ? 'rgba(255,255,255,0.5)' : colors.textMuted;

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
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
          <Text style={{ fontSize: size > 120 ? FONT.hero : FONT.xl, fontWeight: '800', color: textColor, letterSpacing: -1 }}>
            {value}
          </Text>
          {unit && (
            <Text style={{ fontSize: FONT.sm, fontWeight: '600', color: mutedColor, marginLeft: 2 }}>
              {unit}
            </Text>
          )}
        </View>
        {label && (
          <Text style={{ fontSize: FONT.sm, color: mutedColor, fontWeight: '500', marginTop: 2 }}>
            {label}
          </Text>
        )}
        {sublabel && (
          <Text style={{ fontSize: FONT.xs, color: sublabelColor, marginTop: 1 }}>
            {sublabel}
          </Text>
        )}
      </View>
    </View>
  );
}

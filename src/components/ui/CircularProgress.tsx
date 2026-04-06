/**
 * Circular Progress Component
 * SVG-based ring progress indicator — flat design, no gradients
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
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - Math.min(1, Math.max(0, progress)));
  const track = trackColor || colors.progressTrack;

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
          <Text style={{ fontSize: size > 120 ? 24 : FONT.xl, fontWeight: '700', color: colors.text, letterSpacing: -1 }}>
            {value}
          </Text>
          {unit && (
            <Text style={{ fontSize: FONT.sm, fontWeight: '500', color: colors.textSecondary, marginLeft: 2 }}>
              {unit}
            </Text>
          )}
        </View>
        {label && (
          <Text style={{ fontSize: FONT.sm, color: colors.textSecondary, fontWeight: '400', marginTop: 2 }}>
            {label}
          </Text>
        )}
        {sublabel && (
          <Text style={{ fontSize: FONT.xs, color: colors.textMuted, marginTop: 1 }}>
            {sublabel}
          </Text>
        )}
      </View>
    </View>
  );
}

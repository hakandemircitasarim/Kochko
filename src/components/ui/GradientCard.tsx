/**
 * Gradient Card Component
 * Modern colored card with gradient background for metric displays
 */
import React, { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { RADIUS, CARD_SHADOW } from '@/lib/constants';

interface Props {
  gradient: [string, string];
  children: ReactNode;
  style?: ViewStyle;
  borderRadius?: number;
  padding?: number;
}

export function GradientCard({ gradient, children, style, borderRadius = RADIUS.xl, padding = 16 }: Props) {
  return (
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        {
          borderRadius,
          padding,
          ...CARD_SHADOW,
        },
        style,
      ]}
    >
      {children}
    </LinearGradient>
  );
}

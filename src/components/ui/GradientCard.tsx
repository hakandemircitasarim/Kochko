/**
 * GradientCard → FlatCard migration wrapper
 * Gradients removed — renders flat colored card with accent background
 * @deprecated Prefer using Card component with style override instead
 */
import React, { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { RADIUS } from '@/lib/constants';

interface Props {
  gradient: [string, string];
  children: ReactNode;
  style?: ViewStyle;
  borderRadius?: number;
  padding?: number;
}

export function GradientCard({ gradient, children, style, borderRadius = RADIUS.md, padding = 14 }: Props) {
  return (
    <View
      style={[
        {
          borderRadius,
          padding,
          backgroundColor: gradient[0] + '18',
          borderWidth: 0.5,
          borderColor: gradient[0] + '30',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

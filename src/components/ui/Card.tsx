import React, { type ReactNode } from 'react';
import { View, Text, type ViewStyle } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

export function Card({ title, children, style }: { title?: string; children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ backgroundColor: COLORS.card, borderRadius: 16, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border }, style]}>
      {title && <Text style={{ color: COLORS.text, fontSize: FONT.lg, fontWeight: '600', marginBottom: SPACING.sm }}>{title}</Text>}
      {children}
    </View>
  );
}

import React, { type ReactNode } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from '@/lib/constants';

interface CardProps {
  title?: string;
  children: ReactNode;
  style?: ViewStyle;
}

export function Card({ title, children, style }: CardProps) {
  return (
    <View style={[styles.card, style]}>
      {title && <Text style={styles.title}>{title}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  title: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
});

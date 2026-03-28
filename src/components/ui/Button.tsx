import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, type ViewStyle } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export function Button({ title, onPress, variant = 'primary', size = 'md', loading, disabled, style }: Props) {
  const bg = variant === 'primary' ? COLORS.primary : variant === 'secondary' ? COLORS.secondary : variant === 'outline' ? 'transparent' : 'transparent';
  const border = variant === 'outline' ? COLORS.primary : 'transparent';
  const textColor = variant === 'outline' || variant === 'ghost' ? COLORS.primary : '#fff';
  const py = size === 'sm' ? SPACING.sm : size === 'lg' ? SPACING.md : SPACING.md - 2;
  const px = size === 'sm' ? SPACING.md : size === 'lg' ? SPACING.xl : SPACING.lg;
  const fontSize = size === 'sm' ? FONT.sm : size === 'lg' ? FONT.lg : FONT.md;

  return (
    <TouchableOpacity
      style={[{ backgroundColor: bg, borderColor: border, borderWidth: variant === 'outline' ? 1.5 : 0, borderRadius: 12, paddingVertical: py, paddingHorizontal: px, alignItems: 'center', opacity: disabled || loading ? 0.5 : 1 }, style]}
      onPress={onPress} disabled={disabled || loading} activeOpacity={0.7}
    >
      {loading ? <ActivityIndicator color={textColor} /> : <Text style={{ color: textColor, fontSize, fontWeight: '600' }}>{title}</Text>}
    </TouchableOpacity>
  );
}

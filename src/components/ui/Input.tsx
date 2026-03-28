import React from 'react';
import { View, TextInput, Text, type TextInputProps } from 'react-native';
import { COLORS, SPACING, FONT } from '@/lib/constants';

interface Props extends TextInputProps { label?: string; error?: string; }

export function Input({ label, error, style, ...props }: Props) {
  return (
    <View style={{ marginBottom: SPACING.md }}>
      {label && <Text style={{ color: COLORS.textSecondary, fontSize: FONT.sm, marginBottom: SPACING.xs, fontWeight: '500' }}>{label}</Text>}
      <TextInput
        style={[{ backgroundColor: COLORS.inputBg, borderRadius: 12, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md - 2, color: COLORS.text, fontSize: FONT.md, borderWidth: 1, borderColor: error ? COLORS.error : COLORS.border }, style]}
        placeholderTextColor={COLORS.textMuted} {...props}
      />
      {error && <Text style={{ color: COLORS.error, fontSize: FONT.xs, marginTop: SPACING.xs }}>{error}</Text>}
    </View>
  );
}

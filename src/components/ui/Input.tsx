import React from 'react';
import { View, TextInput, Text, type TextInputProps } from 'react-native';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, style, ...props }: Props) {
  const { colors } = useTheme();

  return (
    <View style={{ marginBottom: SPACING.md }}>
      {label && (
        <Text style={{ color: colors.textSecondary, fontSize: FONT.sm, fontWeight: '500', marginBottom: SPACING.xs + 2 }}>
          {label}
        </Text>
      )}
      <TextInput
        style={[
          {
            backgroundColor: colors.inputBg,
            borderRadius: RADIUS.md,
            paddingHorizontal: SPACING.xl,
            paddingVertical: SPACING.md,
            color: colors.text,
            fontSize: FONT.sm,
            borderWidth: 0.5,
            borderColor: error ? colors.error : colors.border,
          },
          style,
        ]}
        placeholderTextColor={colors.textMuted}
        {...props}
      />
      {error && <Text style={{ color: colors.error, fontSize: FONT.xs, marginTop: SPACING.xs }}>{error}</Text>}
      {hint && !error && <Text style={{ color: colors.textMuted, fontSize: FONT.xs, marginTop: SPACING.xs }}>{hint}</Text>}
    </View>
  );
}

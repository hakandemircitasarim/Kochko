/**
 * Input Component — Enhanced TextInput with label, error, character count, prefix/suffix.
 * Spec 22.1: Minimum touch target 44px.
 */
import React, { useState } from 'react';
import { View, TextInput, Text, type TextInputProps, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT, RADIUS, TOUCH_TARGET } from '@/lib/constants';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  maxCharacters?: number;
  prefix?: string;
  suffix?: string;
  onClear?: () => void;
}

export function Input({ label, error, hint, maxCharacters, prefix, suffix, onClear, style, value, ...props }: Props) {
  const [focused, setFocused] = useState(false);
  const charCount = value?.length ?? 0;
  const isOverLimit = maxCharacters ? charCount > maxCharacters : false;

  return (
    <View style={{ marginBottom: SPACING.md }}>
      {/* Label */}
      {label && (
        <Text style={{
          color: error ? COLORS.error : focused ? COLORS.primary : COLORS.textSecondary,
          fontSize: FONT.sm, marginBottom: SPACING.xs, fontWeight: '500',
        }}>
          {label}
        </Text>
      )}

      {/* Input container */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: COLORS.inputBg, borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: error ? COLORS.error : focused ? COLORS.borderFocus : COLORS.border,
        minHeight: TOUCH_TARGET,
      }}>
        {prefix && (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.md, paddingLeft: SPACING.md }}>{prefix}</Text>
        )}

        <TextInput
          style={[{
            flex: 1,
            paddingHorizontal: SPACING.md,
            paddingVertical: SPACING.md - 2,
            color: COLORS.text,
            fontSize: FONT.md,
          }, style]}
          placeholderTextColor={COLORS.textMuted}
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />

        {suffix && (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT.sm, paddingRight: SPACING.md }}>{suffix}</Text>
        )}

        {onClear && value && (value as string).length > 0 && (
          <TouchableOpacity onPress={onClear} style={{ paddingRight: SPACING.md, paddingVertical: SPACING.sm }}>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT.md }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Bottom row: error/hint + character count */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.xxs }}>
        <View style={{ flex: 1 }}>
          {error && <Text style={{ color: COLORS.error, fontSize: FONT.xs }}>{error}</Text>}
          {hint && !error && <Text style={{ color: COLORS.textMuted, fontSize: FONT.xs }}>{hint}</Text>}
        </View>
        {maxCharacters && (
          <Text style={{ color: isOverLimit ? COLORS.error : COLORS.textMuted, fontSize: FONT.xs }}>
            {charCount}/{maxCharacters}
          </Text>
        )}
      </View>
    </View>
  );
}

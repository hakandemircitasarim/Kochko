import React, { forwardRef, useState } from 'react';
import { View, TextInput, Text, Pressable, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { SPACING, FONT, RADIUS } from '@/lib/constants';
import { TYPE } from '@/lib/design';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  /** Renders an eye toggle to reveal/hide the entered text (for password fields). */
  secureToggle?: boolean;
}

export const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, hint, secureToggle, style, secureTextEntry, ...props },
  ref,
) {
  const { colors } = useTheme();
  const [revealed, setRevealed] = useState(false);

  // When secureToggle is on, the eye controls masking; otherwise honor the prop.
  const masked = secureToggle ? !revealed : secureTextEntry;

  return (
    <View style={{ marginBottom: SPACING.md }}>
      {label && (
        <Text style={{ ...TYPE.callout, color: colors.textSecondary, fontWeight: '500', marginBottom: SPACING.xs + 2 }}>
          {label}
        </Text>
      )}
      <View style={{ justifyContent: 'center' }}>
        <TextInput
          ref={ref}
          style={[
            {
              backgroundColor: colors.inputBg,
              borderRadius: RADIUS.md,
              paddingHorizontal: SPACING.xl,
              paddingVertical: SPACING.md,
              paddingRight: secureToggle ? SPACING.xl + 44 : SPACING.xl,
              color: colors.text,
              // You TYPE here — 13px is below the app's own reading size, so text you are actively
              // entering was smaller than text you passively read. TYPE.body is the reading step.
              ...TYPE.body,
              borderWidth: 0.5,
              borderColor: error ? colors.error : colors.border,
            },
            style,
          ]}
          placeholderTextColor={colors.textSecondary}
          secureTextEntry={masked}
          {...props}
          // FIX (ux-pass5, audit UX-A11-03): the visual label was only a sibling <Text> —
          // screen readers heard just the placeholder (or the bare value once filled) on
          // visually identical fields. Placed after the spread so an explicit
          // accessibilityLabel from a consumer still wins.
          accessibilityLabel={props.accessibilityLabel ?? label}
        />
        {secureToggle && (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Şifreyi gizle' : 'Şifreyi göster'}
            style={{
              position: 'absolute',
              right: SPACING.xs,
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={revealed ? colors.primary : colors.textMuted}
            />
          </Pressable>
        )}
      </View>
      {/* An error message is the one line a user MUST read to recover — 11px was the smallest step
          in the app for the most important sentence on the screen. */}
      {error && <Text style={{ ...TYPE.caption, color: colors.error, marginTop: SPACING.xs }}>{error}</Text>}
      {hint && !error && <Text style={{ ...TYPE.caption, color: colors.textSecondary, marginTop: SPACING.xs }}>{hint}</Text>}
    </View>
  );
});
